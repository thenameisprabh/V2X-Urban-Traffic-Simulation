/**
 * @file map-layer-manager.js
 * @description Render loop orchestrator for the 2D map renderer.
 *
 * Responsibilities:
 *   - Acquires and owns the CanvasRenderingContext2D
 *   - Maintains an ordered list of layer renderers
 *   - Runs a requestAnimationFrame render loop
 *   - Implements dirty-flag rendering (skips frames when nothing changed)
 *   - Manages layer lifecycle: initialize → render → resize → destroy
 *   - Applies DPR canvas scaling before each frame
 *
 * This class MUST NOT:
 *   - Render any geometry itself
 *   - Fetch data from the backend
 *   - Listen to DOM events (that is MapInteraction's job)
 *   - Know about specific layer implementations
 *
 * Layer renderer interface (all methods optional — manager guards each call):
 *   initialize(ctx, projector, network, supplement) → void
 *   render(ctx, projector, timestamp)               → void
 *   resize(cssWidth, cssHeight)                     → void
 *   destroy()                                       → void
 *
 * @module rendering/core/map-layer-manager
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target frame rate cap. RAF naturally caps at monitor refresh; this is a
 *  secondary guard to prevent runaway loops on high-refresh displays. */
const TARGET_FPS     = 60;
const MIN_FRAME_MS   = 1000 / TARGET_FPS;

/** How many consecutive identical frames before the loop idles.
 *  Set to Infinity to always render (useful during development). */
const IDLE_AFTER_FRAMES = Infinity;

// ---------------------------------------------------------------------------
// MapLayerManager
// ---------------------------------------------------------------------------

/**
 * Orchestrates all 2D map layer renderers inside a single canvas.
 */
class MapLayerManager {

    /**
     * @param {HTMLCanvasElement}  canvas      The #map-canvas element.
     * @param {SimProjector}       projector   Coordinate maths engine (Phase 1B Step 1).
     * @param {object}             network     RenderNetwork from roadNetworkAdapter (Phase 1A).
     * @param {object}             supplement  OSMSupplementProvider instance (Phase 0).
     */
    constructor(canvas, projector, network, supplement) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('[MapLayerManager] canvas must be an HTMLCanvasElement');
        }
        if (!projector || typeof projector.project !== 'function') {
            throw new Error('[MapLayerManager] projector must be a SimProjector instance');
        }

        this._canvas     = canvas;
        this._projector  = projector;
        this._network    = network   ?? {};
        this._supplement = supplement ?? {};

        // Acquire context once — never expose raw ctx outside this class
        this._ctx = canvas.getContext('2d', { alpha: true });
        if (!this._ctx) {
            throw new Error('[MapLayerManager] Failed to acquire 2D context from canvas');
        }

        /** @type {Array<object>} Ordered array of layer renderer instances. */
        this._layers = [];

        /** @type {boolean} Whether a redraw is needed on the next frame. */
        this._dirty = true;

        /** @type {boolean} Whether the render loop is running. */
        this._running = false;

        /** @type {number|null} requestAnimationFrame handle. */
        this._rafHandle = null;

        /** @type {number} Timestamp of the last rendered frame. */
        this._lastFrameTime = 0;

        /** @type {boolean} Whether initialize() has been called. */
        this._initialised = false;

        /** @type {ResizeObserver} Watches canvas parent for size changes. */
        this._resizeObserver = null;

        console.info('[MapLayerManager] constructed');
    }

    // -----------------------------------------------------------------------
    // Public — Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Initializes all registered layer renderers and starts the render loop.
     * Must be called once after all layers have been added via addLayer().
     *
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this._initialised) {
            console.warn('[MapLayerManager] initialize() called more than once — ignoring');
            return;
        }

        console.info('[MapLayerManager] initializing', this._layers.length, 'layers...');

        // Initialize each layer — guard against scaffold no-ops and errors
        for (const layer of this._layers) {
            await _safeCall(layer, 'initialize',
                [this._ctx, this._projector, this._network, this._supplement],
                layer.constructor?.name ?? 'UnknownLayer');
        }

        // Set up ResizeObserver on the canvas parent
        this._setupResizeObserver();

        this._initialised = true;
        this.markDirty();

        console.info('[MapLayerManager] initialized — starting render loop');
        this.start();
    }

    /**
     * Starts the requestAnimationFrame render loop.
     * Safe to call multiple times — only one loop runs at a time.
     */
    start() {
        if (this._running) return;
        this._running   = true;
        this._rafHandle = requestAnimationFrame(this._loop.bind(this));
        console.info('[MapLayerManager] render loop started');
    }

    /**
     * Stops the render loop. Renderers remain initialized and can be restarted.
     */
    stop() {
        this._running = false;
        if (this._rafHandle !== null) {
            cancelAnimationFrame(this._rafHandle);
            this._rafHandle = null;
        }
        console.info('[MapLayerManager] render loop stopped');
    }

    /**
     * Destroys all layers, stops the loop, and disconnects observers.
     * After destroy() this instance must not be reused.
     */
    destroy() {
        this.stop();

        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        for (const layer of this._layers) {
            _safeCall(layer, 'destroy', [], layer.constructor?.name ?? 'UnknownLayer');
        }

        this._layers      = [];
        this._initialised = false;

        console.info('[MapLayerManager] destroyed');
    }

    // -----------------------------------------------------------------------
    // Public — Layer management
    // -----------------------------------------------------------------------

    /**
     * Registers a layer renderer. Must be called before initialize().
     * Layers render in registration order (first added = bottom of stack).
     *
     * @param {object} layer  Any object implementing the layer renderer interface.
     * @returns {MapLayerManager} this (fluent API)
     */
    addLayer(layer) {
        if (this._initialised) {
            throw new Error('[MapLayerManager] addLayer() must be called before initialize()');
        }
        if (!layer || typeof layer !== 'object') {
            throw new Error('[MapLayerManager] layer must be an object');
        }
        this._layers.push(layer);
        return this;
    }

    /**
     * Returns layer at index or by constructor name. Useful for testing.
     *
     * @param {number|string} indexOrName
     * @returns {object|undefined}
     */
    getLayer(indexOrName) {
        if (typeof indexOrName === 'number') return this._layers[indexOrName];
        return this._layers.find(l => l.constructor?.name === indexOrName);
    }

    // -----------------------------------------------------------------------
    // Public — Render control
    // -----------------------------------------------------------------------

    /**
     * Signals that the scene has changed and a redraw is needed.
     * Call this after updating vehicle positions, signal states, etc.
     */
    markDirty() {
        this._dirty = true;
    }

    /**
     * Forces an immediate synchronous render outside the RAF loop.
     * Useful for testing. Does not affect the dirty flag or the loop.
     */
    forceRender() {
        this._draw(performance.now());
    }

    // -----------------------------------------------------------------------
    // Public — Resize
    // -----------------------------------------------------------------------

    /**
     * Handles canvas resize. Called by ResizeObserver and externally if needed.
     * Updates projector, notifies all layers, marks dirty.
     */
    onResize() {
        this._projector.resize();

        const w = this._projector.cssWidth;
        const h = this._projector.cssHeight;

        for (const layer of this._layers) {
            _safeCall(layer, 'resize', [w, h], layer.constructor?.name ?? 'UnknownLayer');
        }

        this.markDirty();
        console.info('[MapLayerManager] resize →', w, 'x', h);
    }

    // -----------------------------------------------------------------------
    // Private — Render loop
    // -----------------------------------------------------------------------

    /**
     * requestAnimationFrame callback.
     * @param {number} timestamp  DOMHighResTimeStamp from RAF.
     * @private
     */
    _loop(timestamp) {
        if (!this._running) return;

        // Schedule next frame immediately so timing is consistent
        this._rafHandle = requestAnimationFrame(this._loop.bind(this));

        // ── Tick projector: advance animations + follow smoothing ─────────
        // tick() returns true when the camera moved this frame.
        // We read the latest vehicle list from the vehicle layer so the
        // projector can locate the followed vehicle without importing it.
        const vehicleLayer = this.getLayer('VehicleOverlayRenderer');
        const vehicles     = vehicleLayer?._vehicles ?? null;
        if (typeof this._projector.tick === 'function') {
            if (this._projector.tick(timestamp, vehicles)) {
                this._dirty = true;
            }
        }

        // ── Tick interaction: drain smooth-zoom accumulator ───────────────
        // MapInteraction may expose a tickZoom() for accumulated wheel deltas.
        if (this._interaction && typeof this._interaction.tickZoom === 'function') {
            if (this._interaction.tickZoom()) {
                this._dirty = true;
            }
        }

        // Frame rate cap
        if (timestamp - this._lastFrameTime < MIN_FRAME_MS) return;

        // Skip if nothing changed
        if (!this._dirty) return;

        this._lastFrameTime = timestamp;
        this._dirty         = false;

        this._draw(timestamp);
    }

    /**
     * Performs a single full render pass across all layers.
     * @param {number} timestamp
     * @private
     */
    _draw(timestamp) {
        const ctx  = this._ctx;
        const proj = this._projector;
        const dpr  = proj.dpr;

        // ✅ MUST clear BEFORE save()/scale() — operates in raw physical pixels
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

        // Now scale so all layer renderers work in CSS pixel space
        ctx.save();
        ctx.scale(dpr, dpr);

        // Render each layer in order (bottom → top)
        for (const layer of this._layers) {
            ctx.save();
            _safeCall(layer, 'render', [ctx, proj, timestamp],
                layer.constructor?.name ?? 'UnknownLayer');
            ctx.restore();
        }

        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Private — ResizeObserver setup
    // -----------------------------------------------------------------------

    /**
     * Watches the canvas element for size changes and triggers onResize().
     * Falls back to window resize event if ResizeObserver is unavailable.
     * @private
     */
    _setupResizeObserver() {
        if (typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => {
                this.onResize();
            });
            this._resizeObserver.observe(this._canvas);
        } else {
            // Fallback for older browsers
            window.addEventListener('resize', () => this.onResize());
            console.warn('[MapLayerManager] ResizeObserver unavailable — using window resize');
        }
    }
}

// ---------------------------------------------------------------------------
// Private helpers — module-scoped
// ---------------------------------------------------------------------------

/**
 * Safely calls a method on a layer renderer.
 * Returns the method's return value, or undefined if the method is absent or throws.
 *
 * @param {object}   layer   Layer renderer instance.
 * @param {string}   method  Method name.
 * @param {Array}    args    Arguments array.
 * @param {string}   name    Layer name for error messages.
 * @returns {*}
 */
function _safeCall(layer, method, args, name) {
    if (typeof layer[method] !== 'function') return undefined;
    try {
        return layer[method](...args);
    } catch (err) {
        console.error(`[MapLayerManager] ${name}.${method}() threw:`, err);
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.MapLayerManager = MapLayerManager;

console.info('[MapLayerManager] module loaded');
/**
 * @file map-interaction.js
 * @description Input event handler for the 2D map canvas.
 *
 * Responsibilities:
 *   - Mouse wheel → zoom toward cursor
 *   - Mouse drag  → pan
 *   - Touch pinch → zoom
 *   - Touch drag  → pan
 *   - Double-click → fit world into view
 *   - Enables pointer-events on #map-canvas when active
 *
 * This class MUST NOT:
 *   - Render anything
 *   - Fetch data
 *   - Know about roads, vehicles, or any domain object
 *   - Hold references beyond canvas, projector, layerManager
 *
 * All listeners are stored and removed cleanly in destroy().
 *
 * @module rendering/ui/map-interaction
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum pixel movement before a mousedown is treated as a drag. */
const DRAG_THRESHOLD_PX = 3;

/** Prevent wheel events firing faster than this (ms). */
const WHEEL_THROTTLE_MS = 16;

// ---------------------------------------------------------------------------
// MapInteraction
// ---------------------------------------------------------------------------

class MapInteraction {

    /**
     * @param {HTMLCanvasElement} canvas       The #map-canvas element.
     * @param {SimProjector}      projector    Coordinate maths engine.
     * @param {MapLayerManager}   layerManager Render loop orchestrator.
     */
    constructor(canvas, projector, layerManager) {
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('[MapInteraction] canvas must be an HTMLCanvasElement');
        }
        if (typeof projector?.project !== 'function') {
            throw new Error('[MapInteraction] projector must be a SimProjector instance');
        }
        if (typeof layerManager?.markDirty !== 'function') {
            throw new Error('[MapInteraction] layerManager must be a MapLayerManager instance');
        }

        this._canvas       = canvas;
        this._projector    = projector;
        this._layerManager = layerManager;

        // Drag state
        this._dragging     = false;
        this._dragStartX   = 0;
        this._dragStartY   = 0;
        this._lastDragX    = 0;
        this._lastDragY    = 0;
        this._dragMoved    = false;

        // Pinch state
        this._pinchDist    = null;

        // Wheel throttle
        this._lastWheelTime = 0;

        // Bound listener references — stored so we can removeEventListener cleanly
        this._listeners = [];

        this._active = false;
    }

    // -----------------------------------------------------------------------
    // Public — Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Attaches all event listeners and enables pointer-events on the canvas.
     * Safe to call multiple times — only attaches once.
     */
    enable() {
        if (this._active) return;
        this._active = true;

        // Enable pointer interaction on the canvas
        this._canvas.style.pointerEvents = 'auto';
        this._canvas.style.cursor        = 'grab';

        this._on(this._canvas, 'wheel',       this._onWheel.bind(this),
                 { passive: false });
        this._on(this._canvas, 'mousedown',   this._onMouseDown.bind(this));
        this._on(window,       'mousemove',   this._onMouseMove.bind(this));
        this._on(window,       'mouseup',     this._onMouseUp.bind(this));
        this._on(this._canvas, 'dblclick',    this._onDblClick.bind(this));
        this._on(this._canvas, 'touchstart',  this._onTouchStart.bind(this),
                 { passive: false });
        this._on(this._canvas, 'touchmove',   this._onTouchMove.bind(this),
                 { passive: false });
        this._on(this._canvas, 'touchend',    this._onTouchEnd.bind(this));
        this._on(this._canvas, 'contextmenu', this._onContextMenu.bind(this));

        console.info('[MapInteraction] enabled');
    }

    /**
     * Detaches all event listeners and disables pointer-events on the canvas.
     */
    disable() {
        if (!this._active) return;
        this._active = false;

        this._canvas.style.pointerEvents = 'none';
        this._canvas.style.cursor        = '';

        for (const { target, type, handler, options } of this._listeners) {
            target.removeEventListener(type, handler, options);
        }
        this._listeners = [];

        console.info('[MapInteraction] disabled');
    }

    /**
     * Permanently destroys this instance. Alias for disable() — after this
     * the instance must not be reused.
     */
    destroy() {
        this.disable();
        console.info('[MapInteraction] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private — Mouse events
    // -----------------------------------------------------------------------

    /** @private */
    _onWheel(e) {
        e.preventDefault();
        e.stopPropagation();

        // Throttle
        const now = performance.now();
        if (now - this._lastWheelTime < WHEEL_THROTTLE_MS) return;
        this._lastWheelTime = now;

        const rect = this._canvas.getBoundingClientRect();
        const cx   = e.clientX - rect.left;
        const cy   = e.clientY - rect.top;

        // Normalise delta across browsers and input devices
        // deltaMode 0 = pixels, 1 = lines (~16px), 2 = pages (~400px)
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 16;
        if (e.deltaMode === 2) delta *= 400;

        this._projector.zoom(delta, cx, cy);
        this._layerManager.markDirty();
    }

    /** @private */
    _onMouseDown(e) {
        if (e.button !== 0) return; // left button only
        this._dragging   = true;
        this._dragMoved  = false;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;
        this._lastDragX  = e.clientX;
        this._lastDragY  = e.clientY;
        this._canvas.style.cursor = 'grabbing';
    }

    /** @private */
    _onMouseMove(e) {
        if (!this._dragging) return;

        const dx = e.clientX - this._lastDragX;
        const dy = e.clientY - this._lastDragY;
        this._lastDragX = e.clientX;
        this._lastDragY = e.clientY;

        // Only register as drag after threshold (avoids accidental click-drags)
        const totalDx = e.clientX - this._dragStartX;
        const totalDy = e.clientY - this._dragStartY;
        if (!this._dragMoved &&
            Math.hypot(totalDx, totalDy) < DRAG_THRESHOLD_PX) return;

        this._dragMoved = true;
        this._projector.pan(dx, dy);
        this._layerManager.markDirty();
    }

    /** @private */
    _onMouseUp(e) {
        if (!this._dragging) return;
        this._dragging = false;
        this._canvas.style.cursor = 'grab';
    }

    /** @private */
    _onDblClick(e) {
        e.preventDefault();
        this._projector.fit();
        this._layerManager.markDirty();
        console.info('[MapInteraction] double-click → fit()');
    }

    /** @private */
    _onContextMenu(e) {
        e.preventDefault(); // suppress right-click menu on canvas
    }

    // -----------------------------------------------------------------------
    // Private — Touch events
    // -----------------------------------------------------------------------

    /** @private */
    _onTouchStart(e) {
        e.preventDefault();

        if (e.touches.length === 1) {
            // Single finger — pan
            this._dragging  = true;
            this._dragMoved = false;
            this._lastDragX = e.touches[0].clientX;
            this._lastDragY = e.touches[0].clientY;
            this._pinchDist = null;

        } else if (e.touches.length === 2) {
            // Two fingers — pinch zoom
            this._dragging  = false;
            this._pinchDist = _touchDistance(e.touches);
        }
    }

    /** @private */
    _onTouchMove(e) {
        e.preventDefault();

        if (e.touches.length === 1 && this._dragging) {
            const dx = e.touches[0].clientX - this._lastDragX;
            const dy = e.touches[0].clientY - this._lastDragY;
            this._lastDragX = e.touches[0].clientX;
            this._lastDragY = e.touches[0].clientY;

            if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
                this._projector.pan(dx, dy);
                this._layerManager.markDirty();
            }

        } else if (e.touches.length === 2 && this._pinchDist !== null) {
            const newDist = _touchDistance(e.touches);
            const delta   = this._pinchDist - newDist; // positive = pinch in = zoom out

            // Find midpoint between two fingers as zoom focus
            const rect    = this._canvas.getBoundingClientRect();
            const midX    = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const midY    = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

            this._projector.zoom(delta * 3, midX, midY);
            this._layerManager.markDirty();
            this._pinchDist = newDist;
        }
    }

    /** @private */
    _onTouchEnd(e) {
        if (e.touches.length === 0) {
            this._dragging  = false;
            this._pinchDist = null;
        } else if (e.touches.length === 1) {
            // Went from pinch to single finger — reset drag
            this._dragging  = true;
            this._lastDragX = e.touches[0].clientX;
            this._lastDragY = e.touches[0].clientY;
            this._pinchDist = null;
        }
    }

    // -----------------------------------------------------------------------
    // Private — Listener management
    // -----------------------------------------------------------------------

    /**
     * Adds an event listener and stores it for clean removal in disable().
     * @private
     */
    _on(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        this._listeners.push({ target, type, handler, options });
    }
}

// ---------------------------------------------------------------------------
// Private helpers — module-scoped
// ---------------------------------------------------------------------------

/**
 * Returns the pixel distance between two touch points.
 * @param {TouchList} touches
 * @returns {number}
 */
function _touchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.MapInteraction = MapInteraction;

console.info('[MapInteraction] module loaded');

/**
 * @file view-mode-controller.js
 * @description Controls which canvas is visible and interactive.
 *
 * Manages the visual relationship between:
 *   - #sim-canvas  (Three.js 3D simulation)
 *   - #map-canvas  (2D map renderer)
 *
 * Supported modes:
 *   MAP_2D  — 2D map is visible and interactive; 3D sim fades to background
 *   SIM_3D  — 3D sim is visible and interactive; 2D map is hidden (default)
 *   SPLIT   — reserved for Phase 3; not yet implemented
 *
 * Phase 1B behaviour:
 *   The class is fully implemented but NOT wired to any DOM button.
 *   Button wiring happens in Phase 2 when the map renders visible content.
 *   Calling showMap() / show3D() works correctly but nothing triggers it yet.
 *
 * CSS contract:
 *   - #map-canvas must have position:absolute; inset:0 (set in rendering.css)
 *   - #sim-canvas sits at its natural position (no absolute needed)
 *   - Transitions are CSS-driven via opacity for smooth switching
 *
 * @module rendering/ui/view-mode-controller
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Enumeration of supported view modes. */
const VIEW_MODE = Object.freeze({
    SIM_3D : 'SIM_3D',
    MAP_2D : 'MAP_2D',
    SPLIT  : 'SPLIT',   // reserved — not yet implemented
});

/** CSS transition duration for canvas switching (ms). */
const TRANSITION_MS = 300;

/** Opacity values for active vs background canvas. */
const OPACITY = Object.freeze({
    ACTIVE     : '1',
    BACKGROUND : '0',
    DIM        : '0.15',   // future: dim sim while map is primary
});

// ---------------------------------------------------------------------------
// ViewModeController
// ---------------------------------------------------------------------------

class ViewModeController {

    /**
     * @param {HTMLCanvasElement} simCanvas   The #sim-canvas (Three.js).
     * @param {HTMLCanvasElement} mapCanvas   The #map-canvas (2D renderer).
     * @param {MapLayerManager}   layerManager  2D render loop orchestrator.
     * @param {object}            [options]
     * @param {string}            [options.initialMode]  VIEW_MODE constant. Default: SIM_3D.
     */
    constructor(simCanvas, mapCanvas, layerManager, options = {}) {
        _assertCanvas(simCanvas, 'simCanvas');
        _assertCanvas(mapCanvas, 'mapCanvas');

        if (typeof layerManager?.markDirty !== 'function') {
            throw new Error('[ViewModeController] layerManager must be a MapLayerManager instance');
        }

        this._simCanvas    = simCanvas;
        this._mapCanvas    = mapCanvas;
        this._layerManager = layerManager;

        /** @type {string} Current active view mode. */
        this._mode = options.initialMode ?? VIEW_MODE.SIM_3D;

        /** @type {boolean} Whether the map renderer is paused. */
        this._paused = false;

        /** @type {Array<Function>} Registered mode-change listeners. */
        this._listeners = [];

        // Apply CSS transition to both canvases once at construction
        _applyTransition(this._simCanvas, TRANSITION_MS);
        _applyTransition(this._mapCanvas, TRANSITION_MS);

        // Apply initial state without animation
        this._applyMode(this._mode, /* animate= */ false);

        console.info('[ViewModeController] constructed — initial mode:', this._mode);
    }

    // -----------------------------------------------------------------------
    // Public — Mode switching
    // -----------------------------------------------------------------------

    /**
     * Switches to 2D map view.
     * Map canvas becomes visible and interactive.
     * Sim canvas dims to background.
     */
    showMap() {
        if (this._mode === VIEW_MODE.MAP_2D) return;
        this._setMode(VIEW_MODE.MAP_2D);
    }

    /**
     * Switches to 3D simulation view.
     * Sim canvas becomes visible and interactive.
     * Map canvas becomes hidden.
     */
    show3D() {
        if (this._mode === VIEW_MODE.SIM_3D) return;
        this._setMode(VIEW_MODE.SIM_3D);
    }

    /**
     * Toggles between MAP_2D and SIM_3D.
     * If currently in SPLIT, switches to MAP_2D.
     */
    toggle() {
        if (this._mode === VIEW_MODE.MAP_2D) {
            this.show3D();
        } else {
            this.showMap();
        }
    }

    // -----------------------------------------------------------------------
    // Public — Render pause/resume
    // -----------------------------------------------------------------------

    /**
     * Pauses the 2D map render loop.
     * Use when the map is not visible to conserve CPU/GPU.
     */
    pause() {
        if (this._paused) return;
        this._paused = true;
        this._layerManager.stop();
        console.info('[ViewModeController] map renderer paused');
    }

    /**
     * Resumes the 2D map render loop.
     * Automatically marks dirty so the next frame redraws.
     */
    resume() {
        if (!this._paused) return;
        this._paused = false;
        this._layerManager.markDirty();
        this._layerManager.start();
        console.info('[ViewModeController] map renderer resumed');
    }

    // -----------------------------------------------------------------------
    // Public — Event subscription
    // -----------------------------------------------------------------------

    /**
     * Registers a listener called whenever the view mode changes.
     * Useful for updating HUD button states in Phase 2.
     *
     * @param {Function} fn  Called with (newMode, oldMode).
     * @returns {Function}   Unsubscribe function.
     */
    onModeChange(fn) {
        if (typeof fn !== 'function') {
            throw new Error('[ViewModeController] onModeChange requires a function');
        }
        this._listeners.push(fn);
        return () => {
            this._listeners = this._listeners.filter(l => l !== fn);
        };
    }

    // -----------------------------------------------------------------------
    // Public — Accessors
    // -----------------------------------------------------------------------

    /** @returns {string} Current VIEW_MODE value. */
    get mode() { return this._mode; }

    /** @returns {boolean} Whether the map renderer is paused. */
    get paused() { return this._paused; }

    /** @returns {object} The VIEW_MODE enum (for external reference). */
    get VIEW_MODE() { return VIEW_MODE; }

    // -----------------------------------------------------------------------
    // Public — Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Destroys the controller. Removes all listeners.
     * Does not destroy the canvases or the layer manager.
     */
    destroy() {
        this._listeners = [];
        console.info('[ViewModeController] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private — Mode application
    // -----------------------------------------------------------------------

    /**
     * Sets a new mode, applies CSS, notifies listeners.
     * @param {string}  newMode
     * @private
     */
    _setMode(newMode) {
        const oldMode = this._mode;
        this._mode    = newMode;
        this._applyMode(newMode, /* animate= */ true);
        this._notify(newMode, oldMode);
        console.info('[ViewModeController] mode:', oldMode, '→', newMode);
    }

    setMode(newMode) {
        this._setMode(newMode);
    }

    /**
     * Applies opacity and pointer-events to both canvases for a given mode.
     * @param {string}  mode
     * @param {boolean} animate  Whether CSS transition is active.
     * @private
     */
    _applyMode(mode, animate) {
        if (!animate) {
            // Temporarily disable transition for instant application
            _applyTransition(this._simCanvas, 0);
            _applyTransition(this._mapCanvas, 0);
        }

        switch (mode) {

            case VIEW_MODE.MAP_2D:
                // Map is primary — fully visible and interactive
                _setVisibility(this._mapCanvas, OPACITY.ACTIVE, 'auto', 'block');
                // Sim dims to background — still renders but not interactive
                _setVisibility(this._simCanvas, OPACITY.DIM, 'none', 'block');
                // Resume map renderer if it was paused
                if (this._paused) this.resume();
                break;

            case VIEW_MODE.SIM_3D:
                // Sim is primary — fully visible and interactive
                _setVisibility(this._simCanvas, OPACITY.ACTIVE, 'auto', 'block');
                // Map is hidden — pause renderer to save resources
                _setVisibility(this._mapCanvas, OPACITY.BACKGROUND, 'none', 'none');
                // Pause map renderer since it is not visible
                if (!this._paused) this.pause();
                break;

            case VIEW_MODE.SPLIT:
                // Reserved — fall back to SIM_3D for now
                console.warn('[ViewModeController] SPLIT mode not yet implemented — using SIM_3D');
                this._applyMode(VIEW_MODE.SIM_3D, animate);
                return;

            default:
                console.error('[ViewModeController] unknown mode:', mode);
                return;
        }

        if (!animate) {
            // Restore transition after a microtask so the instant apply settles
            setTimeout(() => {
                _applyTransition(this._simCanvas, TRANSITION_MS);
                _applyTransition(this._mapCanvas, TRANSITION_MS);
            }, 0);
        }
    }

    /**
     * Notifies all registered listeners of a mode change.
     * @private
     */
    _notify(newMode, oldMode) {
        for (const fn of this._listeners) {
            try { fn(newMode, oldMode); }
            catch (err) {
                console.error('[ViewModeController] listener error:', err);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Private helpers — module-scoped
// ---------------------------------------------------------------------------

/**
 * Sets opacity and pointer-events on a canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {string}            opacity
 * @param {string}            pointerEvents
 */
function _setVisibility(canvas, opacity, pointerEvents, display = 'block') {
    canvas.style.opacity       = opacity;
    canvas.style.pointerEvents = pointerEvents;
    canvas.style.display       = display;
}

/**
 * Applies a CSS transition for opacity changes.
 * @param {HTMLCanvasElement} canvas
 * @param {number}            ms
 */
function _applyTransition(canvas, ms) {
    canvas.style.transition = ms > 0
        ? `opacity ${ms}ms ease-in-out`
        : 'none';
}

/**
 * Asserts a value is an HTMLCanvasElement.
 * @param {*}      v
 * @param {string} name
 */
function _assertCanvas(v, name) {
    if (!(v instanceof HTMLCanvasElement)) {
        throw new Error(`[ViewModeController] ${name} must be an HTMLCanvasElement`);
    }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.ViewModeController = ViewModeController;
window.VIEW_MODE          = VIEW_MODE;

console.info('[ViewModeController] module loaded');

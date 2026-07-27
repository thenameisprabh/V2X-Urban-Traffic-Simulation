/**
 * @file traffic-signal-renderer.js
 * @description Renders traffic signal housings and active phase lights.
 *
 * Layer order: index 7 — above buildings, below vehicles.
 *
 * Data shape (from network):
 *   network.signals = Array<{
 *     id:           string,
 *     pos:          { x:number, z:number },
 *     state:        string,          // backend authoritative
 *     _clientState: string           // client-side optimistic (use this until Phase 6)
 *   }>
 *
 * State strings normalised to uppercase: 'RED' | 'GREEN' | 'YELLOW'
 *
 * Interface contract (called by MapLayerManager):
 *   initialize(ctx, projector, network, supplement) → void
 *   render(ctx, projector, timestamp)               → void
 *   resize(cssWidth, cssHeight)                     → void
 *   destroy()                                       → void
 *
 * @module rendering/layers/traffic-signal-renderer
 */

'use strict';

/** Radius of one signal light in metres. */
const LIGHT_RADIUS_M = 0.8;

/** Minimum light radius in CSS pixels — below this, signals are skipped. */
const MIN_LIGHT_PX = 2;

class TrafficSignalRenderer {

    constructor(network, supplement) {
        this._network = network ?? {};
        this._style   = null;
        this._ready   = false;

        console.info('[TrafficSignalRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    initialize(ctx, projector, network, supplement) {
        this._network = network ?? this._network;

        this._style = window.RENDER_CONSTANTS?.SIGNAL_STYLE
                   ?? window.SIGNAL_STYLE
                   ?? _FALLBACK_SIGNAL_STYLE;

        this._ready = true;
        console.info('[TrafficSignalRenderer] initialized —',
            (this._network.signals?.length ?? 0), 'signals');
    }

    render(ctx, projector, timestamp) {
        if (!this._ready) return;

        const signals = this._network?.signals ?? [];
        if (signals.length === 0) return;

        const zoom = projector.scale;
        if (zoom < (window.RENDER_CONSTANTS?.ZOOM_THRESHOLDS?.trafficSignals ?? 0.8)) return;

        const lightPx = projector.metresToPixels(LIGHT_RADIUS_M);
        if (lightPx < MIN_LIGHT_PX) return;

        ctx.save();

        for (const signal of signals) {
            this._drawSignal(ctx, projector, signal, lightPx);
        }

        ctx.restore();
    }

    resize(cssWidth, cssHeight) {
        // Always projects live
    }

    destroy() {
        this._ready   = false;
        this._network = null;
        this._style   = null;
        console.info('[TrafficSignalRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _drawSignal(ctx, proj, signal, lightPx) {
        if (!signal.pos) return;

        const { cx, cy } = proj.project(signal.pos.x, signal.pos.z);

        // Normalise state — prefer _clientState (client-authoritative until Phase 6)
        const rawState    = signal._clientState ?? signal.state ?? 'RED';
        const state       = rawState.toUpperCase();
        const phaseStyle  = this._style.phases[state]
                         ?? this._style.phases[this._style.defaultState]
                         ?? this._style.phases['RED'];

        const padding  = lightPx * (this._style.housingPadding ?? 0.15);
        const housing  = lightPx + padding * 2;

        // ── Housing background ──
        ctx.fillStyle   = this._style.housingColour;
        ctx.strokeStyle = this._style.housingStroke;
        ctx.lineWidth   = 0.5;

        ctx.beginPath();
        ctx.arc(cx, cy, housing, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // ── Inactive lights (dim) ──
        const phases = ['RED', 'YELLOW', 'GREEN'];
        const offsets = [-1, 0, 1];   // vertical stacking

        for (let i = 0; i < phases.length; i++) {
            const ph   = phases[i];
            const pSt  = this._style.phases[ph];
            const lcy  = cy + offsets[i] * lightPx * 2.4;

            ctx.beginPath();
            ctx.arc(cx, lcy, lightPx, 0, Math.PI * 2);
            ctx.fillStyle = pSt.inactiveColour;
            ctx.fill();
        }

        // ── Active light ──
        const activeIdx = phases.indexOf(state);
        if (activeIdx >= 0) {
            const lcy = cy + offsets[activeIdx] * lightPx * 2.4;

            // Glow
            ctx.save();
            ctx.shadowColor = phaseStyle.glowColour;
            ctx.shadowBlur  = lightPx * (this._style.glowMultiplier ?? 3.0);

            ctx.beginPath();
            ctx.arc(cx, lcy, lightPx, 0, Math.PI * 2);
            ctx.fillStyle = phaseStyle.activeColour;
            ctx.fill();

            ctx.restore();
        }
    }
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const _FALLBACK_SIGNAL_STYLE = {
    housingColour:  '#1a1a22',
    housingStroke:  '#2e2e3c',
    housingPadding: 0.15,
    glowMultiplier: 3.0,
    defaultState:   'RED',
    phases: {
        GREEN:  { activeColour:'#32d74b', glowColour:'#32d74b', inactiveColour:'#0a2a12' },
        YELLOW: { activeColour:'#ffd60a', glowColour:'#ffd60a', inactiveColour:'#3a2e00' },
        RED:    { activeColour:'#ff453a', glowColour:'#ff453a', inactiveColour:'#3a1010' },
    },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.TrafficSignalRenderer = TrafficSignalRenderer;
console.info('[TrafficSignalRenderer] module loaded');

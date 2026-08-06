/**
 * @file traffic-signal-renderer.js
 * @description Renders traffic signal poles, housings, and active phase lights.
 *
 * Draws (per signal):
 *   - Vertical pole from ground to housing
 *   - Horizontal arm to housing
 *   - Rectangular housing box
 *   - Three phase lights (red/yellow/green) with glow on active phase
 *
 * @module rendering/layers/traffic-signal-renderer
 */

'use strict';

const LIGHT_RADIUS_M  = 0.7;
const MIN_LIGHT_PX    = 1.8;
/** Pole height in metres (visual only — 2D top-down approximation). */
const POLE_HEIGHT_M   = 5.0;
const POLE_WIDTH_M    = 0.25;

class TrafficSignalRenderer {

    constructor(network, supplement) {
        this._network = network ?? {};
        this._style   = null;
        this._ready   = false;
        console.info('[TrafficSignalRenderer] constructed');
    }

    initialize(ctx, projector, network, supplement) {
        this._network = network ?? this._network;
        this._style   = window.RENDER_CONSTANTS?.SIGNAL_STYLE
                     ?? window.SIGNAL_STYLE
                     ?? _FALLBACK;
        this._ready   = true;
        console.info('[TrafficSignalRenderer] initialized —',
            (this._network.signals?.length ?? 0), 'signals');
    }

    render(ctx, projector, timestamp) {
        if (!this._ready) return;

        const signals = this._network?.signals ?? [];
        if (signals.length === 0) return;

        const lightPx = projector.metresToPixels(LIGHT_RADIUS_M);
        if (lightPx < MIN_LIGHT_PX) return;

        ctx.save();
        for (const signal of signals) {
            this._drawSignal(ctx, projector, signal, lightPx, timestamp);
        }
        ctx.restore();
    }

    resize() { /* projects live */ }

    destroy() {
        this._ready   = false;
        this._network = null;
        this._style   = null;
        console.info('[TrafficSignalRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _drawSignal(ctx, proj, signal, lightPx, timestamp) {
        if (!signal.pos) return;

        const { cx, cy } = proj.project(signal.pos.x, signal.pos.z);

        const rawState   = signal._clientState ?? signal.state ?? 'RED';
        const state      = rawState.toUpperCase();
        const phaseStyle = this._style.phases[state]
                        ?? this._style.phases['RED'];

        const padding    = lightPx * (this._style.housingPadding ?? 0.15);
        const housing    = lightPx + padding;

        // ── Pole ─────────────────────────────────────────────────────────
        const polePx   = Math.max(1.0, proj.metresToPixels(POLE_WIDTH_M));
        const poleHPx  = proj.metresToPixels(POLE_HEIGHT_M);
        ctx.fillStyle  = '#2a2a3a';
        ctx.fillRect(cx - polePx / 2, cy, polePx, poleHPx * 0.35);  // stub visible in top-down

        // ── Housing box ───────────────────────────────────────────────────
        const boxW  = housing * 2.2;
        const boxH  = housing * 7.5;   // tall enough for 3 lights stacked
        const boxX  = cx - boxW / 2;
        const boxY  = cy - boxH / 2;
        const rBox  = Math.min(boxW * 0.22, 3);

        // Housing shadow
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        _roundRect(ctx, boxX + 2, boxY + 2, boxW, boxH, rBox);
        ctx.fill();

        // Housing body
        ctx.fillStyle   = this._style.housingColour ?? '#1a1a26';
        ctx.strokeStyle = this._style.housingStroke ?? '#2e2e3e';
        ctx.lineWidth   = Math.max(0.5, polePx * 0.4);
        _roundRect(ctx, boxX, boxY, boxW, boxH, rBox);
        ctx.fill();
        ctx.stroke();

        // ── Three phase lights ────────────────────────────────────────────
        const phases  = ['RED', 'YELLOW', 'GREEN'];
        const offsets = [-1, 0, 1];   // red top, yellow middle, green bottom

        for (let i = 0; i < phases.length; i++) {
            const ph   = phases[i];
            const pSt  = this._style.phases[ph];
            const lcy  = cy + offsets[i] * housing * 2.5;
            const isActive = ph === state;

            if (isActive) {
                // Glow behind active light
                ctx.save();
                ctx.shadowColor = phaseStyle.glowColour;
                ctx.shadowBlur  = lightPx * (this._style.glowMultiplier ?? 3.0);
                ctx.beginPath();
                ctx.arc(cx, lcy, lightPx, 0, Math.PI * 2);
                ctx.fillStyle = phaseStyle.activeColour;
                ctx.fill();
                ctx.restore();

                // Bright centre spot
                ctx.beginPath();
                ctx.arc(cx, lcy, lightPx * 0.45, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.55)';
                ctx.fill();
            } else {
                // Dim inactive light
                ctx.beginPath();
                ctx.arc(cx, lcy, lightPx, 0, Math.PI * 2);
                ctx.fillStyle = pSt.inactiveColour;
                ctx.fill();
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x,     y + r);
    ctx.arcTo(x,     y,     x + r, y,         r);
    ctx.closePath();
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const _FALLBACK = {
    housingColour:  '#1a1a26',
    housingStroke:  '#2e2e3e',
    housingPadding: 0.15,
    glowMultiplier: 3.0,
    defaultState:   'RED',
    phases: {
        GREEN:  { activeColour:'#32d74b', glowColour:'#32d74b', inactiveColour:'#0a2a12' },
        YELLOW: { activeColour:'#ffd60a', glowColour:'#ffd60a', inactiveColour:'#3a2e00' },
        RED:    { activeColour:'#ff453a', glowColour:'#ff453a', inactiveColour:'#3a1010' },
    },
};

window.TrafficSignalRenderer = TrafficSignalRenderer;
console.info('[TrafficSignalRenderer] module loaded');
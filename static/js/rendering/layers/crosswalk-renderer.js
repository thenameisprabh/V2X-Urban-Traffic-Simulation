/**
 * @file crosswalk-renderer.js
 * @description Renders zebra crossing stripes at intersections.
 *
 * Draws:
 *   - Dark background band (road surface behind stripes)
 *   - White zebra stripes
 *   - Thin border lines on the pedestrian-approach edges
 *
 * @module rendering/layers/crosswalk-renderer
 */

'use strict';

const DEFAULT_CROSSING_SPAN_M = 16;

class CrosswalkRenderer {

    constructor(network, supplement) {
        this._network = network ?? {};
        this._style   = null;
        this._ready   = false;
        console.info('[CrosswalkRenderer] constructed');
    }

    initialize(ctx, projector, network, supplement) {
        this._network = network ?? this._network;
        this._style   = window.RENDER_CONSTANTS?.CROSSWALK_STYLE
                     ?? window.CROSSWALK_STYLE
                     ?? _FALLBACK;
        this._ready   = true;
        console.info('[CrosswalkRenderer] initialized —',
            (this._network.crosswalks?.length ?? 0), 'crosswalks');
    }

    render(ctx, projector, timestamp) {
        if (!this._ready) return;
        const crosswalks = this._network?.crosswalks ?? [];
        if (crosswalks.length === 0) return;

        ctx.save();
        for (const cw of crosswalks) {
            this._drawCrosswalk(ctx, projector, cw);
        }
        ctx.restore();
    }

    resize() { /* projects live */ }

    destroy() {
        this._ready   = false;
        this._network = null;
        this._style   = null;
        console.info('[CrosswalkRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _drawCrosswalk(ctx, proj, cw) {
        if (!cw.pos) return;

        const { cx, cy } = proj.project(cw.pos.x, cw.pos.z);

        const spanM    = this._resolveCrossingSpan(cw);
        const spanPx   = proj.metresToPixels(spanM);
        const stripeW  = proj.metresToPixels(this._style.stripeWidthM ?? 0.5);
        const stripeG  = proj.metresToPixels(this._style.stripeGapM   ?? 0.5);
        const pitchPx  = stripeW + stripeG;

        if (pitchPx < 1 || spanPx < 4) return;

        // Depth of the crossing (perpendicular to traffic direction)
        const depthM  = Math.max(3.5, (this._style.stripeWidthM ?? 0.5) * 6);
        const depthPx = proj.metresToPixels(depthM);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(cw.rotationRad ?? 0);

        const numStripes = Math.max(this._style.minStripes ?? 4, Math.floor(spanPx / pitchPx));
        const totalW     = numStripes * pitchPx - stripeG;
        const halfSpan   = totalW / 2;

        // ── Dark background band ──────────────────────────────────────────
        ctx.fillStyle = 'rgba(28,28,40,0.70)';
        ctx.fillRect(-halfSpan, -depthPx / 2, totalW, depthPx);

        // ── White stripes ─────────────────────────────────────────────────
        ctx.fillStyle = this._style.stripeColour ?? 'rgba(255,255,255,0.88)';
        let x = -halfSpan;
        for (let i = 0; i < numStripes; i++) {
            ctx.fillRect(x, -depthPx / 2, stripeW, depthPx);
            x += pitchPx;
        }

        // ── Border lines on approach edges ────────────────────────────────
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth   = Math.max(0.8, depthPx * 0.04);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(-halfSpan, -depthPx / 2);
        ctx.lineTo( halfSpan, -depthPx / 2);
        ctx.moveTo(-halfSpan,  depthPx / 2);
        ctx.lineTo( halfSpan,  depthPx / 2);
        ctx.stroke();

        ctx.restore();
    }

    _resolveCrossingSpan(cw) {
        const roads = this._network?.roads ?? [];
        const signalId = cw.signalId;
        if (signalId) {
            for (const road of roads) {
                if (road.signalId === signalId || road.id?.includes(signalId)) {
                    return road.totalWidthM ?? DEFAULT_CROSSING_SPAN_M;
                }
            }
        }
        return DEFAULT_CROSSING_SPAN_M;
    }
}

const _FALLBACK = {
    stripeColour:  'rgba(255,255,255,0.88)',
    stripeWidthM:  0.5,
    stripeGapM:    0.5,
    minStripes:    4,
};

window.CrosswalkRenderer = CrosswalkRenderer;
console.info('[CrosswalkRenderer] module loaded');
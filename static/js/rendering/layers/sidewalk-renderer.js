/**
 * @file sidewalk-renderer.js
 * @description Renders sidewalks as solid paved bands with a curb edge line.
 *
 * Draws:
 *   - Paved sidewalk fill (concrete grey-blue)
 *   - Curb edge stroke (bright kerb line facing the road)
 *
 * @module rendering/layers/sidewalk-renderer
 */

'use strict';

class SidewalkRenderer {

    constructor(network, supplement) {
        this._network = network ?? {};
        this._style   = null;
        this._ready   = false;
        console.info('[SidewalkRenderer] constructed');
    }

    initialize(ctx, projector, network, supplement) {
        this._network = network ?? this._network;
        this._style   = window.RENDER_CONSTANTS?.SIDEWALK_STYLE
                     ?? window.SIDEWALK_STYLE
                     ?? _FALLBACK;
        this._ready   = true;
        console.info('[SidewalkRenderer] initialized —',
            (this._network.sidewalks?.length ?? 0), 'sidewalks');
    }

    render(ctx, projector, timestamp) {
        if (!this._ready) return;
        const sidewalks = this._network?.sidewalks ?? [];
        if (sidewalks.length === 0) return;

        ctx.save();
        for (const sw of sidewalks) {
            this._drawSidewalk(ctx, projector, sw);
        }
        ctx.restore();
    }

    resize() { /* projects live */ }

    destroy() {
        this._ready   = false;
        this._network = null;
        this._style   = null;
        console.info('[SidewalkRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _drawSidewalk(ctx, proj, sw) {
        const geom = sw.geometry;
        if (!Array.isArray(geom) || geom.length < 2) return;

        const widthPx = proj.metresToPixels(sw.widthM ?? 2.5);
        if (widthPx < (this._style.minWidthPx ?? 1.0)) return;

        const pts = geom.map(p => proj.project(p.x, p.z));

        // ── Pavement fill ─────────────────────────────────────────────────
        ctx.beginPath();
        ctx.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
        ctx.strokeStyle = this._style.colour      ?? 'rgba(185,185,210,0.32)';
        ctx.lineWidth   = widthPx;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.stroke();

        // ── Curb edge line (thin bright line on the road-facing side) ─────
        const curbPx = Math.max(0.8, widthPx * 0.08);
        ctx.beginPath();
        ctx.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
        ctx.strokeStyle = this._style.curbColour  ?? 'rgba(230,230,255,0.55)';
        ctx.lineWidth   = curbPx;
        ctx.lineCap     = 'butt';
        ctx.stroke();
    }
}

const _FALLBACK = {
    colour:      'rgba(185,185,210,0.32)',
    curbColour:  'rgba(230,230,255,0.55)',
    minWidthPx:  1.0,
};

window.SidewalkRenderer = SidewalkRenderer;
console.info('[SidewalkRenderer] module loaded');
/**
 * @file water-renderer.js
 * @description Renders animated water bodies (lakes, ponds) and waterways
 *              (rivers, streams) from OSMSupplementProvider data.
 *
 * Layer order: index 1 — above terrain, below vegetation and roads.
 *
 * Data shape (from supplement):
 *   supplement._water = { bodies: Array<WaterBody>, ways: Array<Waterway> }
 *   WaterBody  : { id, geometry: [{x,z}], type: 'lake'|'pond'|... }
 *   Waterway   : { id, geometry: [{x,z}], type: 'river'|'stream'|... }
 *
 * Interface contract (called by MapLayerManager):
 *   initialize(ctx, projector, network, supplement) → void
 *   render(ctx, projector, timestamp)               → void
 *   resize(cssWidth, cssHeight)                     → void
 *   destroy()                                       → void
 *
 * @module rendering/layers/water-renderer
 */

'use strict';

class WaterRenderer {

    constructor(network, supplement) {
        this._network    = network    ?? {};
        this._supplement = supplement ?? {};
        this._animOffset = 0;
        this._style      = null;
        this._ready      = false;
        this._lastTs     = 0;

        console.info('[WaterRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    initialize(ctx, projector, network, supplement) {
        // MapLayerManager passes authoritative network/supplement — prefer these
        this._network    = network    ?? this._network;
        this._supplement = supplement ?? this._supplement;

        // ✅ Read from constants — never reference bare WATER_STYLE global
        this._style = window.RENDER_CONSTANTS?.WATER_STYLE
                   ?? window.WATER_STYLE
                   ?? _FALLBACK_WATER_STYLE;

        this._ready = true;
        console.info('[WaterRenderer] initialized');
    }

    render(ctx, projector, timestamp) {
        if (!this._ready) return;

        // Advance animation offset using delta time
        const delta      = this._lastTs > 0 ? timestamp - this._lastTs : 0;
        this._lastTs     = timestamp;
        this._animOffset += delta * this._style.shimmerSpeed;

        // Retrieve water data from supplement
        const waterData = this._supplement?._water ?? { bodies: [], ways: [] };
        const bodies    = waterData.bodies ?? [];
        const ways      = waterData.ways   ?? [];

        // Nothing to render — supplement data is empty in current dataset
        if (bodies.length === 0 && ways.length === 0) return;

        ctx.save();

        // Draw water bodies (lakes, ponds) — filled polygons
        for (const body of bodies) {
            this._drawBody(ctx, projector, body);
        }

        // Draw waterways (rivers, streams) — stroked polylines
        for (const way of ways) {
            this._drawWay(ctx, projector, way);
        }

        ctx.restore();
    }

    resize(cssWidth, cssHeight) {
        // No cached geometry — nothing to invalidate
    }

    destroy() {
        this._ready      = false;
        this._supplement = null;
        this._network    = null;
        this._style      = null;
        console.info('[WaterRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private — drawing
    // -----------------------------------------------------------------------

    _drawBody(ctx, proj, body) {
        const geom = body.geometry;
        if (!Array.isArray(geom) || geom.length < 3) return;

        const pts = geom.map(p => proj.project(p.x, p.z));

        // Deep water fill
        ctx.beginPath();
        ctx.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].cx, pts[i].cy);
        }
        ctx.closePath();

        ctx.fillStyle = this._style.deepColour;
        ctx.fill();

        // Shore highlight (inner stroke)
        ctx.strokeStyle = this._style.shoreColour;
        ctx.lineWidth   = 2;
        ctx.stroke();

        // Shimmer overlay — animated horizontal bands
        this._drawShimmer(ctx, proj, pts);
    }

    _drawWay(ctx, proj, way) {
        const geom = way.geometry;
        if (!Array.isArray(geom) || geom.length < 2) return;

        const pts     = geom.map(p => proj.project(p.x, p.z));
        const widthM  = way.type === 'river'
                      ? this._style.riverWidthM
                      : this._style.streamWidthM;
        const widthPx = proj.metresToPixels(widthM);

        if (widthPx < 1) return;

        ctx.beginPath();
        ctx.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].cx, pts[i].cy);
        }

        ctx.strokeStyle = this._style.shallowColour;
        ctx.lineWidth   = widthPx;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.stroke();
    }

    _drawShimmer(ctx, proj, pts) {
        if (pts.length < 3) return;

        // Compute bounding box of the polygon in canvas space
        let minY = Infinity, maxY = -Infinity;
        let minX = Infinity, maxX = -Infinity;
        for (const p of pts) {
            if (p.cx < minX) minX = p.cx;
            if (p.cx > maxX) maxX = p.cx;
            if (p.cy < minY) minY = p.cy;
            if (p.cy > maxY) maxY = p.cy;
        }

        // Clip to polygon before drawing shimmer bands
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
        ctx.closePath();
        ctx.clip();

        ctx.strokeStyle = this._style.shimmerColour;
        ctx.lineWidth   = 1;

        const spacing = 6; // px between shimmer lines
        const offset  = (this._animOffset * 20) % spacing;

        for (let y = minY - spacing + offset; y < maxY + spacing; y += spacing) {
            ctx.beginPath();
            ctx.moveTo(minX, y);
            ctx.lineTo(maxX, y + 4);
            ctx.stroke();
        }

        ctx.restore();
    }
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const _FALLBACK_WATER_STYLE = {
    deepColour:    '#0a0f1e',
    shallowColour: '#121a2e',
    shoreColour:   'rgba(30,50,80,0.60)',
    shimmerColour: 'rgba(100,150,220,0.12)',
    shimmerSpeed:  0.03,
    riverWidthM:   15.0,
    streamWidthM:  5.0,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.WaterRenderer = WaterRenderer;
console.info('[WaterRenderer] module loaded');

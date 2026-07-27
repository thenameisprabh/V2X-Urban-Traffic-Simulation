/**
 * @file sidewalk-renderer.js
 * @description Renders pavement zones adjacent to roads.
 *
 * Layer order: index 4 — above roads, below crosswalks and signals.
 *
 * Data shape (from network):
 *   network.sidewalks = Array<{
 *     id:       string,
 *     geometry: [{x:number, z:number}],
 *     widthM:   number
 *   }>
 *
 * Interface contract (called by MapLayerManager):
 *   initialize(ctx, projector, network, supplement) → void
 *   render(ctx, projector, timestamp)               → void
 *   resize(cssWidth, cssHeight)                     → void
 *   destroy()                                       → void
 *
 * @module rendering/layers/sidewalk-renderer
 */

'use strict';

class SidewalkRenderer {

    constructor(network, supplement) {
        this._network  = network ?? {};
        this._style    = null;
        this._ready    = false;

        console.info('[SidewalkRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    initialize(ctx, projector, network, supplement) {
        this._network = network ?? this._network;

        this._style = window.RENDER_CONSTANTS?.SIDEWALK_STYLE
                   ?? window.SIDEWALK_STYLE
                   ?? _FALLBACK_SIDEWALK_STYLE;

        this._ready = true;
        console.info('[SidewalkRenderer] initialized —',
            (this._network.sidewalks?.length ?? 0), 'sidewalks');
    }

    /**
     * Called every frame by MapLayerManager with signature (ctx, proj, timestamp).
     */
    render(ctx, projector, timestamp) {
        if (!this._ready) return;

        const sidewalks = this._network?.sidewalks ?? [];
        if (sidewalks.length === 0) return;

        const zoom = projector.scale;

        // Zoom threshold — don't draw at very low zoom
        if (zoom < (window.RENDER_CONSTANTS?.ZOOM_THRESHOLDS?.sidewalks ?? 1.0)) return;

        ctx.save();

        for (const sidewalk of sidewalks) {
            this._drawSidewalk(ctx, projector, sidewalk);
        }

        ctx.restore();
    }

    resize(cssWidth, cssHeight) {
        // No cached geometry — always projects live
    }

    destroy() {
        this._ready   = false;
        this._network = null;
        this._style   = null;
        console.info('[SidewalkRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _drawSidewalk(ctx, proj, sidewalk) {
        const geom = sidewalk.geometry;
        if (!Array.isArray(geom) || geom.length < 2) return;

        const widthPx = proj.metresToPixels(sidewalk.widthM ?? 2);
        if (widthPx < (this._style.minWidthPx ?? 1.0)) return;

        const pts = geom.map(p => proj.project(p.x, p.z));

        ctx.beginPath();
        ctx.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].cx, pts[i].cy);
        }

        ctx.strokeStyle = this._style.colour;
        ctx.lineWidth   = widthPx;
        ctx.lineCap     = 'butt';
        ctx.lineJoin    = 'round';
        ctx.stroke();

        // Inner edge stroke
        ctx.strokeStyle = this._style.strokeColour;
        ctx.lineWidth   = 0.5;
        ctx.stroke();
    }
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const _FALLBACK_SIDEWALK_STYLE = {
    colour:       'rgba(160,160,180,0.22)',
    strokeColour: 'rgba(160,160,180,0.08)',
    minWidthPx:   1.0,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.SidewalkRenderer = SidewalkRenderer;
console.info('[SidewalkRenderer] module loaded');

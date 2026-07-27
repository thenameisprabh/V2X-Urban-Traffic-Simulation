/**
 * @file vegetation-renderer.js
 * @description Renders park areas and tree canopies from OSMSupplementProvider.
 *
 * Layer order: index 2 — above water, below roads.
 *
 * Data shape:
 *   supplement._vegetation = {
 *     areas: Array<{ id, geometry:[{x,z}], type:'park'|'garden'|... }>,
 *     trees: Array<{ id, pos:{x,z}, radius?:number }>
 *   }
 *
 * Interface contract (called by MapLayerManager):
 *   initialize(ctx, projector, network, supplement) → void
 *   render(ctx, projector, timestamp)               → void
 *   resize(cssWidth, cssHeight)                     → void
 *   destroy()                                       → void
 *
 * @module rendering/layers/vegetation-renderer
 */

'use strict';

/** Minimum tree canopy radius in CSS pixels — below this trees are skipped. */
const MIN_TREE_PX = 2;

class VegetationRenderer {

    constructor(network, supplement) {
        this._network    = network    ?? {};
        this._supplement = supplement ?? {};
        this._style      = null;
        this._ready      = false;

        console.info('[VegetationRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    initialize(ctx, projector, network, supplement) {
        this._network    = network    ?? this._network;
        this._supplement = supplement ?? this._supplement;

        this._style = window.RENDER_CONSTANTS?.VEGETATION_STYLE
                   ?? window.VEGETATION_STYLE
                   ?? _FALLBACK_VEGETATION_STYLE;

        this._ready = true;
        console.info('[VegetationRenderer] initialized');
    }

    render(ctx, projector, timestamp) {
        if (!this._ready) return;

        const vegData = this._supplement?._vegetation ?? { areas: [], trees: [] };
        const areas   = vegData.areas ?? [];
        const trees   = vegData.trees ?? [];

        if (areas.length === 0 && trees.length === 0) return;

        ctx.save();

        // Pass 1 — park area fills (below tree canopies)
        for (const area of areas) {
            this._drawArea(ctx, projector, area);
        }

        // Pass 2 — tree canopy shadows (offset circle)
        for (const tree of trees) {
            this._drawTreeShadow(ctx, projector, tree);
        }

        // Pass 3 — tree canopy fills
        for (const tree of trees) {
            this._drawTreeCanopy(ctx, projector, tree);
        }

        ctx.restore();
    }

    resize(cssWidth, cssHeight) {
        // No cached geometry
    }

    destroy() {
        this._ready      = false;
        this._supplement = null;
        this._network    = null;
        this._style      = null;
        console.info('[VegetationRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _drawArea(ctx, proj, area) {
        const geom = area.geometry;
        if (!Array.isArray(geom) || geom.length < 3) return;

        const pts = geom.map(p => proj.project(p.x, p.z));

        ctx.beginPath();
        ctx.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
        ctx.closePath();

        ctx.fillStyle   = this._style.parkFill;
        ctx.strokeStyle = this._style.parkStroke;
        ctx.lineWidth   = 1;
        ctx.fill();
        ctx.stroke();
    }

    _drawTreeShadow(ctx, proj, tree) {
        if (!tree.pos) return;
        const { cx, cy } = proj.project(tree.pos.x, tree.pos.z);
        const radiusPx   = this._treeRadiusPx(proj, tree);
        if (radiusPx < MIN_TREE_PX) return;

        ctx.save();
        ctx.globalAlpha  = 0.35;
        ctx.fillStyle    = this._style.treeShadow ?? 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        // Shadow offset: 2px down-right
        ctx.arc(cx + 2, cy + 2, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    _drawTreeCanopy(ctx, proj, tree) {
        if (!tree.pos) return;
        const { cx, cy } = proj.project(tree.pos.x, tree.pos.z);
        const radiusPx   = this._treeRadiusPx(proj, tree);
        if (radiusPx < MIN_TREE_PX) return;

        // Dark base
        ctx.beginPath();
        ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
        ctx.fillStyle = this._style.treeCanopy;
        ctx.fill();

        // Highlight patch (upper-left)
        ctx.beginPath();
        ctx.arc(cx - radiusPx * 0.2, cy - radiusPx * 0.2,
                radiusPx * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = this._style.treeHighlight;
        ctx.fill();
    }

    _treeRadiusPx(proj, tree) {
        // Use explicit radius if provided, else derive from default canopy size
        const radiusM = tree.radiusM ?? 3.5;
        return proj.metresToPixels(radiusM);
    }
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const _FALLBACK_VEGETATION_STYLE = {
    parkFill:      'rgba(20,35,20,0.70)',
    parkStroke:    'rgba(30,55,30,0.40)',
    treeCanopy:    '#1a3a1a',
    treeHighlight: '#224422',
    treeShadow:    'rgba(0,0,0,0.35)',
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.VegetationRenderer = VegetationRenderer;
console.info('[VegetationRenderer] module loaded');

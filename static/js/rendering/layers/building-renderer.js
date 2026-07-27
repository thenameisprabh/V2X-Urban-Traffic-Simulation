/**
 * @file building-renderer.js
 * @description Renders building footprints with flat-top isometric-lite shading.
 *
 * Layer order: index 6 — above crosswalks, below traffic signals.
 *
 * Data shape:
 *   supplement._buildings = {
 *     buildings: Array<{
 *       id:       string,
 *       geometry: [{x,z}],
 *       type:     'commercial'|'residential'|'industrial'|'default',
 *       heightM?: number
 *     }>
 *   }
 *
 * Interface contract (called by MapLayerManager):
 *   initialize(ctx, projector, network, supplement) → void
 *   render(ctx, projector, timestamp)               → void
 *   resize(cssWidth, cssHeight)                     → void
 *   destroy()                                       → void
 *
 * @module rendering/layers/building-renderer
 */

'use strict';

/** Minimum building footprint area in px² — smaller buildings are skipped. */
const MIN_AREA_PX2 = 9;

class BuildingRenderer {

    constructor(network, supplement) {
        this._supplement = supplement ?? {};
        this._style      = null;
        this._ready      = false;

        console.info('[BuildingRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    initialize(ctx, projector, network, supplement) {
        this._supplement = supplement ?? this._supplement;

        this._style = window.RENDER_CONSTANTS?.BUILDING_STYLE
                   ?? window.BUILDING_STYLE
                   ?? _FALLBACK_BUILDING_STYLE;

        this._ready = true;

        const count = this._supplement?._buildings?.buildings?.length ?? 0;
        console.info('[BuildingRenderer] initialized —', count, 'buildings');
    }

    render(ctx, projector, timestamp) {
        if (!this._ready) return;

        const buildings = this._supplement?._buildings?.buildings ?? [];
        if (buildings.length === 0) return;

        ctx.save();

        // Pass 1 — shadows (drawn first, under all footprints)
        for (const b of buildings) {
            this._drawShadow(ctx, projector, b);
        }

        // Pass 2 — footprint fills
        for (const b of buildings) {
            this._drawFootprint(ctx, projector, b);
        }

        ctx.restore();
    }

    resize(cssWidth, cssHeight) {
        // Always projects live
    }

    destroy() {
        this._ready      = false;
        this._supplement = null;
        this._style      = null;
        console.info('[BuildingRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private
    // -----------------------------------------------------------------------

    _resolveStyle(building) {
        const type = building.type ?? 'default';
        return this._style[type] ?? this._style.default;
    }

    _buildPath(ctx, proj, building) {
        const geom = building.geometry;
        if (!Array.isArray(geom) || geom.length < 3) return false;

        const pts = geom.map(p => proj.project(p.x, p.z));

        ctx.beginPath();
        ctx.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
        ctx.closePath();

        return true;
    }

    _drawShadow(ctx, proj, building) {
        const geom = building.geometry;
        if (!Array.isArray(geom) || geom.length < 3) return;

        const s    = this._resolveStyle(building);
        const pts  = geom.map(p => proj.project(p.x, p.z));

        // Estimate a pseudo-height offset (isometric-lite shadow)
        const heightM  = building.heightM ?? 6;
        const heightPx = Math.min(proj.metresToPixels(heightM) * 0.3, 8);

        ctx.save();
        ctx.translate(heightPx, heightPx);   // shadow offset

        ctx.beginPath();
        ctx.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].cx, pts[i].cy);
        ctx.closePath();

        ctx.fillStyle   = s.shadowColour;
        ctx.fill();

        ctx.restore();
    }

    _drawFootprint(ctx, proj, building) {
        if (!this._buildPath(ctx, proj, building)) return;

        const s = this._resolveStyle(building);

        // Check area is large enough to be visible
        const geom = building.geometry;
        const pts  = geom.map(p => proj.project(p.x, p.z));
        if (_polygonArea(pts) < MIN_AREA_PX2) return;

        ctx.fillStyle   = s.roofColour;
        ctx.fill();

        ctx.strokeStyle = s.outlineColour;
        ctx.lineWidth   = 0.8;
        ctx.stroke();
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shoelace formula — returns absolute polygon area in px². */
function _polygonArea(pts) {
    let area = 0;
    const n  = pts.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += pts[i].cx * pts[j].cy;
        area -= pts[j].cx * pts[i].cy;
    }
    return Math.abs(area) / 2;
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const _FALLBACK_BUILDING_STYLE = {
    default: {
        wallColour:    '#1e1e2c',
        roofColour:    '#2a2a3a',
        outlineColour: '#14141e',
        shadowColour:  'rgba(0,0,0,0.40)',
    },
    commercial:  { wallColour:'#1a2030', roofColour:'#222840', outlineColour:'#10101e', shadowColour:'rgba(0,0,0,0.45)' },
    residential: { wallColour:'#201e28', roofColour:'#282634', outlineColour:'#141220', shadowColour:'rgba(0,0,0,0.38)' },
    industrial:  { wallColour:'#1c1c22', roofColour:'#242428', outlineColour:'#101010', shadowColour:'rgba(0,0,0,0.50)' },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.BuildingRenderer = BuildingRenderer;
console.info('[BuildingRenderer] module loaded');

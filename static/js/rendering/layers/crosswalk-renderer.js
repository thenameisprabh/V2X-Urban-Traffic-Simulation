/**
 * @file crosswalk-renderer.js
 * @description Renders zebra crossing stripes at intersections.
 *
 * Layer order: index 5 — above sidewalks, below buildings and signals.
 *
 * Data shape (from network):
 *   network.crosswalks = Array<{
 *     id:          string,
 *     pos:         { x:number, z:number },
 *     signalId:    string|null,
 *     direction:   'NS' | 'EW',
 *     rotationRad: number
 *   }>
 *
 * Crosswalk geometry is derived from the crossing position + direction +
 * the width of the road it crosses (looked up from network.roads by signalId
 * → intersection → road width).
 *
 * Interface contract (called by MapLayerManager):
 *   initialize(ctx, projector, network, supplement) → void
 *   render(ctx, projector, timestamp)               → void
 *   resize(cssWidth, cssHeight)                     → void
 *   destroy()                                       → void
 *
 * @module rendering/layers/crosswalk-renderer
 */

'use strict';

/** Default crossing span in metres when road width cannot be resolved. */
const DEFAULT_CROSSING_SPAN_M = 14;

class CrosswalkRenderer {

    constructor(network, supplement) {
        this._network = network ?? {};
        this._style   = null;
        this._ready   = false;

        console.info('[CrosswalkRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    initialize(ctx, projector, network, supplement) {
        this._network = network ?? this._network;

        this._style = window.RENDER_CONSTANTS?.CROSSWALK_STYLE
                   ?? window.CROSSWALK_STYLE
                   ?? _FALLBACK_CROSSWALK_STYLE;

        this._ready = true;
        console.info('[CrosswalkRenderer] initialized —',
            (this._network.crosswalks?.length ?? 0), 'crosswalks');
    }

    render(ctx, projector, timestamp) {
        if (!this._ready) return;

        const crosswalks = this._network?.crosswalks ?? [];
        if (crosswalks.length === 0) return;

        const zoom = projector.scale;
        if (zoom < (window.RENDER_CONSTANTS?.ZOOM_THRESHOLDS?.crosswalks ?? 1.2)) return;

        ctx.save();

        for (const cw of crosswalks) {
            this._drawCrosswalk(ctx, projector, cw);
        }

        ctx.restore();
    }

    resize(cssWidth, cssHeight) {
        // Always projects live — no cache
    }

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

        // Determine crossing span — use road total width if available
        const spanM    = this._resolveCrossingSpan(cw);
        const spanPx   = proj.metresToPixels(spanM);

        const stripeW  = proj.metresToPixels(this._style.stripeWidthM ?? 0.45);
        const stripeG  = proj.metresToPixels(this._style.stripeGapM   ?? 0.45);
        const pitchPx  = stripeW + stripeG;

        if (pitchPx < 1 || spanPx < 2) return;

        const halfSpan = spanPx / 2;

        // Crosswalk depth — perpendicular to crossing direction
        // Use 2× stripe pitch as minimum visible depth
        const depthM  = Math.max(this._style.stripeWidthM * 4, 2.0);
        const depthPx = proj.metresToPixels(depthM);

        ctx.save();

        // Translate to crossing centre and rotate to match road orientation
        ctx.translate(cx, cy);
        ctx.rotate(cw.rotationRad ?? 0);

        ctx.fillStyle = this._style.stripeColour;

        // Draw stripes along the span axis
        const numStripes = Math.max(
            this._style.minStripes ?? 3,
            Math.floor(spanPx / pitchPx)
        );

        // Centre the stripe pattern
        const totalW = numStripes * pitchPx - stripeG;
        let   x      = -totalW / 2;

        for (let i = 0; i < numStripes; i++) {
            ctx.fillRect(x, -depthPx / 2, stripeW, depthPx);
            x += pitchPx;
        }

        ctx.restore();
    }

    _resolveCrossingSpan(cw) {
        // Try to find the road that passes through this crossing's signal
        const signalId = cw.signalId;
        if (!signalId) return DEFAULT_CROSSING_SPAN_M;

        const roads = this._network?.roads ?? [];
        // A rough heuristic: find road whose signal matches
        for (const road of roads) {
            if (road.signalId === signalId || road.id?.includes(signalId)) {
                return road.totalWidthM ?? DEFAULT_CROSSING_SPAN_M;
            }
        }

        // Fallback: derive from intersection geometry
        return DEFAULT_CROSSING_SPAN_M;
    }
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

const _FALLBACK_CROSSWALK_STYLE = {
    stripeColour:     'rgba(255,255,255,0.62)',
    stripeWidthM:     0.45,
    stripeGapM:       0.45,
    crosswalkWidthFr: 0.85,
    minStripes:       3,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.CrosswalkRenderer = CrosswalkRenderer;
console.info('[CrosswalkRenderer] module loaded');

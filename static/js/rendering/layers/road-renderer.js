/**
 * @file road-renderer.js
 * @description Phase 2 — Static road geometry renderer for the 2D map canvas.
 *
 * Responsibilities:
 *   - Reads an immutable RenderNetwork and draws road geometry onto the 2D canvas.
 *   - Implements a multi-pass rendering pipeline:
 *       Pass 1 — Drop shadows         (depth cue, controlled by drawShadow flag)
 *       Pass 2 — Road casing          (outline/kerb, controlled by drawCasing flag)
 *       Pass 3 — Road surface fill    (always drawn — this is the road itself)
 *       Pass 4 — Lane markings        (dashes / edge lines, controlled by drawMarkings flag)
 *       Pass 5 — Centre lines         (yellow / white dividers, controlled by drawCentreLine flag)
 *
 * This renderer MUST NOT:
 *   - fetch data from the backend
 *   - read vehicle state, V2V state, signal state, or AI state
 *   - modify simulation state
 *   - know about Three.js or the sim-canvas
 *   - perform business logic of any kind
 *
 * Rendering is driven entirely by:
 *   - network:   RenderNetwork (immutable, from roadNetworkAdapter)
 *   - projector: SimProjector  (coordinate maths only)
 *   - roadStyle: RENDER_CONSTANTS.ROAD_STYLE (cached at initialize())
 *
 * @module rendering/layers/road-renderer
 */

'use strict';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Minimum road width in CSS pixels below which a road is skipped entirely.
 *  Prevents sub-pixel artefacts at extreme zoom-out levels. */
const MIN_DRAW_WIDTH_PX = 0.5;

/** Alpha for the drop-shadow pass. Kept low so shadows don't dominate. */
const SHADOW_ALPHA = 0.18;

/** Shadow offset as a fraction of road width. */
const SHADOW_OFFSET_FRACTION = 0.6;

/** Lane dash length in metres. */
const LANE_DASH_LENGTH_M = 3.0;

/** Lane dash gap in metres. */
const LANE_DASH_GAP_M = 5.0;

/** Centre-line dash length in metres (used on two-way roads). */
const CENTRE_DASH_LENGTH_M = 4.0;

/** Centre-line dash gap in metres. */
const CENTRE_DASH_GAP_M = 3.0;

/** Edge-line width as a fraction of road width. */
const EDGE_LINE_FRACTION = 0.04;

/** Minimum edge-line width in CSS pixels. */
const EDGE_LINE_MIN_PX = 0.8;

// ---------------------------------------------------------------------------
// RoadRenderer
// ---------------------------------------------------------------------------

/**
 * Renders static road geometry in multiple passes onto the 2D map canvas.
 *
 * Lifecycle (called by MapLayerManager):
 *   initialize(ctx, projector, network, supplement) — cache projector & style, project geometry
 *   render(ctx, projector, timestamp)               — draw all passes
 *   resize(cssWidth, cssHeight)                     — invalidate projected geometry cache
 *   destroy()                                       — release all references
 */
class RoadRenderer {

    /**
     * @param {object} network     RenderNetwork from roadNetworkAdapter.
     * @param {object} supplement  OSMSupplementProvider (not used by roads — accepted for interface compatibility).
     */
    constructor(network, supplement) {
        /** @type {object} Immutable RenderNetwork. */
        this._network    = network    ?? {};

        /** @type {object} Road style configuration — populated at initialize(). */
        this._roadStyle  = null;

        /** @type {CanvasRenderingContext2D} Owned by MapLayerManager — do not close. */
        this._ctx        = null;

        /** @type {SimProjector} */
        this._projector  = null;

        /**
         * Projected road geometry cache.
         * Each entry: { road: RenderRoad, pts: Array<{x,y}>, widthPx: number, style: object }
         * Rebuilt on initialize() and on resize().
         * @type {Array<object>}
         */
        this._projected  = [];

        /** @type {boolean} Whether projected geometry is valid. */
        this._cacheValid = false;

        console.info('[RoadRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle — MapLayerManager interface
    // -----------------------------------------------------------------------

    /**
     * Called once by MapLayerManager before the first render.
     * Caches style configuration and projects road geometry.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {SimProjector}             projector
     * @param {object}                   network    RenderNetwork
     * @param {object}                   supplement OSMSupplementProvider (unused here)
     */
    initialize(ctx, projector, network, supplement) {
        this._ctx       = ctx;
        this._projector = projector;

        // Use the network passed by MapLayerManager (authoritative) in preference
        // to the constructor argument, which is kept only for future direct instantiation.
        if (network && network.roads) {
            this._network = network;
        }

        // ── Cache road style configuration ───────────────────────────────
        // Read once here. Never read window globals during render().
        // Supports both window.RENDER_CONSTANTS.ROAD_STYLE and the
        // direct window.ROAD_STYLE export for resilience during load order
        // edge cases.
        this._roadStyle = (
            window.RENDER_CONSTANTS?.ROAD_STYLE ??
            window.ROAD_STYLE ??
            {}
        );

        // Project all road geometry into canvas pixel space.
                // Project all road geometry into canvas pixel space.
        this._buildProjectedCache();

        // ✅ Signal readiness — required by MapLayerManager layer verification
        this._ready       = true;
        this._initialised = true;

        console.info('[RoadRenderer] initialized —',
            this._projected.length, 'roads projected');
    }


    /**
     * Draws all roads in pass order. Called every dirty frame by MapLayerManager.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {SimProjector}             projector
     * @param {number}                   timestamp  DOMHighResTimeStamp
     */
    render(ctx, projector, timestamp) {
        if (!this._cacheValid) {
            // Geometry invalidated (e.g. after resize) — rebuild before drawing.
            this._projector = projector;
            this._buildProjectedCache();
        }

        if (this._projected.length === 0) return;

        // ── Multi-pass pipeline ───────────────────────────────────────────
        // Each pass is a full iteration over all roads. This is intentional:
        // mixing passes per-road would cause incorrect z-ordering at intersections
        // (e.g. a shadow of a minor road drawn over the surface of a major road).
        this._passShadow(ctx);
        this._passCasing(ctx);
        this._passSurface(ctx);
        this._passMarkings(ctx);
        this._passCentreLine(ctx);
    }

    /**
     * Called by MapLayerManager when the canvas is resized.
     * Projected geometry is in CSS pixels and must be rebuilt after every resize.
     *
     * @param {number} cssWidth
     * @param {number} cssHeight
     */
    resize(cssWidth, cssHeight) {
        // Invalidate cache — geometry will be rebuilt on the next render() call.
        // We do NOT rebuild here because the projector may not yet have updated
        // its internal dimensions when resize() is called.
        this._cacheValid = false;
        console.info('[RoadRenderer] resize — cache invalidated');
    }

    /**
     * Releases all references. Called by MapLayerManager.destroy().
     */
    destroy() {
        this._projected  = [];
        this._ctx        = null;
        this._projector  = null;
        this._network    = null;
        this._roadStyle  = null;
        this._cacheValid = false;
        console.info('[RoadRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private — Geometry projection cache
    // -----------------------------------------------------------------------

    /**
     * Projects all road centrelines into CSS pixel space and computes pixel widths.
     * Result stored in this._projected for reuse across frames.
     *
     * This runs on initialize() and after resize(). It does NOT run every frame.
     * @private
     */
    _buildProjectedCache() {
        const proj   = this._projector;
        const roads  = this._network.roads;    // ← network.roads (not network.ways)

        if (!proj || !Array.isArray(roads)) {
            this._projected  = [];
            this._cacheValid = false;
            console.warn('[RoadRenderer] _buildProjectedCache — no projector or roads array');
            return;
        }

        this._projected = [];

        for (const road of roads) {
            const pts = _projectGeometry(road.centreline ?? road.geometry, proj);

            if (pts.length < 2) continue;           // degenerate — skip

            const style   = _styleFor(road, this._roadStyle);
            const widthPx = proj.metresToPixels(road.totalWidthM ?? 7);

            if (widthPx < MIN_DRAW_WIDTH_PX) continue;  // sub-pixel — skip

            this._projected.push({ road, pts, widthPx, style });
        }

        this._cacheValid = true;

        console.info('[RoadRenderer] geometry cache built —',
            this._projected.length, '/', roads.length, 'roads');
    }

    // -----------------------------------------------------------------------
    // Private — Rendering passes
    // -----------------------------------------------------------------------

    /**
     * Pass 1 — Drop shadow.
     * A blurred, offset, semi-transparent stroke drawn below the road body.
     * Gives depth cues at intersections. Controlled by style.drawShadow.
     * @param {CanvasRenderingContext2D} ctx
     * @private
     */
    _passShadow(ctx) {
        ctx.save();

        for (const { pts, widthPx, style } of this._projected) {
            // ── Feature flag ──────────────────────────────────────────────
            if (!style.drawShadow) continue;

            const offsetPx = widthPx * SHADOW_OFFSET_FRACTION;

            ctx.beginPath();
            _tracePts(ctx, pts, offsetPx * 0.25, offsetPx * 0.25);

            ctx.strokeStyle = `rgba(0,0,0,${SHADOW_ALPHA})`;
            ctx.lineWidth   = widthPx + offsetPx;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.filter      = `blur(${(offsetPx * 0.5).toFixed(1)}px)`;
            ctx.stroke();
        }

        ctx.filter = 'none';  // always reset — filter is expensive if left on
        ctx.restore();
    }

    /**
     * Pass 2 — Road casing (outline / kerb).
     * A slightly wider stroke in the casing colour drawn behind the surface.
     * Gives a kerb or edge effect. Controlled by style.drawCasing.
     * @param {CanvasRenderingContext2D} ctx
     * @private
     */
    _passCasing(ctx) {
        ctx.save();

        for (const { pts, widthPx, style } of this._projected) {
            // ── Feature flag ──────────────────────────────────────────────
            if (!style.drawCasing) continue;

            ctx.beginPath();
            _tracePts(ctx, pts);

            ctx.strokeStyle = style.casingColour ?? style.edge ?? '#222222';
            ctx.lineWidth   = widthPx + (style.casingWidthPx ?? 2);
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Pass 3 — Road surface fill.
     * The primary road colour. Always drawn — this is the road itself.
     * No feature flag: a road with no surface is not a road.
     * @param {CanvasRenderingContext2D} ctx
     * @private
     */
    _passSurface(ctx) {
        ctx.save();

        for (const { pts, widthPx, style } of this._projected) {
            ctx.beginPath();
            _tracePts(ctx, pts);

            ctx.strokeStyle = style.colour ?? style.color ?? '#555555';
            ctx.lineWidth   = widthPx;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Pass 4 — Lane markings (edge lines and inter-lane dashes).
     * Drawn on top of the surface. Controlled by style.drawMarkings.
     *
     * Two sub-passes:
     *   4a — White edge lines along both sides of the road.
     *   4b — Dashed white lane-divider lines between lanes.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @private
     */
    _passMarkings(ctx) {
        ctx.save();

        const proj = this._projector;

        for (const { road, pts, widthPx, style } of this._projected) {
            // ── Feature flag ──────────────────────────────────────────────
            if (!style.drawMarkings) continue;

            const laneCount = road.laneCount ?? 2;

            // ── 4a — Edge lines ───────────────────────────────────────────
            // One solid white line along each side of the road.
            const edgePx = Math.max(EDGE_LINE_MIN_PX, widthPx * EDGE_LINE_FRACTION);
            const halfW  = widthPx / 2;

            // Left edge
            const leftPts  = _offsetPolylinePx(pts, -(halfW - edgePx * 0.5));
            // Right edge
            const rightPts = _offsetPolylinePx(pts,  (halfW - edgePx * 0.5));

            ctx.strokeStyle = 'rgba(255,255,255,0.75)';
            ctx.lineWidth   = edgePx;
            ctx.lineCap     = 'butt';
            ctx.lineJoin    = 'miter';
            ctx.setLineDash([]);

            if (leftPts.length >= 2) {
                ctx.beginPath();
                _tracePts(ctx, leftPts);
                ctx.stroke();
            }
            if (rightPts.length >= 2) {
                ctx.beginPath();
                _tracePts(ctx, rightPts);
                ctx.stroke();
            }

            // ── 4b — Inter-lane dashes ────────────────────────────────────
            // One dashed line per internal lane boundary (laneCount - 1 lines
            // for a two-way road, but the centre is handled by passCentreLine).
            // On a two-way road: no inter-lane dashes (centre handled separately).
            // On a one-way road with N lanes: N-1 dashed lines.
            if (road.isOneway && laneCount > 1) {
                const dashOnPx  = proj.metresToPixels(LANE_DASH_LENGTH_M);
                const dashOffPx = proj.metresToPixels(LANE_DASH_GAP_M);

                ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                ctx.lineWidth   = Math.max(0.8, widthPx * 0.025);
                ctx.setLineDash([dashOnPx, dashOffPx]);

                const laneW = widthPx / laneCount;

                for (let i = 1; i < laneCount; i++) {
                    const offsetPx = -halfW + laneW * i;
                    const lanePts  = _offsetPolylinePx(pts, offsetPx);
                    if (lanePts.length < 2) continue;

                    ctx.beginPath();
                    _tracePts(ctx, lanePts);
                    ctx.stroke();
                }
            }
        }

        ctx.setLineDash([]);   // reset — dash state leaks across save()/restore() in some engines
        ctx.restore();
    }

    /**
     * Pass 5 — Centre line.
     * Drawn on top of everything. Controlled by style.drawCentreLine.
     *
     * Two-way roads: dashed yellow centre line (do-not-cross divider).
     * One-way roads: no centre line (direction implicit from markings).
     *
     * @param {CanvasRenderingContext2D} ctx
     * @private
     */
    _passCentreLine(ctx) {
        ctx.save();

        const proj = this._projector;

        for (const { road, pts, widthPx, style } of this._projected) {
            // ── Feature flag ──────────────────────────────────────────────
            if (!style.drawCentreLine) continue;

            // Centre line only meaningful on two-way roads
            if (road.isOneway) continue;

            const dashOnPx  = proj.metresToPixels(CENTRE_DASH_LENGTH_M);
            const dashOffPx = proj.metresToPixels(CENTRE_DASH_GAP_M);
            const lineW     = Math.max(0.8, widthPx * 0.03);

            ctx.strokeStyle = 'rgba(255,220,0,0.90)';
            ctx.lineWidth   = lineW;
            ctx.lineCap     = 'butt';
            ctx.lineJoin    = 'miter';
            ctx.setLineDash([dashOnPx, dashOffPx]);

            ctx.beginPath();
            _tracePts(ctx, pts);   // centre line follows road centreline directly
            ctx.stroke();
        }

        ctx.setLineDash([]);
        ctx.restore();
    }
}

// ---------------------------------------------------------------------------
// Private module helpers — not exported, no global state
// ---------------------------------------------------------------------------

/**
 * Projects an array of world-space geometry points to CSS pixel points.
 * Silently skips invalid entries. Returns an empty array if fewer than
 * 2 points project successfully.
 *
 * @param  {Array<{x: number, z: number}>} geometry  Road centreline in world metres.
 * @param  {SimProjector}                  proj
 * @returns {Array<{x: number, y: number}>}           Canvas CSS pixel points.
 */
function _projectGeometry(geometry, proj) {
    if (!Array.isArray(geometry)) return [];

    const pts = [];
    for (const pt of geometry) {
        if (!pt || typeof pt.x !== 'number' || typeof pt.z !== 'number') continue;
        if (!isFinite(pt.x) || !isFinite(pt.z)) continue;

        const p = proj.project(pt.x, pt.z);
        // proj.project() returns { cx, cy }
        pts.push({ x: p.cx, y: p.cy });
    }

    return pts;
}

/**
 * Moves the canvas path cursor along a series of pixel-space points.
 * Applies an optional uniform pixel offset perpendicular to each segment
 * when offsetPx is non-zero and the polyline has ≥ 2 points.
 *
 * For performance, if offsetPx is 0 (the common case) no offset math runs.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x,y}>}            pts
 * @param {number}                  [offsetX=0]  Additional X pixel nudge (shadow use).
 * @param {number}                  [offsetY=0]  Additional Y pixel nudge (shadow use).
 */
function _tracePts(ctx, pts, offsetX = 0, offsetY = 0) {
    if (pts.length === 0) return;
    ctx.moveTo(pts[0].x + offsetX, pts[0].y + offsetY);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x + offsetX, pts[i].y + offsetY);
    }
}

/**
 * Returns a new polyline offset perpendicular to the original by `offsetPx`
 * CSS pixels (positive = right of travel direction, negative = left).
 *
 * Uses per-segment normal averaging at joints to reduce corner artefacts.
 *
 * @param  {Array<{x,y}>} pts
 * @param  {number}        offsetPx
 * @returns {Array<{x,y}>}
 */
function _offsetPolylinePx(pts, offsetPx) {
    if (pts.length < 2 || offsetPx === 0) return pts;

    const result = [];

    for (let i = 0; i < pts.length; i++) {
        // Compute averaged normal at point i from adjacent segments
        let nx = 0, ny = 0, count = 0;

        if (i > 0) {
            const seg = _segmentNormal(pts[i - 1], pts[i]);
            nx += seg.nx; ny += seg.ny; count++;
        }
        if (i < pts.length - 1) {
            const seg = _segmentNormal(pts[i], pts[i + 1]);
            nx += seg.nx; ny += seg.ny; count++;
        }

        if (count > 0) { nx /= count; ny /= count; }

        // Re-normalise averaged normal
        const len = Math.sqrt(nx * nx + ny * ny);
        if (len > 0.0001) { nx /= len; ny /= len; }

        result.push({
            x: pts[i].x + nx * offsetPx,
            y: pts[i].y + ny * offsetPx,
        });
    }

    return result;
}

/**
 * Computes the unit right-hand normal of a 2D segment (from → to).
 * "Right-hand" means: if travel direction is up, normal points right.
 *
 * @param  {{x,y}} from
 * @param  {{x,y}} to
 * @returns {{nx: number, ny: number}}
 */
function _segmentNormal(from, to) {
    const dx  = to.x - from.x;
    const dy  = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.0001) return { nx: 0, ny: 0 };
    // Right-hand normal of (dx, dy) is (dy, -dx) — rotated 90° clockwise
    return { nx: dy / len, ny: -dx / len };
}

/**
 * Returns the rendering style object for a given road from the cached style map.
 * Falls back gracefully through highway type → 'service' → empty object.
 *
 * @param  {object} road       RenderRoad from roadNetworkAdapter.
 * @param  {object} roadStyle  Cached RENDER_CONSTANTS.ROAD_STYLE.
 * @returns {object}           Style definition (never null).
 */
function _styleFor(road, roadStyle) {
    if (!roadStyle) return {};
    return roadStyle[road.highway] ?? roadStyle['service'] ?? {};
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.RoadRenderer = RoadRenderer;

console.info('[RoadRenderer] module loaded');

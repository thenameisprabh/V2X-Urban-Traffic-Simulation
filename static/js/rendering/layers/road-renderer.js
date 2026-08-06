/**
 * @file road-renderer.js
 * @description Multi-pass road geometry renderer for the 2D map canvas.
 *
 * Passes (in draw order):
 *   1  Grass verge      — green band beyond road casing
 *   2  Drop shadow      — soft blur below road body
 *   3  Road casing      — kerb / edge outline
 *   4  Road surface     — primary asphalt fill
 *   5  Lane separators  — dashed white dividers between same-direction lanes
 *   6  Centre line      — dashed yellow divider on two-way roads
 *   7  Edge lines       — solid white lines at both road edges
 *   8  Stop lines       — thick white bars at intersection approaches
 *   9  Road arrows      — direction chevrons painted on lane surface
 *
 * @module rendering/layers/road-renderer
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_DRAW_WIDTH_PX      = 0.5;
const SHADOW_ALPHA           = 0.22;
const SHADOW_OFFSET_FRACTION = 0.55;
const LANE_DASH_LENGTH_M     = 3.0;
const LANE_DASH_GAP_M        = 5.0;
const CENTRE_DASH_LENGTH_M   = 4.0;
const CENTRE_DASH_GAP_M      = 3.0;
const EDGE_LINE_FRACTION     = 0.038;
const EDGE_LINE_MIN_PX       = 0.9;

/** Grass verge width each side of the road casing, in metres. */
const GRASS_VERGE_M          = 3.0;
/** Grass colour — dark desaturated green matching the night-city palette. */
const GRASS_COLOUR           = '#162212';
const GRASS_STROKE_COLOUR    = '#1a2814';

/** Stop-line depth in metres (perpendicular to travel direction). */
const STOP_LINE_DEPTH_M      = 0.8;
/** Stop-line setback from physical intersection centre in metres. */
const STOP_LINE_SETBACK_M    = 18;

/** Arrow chevron size in metres (half-length along lane axis). */
const ARROW_HALF_LEN_M       = 3.5;
const ARROW_HALF_WID_M       = 1.2;
/** How far from the road start/end to place arrows (fraction of road length). */
const ARROW_POSITION_FRAC    = 0.25;

// ---------------------------------------------------------------------------
// RoadRenderer
// ---------------------------------------------------------------------------

class RoadRenderer {

    constructor(network, supplement) {
        this._network    = network ?? {};
        this._roadStyle  = null;
        this._ctx        = null;
        this._projector  = null;
        this._projected  = [];
        this._cacheValid = false;
        console.info('[RoadRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    initialize(ctx, projector, network, supplement) {
        this._ctx       = ctx;
        this._projector = projector;
        if (network && network.roads) this._network = network;

        this._roadStyle = window.RENDER_CONSTANTS?.ROAD_STYLE ?? window.ROAD_STYLE ?? {};
        this._buildProjectedCache();

        this._ready       = true;
        this._initialised = true;
        console.info('[RoadRenderer] initialized —', this._projected.length, 'roads projected');
    }

    render(ctx, projector, timestamp) {
        if (!this._cacheValid) {
            this._projector = projector;
            this._buildProjectedCache();
        }
        if (this._projected.length === 0) return;

        this._passGrass(ctx);
        this._passShadow(ctx);
        this._passCasing(ctx);
        this._passSurface(ctx);
        this._passLaneSeparators(ctx);
        this._passCentreLine(ctx);
        this._passEdgeLines(ctx);
        this._passStopLines(ctx);
        this._passArrows(ctx);
    }

    resize(cssWidth, cssHeight) {
        this._cacheValid = false;
    }

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
    // Geometry cache
    // -----------------------------------------------------------------------

    _buildProjectedCache() {
        const proj  = this._projector;
        const roads = this._network.roads;
        if (!proj || !Array.isArray(roads)) {
            this._projected  = [];
            this._cacheValid = false;
            return;
        }

        this._projected = [];
        for (const road of roads) {
            const pts = _projectGeometry(road.centreline ?? road.geometry, proj);
            if (pts.length < 2) continue;
            const style   = _styleFor(road, this._roadStyle);
            const widthPx = proj.metresToPixels(road.totalWidthM ?? 7);
            if (widthPx < MIN_DRAW_WIDTH_PX) continue;
            this._projected.push({ road, pts, widthPx, style });
        }
        this._cacheValid = true;
        console.info('[RoadRenderer] cache built —', this._projected.length, '/', roads.length, 'roads');
    }

    // -----------------------------------------------------------------------
    // Pass 1 — Grass verge
    // -----------------------------------------------------------------------

    _passGrass(ctx) {
        const proj = this._projector;
        ctx.save();

        for (const { pts, widthPx, style } of this._projected) {
            if (!style.drawCasing) continue;   // only roads with kerbs get a verge

            const vergePx   = proj.metresToPixels(GRASS_VERGE_M);
            const casingAdd = proj.metresToPixels(style.casingWidthM ?? 0.5);
            const totalPx   = widthPx + casingAdd * 2 + vergePx * 2;

            ctx.beginPath();
            _tracePts(ctx, pts);
            ctx.strokeStyle = GRASS_COLOUR;
            ctx.lineWidth   = totalPx;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.stroke();
        }

        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Pass 2 — Drop shadow
    // -----------------------------------------------------------------------

    _passShadow(ctx) {
        ctx.save();
        for (const { pts, widthPx, style } of this._projected) {
            if (!style.drawShadow) continue;
            const offsetPx = widthPx * SHADOW_OFFSET_FRACTION;
            ctx.beginPath();
            _tracePts(ctx, pts, offsetPx * 0.25, offsetPx * 0.25);
            ctx.strokeStyle = `rgba(0,0,0,${SHADOW_ALPHA})`;
            ctx.lineWidth   = widthPx + offsetPx;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.filter      = `blur(${(offsetPx * 0.45).toFixed(1)}px)`;
            ctx.stroke();
        }
        ctx.filter = 'none';
        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Pass 3 — Road casing (kerb)
    // -----------------------------------------------------------------------

    _passCasing(ctx) {
        const proj = this._projector;
        ctx.save();
        for (const { pts, widthPx, style } of this._projected) {
            if (!style.drawCasing) continue;
            const casingPx = proj.metresToPixels(style.casingWidthM ?? 0.5);
            ctx.beginPath();
            _tracePts(ctx, pts);
            ctx.strokeStyle = style.casingColour ?? '#222232';
            ctx.lineWidth   = widthPx + casingPx * 2;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.stroke();
        }
        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Pass 4 — Road surface
    // -----------------------------------------------------------------------

    _passSurface(ctx) {
        ctx.save();
        for (const { pts, widthPx, style } of this._projected) {
            ctx.beginPath();
            _tracePts(ctx, pts);
            ctx.strokeStyle = style.surfaceColour ?? style.colour ?? '#2c2c3a';
            ctx.lineWidth   = widthPx;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';
            ctx.stroke();
        }
        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Pass 5 — Lane separators (dashed white, between same-direction lanes)
    // -----------------------------------------------------------------------

    _passLaneSeparators(ctx) {
        const proj = this._projector;
        ctx.save();

        for (const { road, pts, widthPx, style } of this._projected) {
            if (!style.drawMarkings) continue;

            const laneCount = road.laneCount ?? 2;
            if (laneCount < 2) continue;

            const halfW     = widthPx / 2;
            const dashOnPx  = proj.metresToPixels(LANE_DASH_LENGTH_M);
            const dashOffPx = proj.metresToPixels(LANE_DASH_GAP_M);
            const lineW     = Math.max(0.8, widthPx * 0.025);

            ctx.strokeStyle = 'rgba(255,255,255,0.80)';
            ctx.lineWidth   = lineW;
            ctx.lineCap     = 'butt';
            ctx.lineJoin    = 'miter';
            ctx.setLineDash([dashOnPx, dashOffPx]);

            if (road.isOneway) {
                // One-way: N-1 separator lines
                const laneW = widthPx / laneCount;
                for (let i = 1; i < laneCount; i++) {
                    const offsetPx = -halfW + laneW * i;
                    const lanePts  = _offsetPolylinePx(pts, offsetPx);
                    if (lanePts.length < 2) continue;
                    ctx.beginPath();
                    _tracePts(ctx, lanePts);
                    ctx.stroke();
                }
            } else if (laneCount >= 4) {
                // Two-way with 4+ lanes: separator between outer lanes on each side
                const halfLanes = Math.floor(laneCount / 2);
                const laneW     = widthPx / laneCount;
                // Left side (negative offset) — innermost lane boundary
                if (halfLanes > 1) {
                    const offsetPx = -halfW + laneW;
                    const lp = _offsetPolylinePx(pts, offsetPx);
                    if (lp.length >= 2) { ctx.beginPath(); _tracePts(ctx, lp); ctx.stroke(); }
                }
                // Right side (positive offset)
                if (halfLanes > 1) {
                    const offsetPx = halfW - laneW;
                    const lp = _offsetPolylinePx(pts, offsetPx);
                    if (lp.length >= 2) { ctx.beginPath(); _tracePts(ctx, lp); ctx.stroke(); }
                }
            }
        }

        ctx.setLineDash([]);
        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Pass 6 — Centre line (dashed yellow on two-way roads)
    // -----------------------------------------------------------------------

    _passCentreLine(ctx) {
        const proj = this._projector;
        ctx.save();

        for (const { road, pts, widthPx, style } of this._projected) {
            if (!style.drawCentreLine) continue;
            if (road.isOneway) continue;

            const dashOnPx  = proj.metresToPixels(CENTRE_DASH_LENGTH_M);
            const dashOffPx = proj.metresToPixels(CENTRE_DASH_GAP_M);
            const lineW     = Math.max(1.0, widthPx * 0.032);

            ctx.strokeStyle = 'rgba(255,215,0,0.92)';
            ctx.lineWidth   = lineW;
            ctx.lineCap     = 'butt';
            ctx.lineJoin    = 'miter';
            ctx.setLineDash([dashOnPx, dashOffPx]);

            ctx.beginPath();
            _tracePts(ctx, pts);
            ctx.stroke();
        }

        ctx.setLineDash([]);
        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Pass 7 — Edge lines (solid white along both road edges)
    // -----------------------------------------------------------------------

    _passEdgeLines(ctx) {
        ctx.save();

        for (const { pts, widthPx, style } of this._projected) {
            if (!style.drawMarkings) continue;

            const edgePx = Math.max(EDGE_LINE_MIN_PX, widthPx * EDGE_LINE_FRACTION);
            const halfW  = widthPx / 2;

            const leftPts  = _offsetPolylinePx(pts, -(halfW - edgePx * 0.5));
            const rightPts = _offsetPolylinePx(pts,   halfW - edgePx * 0.5);

            ctx.strokeStyle = 'rgba(255,255,255,0.80)';
            ctx.lineWidth   = edgePx;
            ctx.lineCap     = 'butt';
            ctx.lineJoin    = 'miter';
            ctx.setLineDash([]);

            if (leftPts.length >= 2) {
                ctx.beginPath(); _tracePts(ctx, leftPts); ctx.stroke();
            }
            if (rightPts.length >= 2) {
                ctx.beginPath(); _tracePts(ctx, rightPts); ctx.stroke();
            }
        }

        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Pass 8 — Stop lines (at intersection approaches)
    // -----------------------------------------------------------------------

    _passStopLines(ctx) {
        const proj = this._projector;
        ctx.save();

        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineCap     = 'butt';
        ctx.lineJoin    = 'miter';
        ctx.setLineDash([]);

        for (const { road, pts, widthPx, style } of this._projected) {
            if (!style.drawMarkings) continue;
            if (pts.length < 2) continue;

            // Stop lines only on roads approaching an intersection
            // We place one stop line near each end of the road
            const stopDepthPx  = proj.metresToPixels(STOP_LINE_DEPTH_M);
            const setbackPx    = proj.metresToPixels(STOP_LINE_SETBACK_M);
            ctx.lineWidth      = stopDepthPx;

            // Near the end of the road (approaching intersection)
            _drawStopLine(ctx, pts, widthPx, setbackPx, false);
        }

        ctx.restore();
    }

    // -----------------------------------------------------------------------
    // Pass 9 — Road arrows (forward chevrons on lane surface)
    // -----------------------------------------------------------------------

    _passArrows(ctx) {
        const proj = this._projector;
        const minPx = proj.metresToPixels(ARROW_HALF_LEN_M);
        if (minPx < 4) return;  // too small to be legible

        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';

        for (const { road, pts, widthPx } of this._projected) {
            if (pts.length < 2) continue;
            if (widthPx < proj.metresToPixels(5)) continue;  // very narrow roads skip arrows

            const laneCount = road.laneCount ?? 2;
            const laneW     = widthPx / laneCount;
            const halfW     = widthPx / 2;

            // Arrow dimensions in pixels
            const aLen = proj.metresToPixels(ARROW_HALF_LEN_M);
            const aWid = proj.metresToPixels(ARROW_HALF_WID_M);

            if (road.isOneway) {
                // Arrow in each lane
                for (let lane = 0; lane < laneCount; lane++) {
                    const laneOffset = -halfW + laneW * (lane + 0.5);
                    _drawArrowAlongLine(ctx, pts, laneOffset, ARROW_POSITION_FRAC, aLen, aWid, false);
                }
            } else if (laneCount >= 2) {
                // Two-way: arrows on the right half pointing forward,
                //          arrows on the left half pointing forward (they're opposing lanes)
                const halfLanes = Math.max(1, Math.floor(laneCount / 2));
                const laneW2    = widthPx / laneCount;

                // Right side (forward lanes)
                for (let lane = 0; lane < halfLanes; lane++) {
                    const laneOffset = laneW2 * (lane + 0.5);
                    _drawArrowAlongLine(ctx, pts, laneOffset, ARROW_POSITION_FRAC, aLen, aWid, false);
                }
                // Left side (opposing lanes — reverse direction)
                for (let lane = 0; lane < halfLanes; lane++) {
                    const laneOffset = -laneW2 * (lane + 0.5);
                    _drawArrowAlongLine(ctx, pts, laneOffset, 1 - ARROW_POSITION_FRAC, aLen, aWid, true);
                }
            }
        }

        ctx.restore();
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _projectGeometry(geometry, proj) {
    if (!Array.isArray(geometry)) return [];
    const pts = [];
    for (const pt of geometry) {
        if (!pt || typeof pt.x !== 'number' || typeof pt.z !== 'number') continue;
        if (!isFinite(pt.x) || !isFinite(pt.z)) continue;
        const p = proj.project(pt.x, pt.z);
        pts.push({ x: p.cx, y: p.cy });
    }
    return pts;
}

function _tracePts(ctx, pts, offsetX = 0, offsetY = 0) {
    if (pts.length === 0) return;
    ctx.moveTo(pts[0].x + offsetX, pts[0].y + offsetY);
    for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x + offsetX, pts[i].y + offsetY);
    }
}

function _offsetPolylinePx(pts, offsetPx) {
    if (pts.length < 2 || offsetPx === 0) return pts;
    const result = [];
    for (let i = 0; i < pts.length; i++) {
        let nx = 0, ny = 0, count = 0;
        if (i > 0)              { const s = _segNorm(pts[i-1], pts[i]); nx += s.nx; ny += s.ny; count++; }
        if (i < pts.length - 1) { const s = _segNorm(pts[i],   pts[i+1]); nx += s.nx; ny += s.ny; count++; }
        if (count > 0) { nx /= count; ny /= count; }
        const len = Math.sqrt(nx*nx + ny*ny);
        if (len > 0.0001) { nx /= len; ny /= len; }
        result.push({ x: pts[i].x + nx * offsetPx, y: pts[i].y + ny * offsetPx });
    }
    return result;
}

function _segNorm(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 0.0001) return { nx: 0, ny: 0 };
    return { nx: dy/len, ny: -dx/len };
}

function _styleFor(road, roadStyle) {
    if (!roadStyle) return {};
    return roadStyle[road.highway] ?? roadStyle['service'] ?? {};
}

/**
 * Draws a stop-line perpendicular to a polyline at a given pixel setback from one end.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x,y}>} pts   — projected road centreline
 * @param {number} widthPx     — road width in pixels
 * @param {number} setbackPx   — distance from end to place the line
 * @param {boolean} fromStart  — true = setback from start, false = from end
 */
function _drawStopLine(ctx, pts, widthPx, setbackPx, fromStart) {
    const n = pts.length;
    if (n < 2) return;

    // Walk from the chosen end toward the interior, accumulating arc length
    let accumulated = 0;
    let px = null, py = null, dx = 0, dy = 0;

    if (fromStart) {
        for (let i = 0; i < n - 1; i++) {
            const segDx = pts[i+1].x - pts[i].x;
            const segDy = pts[i+1].y - pts[i].y;
            const segLen = Math.sqrt(segDx*segDx + segDy*segDy);
            if (accumulated + segLen >= setbackPx) {
                const t = (setbackPx - accumulated) / segLen;
                px = pts[i].x + segDx * t;
                py = pts[i].y + segDy * t;
                dx = segDx / segLen;
                dy = segDy / segLen;
                break;
            }
            accumulated += segLen;
        }
    } else {
        for (let i = n - 1; i > 0; i--) {
            const segDx = pts[i-1].x - pts[i].x;
            const segDy = pts[i-1].y - pts[i].y;
            const segLen = Math.sqrt(segDx*segDx + segDy*segDy);
            if (accumulated + segLen >= setbackPx) {
                const t = (setbackPx - accumulated) / segLen;
                px = pts[i].x + segDx * t;
                py = pts[i].y + segDy * t;
                // Normal direction (perpendicular to travel)
                dx = segDx / segLen;
                dy = segDy / segLen;
                break;
            }
            accumulated += segLen;
        }
    }

    if (px === null) return;  // road shorter than setback

    // Perpendicular to travel direction
    const nx =  dy;
    const ny = -dx;
    const halfW = widthPx * 0.48;

    ctx.beginPath();
    ctx.moveTo(px - nx * halfW, py - ny * halfW);
    ctx.lineTo(px + nx * halfW, py + ny * halfW);
    ctx.stroke();
}

/**
 * Draws a forward-pointing arrow chevron on a polyline at a given position.
 */
function _drawArrowAlongLine(ctx, pts, lateralOffsetPx, posFrac, halfLenPx, halfWidPx, reverse) {
    const n = pts.length;
    if (n < 2) return;

    // Compute total arc length
    let totalLen = 0;
    const segLens = [];
    for (let i = 0; i < n - 1; i++) {
        const dx = pts[i+1].x - pts[i].x;
        const dy = pts[i+1].y - pts[i].y;
        const sl = Math.sqrt(dx*dx + dy*dy);
        segLens.push(sl);
        totalLen += sl;
    }

    const target = totalLen * posFrac;
    let acc = 0, ax = 0, ay = 0, tang = 0;

    for (let i = 0; i < n - 1; i++) {
        const sl = segLens[i];
        if (acc + sl >= target) {
            const t  = (target - acc) / sl;
            const dx = pts[i+1].x - pts[i].x;
            const dy = pts[i+1].y - pts[i].y;
            ax   = pts[i].x + dx * t;
            ay   = pts[i].y + dy * t;
            tang = Math.atan2(dy, dx);
            break;
        }
        acc += sl;
    }

    if (reverse) tang += Math.PI;

    // Lateral offset (perpendicular to tang)
    const nx = Math.sin(tang);
    const ny = -Math.cos(tang);
    const cx = ax + nx * lateralOffsetPx;
    const cy = ay + ny * lateralOffsetPx;

    // Draw chevron (two angled strokes meeting at a forward tip)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tang);

    const stemLen  = halfLenPx * 0.55;
    const tipX     = halfLenPx;
    const baseX    = -halfLenPx * 0.4;

    ctx.beginPath();
    ctx.moveTo(baseX, -halfWidPx);
    ctx.lineTo(tipX,  0);
    ctx.lineTo(baseX,  halfWidPx);
    ctx.lineTo(baseX + stemLen * 0.3, 0);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.RoadRenderer = RoadRenderer;
console.info('[RoadRenderer] module loaded');
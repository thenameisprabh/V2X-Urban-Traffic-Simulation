/**
 * geometry.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure geometry utility functions shared across all rendering layers.
 *
 * RULES — enforced for the lifetime of this module:
 *  1. Every function is pure: no side effects, no global reads or writes.
 *  2. No CanvasRenderingContext2D references in computation functions.
 *     Drawing helpers (drawPolyline etc.) accept ctx as a parameter only.
 *  3. No dependencies on any other module in this project.
 *  4. All angle values are in radians.
 *  5. Canvas-space points are { x, y } objects.
 *  6. Simulation-space points are { x, z } objects.
 *     This distinction is maintained in naming throughout.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Angle and Vector Math ────────────────────────────────────────────────────

/**
 * Returns the angle in radians of the directed segment from p1 to p2.
 * Angle is measured clockwise from the positive X axis (Canvas convention).
 *
 * @param {{ x: number, y: number }} p1 - start point (canvas pixels)
 * @param {{ x: number, y: number }} p2 - end point (canvas pixels)
 * @returns {number} angle in radians
 */
function segmentAngle(p1, p2) {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x);
}

/**
 * Returns the unit normal vector perpendicular to a given angle.
 * The normal points to the LEFT of the travel direction (counter-clockwise
 * rotation by 90°), which is the conventional "positive offset" direction
 * for road geometry (offsets to the left side of travel).
 *
 * @param {number} angle - segment angle in radians
 * @returns {{ x: number, y: number }} unit normal vector
 */
function normalVector(angle) {
  return {
    x: -Math.sin(angle),
    y:  Math.cos(angle),
  };
}

/**
 * Offsets a canvas point perpendicular to a segment angle by `distance` pixels.
 * Positive distance → left of travel direction.
 * Negative distance → right of travel direction.
 *
 * @param {{ x: number, y: number }} point
 * @param {number} angle    - segment angle in radians
 * @param {number} distance - offset in canvas pixels
 * @returns {{ x: number, y: number }}
 */
function offsetPoint(point, angle, distance) {
  const n = normalVector(angle);
  return {
    x: point.x + n.x * distance,
    y: point.y + n.y * distance,
  };
}

/**
 * Euclidean distance between two canvas-space points.
 *
 * @param {{ x: number, y: number }} p1
 * @param {{ x: number, y: number }} p2
 * @returns {number} distance in pixels
 */
function pointDistance(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Linearly interpolates between two numbers.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} t - interpolation factor [0, 1]
 * @returns {number}
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamps a value between min and max.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// ─── Polyline Operations ──────────────────────────────────────────────────────

/**
 * Computes a parallel-offset polyline at `distance` canvas pixels from input.
 *
 * Uses averaged normals at interior vertices to produce clean mitre joints
 * without gaps or overlaps at bends. This is the standard technique for
 * road casing and edge line rendering.
 *
 * Visual convention:
 *   distance > 0 → offset to the LEFT  of travel
 *   distance < 0 → offset to the RIGHT of travel
 *
 * @param {{ x: number, y: number }[]} pts      - input polyline (canvas pixels)
 * @param {number}                    distance  - offset distance in pixels
 * @returns {{ x: number, y: number }[]}        - offset polyline
 */
function offsetPolyline(pts, distance) {
  if (pts.length < 2) return [...pts];

  const result = [];

  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      // First vertex: use only the outgoing segment normal
      const ang = segmentAngle(pts[0], pts[1]);
      result.push(offsetPoint(pts[0], ang, distance));

    } else if (i === pts.length - 1) {
      // Last vertex: use only the incoming segment normal
      const ang = segmentAngle(pts[i - 1], pts[i]);
      result.push(offsetPoint(pts[i], ang, distance));

    } else {
      // Interior vertex: average the normals of adjacent segments.
      // Re-normalise to prevent the mitre from exploding at sharp angles.
      const ang1 = segmentAngle(pts[i - 1], pts[i]);
      const ang2 = segmentAngle(pts[i],     pts[i + 1]);
      const n1   = normalVector(ang1);
      const n2   = normalVector(ang2);

      const nx  = (n1.x + n2.x) / 2;
      const ny  = (n1.y + n2.y) / 2;
      const len = Math.sqrt(nx * nx + ny * ny) || 1;

      // Scale the offset so it remains `distance` pixels measured
      // perpendicular to each of the adjacent segments
      const scale = distance / len;

      result.push({
        x: pts[i].x + nx * scale,
        y: pts[i].y + ny * scale,
      });
    }
  }

  return result;
}

/**
 * Returns the total arc-length of a polyline in canvas pixels.
 *
 * @param {{ x: number, y: number }[]} pts
 * @returns {number} total length in pixels
 */
function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += pointDistance(pts[i - 1], pts[i]);
  }
  return total;
}

/**
 * Returns a point at a given fraction (0–1) along a polyline.
 * Useful for placing arrows or markers at mid-segment positions.
 *
 * @param {{ x: number, y: number }[]} pts
 * @param {number} t - fraction along total length [0, 1]
 * @returns {{ x: number, y: number, angle: number }}
 *   point position and the angle of the segment at that position
 */
function pointAtFraction(pts, t) {
  if (pts.length === 0) return { x: 0, y: 0, angle: 0 };
  if (pts.length === 1) return { ...pts[0], angle: 0 };

  const totalLen  = polylineLength(pts);
  const targetLen = clamp(t, 0, 1) * totalLen;

  let accumulated = 0;
  for (let i = 1; i < pts.length; i++) {
    const segLen = pointDistance(pts[i - 1], pts[i]);
    if (accumulated + segLen >= targetLen) {
      const segT  = (targetLen - accumulated) / segLen;
      const angle = segmentAngle(pts[i - 1], pts[i]);
      return {
        x:     lerp(pts[i - 1].x, pts[i].x, segT),
        y:     lerp(pts[i - 1].y, pts[i].y, segT),
        angle,
      };
    }
    accumulated += segLen;
  }

  const last  = pts[pts.length - 1];
  const prev  = pts[pts.length - 2];
  return { ...last, angle: segmentAngle(prev, last) };
}

// ─── Bounding Box ─────────────────────────────────────────────────────────────

/**
 * Returns the axis-aligned bounding box of a set of canvas-space points.
 *
 * @param {{ x: number, y: number }[]} pts
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number,
 *             width: number, height: number, cx: number, cy: number }}
 */
function pointsBounds(pts) {
  if (pts.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, cx: 0, cy: 0 };
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    minX, minY, maxX, maxY,
    width:  maxX - minX,
    height: maxY - minY,
    cx:     (minX + maxX) / 2,
    cy:     (minY + maxY) / 2,
  };
}

/**
 * Returns the centroid of a set of points.
 *
 * @param {{ x: number, y: number }[]} pts
 * @returns {{ x: number, y: number }}
 */
function centroid(pts) {
  if (pts.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / pts.length, y: sy / pts.length };
}

// ─── Canvas Drawing Primitives ────────────────────────────────────────────────
// These functions wrap canvas 2D calls. They are drawing helpers only —
// no geometry logic lives here.

/**
 * Traces a polyline path on the canvas context.
 * Does NOT stroke or fill — the caller sets style and calls stroke/fill.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }[]} pts
 */
function tracePath(ctx, pts) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
}

/**
 * Traces a closed polygon path.
 * Does NOT stroke or fill.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }[]} pts
 */
function traceClosedPath(ctx, pts) {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
}

/**
 * Strokes a polyline with the given style.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }[]} pts
 * @param {number} lineWidth
 * @param {string} strokeStyle
 * @param {CanvasLineCap}  [lineCap='round']
 * @param {CanvasLineJoin} [lineJoin='round']
 */
function drawPolyline(ctx, pts, lineWidth, strokeStyle, lineCap = 'round', lineJoin = 'round') {
  if (pts.length < 2) return;
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, pts);
  ctx.lineWidth   = lineWidth;
  ctx.strokeStyle = strokeStyle;
  ctx.lineCap     = lineCap;
  ctx.lineJoin    = lineJoin;
  ctx.stroke();
  ctx.restore();
}

/**
 * Strokes a dashed polyline.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }[]} pts
 * @param {number} lineWidth
 * @param {string} strokeStyle
 * @param {number[]} dashPattern - e.g. [dashLen, gapLen]
 * @param {CanvasLineCap} [lineCap='butt']
 */
function drawDashedPolyline(ctx, pts, lineWidth, strokeStyle, dashPattern, lineCap = 'butt') {
  if (pts.length < 2) return;
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, pts);
  ctx.lineWidth   = lineWidth;
  ctx.strokeStyle = strokeStyle;
  ctx.lineCap     = lineCap;
  ctx.setLineDash(dashPattern);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Fills and optionally strokes a closed polygon.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }[]} pts
 * @param {string|null} fillStyle   - null to skip fill
 * @param {string|null} strokeStyle - null to skip stroke
 * @param {number}      [lineWidth=1]
 */
function drawPolygon(ctx, pts, fillStyle, strokeStyle, lineWidth = 1) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.beginPath();
  traceClosedPath(ctx, pts);
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.lineWidth   = lineWidth;
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
  ctx.restore();
}

// ── Global registration ───────────────────────────────────────────────────────
window.GeometryUtils = {
    segmentAngle,
    normalVector,
    offsetPoint,
    pointDistance,
    lerp,
    clamp,
    offsetPolyline,
    polylineLength,
    pointAtFraction,
    pointsBounds,
    centroid,
    tracePath,
    traceClosedPath,
    drawPolyline,
    drawDashedPolyline,
    drawPolygon,
};

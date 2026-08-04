/**
 * @file vehicle-overlay-renderer.js
 * @description Phase 3 — Live vehicle position overlay for the 2D map canvas.
 *
 * Renders all active vehicles each dirty frame. Vehicles are pushed in via
 * updateVehicles() which is called externally (by the bootstrap's
 * window.updateVehicles hook) every time /api/state delivers new data.
 *
 * Rendering pipeline (per frame, single pass):
 *   1. Selection glow        — highlight ring on selected/emergency vehicles
 *   2. Vehicle body          — rotated rect (or circle for pedestrians)
 *   3. Direction indicator   — small forward-facing triangle on the body
 *   4. Speed label           — drawn only above ZOOM_THRESHOLDS.vehicleLabels
 *   5. UID label             — drawn only above ZOOM_THRESHOLDS.vehicleLabels
 *
 * Coordinate contract:
 *   - vehicle.pos      = [x, z] in simulation world metres
 *   - vehicle.rotation = radians, 0 = +X axis, clockwise positive (optional)
 *   - proj.project(x, z) → { cx, cy } in CSS pixels
 *   - proj.metresToPixels(m) → CSS pixel length
 *
 * This renderer MUST NOT:
 *   - fetch data from the backend
 *   - modify simulation state
 *   - know about Three.js or sim-canvas
 *   - call markDirty() itself (that is the bootstrap hook's responsibility)
 *
 * @module rendering/layers/vehicle-overlay-renderer
 */

'use strict';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Minimum vehicle body dimension in CSS pixels below which drawing is skipped. */
const MIN_BODY_PX = 1.5;

/** Alpha for the emergency glow pulse (oscillates with timestamp). */
const EMERGENCY_GLOW_BASE_ALPHA = 0.55;

/** Emergency glow outer radius multiplier relative to vehicle diagonal. */
const EMERGENCY_GLOW_RADIUS_MULT = 1.6;

/** Alpha for the normal vehicle outline stroke. */
const OUTLINE_ALPHA = 0.90;

/** Outline stroke width as a fraction of vehicle width in pixels. */
const OUTLINE_WIDTH_FRACTION = 0.08;

/** Direction triangle height as a fraction of vehicle length in pixels. */
const DIR_TRIANGLE_FRACTION = 0.28;

/** Minimum outline stroke width in CSS pixels. */
const OUTLINE_MIN_PX = 0.6;

/** Font size for UID / speed labels in CSS pixels. */
const LABEL_FONT_PX = 10;

/** Vertical offset of UID label above vehicle centre in CSS pixels. */
const LABEL_OFFSET_PX = -14;

// ---------------------------------------------------------------------------
// VehicleOverlayRenderer
// ---------------------------------------------------------------------------

/**
 * Renders live vehicle positions as a dynamic canvas overlay.
 *
 * Lifecycle (called by MapLayerManager):
 *   initialize(ctx, projector, network, supplement) — cache style constants
 *   render(ctx, projector, timestamp)               — draw all vehicles
 *   resize(cssWidth, cssHeight)                     — no-op (projects live)
 *   destroy()                                       — release all references
 *
 * External API:
 *   updateVehicles(vehicles)  — replace the current vehicle list; thread-safe
 *                               (JS is single-threaded; no lock needed)
 */
class VehicleOverlayRenderer {

    constructor() {
        /** @type {object[]} Latest vehicle array from /api/state. */
        this._vehicles = [];

        /** @type {object} VEHICLE_STYLE from RENDER_CONSTANTS. */
        this._vehicleStyle = null;

        /** @type {object} ZOOM_THRESHOLDS from RENDER_CONSTANTS. */
        this._zoomThresholds = null;

        /** @type {SimProjector|null} */
        this._projector = null;

        /** @type {boolean} Whether initialize() has been called. */
        this._ready = false;

        console.info('[VehicleOverlayRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle — MapLayerManager interface
    // -----------------------------------------------------------------------

    /**
     * Called once by MapLayerManager before the first render frame.
     * Caches style constants — never reads window globals during render().
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {SimProjector}             projector
     * @param {object}                   network    — not used by this layer
     * @param {object}                   supplement — not used by this layer
     */
    initialize(ctx, projector, network, supplement) {
        this._projector      = projector;
        this._vehicleStyle   = window.RENDER_CONSTANTS?.VEHICLE_STYLE   ?? window.VEHICLE_STYLE   ?? {};
        this._zoomThresholds = window.RENDER_CONSTANTS?.ZOOM_THRESHOLDS ?? window.ZOOM_THRESHOLDS ?? {};

        this._ready = true;

        console.info('[VehicleOverlayRenderer] initialized — style types available:',
            Object.keys(this._vehicleStyle));
    }

    /**
     * Draws all current vehicles. Called every dirty frame by MapLayerManager.
     * ctx has already been scaled to CSS pixel space by MapLayerManager._draw().
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {SimProjector}             proj
     * @param {number}                   timestamp  DOMHighResTimeStamp
     */
    render(ctx, proj, timestamp) {
        if (!this._ready) return;

        const vehicles = this._vehicles;
        if (!vehicles || vehicles.length === 0) return;

        // Cache projector reference so _drawVehicle can use it without passing
        // it through every helper call.
        this._projector = proj;

        const scale          = proj.scale;
        const showLabels     = scale >= (this._zoomThresholds.vehicleLabels ?? 3.5);

        // Single-pass: draw every vehicle in zOrder-sorted order so higher
        // zOrder vehicles appear on top of lower ones at intersections.
        // Sort is O(n log n) but vehicle counts are small (< 500 typical).
        const sorted = _sortedByZOrder(vehicles, this._vehicleStyle);

        for (const vehicle of sorted) {
            this._drawVehicle(ctx, proj, vehicle, timestamp, showLabels);
        }
    }

    /**
     * Called when canvas is resized. No geometry is cached here — all
     * projection happens live each frame — so this is intentionally a no-op.
     *
     * @param {number} cssWidth
     * @param {number} cssHeight
     */
    resize(cssWidth, cssHeight) {
        // No cache to invalidate — vehicles are projected live each frame.
    }

    /**
     * Releases all references. Called by MapLayerManager.destroy().
     */
    destroy() {
        this._vehicles       = [];
        this._vehicleStyle   = null;
        this._zoomThresholds = null;
        this._projector      = null;
        this._ready          = false;
        console.info('[VehicleOverlayRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // External API
    // -----------------------------------------------------------------------

    /**
     * Replaces the current vehicle list with a new snapshot from /api/state.
     * Called by the bootstrap's window.updateVehicles hook at up to 60 Hz.
     * Does NOT trigger a redraw — the bootstrap hook calls markDirty() after.
     *
     * @param {object[]} vehicles  Array of vehicle objects from backend.
     */
    updateVehicles(vehicles) {
        this._vehicles = Array.isArray(vehicles) ? vehicles : [];
    }

    // -----------------------------------------------------------------------
    // Private — per-vehicle drawing
    // -----------------------------------------------------------------------

    /**
     * Projects and draws a single vehicle onto the canvas.
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {SimProjector}             proj
     * @param {object}                   vehicle
     * @param {number}                   timestamp
     * @param {boolean}                  showLabels
     * @private
     */
    _drawVehicle(ctx, proj, vehicle, timestamp, showLabels) {
        // ── Unpack vehicle fields ─────────────────────────────────────────
        const pos     = vehicle.pos;
        if (!Array.isArray(pos) || pos.length < 2) return;
        if (!isFinite(pos[0]) || !isFinite(pos[1])) return;

        const worldX  = pos[0];
        const worldZ  = pos[1];
        const heading = (typeof vehicle.rotation === 'number' && isFinite(vehicle.rotation))
            ? vehicle.rotation
            : 0;
        const vType   = (vehicle.type ?? 'default').toLowerCase();
        const isEmerg = vehicle.is_emergency === true || vType === 'emergency';
        const uid     = vehicle.uid ?? '?';
        const speed   = typeof vehicle.speed === 'number' ? vehicle.speed : null;

        // ── Project world → canvas CSS pixels ────────────────────────────
        const { cx, cy } = proj.project(worldX, worldZ);

        // ── Resolve style ─────────────────────────────────────────────────
        const style   = this._vehicleStyle[vType] ?? this._vehicleStyle['default'];
        const colour  = isEmerg
            ? (style.emergencyColour ?? '#ff3b30')
            : style.colour;

        // ── Compute pixel dimensions ──────────────────────────────────────
        const halfLenPx = proj.metresToPixels(style.lengthM) / 2;
        const halfWidPx = proj.metresToPixels(style.widthM)  / 2;

        // Skip sub-pixel vehicles
        // AFTER — enforce a minimum rendered size instead of skipping
        const drawLenPx = Math.max(halfLenPx, MIN_BODY_PX / 2);
        const drawWidPx = Math.max(halfWidPx, MIN_BODY_PX / 2);

        const isPedestrian = (style.wheelbaseRatio === 0.0);

        // ── Draw ──────────────────────────────────────────────────────────
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(heading);   // heading = 0 → +X axis (east), clockwise positive

        // Pass 1 — Emergency glow pulse
        if (isEmerg) {
            _drawEmergencyGlow(ctx, halfLenPx, halfWidPx, isPedestrian, timestamp, colour);
        }

        // Pass 2 — Body
        if (isPedestrian) {
            _drawPedestrianBody(ctx, halfWidPx, colour);
        } else {
            _drawVehicleBody(ctx, halfLenPx, halfWidPx, colour);
        }

        // Pass 3 — Outline
        _drawOutline(ctx, halfLenPx, halfWidPx, isPedestrian);

        // Pass 4 — Direction indicator (not meaningful for pedestrians)
        if (!isPedestrian && halfLenPx > 3) {
            _drawDirectionIndicator(ctx, halfLenPx, halfWidPx, colour);
        }

        ctx.restore();   // back to unrotated/untranslated CSS pixel space

        // Pass 5 — Labels (drawn without rotation — always axis-aligned)
        if (showLabels) {
            _drawLabels(ctx, cx, cy, uid, speed, halfWidPx);
        }
    }
}

// ---------------------------------------------------------------------------
// Private module helpers — no global state, no exports
// ---------------------------------------------------------------------------

/**
 * Returns a copy of the vehicle array sorted ascending by zOrder so that
 * higher-priority vehicles render on top. Unknown types use 'default' zOrder.
 *
 * @param {object[]}  vehicles
 * @param {object}    vehicleStyle
 * @returns {object[]}
 */
function _sortedByZOrder(vehicles, vehicleStyle) {
    const defaultZ = vehicleStyle['default']?.zOrder ?? 50;
    return [...vehicles].sort((a, b) => {
        const za = vehicleStyle[(a.type ?? '').toLowerCase()]?.zOrder ?? defaultZ;
        const zb = vehicleStyle[(b.type ?? '').toLowerCase()]?.zOrder ?? defaultZ;
        return za - zb;   // ascending: lower zOrder drawn first (behind)
    });
}

/**
 * Draws a pulsing emergency glow behind the vehicle body.
 * Uses a radial gradient that oscillates in alpha with timestamp.
 *
 * Assumes ctx is already translated to vehicle centre and rotated.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number}  halfLenPx
 * @param {number}  halfWidPx
 * @param {boolean} isPedestrian
 * @param {number}  timestamp
 * @param {string}  colour
 */
function _drawEmergencyGlow(ctx, halfLenPx, halfWidPx, isPedestrian, timestamp, colour) {
    // Pulse: 0 → 1 → 0 every ~800ms
    const pulse  = 0.5 + 0.5 * Math.sin(timestamp * 0.008);
    const alpha  = EMERGENCY_GLOW_BASE_ALPHA * pulse;
    const diagPx = Math.sqrt(halfLenPx * halfLenPx + halfWidPx * halfWidPx);
    const radius = diagPx * EMERGENCY_GLOW_RADIUS_MULT;

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    grad.addColorStop(0.0, _colourWithAlpha(colour, alpha));
    grad.addColorStop(0.5, _colourWithAlpha(colour, alpha * 0.45));
    grad.addColorStop(1.0, _colourWithAlpha(colour, 0));

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
}

/**
 * Draws a rectangular vehicle body centred at the current transform origin.
 * Width runs along the Y axis (perpendicular to heading), length along X.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} halfLenPx   Half of vehicle length in CSS pixels.
 * @param {number} halfWidPx   Half of vehicle width in CSS pixels.
 * @param {string} colour      Fill colour string.
 */
function _drawVehicleBody(ctx, halfLenPx, halfWidPx, colour) {
    // Rounded corners — radius ≤ half the shorter dimension
    const radius = Math.min(halfWidPx * 0.35, halfLenPx * 0.2, 3);

    ctx.beginPath();
    _roundedRect(ctx, -halfLenPx, -halfWidPx, halfLenPx * 2, halfWidPx * 2, radius);
    ctx.fillStyle = colour;
    ctx.fill();
}

/**
 * Draws a circular pedestrian body centred at the current transform origin.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} halfWidPx
 * @param {string} colour
 */
function _drawPedestrianBody(ctx, halfWidPx, colour) {
    const r = Math.max(halfWidPx, 1.5);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
}

/**
 * Draws a semi-transparent dark outline around the vehicle body.
 * Helps vehicles stand out over dark road surfaces.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number}  halfLenPx
 * @param {number}  halfWidPx
 * @param {boolean} isPedestrian
 */
function _drawOutline(ctx, halfLenPx, halfWidPx, isPedestrian) {
    const lineW = Math.max(OUTLINE_MIN_PX, halfWidPx * 2 * OUTLINE_WIDTH_FRACTION);

    ctx.strokeStyle = `rgba(0,0,0,${OUTLINE_ALPHA})`;
    ctx.lineWidth   = lineW;

    if (isPedestrian) {
        const r = Math.max(halfWidPx, 1.5);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        const radius = Math.min(halfWidPx * 0.35, halfLenPx * 0.2, 3);
        ctx.beginPath();
        _roundedRect(ctx, -halfLenPx, -halfWidPx, halfLenPx * 2, halfWidPx * 2, radius);
        ctx.stroke();
    }
}

/**
 * Draws a small forward-pointing triangle at the front of the vehicle.
 * "Forward" is the +X direction in the rotated context (positive heading axis).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} halfLenPx
 * @param {number} halfWidPx
 * @param {string} colour
 */
function _drawDirectionIndicator(ctx, halfLenPx, halfWidPx, colour) {
    const tipX  = halfLenPx;                                  // front edge
    const baseX = halfLenPx - halfLenPx * DIR_TRIANGLE_FRACTION * 2;
    const baseH = halfWidPx * 0.55;                           // half-height of base

    ctx.beginPath();
    ctx.moveTo(tipX,  0);
    ctx.lineTo(baseX, -baseH);
    ctx.lineTo(baseX,  baseH);
    ctx.closePath();

    // Slightly lighter than body for contrast
    ctx.fillStyle = _lightenColour(colour, 0.30);
    ctx.fill();
}

/**
 * Draws UID and optional speed labels above the vehicle, axis-aligned.
 * ctx must NOT be in the vehicle's rotated transform when this is called.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number}       cx         Vehicle canvas X in CSS pixels.
 * @param {number}       cy         Vehicle canvas Y in CSS pixels.
 * @param {string|number} uid
 * @param {number|null}  speed      m/s, or null if unknown.
 * @param {number}       halfWidPx  Used to offset label horizontally if needed.
 */
function _drawLabels(ctx, cx, cy, uid, speed, halfWidPx) {
    ctx.font         = `bold ${LABEL_FONT_PX}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';

    const label = speed !== null
        ? `#${uid} ${speed.toFixed(1)}m/s`
        : `#${uid}`;

    const labelY = cy + LABEL_OFFSET_PX;

    // Dark shadow for legibility over any road colour
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(label, cx + 1, labelY + 1);

    // White foreground
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(label, cx, labelY);
}

// ---------------------------------------------------------------------------
// Canvas path helpers
// ---------------------------------------------------------------------------

/**
 * Adds a rounded rectangle path to ctx.
 * Compatible with browsers that do not yet support ctx.roundRect().
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x       Top-left X
 * @param {number} y       Top-left Y
 * @param {number} w       Width
 * @param {number} h       Height
 * @param {number} r       Corner radius (clamped internally)
 */
function _roundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);

    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y,     x + w, y + r,     r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x,     y + h, x,     y + h - r, r);
    ctx.lineTo(x,     y + r);
    ctx.arcTo(x,     y,     x + r, y,         r);
    ctx.closePath();
}

// ---------------------------------------------------------------------------
// Colour utilities — pure functions, no state
// ---------------------------------------------------------------------------

/**
 * Parses a CSS hex colour (#rgb or #rrggbb) and returns it with a given alpha
 * as an rgba() string. Falls back to a safe default if parsing fails.
 *
 * @param  {string} hex     e.g. '#4a90d9'
 * @param  {number} alpha   0–1
 * @returns {string}        e.g. 'rgba(74,144,217,0.55)'
 */
function _colourWithAlpha(hex, alpha) {
    const result = _parseHex(hex);
    if (!result) return `rgba(100,100,100,${alpha.toFixed(3)})`;
    return `rgba(${result.r},${result.g},${result.b},${alpha.toFixed(3)})`;
}

/**
 * Returns a lightened version of a hex colour by blending toward white.
 *
 * @param  {string} hex     e.g. '#4a90d9'
 * @param  {number} amount  0–1 (fraction toward white)
 * @returns {string}        rgba() string at full opacity
 */
function _lightenColour(hex, amount) {
    const c = _parseHex(hex);
    if (!c) return '#ffffff';
    const r = Math.round(c.r + (255 - c.r) * amount);
    const g = Math.round(c.g + (255 - c.g) * amount);
    const b = Math.round(c.b + (255 - c.b) * amount);
    return `rgb(${r},${g},${b})`;
}

/**
 * Parses a CSS hex colour string to {r, g, b} (0–255 each).
 * Handles both #rgb and #rrggbb. Returns null on failure.
 *
 * @param  {string} hex
 * @returns {{r:number, g:number, b:number}|null}
 */
function _parseHex(hex) {
    if (typeof hex !== 'string') return null;
    const h = hex.replace('#', '');
    if (h.length === 3) {
        return {
            r: parseInt(h[0] + h[0], 16),
            g: parseInt(h[1] + h[1], 16),
            b: parseInt(h[2] + h[2], 16),
        };
    }
    if (h.length === 6) {
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16),
        };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.VehicleOverlayRenderer = VehicleOverlayRenderer;

console.info('[VehicleOverlayRenderer] module loaded');

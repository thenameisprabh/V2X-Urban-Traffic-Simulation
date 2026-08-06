/**
 * @file vehicle-overlay-renderer.js
 * @description Live vehicle overlay with smooth animation.
 *
 * Animation features (all client-side, no API changes):
 *
 *   INTERPOLATION
 *     Per-vehicle state is stored between updateVehicles() calls (10 Hz).
 *     On every render frame (60 Hz) positions and headings are lerped toward
 *     the target snapshot using timestamp delta. Vehicles glide smoothly
 *     instead of jumping 100ms steps.
 *
 *   ACCELERATION / DECELERATION SQUASH
 *     Speed delta between frames drives a subtle length/width ratio change:
 *     accelerating vehicles stretch slightly forward; braking vehicles
 *     compress. Limited to ±12% so it reads as life, not cartoon.
 *
 *   TURNING LEAN
 *     Angular velocity (heading change rate) tilts the body slightly in the
 *     direction of the turn by drawing the front axle offset from centre.
 *     Renders as a subtle trapezoid deformation.
 *
 *   WHEEL POSITIONS
 *     Four wheel ellipses are drawn at the correct wheelbase / track corners.
 *     Front wheels steer with angular velocity.
 *
 *   EMERGENCY FLASHING LIGHTS
 *     Emergency vehicles alternate red/blue light bars at ~2 Hz.
 *     The bar strobes left half red, right half blue, swapping each cycle.
 *     A directional beam cone projects forward from the active side.
 *
 * API contract (unchanged):
 *   updateVehicles(vehicles)  — called by bootstrap hook at ~10 Hz
 *   render(ctx, proj, ts)     — called by MapLayerManager at ~60 Hz
 *   initialize / resize / destroy — standard layer lifecycle
 *
 * Field names read from vehicle objects:
 *   vehicle.pos          [x, z]   world metres
 *   vehicle.rotation     number   radians
 *   vehicle.speed        number   normalised
 *   vehicle.type         string
 *   vehicle.uid          string
 *   vehicle.is_emergency boolean
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_BODY_PX            = 5;
const OUTLINE_ALPHA          = 0.72;
const OUTLINE_WIDTH_FRACTION = 0.10;
const OUTLINE_MIN_PX         = 0.7;
const LABEL_FONT_PX          = 10;
const LABEL_OFFSET_PX        = -16;

// Interpolation — exponential decay toward snapshot target
const POS_LERP_T             = 0.22;   // per-frame position blend
const ROT_LERP_T             = 0.25;   // per-frame rotation blend

// Squash & stretch
const ACCEL_SQUASH_MAX       = 0.12;
const SQUASH_SMOOTH_T        = 0.18;

// Wheels
const WHEEL_RADIUS_FRAC      = 0.22;
const WHEEL_LENGTH_FRAC      = 0.38;
const WHEELBASE_FRAC         = 0.62;
const TRACK_FRAC             = 0.85;
const MAX_STEER_ANGLE        = 0.45;   // radians

// Emergency lights
const FLASH_HZ               = 2.0;
const LIGHT_BAR_H_FRAC       = 0.30;
const LIGHT_BAR_W_FRAC       = 0.70;
const BEAM_ALPHA             = 0.18;
const BEAM_LENGTH_FRAC       = 3.5;

// Headlights / tail lights
const HEADLIGHT_R_FRAC       = 0.26;
const TAILLIGHT_H_FRAC       = 0.55;
const TAILLIGHT_W_FRAC       = 0.14;

// Emergency glow
const EMERG_GLOW_ALPHA       = 0.45;
const EMERG_GLOW_R_MUL       = 2.0;

// ---------------------------------------------------------------------------
// VehicleOverlayRenderer
// ---------------------------------------------------------------------------

class VehicleOverlayRenderer {

    constructor() {
        /** Snapshot (target) state keyed by uid. Updated at ~10 Hz. */
        this._snapshots      = new Map();
        /** Interpolated display state keyed by uid. Updated every RAF frame. */
        this._display        = new Map();
        /** Sorted uid rendering order. */
        this._uidOrder       = [];

        this._vehicleStyle   = null;
        this._colourVariants = null;
        this._zoomThresholds = null;
        this._ready          = false;

        console.info('[VehicleOverlayRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    initialize(ctx, projector, network, supplement) {
        this._vehicleStyle   = window.RENDER_CONSTANTS?.VEHICLE_STYLE          ?? window.VEHICLE_STYLE          ?? {};
        this._colourVariants = window.RENDER_CONSTANTS?.VEHICLE_COLOUR_VARIANTS ?? window.VEHICLE_COLOUR_VARIANTS ?? ['#4a90d9'];
        this._zoomThresholds = window.RENDER_CONSTANTS?.ZOOM_THRESHOLDS         ?? window.ZOOM_THRESHOLDS         ?? {};
        this._ready = true;
        console.info('[VehicleOverlayRenderer] initialized');
    }

    render(ctx, proj, timestamp) {
        if (!this._ready || this._snapshots.size === 0) return;

        this._interpolate(timestamp);

        const showLabels = proj.scale >= (this._zoomThresholds.vehicleLabels ?? 3.5);
        const showWheels = proj.scale >= 0.25;

        for (const uid of this._uidOrder) {
            const snap = this._snapshots.get(uid);
            const disp = this._display.get(uid);
            if (!snap || !disp) continue;
            this._drawVehicle(ctx, proj, uid, snap, disp, timestamp, showLabels, showWheels);
        }
    }

    resize() { /* projects live — no cache */ }

    destroy() {
        this._snapshots.clear();
        this._display.clear();
        this._uidOrder       = [];
        this._vehicleStyle   = null;
        this._colourVariants = null;
        this._zoomThresholds = null;
        this._ready          = false;
        console.info('[VehicleOverlayRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // External API — called by bootstrap hook at ~10 Hz
    // -----------------------------------------------------------------------

    updateVehicles(vehicles) {
        if (!Array.isArray(vehicles)) { this._snapshots.clear(); return; }

        const now     = performance.now();
        const liveSet = new Set();

        for (const v of vehicles) {
            const pos = v.pos;
            if (!Array.isArray(pos) || pos.length < 2)    continue;
            if (!isFinite(pos[0]) || !isFinite(pos[1]))   continue;

            const uid  = String(v.uid ?? v.id ?? '?');
            liveSet.add(uid);

            const newRot   = (typeof v.rotation === 'number' && isFinite(v.rotation)) ? v.rotation : 0;
            const newSpeed = (typeof v.speed    === 'number' && isFinite(v.speed))    ? v.speed    : 0;

            const prev = this._snapshots.get(uid);

            if (!prev) {
                // First sighting — seed display at exact position (no interpolation jump)
                this._snapshots.set(uid, {
                    x: pos[0], z: pos[1], rot: newRot, speed: newSpeed,
                    ts: now, angVel: 0,
                    type: (v.type ?? 'car').toLowerCase(),
                    is_emergency: v.is_emergency === true || (v.type ?? '').toLowerCase() === 'emergency'
                });
                this._display.set(uid, {
                    x: pos[0], z: pos[1], rot: newRot,
                    squash: 0, prevSpeed: newSpeed, angVel: 0
                });
            } else {
                // Compute angular velocity from heading delta / elapsed time
                const dt     = Math.max(1, now - prev.ts);
                const angVel = _angleDelta(newRot, prev.rot) / dt;

                this._snapshots.set(uid, {
                    x: pos[0], z: pos[1], rot: newRot, speed: newSpeed,
                    ts: now, angVel,
                    type: (v.type ?? 'car').toLowerCase(),
                    is_emergency: v.is_emergency === true || (v.type ?? '').toLowerCase() === 'emergency'
                });
            }
        }

        // Remove stale vehicles
        for (const uid of [...this._snapshots.keys()]) {
            if (!liveSet.has(uid)) {
                this._snapshots.delete(uid);
                this._display.delete(uid);
            }
        }

        this._rebuildOrder();
    }

    // -----------------------------------------------------------------------
    // Private — interpolation (runs every RAF frame)
    // -----------------------------------------------------------------------

    _interpolate(timestamp) {
        for (const [uid, snap] of this._snapshots) {
            let disp = this._display.get(uid);
            if (!disp) {
                // Defensive: create missing display state
                disp = { x: snap.x, z: snap.z, rot: snap.rot, squash: 0, prevSpeed: snap.speed, angVel: 0 };
                this._display.set(uid, disp);
            }

            // Position
            disp.x = _lerp(disp.x, snap.x, POS_LERP_T);
            disp.z = _lerp(disp.z, snap.z, POS_LERP_T);

            // Heading (shortest-arc)
            disp.rot = _lerpAngle(disp.rot, snap.rot, ROT_LERP_T);

            // Angular velocity (for steering / lean effect)
            disp.angVel = _lerp(disp.angVel ?? 0, snap.angVel ?? 0, 0.15);

            // Squash & stretch
            const speedDelta   = snap.speed - disp.prevSpeed;
            const targetSquash = _clamp(speedDelta * 8, -ACCEL_SQUASH_MAX, ACCEL_SQUASH_MAX);
            disp.squash    = _lerp(disp.squash ?? 0, targetSquash, SQUASH_SMOOTH_T);
            disp.prevSpeed = _lerp(disp.prevSpeed, snap.speed, 0.20);
        }
    }

    _rebuildOrder() {
        const defaultZ = this._vehicleStyle?.['default']?.zOrder ?? 50;
        this._uidOrder = [...this._snapshots.keys()].sort((a, b) => {
            const sa = this._snapshots.get(a);
            const sb = this._snapshots.get(b);
            const za = this._vehicleStyle?.[sa?.type ?? '']?.zOrder ?? defaultZ;
            const zb = this._vehicleStyle?.[sb?.type ?? '']?.zOrder ?? defaultZ;
            return za - zb;
        });
    }

    // -----------------------------------------------------------------------
    // Private — per-vehicle drawing
    // -----------------------------------------------------------------------

    _drawVehicle(ctx, proj, uid, snap, disp, timestamp, showLabels, showWheels) {
        const { cx, cy } = proj.project(disp.x, disp.z);

        const style  = this._vehicleStyle[snap.type] ?? this._vehicleStyle['default'];
        const colour = snap.is_emergency
            ? (style.emergencyColour ?? '#ff3b30')
            : (snap.type === 'car' || snap.type === 'default')
              ? _variantColour(uid, this._colourVariants)
              : style.colour;

        // Pixel dimensions with squash/stretch
        const baseHL    = Math.max(proj.metresToPixels(style.lengthM) / 2, MIN_BODY_PX);
        const baseHW    = Math.max(proj.metresToPixels(style.widthM)  / 2, MIN_BODY_PX * 0.5);
        const sq        = disp.squash ?? 0;
        const halfLenPx = baseHL * (1 + sq);
        const halfWidPx = baseHW * (1 - sq * 0.5);
        const isPed     = (style.wheelbaseRatio === 0.0);
        const angVel    = disp.angVel ?? 0;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(disp.rot);

        // 1 — Emergency outer glow pulse
        if (snap.is_emergency) {
            _drawEmergencyGlow(ctx, halfLenPx, halfWidPx, timestamp, colour);
        }

        // 2 — Wheels (beneath body)
        if (showWheels && !isPed && halfLenPx > 6) {
            _drawWheels(ctx, halfLenPx, halfWidPx, style, angVel);
        }

        // 3 — Body
        if (isPed) {
            _drawPedestrianBody(ctx, halfWidPx, colour);
        } else {
            _drawCarBody(ctx, halfLenPx, halfWidPx, colour, snap.type, angVel);
        }

        // 4 — Outline
        _drawOutline(ctx, halfLenPx, halfWidPx, isPed);

        // 5 — Lights
        if (!isPed && snap.type !== 'cyclist' && halfLenPx > 4) {
            _drawHeadlights(ctx, halfLenPx, halfWidPx);
            _drawTailLights(ctx, halfLenPx, halfWidPx);
        }

        // 6 — Emergency light bar + beam
        if (snap.is_emergency && halfLenPx > 5) {
            _drawEmergencyLightBar(ctx, halfLenPx, halfWidPx, timestamp);
        }

        ctx.restore();

        // 7 — Labels (axis-aligned, after restore)
        if (showLabels) {
            _drawLabels(ctx, cx, cy, uid, snap.speed, halfWidPx);
        }
    }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function _drawCarBody(ctx, halfLenPx, halfWidPx, colour, vType, angVel) {
    const r = Math.min(halfWidPx * 0.38, halfLenPx * 0.22, 4);

    // Lean: front axle shifts laterally proportional to angular velocity
    const leanPx = _clamp(angVel * 800, -halfWidPx * 0.12, halfWidPx * 0.12);

    // Four corners (with lean at the front)
    const fl = {  x: halfLenPx,  y: -(halfWidPx + leanPx) };
    const fr = {  x: halfLenPx,  y:  (halfWidPx + leanPx) };
    const rl = {  x: -halfLenPx, y: -(halfWidPx - leanPx) };
    const rr = {  x: -halfLenPx, y:  (halfWidPx - leanPx) };

    ctx.beginPath();
    ctx.moveTo(fl.x, fl.y + r);
    ctx.arcTo(fl.x, fl.y,  fl.x - r, fl.y, r);
    ctx.lineTo(fr.x - r, fr.y);
    ctx.arcTo(fr.x, fr.y,  fr.x, fr.y + r, r);
    ctx.lineTo(rr.x, rr.y - r);
    ctx.arcTo(rr.x, rr.y,  rr.x + r, rr.y, r);
    ctx.lineTo(rl.x + r, rl.y);
    ctx.arcTo(rl.x, rl.y,  rl.x, rl.y + r, r);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();

    // Roof/cabin highlight (cars and motorcycles only)
    if (vType !== 'truck' && vType !== 'bus') {
        const roofX  = -halfLenPx * 0.22;
        const roofW  =  halfLenPx * 0.58;
        const roofHW =  halfWidPx * 0.80;
        const rr2    = Math.min(roofHW * 0.35, roofW * 0.35, 3);

        ctx.beginPath();
        _roundedRect(ctx, roofX, -roofHW, roofW, roofHW * 2, rr2);
        ctx.fillStyle = _lightenColour(colour, 0.16);
        ctx.fill();

        // Windshield glint line
        ctx.beginPath();
        ctx.moveTo(roofX + roofW, -roofHW);
        ctx.lineTo(roofX + roofW,  roofHW);
        ctx.strokeStyle = 'rgba(180,220,255,0.38)';
        ctx.lineWidth   = Math.max(0.7, halfWidPx * 0.08);
        ctx.stroke();
    }

    // Bus: side ribs
    if (vType === 'bus') {
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth   = 0.8;
        const count     = 5;
        const sp        = (halfLenPx * 1.6) / (count + 1);
        for (let i = 1; i <= count; i++) {
            const rx = -halfLenPx * 0.7 + sp * i;
            ctx.beginPath();
            ctx.moveTo(rx, -halfWidPx);
            ctx.lineTo(rx,  halfWidPx);
            ctx.stroke();
        }
    }
}

function _drawPedestrianBody(ctx, halfWidPx, colour) {
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(halfWidPx, 2.0), 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
}

/**
 * Four tyre ellipses at wheelbase × track corners.
 * Front wheels steer by angVel; rear wheels stay straight.
 */
function _drawWheels(ctx, halfLenPx, halfWidPx, style, angVel) {
    const axleOff  = halfLenPx * (style.wheelbaseRatio ?? 0.62);
    const trackW   = halfWidPx * TRACK_FRAC;
    const wRad     = halfWidPx * WHEEL_RADIUS_FRAC;
    const wLen     = halfWidPx * WHEEL_LENGTH_FRAC;
    const steer    = _clamp(angVel * 1200, -MAX_STEER_ANGLE, MAX_STEER_ANGLE);

    const wheels = [
        {  x:  axleOff, y: -trackW, sa: steer },
        {  x:  axleOff, y:  trackW, sa: steer },
        {  x: -axleOff, y: -trackW, sa: 0     },
        {  x: -axleOff, y:  trackW, sa: 0     },
    ];

    for (const w of wheels) {
        ctx.save();
        ctx.translate(w.x, w.y);
        ctx.rotate(w.sa);

        // Tyre
        ctx.beginPath();
        ctx.ellipse(0, 0, wLen, wRad, 0, 0, Math.PI * 2);
        ctx.fillStyle   = 'rgba(20,20,25,0.88)';
        ctx.strokeStyle = 'rgba(60,60,70,0.70)';
        ctx.lineWidth   = 0.5;
        ctx.fill();
        ctx.stroke();

        // Rim
        ctx.beginPath();
        ctx.ellipse(0, 0, wLen * 0.55, wRad * 0.55, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(140,140,155,0.80)';
        ctx.fill();

        ctx.restore();
    }
}

function _drawOutline(ctx, halfLenPx, halfWidPx, isPed) {
    const lw = Math.max(OUTLINE_MIN_PX, halfWidPx * 2 * OUTLINE_WIDTH_FRACTION);
    ctx.strokeStyle = `rgba(0,0,0,${OUTLINE_ALPHA})`;
    ctx.lineWidth   = lw;

    if (isPed) {
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(halfWidPx, 2.0), 0, Math.PI * 2);
        ctx.stroke();
    } else {
        const r = Math.min(halfWidPx * 0.38, halfLenPx * 0.22, 4);
        ctx.beginPath();
        _roundedRect(ctx, -halfLenPx, -halfWidPx, halfLenPx * 2, halfWidPx * 2, r);
        ctx.stroke();
    }
}

function _drawHeadlights(ctx, halfLenPx, halfWidPx) {
    const r    = Math.max(1.2, halfWidPx * HEADLIGHT_R_FRAC);
    const x    = halfLenPx - r * 0.5;
    const yOff = halfWidPx * 0.62;

    ctx.fillStyle = 'rgba(255,248,200,0.92)';
    ctx.beginPath(); ctx.ellipse(x, -yOff, r, r * 0.65, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x,  yOff, r, r * 0.65, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = 'rgba(255,248,200,0.14)';
    ctx.beginPath(); ctx.ellipse(x, -yOff, r * 2.5, r * 1.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x,  yOff, r * 2.5, r * 1.6, 0, 0, Math.PI * 2); ctx.fill();
}

function _drawTailLights(ctx, halfLenPx, halfWidPx) {
    const h    = halfWidPx * TAILLIGHT_H_FRAC;
    const w    = Math.max(1.0, halfLenPx * TAILLIGHT_W_FRAC);
    const x    = -halfLenPx + w * 0.5;
    const yOff = halfWidPx * 0.55;

    ctx.fillStyle = 'rgba(255,50,50,0.90)';
    ctx.fillRect(x - w, -yOff - h * 0.5, w * 1.5, h);
    ctx.fillRect(x - w,  yOff - h * 0.5, w * 1.5, h);

    ctx.fillStyle = 'rgba(255,50,50,0.17)';
    ctx.fillRect(x - w * 2, -yOff - h, w * 3, h * 2.5);
    ctx.fillRect(x - w * 2,  yOff - h, w * 3, h * 2.5);
}

/**
 * Alternating red/blue strobe light bar with a forward beam cone.
 * The bar sits on the vehicle roof; colours swap at FLASH_HZ.
 */
function _drawEmergencyLightBar(ctx, halfLenPx, halfWidPx, timestamp) {
    const cycle    = (timestamp * FLASH_HZ / 1000) % 1;   // 0→1 per cycle
    const phaseA   = cycle < 0.5;

    const barH     = halfWidPx * LIGHT_BAR_H_FRAC * 2;
    const barW     = halfLenPx * LIGHT_BAR_W_FRAC;
    const barTopY  = -(halfWidPx * 0.70);

    const colLeft  = phaseA ? 'rgba(255,30,30,0.95)' : 'rgba(40,70,255,0.95)';
    const colRight = phaseA ? 'rgba(40,70,255,0.95)' : 'rgba(255,30,30,0.95)';

    // Left half bar
    ctx.fillStyle = colLeft;
    ctx.fillRect(-barW, barTopY, barW, barH);
    // Right half bar
    ctx.fillStyle = colRight;
    ctx.fillRect(0, barTopY, barW, barH);

    // Bar border
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth   = 0.6;
    ctx.strokeRect(-barW, barTopY, barW * 2, barH);

    // Forward beam cone
    const beamLen  = halfLenPx * BEAM_LENGTH_FRAC;
    const beamOpen = halfWidPx * 0.65;
    const beamColour = phaseA
        ? `rgba(255,30,30,${BEAM_ALPHA})`
        : `rgba(40,70,255,${BEAM_ALPHA})`;

    const gradF = ctx.createLinearGradient(halfLenPx, 0, halfLenPx + beamLen, 0);
    gradF.addColorStop(0, beamColour);
    gradF.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.beginPath();
    ctx.moveTo(halfLenPx, -beamOpen);
    ctx.lineTo(halfLenPx + beamLen, -beamOpen * 2.8);
    ctx.lineTo(halfLenPx + beamLen,  beamOpen * 2.8);
    ctx.lineTo(halfLenPx,  beamOpen);
    ctx.closePath();
    ctx.fillStyle = gradF;
    ctx.fill();
}

function _drawEmergencyGlow(ctx, halfLenPx, halfWidPx, timestamp, colour) {
    const pulse  = 0.5 + 0.5 * Math.sin(timestamp * 0.0075);
    const alpha  = EMERG_GLOW_ALPHA * pulse;
    const diag   = Math.sqrt(halfLenPx * halfLenPx + halfWidPx * halfWidPx);
    const radius = diag * EMERG_GLOW_R_MUL;

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    grad.addColorStop(0.0, _rgba(colour, alpha));
    grad.addColorStop(0.5, _rgba(colour, alpha * 0.4));
    grad.addColorStop(1.0, _rgba(colour, 0));

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
}

function _drawLabels(ctx, cx, cy, uid, speed, halfWidPx) {
    const label  = (speed !== null && speed !== undefined)
        ? `#${uid} ${Number(speed).toFixed(2)}`
        : `#${uid}`;
    const labelY = cy + LABEL_OFFSET_PX;

    ctx.font         = `bold ${LABEL_FONT_PX}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillText(label, cx + 1, labelY + 1);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(label, cx, labelY);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

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
// Colour
// ---------------------------------------------------------------------------

function _variantColour(uid, variants) {
    if (!variants || variants.length === 0) return '#4a90d9';
    let hash = 0;
    const s  = String(uid);
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
    return variants[Math.abs(hash) % variants.length];
}

function _rgba(hex, alpha) {
    const c = _parseHex(hex);
    if (!c) return `rgba(100,100,100,${alpha.toFixed(3)})`;
    return `rgba(${c.r},${c.g},${c.b},${alpha.toFixed(3)})`;
}

function _lightenColour(hex, amount) {
    const c = _parseHex(hex);
    if (!c) return '#fff';
    return `rgb(${Math.round(c.r+(255-c.r)*amount)},${Math.round(c.g+(255-c.g)*amount)},${Math.round(c.b+(255-c.b)*amount)})`;
}

function _parseHex(hex) {
    if (typeof hex !== 'string') return null;
    const h = hex.replace('#', '');
    if (h.length === 3) return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16) };
    if (h.length === 6) return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
    return null;
}

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

function _lerp(a, b, t)      { return a + (b - a) * t; }

function _angleDelta(a, b) {
    let d = a - b;
    while (d >  Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

function _lerpAngle(a, b, t) { return a + _angleDelta(b, a) * t; }

function _clamp(v, lo, hi)   { return v < lo ? lo : v > hi ? hi : v; }

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.VehicleOverlayRenderer = VehicleOverlayRenderer;
console.info('[VehicleOverlayRenderer] module loaded');
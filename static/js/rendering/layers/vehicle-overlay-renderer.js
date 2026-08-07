/**
 * @file vehicle-overlay-renderer.js
 * @description Live vehicle overlay with smooth animation.
 *
 * Field names read from vehicle objects (from /api/state):
 *   vehicle.pos          [x, z]   world metres
 *   vehicle.rotation     number   radians
 *   vehicle.speed        number   normalised 0-1
 *   vehicle.type         string   'car','truck','bus','emergency','pedestrian'
 *   vehicle.uid          string
 *   vehicle.is_emergency boolean
 *
 * @module rendering/layers/vehicle-overlay-renderer
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

const POS_LERP_T             = 0.22;
const ROT_LERP_T             = 0.25;

const ACCEL_SQUASH_MAX       = 0.12;
const SQUASH_SMOOTH_T        = 0.18;

const WHEEL_RADIUS_FRAC      = 0.22;
const WHEEL_LENGTH_FRAC      = 0.38;
const TRACK_FRAC             = 0.85;
const MAX_STEER_ANGLE        = 0.45;

const FLASH_HZ               = 2.0;
const LIGHT_BAR_H_FRAC       = 0.30;
const LIGHT_BAR_W_FRAC       = 0.70;
const BEAM_ALPHA             = 0.18;
const BEAM_LENGTH_FRAC       = 3.5;

const HEADLIGHT_R_FRAC       = 0.26;
const TAILLIGHT_H_FRAC       = 0.55;
const TAILLIGHT_W_FRAC       = 0.14;

const EMERG_GLOW_ALPHA       = 0.45;
const EMERG_GLOW_R_MUL       = 2.0;

// ---------------------------------------------------------------------------
// VehicleOverlayRenderer
// ---------------------------------------------------------------------------

class VehicleOverlayRenderer {

    constructor() {
        this._snapshots      = new Map();
        this._display        = new Map();
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
        this._colourVariants = window.RENDER_CONSTANTS?.VEHICLE_COLOUR_VARIANTS ?? window.VEHICLE_COLOUR_VARIANTS ?? ['#4a90d9','#e8832a','#2ab87f','#c94fc9','#c9c94f'];
        this._zoomThresholds = window.RENDER_CONSTANTS?.ZOOM_THRESHOLDS         ?? window.ZOOM_THRESHOLDS         ?? {};
        this._ready = true;
        console.info('[VehicleOverlayRenderer] initialized');
    }

    render(ctx, proj, timestamp) {
        if (!this._ready || this._snapshots.size === 0) return;

        this._interpolate(timestamp);

        const showLabels = proj.scale >= (this._zoomThresholds.vehicleLabels ?? 3.5);
        const showWheels = proj.scale >= 1.5;

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
            // ── FIELD NAMES: backend sends .pos and .rotation ──────────────
            const pos = v.pos;
            if (!Array.isArray(pos) || pos.length < 2)    continue;
            if (!isFinite(pos[0]) || !isFinite(pos[1]))   continue;

            const uid    = String(v.uid ?? v.id ?? '?');
            liveSet.add(uid);

            const newRot   = (typeof v.rotation === 'number' && isFinite(v.rotation)) ? v.rotation : 0;
            const newSpeed = (typeof v.speed    === 'number' && isFinite(v.speed))    ? v.speed    : 0;

            const prev = this._snapshots.get(uid);

            if (!prev) {
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

        for (const uid of [...this._snapshots.keys()]) {
            if (!liveSet.has(uid)) {
                this._snapshots.delete(uid);
                this._display.delete(uid);
            }
        }

        this._rebuildOrder();
    }

    // -----------------------------------------------------------------------
    // Private — interpolation
    // -----------------------------------------------------------------------

    _interpolate(timestamp) {
        for (const [uid, snap] of this._snapshots) {
            let disp = this._display.get(uid);
            if (!disp) {
                disp = { x: snap.x, z: snap.z, rot: snap.rot, squash: 0, prevSpeed: snap.speed, angVel: 0 };
                this._display.set(uid, disp);
            }

            disp.x   = _lerp(disp.x, snap.x, POS_LERP_T);
            disp.z   = _lerp(disp.z, snap.z, POS_LERP_T);
            disp.rot = _lerpAngle(disp.rot, snap.rot, ROT_LERP_T);
            disp.angVel = _lerp(disp.angVel ?? 0, snap.angVel ?? 0, 0.15);

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

        const style = this._vehicleStyle[snap.type] ?? this._vehicleStyle['default'] ?? _fallbackStyle(snap.type);
        if (!style) return;

        const colour = snap.is_emergency
            ? (style.emergencyColour ?? '#ff3b30')
            : (snap.type === 'car' || snap.type === 'default')
              ? _variantColour(uid, this._colourVariants)
              : (style.colour ?? '#4a90d9');

        const lengthM = style.lengthM ?? 4.5;
        const widthM  = style.widthM  ?? 2.0;

        const baseHL = Math.max(proj.metresToPixels(lengthM) / 2, MIN_BODY_PX);
        const baseHW = Math.max(proj.metresToPixels(widthM)  / 2, MIN_BODY_PX * 0.5);

        if (baseHL < MIN_BODY_PX) return;  // sub-pixel — skip

        const sq        = disp.squash ?? 0;
        const halfLenPx = baseHL * (1 + sq);
        const halfWidPx = baseHW * (1 - sq * 0.5);
        const isPed     = (style.wheelbaseRatio === 0.0);
        const angVel    = disp.angVel ?? 0;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(disp.rot);

        if (snap.is_emergency) {
            _drawEmergencyGlow(ctx, halfLenPx, halfWidPx, timestamp, colour);
        }

        if (showWheels && !isPed && halfLenPx > 6) {
            _drawWheels(ctx, halfLenPx, halfWidPx, style, angVel);
        }

        if (isPed) {
            _drawPedestrianBody(ctx, halfWidPx, colour);
        } else {
            _drawCarBody(ctx, halfLenPx, halfWidPx, colour, snap.type, angVel);
        }

        _drawOutline(ctx, halfLenPx, halfWidPx, isPed);

        if (!isPed && halfLenPx > 4) {
            _drawHeadlights(ctx, halfLenPx, halfWidPx);
            _drawTailLights(ctx, halfLenPx, halfWidPx);
        }

        if (snap.is_emergency && halfLenPx > 5) {
            _drawEmergencyLightBar(ctx, halfLenPx, halfWidPx, timestamp);
        }

        ctx.restore();

        if (showLabels) {
            _drawLabels(ctx, cx, cy, uid, snap.speed, halfWidPx);
        }
    }
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function _fallbackStyle(type) {
    const defaults = {
        car:        { lengthM: 4.5,  widthM: 2.0,  colour: '#4a90d9', zOrder: 50, wheelbaseRatio: 0.62 },
        truck:      { lengthM: 8.0,  widthM: 2.5,  colour: '#e8832a', zOrder: 40, wheelbaseRatio: 0.60 },
        bus:        { lengthM: 12.0, widthM: 2.8,  colour: '#2ab87f', zOrder: 30, wheelbaseRatio: 0.70 },
        emergency:  { lengthM: 5.5,  widthM: 2.2,  colour: '#ff3b30', emergencyColour: '#ff3b30', zOrder: 90, wheelbaseRatio: 0.62 },
        pedestrian: { lengthM: 0.6,  widthM: 0.6,  colour: '#c94fc9', zOrder: 60, wheelbaseRatio: 0.0  },
        default:    { lengthM: 4.5,  widthM: 2.0,  colour: '#4a90d9', zOrder: 50, wheelbaseRatio: 0.62 },
    };
    return defaults[type] ?? defaults['default'];
}

function _drawCarBody(ctx, halfLenPx, halfWidPx, colour, vType, angVel) {
    const r      = Math.min(halfWidPx * 0.38, halfLenPx * 0.22, 4);
    const leanPx = _clamp(angVel * 800, -halfWidPx * 0.12, halfWidPx * 0.12);

    const fl = { x:  halfLenPx, y: -(halfWidPx + leanPx) };
    const fr = { x:  halfLenPx, y:  (halfWidPx + leanPx) };
    const rl = { x: -halfLenPx, y: -(halfWidPx - leanPx) };
    const rr = { x: -halfLenPx, y:  (halfWidPx - leanPx) };

    ctx.beginPath();
    ctx.moveTo(fl.x, fl.y + r);
    ctx.arcTo(fl.x, fl.y, fl.x - r, fl.y, r);
    ctx.lineTo(fr.x - r, fr.y);
    ctx.arcTo(fr.x, fr.y, fr.x, fr.y + r, r);
    ctx.lineTo(rr.x, rr.y - r);
    ctx.arcTo(rr.x, rr.y, rr.x + r, rr.y, r);
    ctx.lineTo(rl.x + r, rl.y);
    ctx.arcTo(rl.x, rl.y, rl.x, rl.y + r, r);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();

    if (vType !== 'truck' && vType !== 'bus') {
        const roofX  = -halfLenPx * 0.22;
        const roofW  =  halfLenPx * 0.58;
        const roofHW =  halfWidPx * 0.80;
        const rr2    = Math.min(roofHW * 0.35, roofW * 0.35, 3);
        ctx.beginPath();
        _roundedRect(ctx, roofX, -roofHW, roofW, roofHW * 2, rr2);
        ctx.fillStyle = _lightenColour(colour, 0.16);
        ctx.fill();
    }
}

function _drawPedestrianBody(ctx, halfWidPx, colour) {
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(halfWidPx, 2.0), 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
}

function _drawWheels(ctx, halfLenPx, halfWidPx, style, angVel) {
    const axleOff = halfLenPx * (style.wheelbaseRatio ?? 0.62);
    const trackW  = halfWidPx * TRACK_FRAC;
    const wRad    = halfWidPx * WHEEL_RADIUS_FRAC;
    const wLen    = halfWidPx * WHEEL_LENGTH_FRAC;
    const steer   = _clamp(angVel * 1200, -MAX_STEER_ANGLE, MAX_STEER_ANGLE);

    const wheels = [
        { x:  axleOff, y: -trackW, sa: steer },
        { x:  axleOff, y:  trackW, sa: steer },
        { x: -axleOff, y: -trackW, sa: 0     },
        { x: -axleOff, y:  trackW, sa: 0     },
    ];

    for (const w of wheels) {
        ctx.save();
        ctx.translate(w.x, w.y);
        ctx.rotate(w.sa);
        ctx.beginPath();
        ctx.ellipse(0, 0, wLen, wRad, 0, 0, Math.PI * 2);
        ctx.fillStyle   = 'rgba(20,20,25,0.88)';
        ctx.strokeStyle = 'rgba(60,60,70,0.70)';
        ctx.lineWidth   = 0.5;
        ctx.fill();
        ctx.stroke();
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
}

function _drawTailLights(ctx, halfLenPx, halfWidPx) {
    const h    = halfWidPx * TAILLIGHT_H_FRAC;
    const w    = Math.max(1.0, halfLenPx * TAILLIGHT_W_FRAC);
    const x    = -halfLenPx + w * 0.5;
    const yOff = halfWidPx * 0.55;
    ctx.fillStyle = 'rgba(255,50,50,0.90)';
    ctx.fillRect(x - w, -yOff - h * 0.5, w * 1.5, h);
    ctx.fillRect(x - w,  yOff - h * 0.5, w * 1.5, h);
}

function _drawEmergencyLightBar(ctx, halfLenPx, halfWidPx, timestamp) {
    const cycle   = (timestamp * FLASH_HZ / 1000) % 1;
    const phaseA  = cycle < 0.5;
    const barH    = halfWidPx * LIGHT_BAR_H_FRAC * 2;
    const barW    = halfLenPx * LIGHT_BAR_W_FRAC;
    const barTopY = -(halfWidPx * 0.70);

    ctx.fillStyle = phaseA ? 'rgba(255,30,30,0.95)' : 'rgba(40,70,255,0.95)';
    ctx.fillRect(-barW, barTopY, barW, barH);
    ctx.fillStyle = phaseA ? 'rgba(40,70,255,0.95)' : 'rgba(255,30,30,0.95)';
    ctx.fillRect(0, barTopY, barW, barH);

    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth   = 0.6;
    ctx.strokeRect(-barW, barTopY, barW * 2, barH);

    const beamLen   = halfLenPx * BEAM_LENGTH_FRAC;
    const beamOpen  = halfWidPx * 0.65;
    const beamColour = phaseA ? `rgba(255,30,30,${BEAM_ALPHA})` : `rgba(40,70,255,${BEAM_ALPHA})`;
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
    const grad   = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
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

function _lerp(a, b, t)    { return a + (b - a) * t; }
function _angleDelta(a, b) { let d = a-b; while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return d; }
function _lerpAngle(a,b,t) { return a + _angleDelta(b, a) * t; }
function _clamp(v,lo,hi)   { return v < lo ? lo : v > hi ? hi : v; }

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.VehicleOverlayRenderer = VehicleOverlayRenderer;
console.info('[VehicleOverlayRenderer] module loaded');
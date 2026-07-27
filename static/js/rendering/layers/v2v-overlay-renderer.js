/**
 * @file v2v-overlay-renderer.js
 * @description Renders V2V communication messages on the map canvas.
 *
 * Phase 9: All five message types fully rendered — TTL constants synced with
 *          simulation_engine.py (MAP_TTL_TICKS=90, EVA=30) and
 *          v2v-message-store.js (TYPE_TTL).
 *
 *   BSM  — soft blue broadcast circle + label
 *   SPAT — amber broadcast circle + signal ring + label
 *   MAP  — green broadcast circle + dashed arc outline + label
 *   EVA  — red broadcast circle + static double pulse ring + label
 *   ICA  — magenta broadcast circle + collision crosshair + label
 *
 * TTL fade: each message's alpha is attenuated by remaining tick lifetime.
 *
 * Ownership contract (unchanged):
 *   - Reads message state from V2VMessageStore ONLY via getActive()
 *   - Never writes to V2VMessageStore
 *   - Never reads from VehicleOverlayRenderer
 *   - Never owns vehicle state
 *   - Never calls markDirty()
 *   - No timers, no requestAnimationFrame state — pure snapshot rendering
 */

'use strict';

// ── Cached dash arrays — allocated once, never recreated inside render() ──
const _DASH_BEAM    = Object.freeze([4, 4]);
const _DASH_MAP_ARC = Object.freeze([6, 5]);
const _DASH_CLEAR   = Object.freeze([]);

// TTL ticks per message type
// SYNC RULE: these three constants must match simulation_engine.py and
//            v2v-message-store.js TYPE_TTL exactly.
//
//   simulation_engine.py : MAP_TTL_TICKS = 90, EVA ttl_ticks = 30, BSM = 3, SPAT = 6
//   v2v-message-store.js : TYPE_TTL = { BSM:3, SPAT:6, MAP:90, EVA:30, ICA:6 }
//   v2v-overlay-renderer : _TTL_MAP=90, _TTL_EVA=30, _TTL_DEFAULT=6  ← here
const _TTL_MAP     = 90;   // MAP_TTL_TICKS  — must match simulation_engine.py
const _TTL_EVA     = 30;   // EVA TTL        — must match simulation_engine.py
const _TTL_DEFAULT = 6;    // BSM/SPAT/ICA   — MSG_TTL_DEFAULT

class V2VOverlayRenderer {

    constructor() {
        this._store        = null;
        this._styles       = null;
        this._defaultStyle = null;
        this._labelFont    = null;
        this._smallFont    = null;
    }

    // ------------------------------------------------------------------ //
    // LIFECYCLE                                                            //
    // ------------------------------------------------------------------ //

    initialize(ctx, proj) {
        this._store = window.v2vMessageStore;

        // ── Colour palette — all strings allocated once ──────────────────
        this._styles = {
            BSM: {
                fill:       'rgba(0,   180, 255, {a})',
                stroke:     'rgba(0,   180, 255, {b})',
                label:      '#00b4ff',
                lineWidth:  1,
                ttl:        _TTL_DEFAULT
            },
            SPAT: {
                fill:       'rgba(255, 165,   0, {a})',
                stroke:     'rgba(255, 165,   0, {b})',
                label:      '#ffa500',
                lineWidth:  1,
                ttl:        _TTL_DEFAULT
            },
            MAP: {
                fill:       'rgba( 80, 200,  80, {a})',
                stroke:     'rgba( 80, 200,  80, {b})',
                label:      '#50c850',
                lineWidth:  1,
                ttl:        _TTL_MAP
            },
            EVA: {
                fill:       'rgba(255,  40,  40, {a})',
                stroke:     'rgba(255,  40,  40, {b})',
                label:      '#ff2828',
                lineWidth:  2.5,
                ttl:        _TTL_EVA
            },
            ICA: {
                fill:       'rgba(220,   0, 220, {a})',
                stroke:     'rgba(220,   0, 220, {b})',
                label:      '#dc00dc',
                lineWidth:  1.5,
                ttl:        _TTL_DEFAULT
            }
        };

        this._defaultStyle = {
            fill:       'rgba(200, 200, 200, {a})',
            stroke:     'rgba(200, 200, 200, {b})',
            label:      '#c8c8c8',
            lineWidth:  1,
            ttl:        _TTL_DEFAULT
        };

        this._labelFont = 'bold 9px monospace';
        this._smallFont = '8px monospace';

        console.info('[V2VOverlayRenderer] initialized — BSM/SPAT/MAP/EVA/ICA active (Phase 9)');
        console.info('[V2VOverlayRenderer] TTL sync — MAP:', _TTL_MAP,
            'EVA:', _TTL_EVA, 'DEFAULT:', _TTL_DEFAULT);
    }

    // ------------------------------------------------------------------ //
    // RENDER                                                               //
    // ------------------------------------------------------------------ //

    /**
     * Called every dirty frame by MapLayerManager inside save/restore.
     * Context is already scaled to CSS pixel space.
     *
     * Allocation budget per frame:
     *   - One Array from store.getActive()         — unavoidable, bounded
     *   - Zero additional allocations inside loop  (string replace is unavoidable
     *     for dynamic alpha — no pre-baked palette can cover all fade values)
     *
     * @param {CanvasRenderingContext2D} ctx
     * @param {SimProjector}             proj
     * @param {number}                   timestamp   ms from rAF (not used — pure rendering)
     */
    render(ctx, proj, timestamp) {
        if (!this._store || !this._styles) return;

        const messages = this._store.getActive();
        if (messages.length === 0) return;

        const cssW        = proj.cssWidth;
        const cssH        = proj.cssHeight;
        const currentTick = this._store._currentTick;

        // ── Outer save: font + textAlign set once for the whole frame ────
        ctx.save();
        ctx.font         = this._labelFont;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (!msg || !msg.pos) continue;

            const style = this._styles[msg.type] || this._defaultStyle;

            const { cx, cy } = proj.project(msg.pos[0], msg.pos[1]);
            const radiusPx   = proj.metresToPixels(msg.range_m);

            // ── Frustum cull ─────────────────────────────────────────────
            if (cx + radiusPx < 0  || cx - radiusPx > cssW ||
                cy + radiusPx < 0  || cy - radiusPx > cssH) {
                continue;
            }

            // ── TTL fade — alpha in [0.15, 1.0] ─────────────────────────
            // Uses per-type ttl so MAP (90 ticks) fades slowly and
            // BSM (6 ticks) fades quickly — proportional to their lifetimes.
            const ticksOld = currentTick - msg.tick;
            const ttl      = style.ttl;
            const fade     = Math.max(0.15, 1.0 - (ticksOld / ttl) * 0.85);

            // ── Per-message save: isolates globalAlpha + lineWidth ────────
            ctx.save();
            ctx.globalAlpha = fade;

            // ── 1. Transmission arc ──────────────────────────────────────
            ctx.beginPath();
            ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
            ctx.fillStyle = this._resolveFill(style, fade * 0.10);
            ctx.fill();

            ctx.lineWidth   = style.lineWidth;
            ctx.strokeStyle = this._resolveStroke(style, fade * 0.60);

            if (msg.type === 'MAP') {
                ctx.setLineDash(_DASH_MAP_ARC);
            }
            ctx.stroke();
            ctx.setLineDash(_DASH_CLEAR);

            // ── 2. Type-specific decoration ──────────────────────────────
            switch (msg.type) {
                case 'SPAT':
                    this._drawSignalRing(ctx, cx, cy, radiusPx, style, fade);
                    break;
                case 'EVA':
                    this._drawPulseRing(ctx, cx, cy, radiusPx, style, fade);
                    break;
                case 'ICA':
                    this._drawCollisionHighlight(ctx, cx, cy, radiusPx, style, fade);
                    break;
                // BSM and MAP need no extra decoration beyond the arc
            }

            // ── 3. Point-to-point beam (targeted messages only) ──────────
            if (msg.receiver_uid !== null && msg.receiver_uid !== undefined) {
                const receiverPos = this._store.getVehiclePos
                    ? this._store.getVehiclePos(msg.receiver_uid)
                    : null;
                if (receiverPos !== null && receiverPos !== undefined) {
                    const { cx: rx, cy: ry } = proj.project(receiverPos[0], receiverPos[1]);
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.lineTo(rx, ry);
                    ctx.strokeStyle = this._resolveStroke(style, fade * 0.75);
                    ctx.lineWidth   = 1.5;
                    ctx.setLineDash(_DASH_BEAM);
                    ctx.stroke();
                    ctx.setLineDash(_DASH_CLEAR);
                }
            }

            // ── 4. Type label ────────────────────────────────────────────
            ctx.fillStyle = style.label;
            ctx.font      = this._labelFont;
            ctx.fillText(msg.type, cx, cy);

            ctx.restore(); // ← per-message restore
        }

        ctx.restore(); // ← outer restore
    }

    // ------------------------------------------------------------------ //
    // PRIVATE — DECORATIONS                                               //
    // ------------------------------------------------------------------ //

    /**
     * SPAT: concentric signal ring at 30% of broadcast radius.
     */
    _drawSignalRing(ctx, cx, cy, radiusPx, style, fade) {
        const ringR = radiusPx * 0.30;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = this._resolveStroke(style, fade * 0.90);
        ctx.lineWidth   = 2;
        ctx.stroke();
    }

    /**
     * EVA: static double-ring showing broadcast strength.
     * Inner ring at 50%, outer ring at 80% of broadcast radius.
     *
     * No timestamp dependency — pure snapshot rendering, no rAF state.
     * Spec requirement: "No requestAnimationFrame state. Pure rendering."
     */
    _drawPulseRing(ctx, cx, cy, radiusPx, style, fade) {
        const innerR = radiusPx * 0.50;
        const outerR = radiusPx * 0.80;

        ctx.lineWidth = 2.5;

        // Inner ring — strong alpha
        ctx.beginPath();
        ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
        ctx.strokeStyle = this._resolveStroke(style, fade * 0.90);
        ctx.stroke();

        // Outer ring — dimmer, showing range boundary
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.strokeStyle = this._resolveStroke(style, fade * 0.55);
        ctx.stroke();
    }

    /**
     * ICA: crosshair at message origin. Arm = 25% of broadcast radius.
     */
    _drawCollisionHighlight(ctx, cx, cy, radiusPx, style, fade) {
        const arm = radiusPx * 0.25;
        ctx.strokeStyle = this._resolveStroke(style, fade * 0.90);
        ctx.lineWidth   = 2;

        ctx.beginPath();
        ctx.moveTo(cx - arm, cy);
        ctx.lineTo(cx + arm, cy);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx, cy - arm);
        ctx.lineTo(cx, cy + arm);
        ctx.stroke();
    }

    // ------------------------------------------------------------------ //
    // PRIVATE — COLOUR HELPERS                                            //
    // ------------------------------------------------------------------ //

    /**
     * Resolve fill colour with dynamic alpha via template replacement.
     * String allocation is unavoidable here — alpha is continuous [0,1].
     * One allocation per visible message per frame — bounded and acceptable.
     */
    _resolveFill(style, alpha) {
        return style.fill.replace('{a}', alpha.toFixed(2));
    }

    _resolveStroke(style, alpha) {
        return style.stroke.replace('{b}', alpha.toFixed(2));
    }
}

window.V2VOverlayRenderer = V2VOverlayRenderer;
console.info('[V2VOverlayRenderer] class registered (Phase 9)');

/**
 * @file sim-projector.js
 * @description Coordinate mathematics engine for the 2D map renderer.
 *
 * Owns ONLY the mathematical relationship between:
 *   - Simulation world space: X, Z measured in metres (local Cartesian)
 *   - Canvas pixel space:     cx, cy measured in CSS pixels
 *
 * This class MUST NOT:
 *   - render anything
 *   - fetch data
 *   - listen to DOM events
 *   - know about roads, vehicles, or any domain object
 *
 * Round-trip guarantee:
 *   unproject(project(x, z)) === {x, z}  (within floating point epsilon)
 *
 * @module rendering/core/sim-projector
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants — no magic numbers
// ---------------------------------------------------------------------------

/** Minimum allowed zoom scale (pixels per metre). Prevents zooming out to nothing. */
const MIN_SCALE = 0.05;

/** Maximum allowed zoom scale (pixels per metre). Prevents zooming in past usefulness. */
const MAX_SCALE = 50.0;

/** Zoom sensitivity multiplier for mouse wheel delta. */
const ZOOM_SENSITIVITY = 0.0012;

/** Maximum fraction of world extent the camera can pan beyond the world edge. */
const PAN_LIMIT_FACTOR = 0.5;

/** Maximum device pixel ratio we honour (caps at 3 to avoid GPU overload on 4K). */
const MAX_DPR = 3;

// ---------------------------------------------------------------------------
// Animation constants
// ---------------------------------------------------------------------------

/** Default animated transition duration in milliseconds. */
const ANIM_DURATION_MS = 600;

/** Exponential smoothing factor for vehicle follow (per-frame, 60 Hz assumed).
 *  Lower = smoother / more lag. Higher = snappier. */
const FOLLOW_SMOOTH = 0.08;

/** How far ahead of the vehicle centre to lead the camera, in metres. */
const FOLLOW_LEAD_M = 12;

/** Scale used when following a vehicle (pixels per metre). */
const FOLLOW_SCALE = 8.0;

/** Cubic ease-in-out — maps t ∈ [0,1] → [0,1]. */
function _easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// SimProjector
// ---------------------------------------------------------------------------

/**
 * Projects simulation Cartesian (X, Z) coordinates to canvas CSS pixels and back.
 *
 * Coordinate conventions:
 *   World:  X = east (+), Z = south (+), origin at world (0, 0)
 *   Canvas: cx = right (+), cy = down (+), origin at top-left
 *
 * The camera is described by:
 *   _scale   — pixels per metre (zoom level)
 *   _originX — world X coordinate at the canvas centre
 *   _originZ — world Z coordinate at the canvas centre
 */
class SimProjector {

    /**
     * @param {HTMLCanvasElement} canvas  The 2D map canvas element.
     * @param {object}            bounds  World bounds from RenderNetwork.
     * @param {number}            bounds.minX
     * @param {number}            bounds.maxX
     * @param {number}            bounds.minZ
     * @param {number}            bounds.maxZ
     * @param {object}            [options]
     * @param {number}            [options.initialScale]  Override initial scale.
     */
    constructor(canvas, bounds, options = {}) {
        this._canvas    = canvas;
        this._bounds    = bounds;
        this._options   = options;
        this._dpr       = window.devicePixelRatio || 1;
        this._originX   = null;
        this._originZ   = null;
        this._scale     = null;

        // Read real CSS dimensions immediately from the canvas element
        const rect      = canvas.getBoundingClientRect();
        this._cssWidth  = rect.width  || canvas.offsetWidth  || canvas.clientWidth  || 800;
        this._cssHeight = rect.height || canvas.offsetHeight || canvas.clientHeight || 600;

        // ── Animation state ──────────────────────────────────────────────────
        /** @type {object|null} Active animateTo() tween. */
        this._anim = null;

        // ── Follow state ─────────────────────────────────────────────────────
        /** @type {string|number|null} UID of vehicle being followed. */
        this._followUid    = null;
        /** @type {number} Smoothed follow origin X (world metres). */
        this._followOriginX = 0;
        /** @type {number} Smoothed follow origin Z (world metres). */
        this._followOriginZ = 0;

        console.info('[SimProjector] constructor — cssW:', this._cssWidth,
            'cssH:', this._cssHeight);
    }

    // -----------------------------------------------------------------------
    // Public — Coordinate conversion
    // -----------------------------------------------------------------------

    /**
     * Projects a world (X, Z) coordinate to canvas CSS pixel (cx, cy).
     *
     * @param  {number} x  World X in metres.
     * @param  {number} z  World Z in metres.
     * @returns {{ cx: number, cy: number }}
     */
    project(x, z) {
        _assertFinite(x, 'x');
        _assertFinite(z, 'z');
        return {
            cx: this._cssWidth  * 0.5 + (x - this._originX) * this._scale,
            cy: this._cssHeight * 0.5 + (z - this._originZ) * this._scale,
        };
    }

    /**
     * Unprojects a canvas CSS pixel (cx, cy) to world (X, Z) in metres.
     * Round-trip inverse of project().
     *
     * @param  {number} cx  Canvas pixel X.
     * @param  {number} cy  Canvas pixel Y.
     * @returns {{ x: number, z: number }}
     */
    unproject(cx, cy) {
        _assertFinite(cx, 'cx');
        _assertFinite(cy, 'cy');
        return {
            x: this._originX + (cx - this._cssWidth  * 0.5) / this._scale,
            z: this._originZ + (cy - this._cssHeight * 0.5) / this._scale,
        };
    }

    /**
     * Converts a world-space distance in metres to CSS pixels at the current scale.
     * Uses the same _scale factor as project() so results are consistent.
     *
     * @param  {number} metres  Distance in simulation world metres.
     * @returns {number}        Equivalent distance in CSS pixels.
     */
    metresToPixels(metres) {
        return metres * this._scale;
    }

    /**
     * Converts a distance in CSS pixels to world metres at the current scale.
     *
     * @param  {number} pixels
     * @returns {number} metres
     */
    pixelsToMetres(pixels) {
        _assertFinite(pixels, 'pixels');
        return pixels / this._scale;
    }

    // -----------------------------------------------------------------------
    // Public — Camera control
    // -----------------------------------------------------------------------

    /**
     * Fits the entire world bounds into the canvas with uniform padding.
     * Updates scale and re-centres the camera on the world centre.
     *
     * Phase 2 note: _originX / _originZ represent the world coordinate that
     * maps to the canvas centre — identical to the convention used by project(),
     * unproject(), pan(), zoom(), and _clampPan(). fit() initialises them to
     * the world-space centre of the bounds so that project(worldCentre)
     * returns canvasCentre exactly.
     *
     * Runtime verification is performed after every fit() call. The console
     * log labelled [SimProjector][FitVerify] shows whether both identities
     * hold. If either fails the fix applied here is the source of the
     * correction — do not revert without re-running verification.
     *
     * @param {number} [paddingFraction=0.05]  Fraction of canvas to leave as margin.
     */
    fit(paddingFraction = 0.05) {
        if (this._cssWidth === 0 || this._cssHeight === 0) return;

        // Support both naming conventions: min_x/max_x and minX/maxX
        const minX = this._bounds.min_x ?? this._bounds.minX ?? 0;
        const maxX = this._bounds.max_x ?? this._bounds.maxX ?? 1000;
        const minZ = this._bounds.min_z ?? this._bounds.minZ ?? 0;
        const maxZ = this._bounds.max_z ?? this._bounds.maxZ ?? 1000;

        const worldW = maxX - minX;
        const worldH = maxZ - minZ;

        if (worldW <= 0 || worldH <= 0) {
            throw new Error('[SimProjector] fit() — world bounds have zero or negative extent');
        }

        const pad    = Math.max(0, Math.min(paddingFraction, 0.4));
        const scaleX = (this._cssWidth  * (1 - pad * 2)) / worldW;
        const scaleY = (this._cssHeight * (1 - pad * 2)) / worldH;

        // Read constants safely — support both global scope and RENDER_CONSTANTS
        const MIN_SC = (window.RENDER_CONSTANTS && window.RENDER_CONSTANTS.MIN_SCALE) || MIN_SCALE;
        const MAX_SC = (window.RENDER_CONSTANTS && window.RENDER_CONSTANTS.MAX_SCALE) || MAX_SCALE;

        this._scale = Math.max(MIN_SC, Math.min(MAX_SC, Math.min(scaleX, scaleY)));

        // -----------------------------------------------------------------------
        // Camera origin — world coordinate at canvas centre.
        //
        // _originX and _originZ represent the world-space point that the camera
        // is looking at (i.e. what appears at the canvas centre). Setting them
        // to the world-space midpoint of the bounds causes project(worldCentre)
        // to return exactly (cssWidth/2, cssHeight/2).
        //
        // Proof:
        //   project(worldCentreX, worldCentreZ).cx
        //     = cssWidth/2 + (worldCentreX - _originX) * scale
        //     = cssWidth/2 + (worldCentreX - worldCentreX) * scale
        //     = cssWidth/2  ✓
        // -----------------------------------------------------------------------
        this._originX = (minX + maxX) / 2;
        this._originZ = (minZ + maxZ) / 2;

        // Cancel any active animation — fit() is an immediate snap
        this._anim = null;

        console.info('[SimProjector] fit() — scale:', this._scale.toFixed(4),
            'world:', worldW.toFixed(1), 'x', worldH.toFixed(1), 'm',
            'origin: (', this._originX.toFixed(2), ',', this._originZ.toFixed(2), ')');

        // Runtime verification — logs both identities and explicitly confirms
        // whether they hold. This runs on every fit() call so that any future
        // regression is immediately visible in the console.
        this._verifyFitIdentities(minX, maxX, minZ, maxZ);
    }

    /**
     * Fits the camera to show all intersection centres with a comfortable margin,
     * choosing a nicer zoom level than fitting the entire world (which often
     * includes large empty areas around Keskustori).
     *
     * If no intersections are provided or they have no geometry, falls back to fit().
     *
     * @param {object[]} intersections  Array of RenderIntersection objects.
     *                                  Each must have { centre: { x, z } } or { x, z }.
     * @param {number}   [padding=0.15] Fraction of canvas to leave as margin.
     */
    fitIntersections(intersections, padding = 0.15) {
        if (!Array.isArray(intersections) || intersections.length === 0) {
            this.fit(padding);
            return;
        }

        // Collect centre points — support both {centre:{x,z}} and direct {x,z}
        const points = [];
        for (const ix of intersections) {
            if (!ix) continue;
            const c = ix.centre ?? ix;
            if (typeof c.x === 'number' && typeof c.z === 'number') {
                points.push(c);
            }
        }

        if (points.length === 0) {
            this.fit(padding);
            return;
        }

        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.z < minZ) minZ = p.z;
            if (p.z > maxZ) maxZ = p.z;
        }

        // Add a fixed world-space margin so a single intersection isn't
        // zoomed in to a single pixel
        const MIN_EXTENT_M = 80;
        if (maxX - minX < MIN_EXTENT_M) {
            const cx = (minX + maxX) / 2;
            minX = cx - MIN_EXTENT_M / 2;
            maxX = cx + MIN_EXTENT_M / 2;
        }
        if (maxZ - minZ < MIN_EXTENT_M) {
            const cz = (minZ + maxZ) / 2;
            minZ = cz - MIN_EXTENT_M / 2;
            maxZ = cz + MIN_EXTENT_M / 2;
        }

        const pad    = Math.max(0, Math.min(padding, 0.4));
        const scaleX = (this._cssWidth  * (1 - pad * 2)) / (maxX - minX);
        const scaleY = (this._cssHeight * (1 - pad * 2)) / (maxZ - minZ);

        const MIN_SC = (window.RENDER_CONSTANTS && window.RENDER_CONSTANTS.MIN_SCALE) || MIN_SCALE;
        const MAX_SC = (window.RENDER_CONSTANTS && window.RENDER_CONSTANTS.MAX_SCALE) || MAX_SCALE;
        const targetScale = Math.max(MIN_SC, Math.min(MAX_SC, Math.min(scaleX, scaleY)));

        const targetX = (minX + maxX) / 2;
        const targetZ = (minZ + maxZ) / 2;

        // Animate smoothly from current position to intersection view
        this.animateTo(targetX, targetZ, targetScale, ANIM_DURATION_MS);

        console.info('[SimProjector] fitIntersections() — intersections:', points.length,
            'target scale:', targetScale.toFixed(4),
            'centre: (', targetX.toFixed(1), ',', targetZ.toFixed(1), ')');
    }

    /**
     * Smoothly animates the camera to the target world position and scale.
     * Cancels any active follow. Uses cubic ease-in-out.
     *
     * @param {number} targetX      World X to centre on.
     * @param {number} targetZ      World Z to centre on.
     * @param {number} targetScale  Target pixels-per-metre zoom level.
     * @param {number} [durationMs] Animation duration in ms (default 600).
     */
    animateTo(targetX, targetZ, targetScale, durationMs = ANIM_DURATION_MS) {
        _assertFinite(targetX,     'targetX');
        _assertFinite(targetZ,     'targetZ');
        _assertFinite(targetScale, 'targetScale');

        const MIN_SC = (window.RENDER_CONSTANTS && window.RENDER_CONSTANTS.MIN_SCALE) || MIN_SCALE;
        const MAX_SC = (window.RENDER_CONSTANTS && window.RENDER_CONSTANTS.MAX_SCALE) || MAX_SCALE;

        this._followUid = null; // cancel follow

        this._anim = {
            startX:     this._originX ?? targetX,
            startZ:     this._originZ ?? targetZ,
            startScale: this._scale   ?? targetScale,
            endX:       targetX,
            endZ:       targetZ,
            endScale:   Math.max(MIN_SC, Math.min(MAX_SC, targetScale)),
            startTime:  null,   // set on first tick() call
            duration:   Math.max(0, durationMs),
        };
    }

    /**
     * Zooms in or out, keeping the canvas point (focusCx, focusCz) stationary.
     *
     * @param {number} delta    Raw wheel delta (positive = zoom out, negative = zoom in).
     * @param {number} focusCx  Canvas X pixel to zoom toward (default: canvas centre).
     * @param {number} focusCz  Canvas Y pixel to zoom toward (default: canvas centre).
     */
    zoom(delta, focusCx, focusCz) {
        _assertFinite(delta, 'delta');

        // Any manual interaction cancels animations and follow
        this._anim      = null;
        this._followUid = null;

        const cx = (focusCx !== undefined) ? focusCx : this._cssWidth  * 0.5;
        const cz = (focusCz !== undefined) ? focusCz : this._cssHeight * 0.5;

        const before   = this.unproject(cx, cz);
        const factor   = 1 - delta * ZOOM_SENSITIVITY;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this._scale * factor));

        if (newScale === this._scale) return;

        this._scale = newScale;

        this._originX = before.x - (cx - this._cssWidth  * 0.5) / this._scale;
        this._originZ = before.z - (cz - this._cssHeight * 0.5) / this._scale;

        this._clampPan();
    }

    /**
     * Pans the camera by a CSS pixel delta.
     * Cancels any active animation and vehicle follow.
     *
     * @param {number} dx  Pixel delta X (positive = pan right = world moves left).
     * @param {number} dy  Pixel delta Y (positive = pan down  = world moves up).
     */
    pan(dx, dy) {
        _assertFinite(dx, 'dx');
        _assertFinite(dy, 'dy');

        // Any manual pan cancels animations and follow
        this._anim      = null;
        this._followUid = null;

        this._originX -= dx / this._scale;
        this._originZ -= dy / this._scale;

        this._clampPan();
    }

    /**
     * Responds to a canvas resize event.
     */
    resize() {
        this._dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

        const rect    = this._canvas.getBoundingClientRect();
        // ── FIX: round to integer pixels before any comparison or storage ──────
        // getBoundingClientRect() returns sub-pixel floats (e.g. 772.200012).
        // Without rounding the equality guard below never fires because the
        // stored integer (_cssWidth=772) never equals the new float (772.200012),
        // causing resize() → fit() → cache-invalidation to run on every frame.
        const newCssW = Math.round(rect.width  || this._canvas.offsetWidth  || 800);
        const newCssH = Math.round(rect.height || this._canvas.offsetHeight || 600);

        // Only skip the physical-buffer resize if dimensions truly unchanged
        // AND the buffer is already correct AND scale is already initialised.
        // Never skip when _scale is null — that means fit() has not run yet.
        const bufferCorrect =
            this._canvas.width  === Math.round(newCssW * this._dpr) &&
            this._canvas.height === Math.round(newCssH * this._dpr);

        if (newCssW === this._cssWidth &&
            newCssH === this._cssHeight &&
            bufferCorrect &&
            this._scale !== null) {
            return;   // genuinely nothing to do
        }

        this._cssWidth  = newCssW;
        this._cssHeight = newCssH;

        this._canvas.width  = Math.round(this._cssWidth  * this._dpr);
        this._canvas.height = Math.round(this._cssHeight * this._dpr);

        if (this._scale === null || this._scale <= 0) {
            this.fit();
        }
    }

    // -----------------------------------------------------------------------
    // Public — Vehicle follow
    // -----------------------------------------------------------------------

    /**
     * Starts smoothly following a vehicle by UID.
     * The camera pans every tick() to keep the vehicle centred with a lead point.
     *
     * @param {string|number} uid  Vehicle UID matching vehicle.uid from /api/state.
     */
    followVehicle(uid) {
        if (uid == null) { this.stopFollow(); return; }

        this._followUid = uid;
        this._anim      = null; // animateTo and follow are mutually exclusive

        // Snap follow origin to current camera position so there's no jump
        this._followOriginX = this._originX ?? 0;
        this._followOriginZ = this._originZ ?? 0;

        console.info('[SimProjector] followVehicle()', uid);
    }

    /**
     * Stops vehicle follow mode. Camera remains where it was.
     */
    stopFollow() {
        if (this._followUid !== null) {
            console.info('[SimProjector] stopFollow()');
        }
        this._followUid = null;
    }

    /** Whether the camera is currently following a vehicle. */
    get isFollowing() { return this._followUid !== null; }

    /** UID of the currently followed vehicle, or null. */
    get followUid()   { return this._followUid; }

    // -----------------------------------------------------------------------
    // Public — Per-frame tick (called by MapLayerManager._loop)
    // -----------------------------------------------------------------------

    /**
     * Advances animations and follow smoothing. Must be called once per RAF
     * frame by MapLayerManager before the dirty check.
     *
     * @param {number}   timestamp  DOMHighResTimeStamp from requestAnimationFrame.
     * @param {object[]} [vehicles] Latest vehicle array (needed for follow mode).
     * @returns {boolean} true if the camera moved this frame (caller should markDirty).
     */
    tick(timestamp, vehicles) {
        let moved = false;

        // ── animateTo tween ───────────────────────────────────────────────
        if (this._anim !== null) {
            const a = this._anim;
            if (a.startTime === null) a.startTime = timestamp;

            const elapsed = timestamp - a.startTime;
            const t       = a.duration > 0 ? Math.min(1, elapsed / a.duration) : 1;
            const et      = _easeInOut(t);

            this._originX = a.startX     + (a.endX     - a.startX)     * et;
            this._originZ = a.startZ     + (a.endZ     - a.startZ)     * et;
            this._scale   = a.startScale + (a.endScale - a.startScale) * et;

            if (t >= 1) {
                // Snap to exact target and clear tween
                this._originX = a.endX;
                this._originZ = a.endZ;
                this._scale   = a.endScale;
                this._anim    = null;
            }

            moved = true;
        }

        // ── vehicle follow ────────────────────────────────────────────────
        if (this._followUid !== null && Array.isArray(vehicles) && vehicles.length > 0) {
            const uid = this._followUid;
            // Coerce uid to string for comparison since backend may return int or string
            const vehicle = vehicles.find(v => String(v.uid) === String(uid));

            if (vehicle) {
                const pos = vehicle.pos ?? vehicle.position;
                if (Array.isArray(pos) && pos.length >= 2) {
                    const vx  = pos[0];
                    const vz  = pos[1];
                    const rot = vehicle.rotation ?? vehicle.heading ?? 0;

                    // Lead point: ahead of vehicle in its direction of travel
                    const targetX = vx + Math.cos(rot) * FOLLOW_LEAD_M;
                    const targetZ = vz + Math.sin(rot) * FOLLOW_LEAD_M;

                    // Exponential smoothing toward target
                    const α = FOLLOW_SMOOTH;
                    this._followOriginX += (targetX - this._followOriginX) * α;
                    this._followOriginZ += (targetZ - this._followOriginZ) * α;

                    // Scale: smoothly approach FOLLOW_SCALE
                    const targetScale = FOLLOW_SCALE;
                    this._scale += (targetScale - this._scale) * α;

                    this._originX = this._followOriginX;
                    this._originZ = this._followOriginZ;
                    moved = true;
                }
            }
            // If vehicle not found this frame, hold position (vehicle may be
            // between API polls — don't cancel follow).
        }

        return moved;
    }

    // -----------------------------------------------------------------------
    // Public — Accessors (read-only, used by renderers)
    // -----------------------------------------------------------------------

    get scale()     { return this._scale; }
    get cssWidth()  { return this._cssWidth; }
    get cssHeight() { return this._cssHeight; }
    get dpr()       { return this._dpr; }
    get originX()   { return this._originX; }
    get originZ()   { return this._originZ; }
    get bounds()    { return { ...this._bounds }; }

    // -----------------------------------------------------------------------
    // Private — Fit identity verification
    // -----------------------------------------------------------------------

    /**
     * Verifies the two required post-fit identities and logs the result.
     *
     * Identity A: project(worldCentre)   === canvasCentre
     * Identity B: unproject(canvasCentre) === worldCentre
     *
     * This method is diagnostic only. It does not modify any state.
     * Check the browser console for [SimProjector][FitVerify] entries.
     *
     * @param {number} minX
     * @param {number} maxX
     * @param {number} minZ
     * @param {number} maxZ
     * @private
     */
    _verifyFitIdentities(minX, maxX, minZ, maxZ) {
        const worldCX  = (minX + maxX) / 2;
        const worldCZ  = (minZ + maxZ) / 2;
        const canvasCX = this._cssWidth  / 2;
        const canvasCZ = this._cssHeight / 2;

        // Identity A — project(worldCentre) should equal canvasCentre
        const projA = this.project(worldCX, worldCZ);
        const errAx = Math.abs(projA.cx - canvasCX);
        const errAz = Math.abs(projA.cy - canvasCZ);
        const identityA = errAx < 0.001 && errAz < 0.001;

        // Identity B — unproject(canvasCentre) should equal worldCentre
        const unprojB = this.unproject(canvasCX, canvasCZ);
        const errBx   = Math.abs(unprojB.x - worldCX);
        const errBz   = Math.abs(unprojB.z - worldCZ);
        const identityB = errBx < 0.001 && errBz < 0.001;

        const allPass = identityA && identityB;

        // ── Structured console output ──────────────────────────────────────
        console.groupCollapsed(
            `[SimProjector][FitVerify] ${allPass ? '✅ PASS' : '❌ FAIL'}`
        );

        console.info('── Inputs ──────────────────────────────────────');
        console.info('  World bounds  : minX', minX, 'maxX', maxX,
                                      'minZ', minZ, 'maxZ', maxZ);
        console.info('  World centre  : X =', worldCX, '  Z =', worldCZ);
        console.info('  Canvas size   : cssW =', this._cssWidth,
                                       'cssH =', this._cssHeight);
        console.info('  Scale (px/m)  :', this._scale);
        console.info('  _originX      :', this._originX,
                     '  _originZ:', this._originZ);

        console.info('── Identity A — project(worldCentre) == canvasCentre ──');
        console.info('  Expected cx   :', canvasCX, '  cy:', canvasCZ);
        console.info('  Got      cx   :', projA.cx, '  cy:', projA.cy);
        console.info('  Error    Δcx  :', errAx.toExponential(3),
                     '  Δcy:', errAz.toExponential(3));
        console.info('  Result        :', identityA ? '✅ PASS' : '❌ FAIL');

        console.info('── Identity B — unproject(canvasCentre) == worldCentre ──');
        console.info('  Expected x    :', worldCX, '  z:', worldCZ);
        console.info('  Got      x    :', unprojB.x, '  z:', unprojB.z);
        console.info('  Error    Δx   :', errBx.toExponential(3),
                     '  Δz:', errBz.toExponential(3));
        console.info('  Result        :', identityB ? '✅ PASS' : '❌ FAIL');

        console.info('── Verdict ─────────────────────────────────────');
        if (allPass) {
            console.info('  Both identities hold. fit() origin is correct.');
        } else {
            console.error('  One or more identities failed.',
                'The origin formula is inconsistent with project().',
                'The fix in fit() must be retained.');
        }

        console.groupEnd();
    }

    // -----------------------------------------------------------------------
    // Private — Pan clamping
    // -----------------------------------------------------------------------

    _clampPan() {
        const minX   = this._bounds.min_x ?? this._bounds.minX ?? 0;
        const maxX   = this._bounds.max_x ?? this._bounds.maxX ?? 1000;
        const minZ   = this._bounds.min_z ?? this._bounds.minZ ?? 0;
        const maxZ   = this._bounds.max_z ?? this._bounds.maxZ ?? 1000;

        const worldW = maxX - minX;
        const worldH = maxZ - minZ;
        const limitX = worldW * PAN_LIMIT_FACTOR;
        const limitZ = worldH * PAN_LIMIT_FACTOR;

        this._originX = Math.max(minX - limitX, Math.min(maxX + limitX, this._originX));
        this._originZ = Math.max(minZ - limitZ, Math.min(maxZ + limitZ, this._originZ));
    }
}

// ---------------------------------------------------------------------------
// Private helpers — module-scoped, not exported
// ---------------------------------------------------------------------------

function _validateBounds(b) {
    if (!b || typeof b !== 'object') {
        throw new Error('[SimProjector] bounds must be a plain object');
    }
    const keys = ['minX', 'maxX', 'minZ', 'maxZ'];
    for (const k of keys) {
        if (typeof b[k] !== 'number' || !isFinite(b[k])) {
            throw new Error(`[SimProjector] bounds.${k} must be a finite number, got: ${b[k]}`);
        }
    }
    if (b.maxX <= b.minX) throw new Error('[SimProjector] bounds.maxX must be > bounds.minX');
    if (b.maxZ <= b.minZ) throw new Error('[SimProjector] bounds.maxZ must be > bounds.minZ');
}

function _assertFinite(v, name) {
    if (typeof v !== 'number' || !isFinite(v)) {
        throw new Error(`[SimProjector] ${name} must be a finite number, got: ${v}`);
    }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.SimProjector = SimProjector;

console.info('[SimProjector] module loaded');
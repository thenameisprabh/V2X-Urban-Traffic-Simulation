/**
 * @file terrain-renderer.js
 * @description Renders the ground base layer — gradient fill, noise texture,
 *              coordinate grid, world-origin crosshair, and edge vignette.
 *
 * Layer order: BOTTOM (index 0) — renders before all other layers.
 *
 * Interface contract (called by MapLayerManager):
 *   initialize(ctx, projector, network, supplement) → void
 *   render(ctx, projector, timestamp)               → void
 *   resize(cssWidth, cssHeight)                     → void
 *   destroy()                                       → void
 *
 * @module rendering/layers/terrain-renderer
 */

'use strict';

class TerrainRenderer {

    constructor() {
        this._initialised = false;
        this._ready       = false;
        this._ctx         = null;
        this._network     = null;
        this._cssWidth    = 0;
        this._cssHeight   = 0;
        this._style       = null;   // TERRAIN_STYLE
        this._vignette    = null;   // VIGNETTE_STYLE

        console.info('[TerrainRenderer] constructed');
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    initialize(ctx, projector, network, supplement) {
        this._ctx       = ctx;
        this._network   = network;
        this._cssWidth  = projector.cssWidth;
        this._cssHeight = projector.cssHeight;

        // Read visual constants — never hardcode colours inline
        this._style    = window.RENDER_CONSTANTS?.TERRAIN_STYLE
                      ?? window.TERRAIN_STYLE
                      ?? _FALLBACK_TERRAIN_STYLE;
        this._vignette = window.RENDER_CONSTANTS?.VIGNETTE_STYLE
                      ?? window.VIGNETTE_STYLE
                      ?? _FALLBACK_VIGNETTE_STYLE;

        this._initialised = true;
        this._ready       = true;

        console.info('[TerrainRenderer] initialized —',
            this._cssWidth.toFixed(0), 'x', this._cssHeight.toFixed(0), 'CSS px');
    }

    render(ctx, projector, timestamp) {
        if (!this._initialised) return;

        const w = projector.cssWidth;
        const h = projector.cssHeight;

        // Pass 1 — base gradient
        this._passGradient(ctx, w, h);

        // Pass 2 — subtle noise texture (only when cells are large enough)
        this._passNoise(ctx, w, h);

        // Pass 3 — coordinate grid (only when grid spacing > 8 px)
        const gridPx = projector.metresToPixels(100);
        if (gridPx > 8) {
            this._passGrid(ctx, projector, w, h);
        }

        // Pass 4 — world-origin crosshair
        this._passOriginMarker(ctx, projector);

        // Pass 5 — edge vignette (draws last — on top of terrain, under roads)
        this._passVignette(ctx, w, h);
    }

    resize(cssWidth, cssHeight) {
        this._cssWidth  = cssWidth;
        this._cssHeight = cssHeight;
    }

    destroy() {
        this._initialised = false;
        this._ready       = false;
        this._ctx         = null;
        this._network     = null;
        this._style       = null;
        this._vignette    = null;
        console.info('[TerrainRenderer] destroyed');
    }

    // -----------------------------------------------------------------------
    // Private passes
    // -----------------------------------------------------------------------

    _passGradient(ctx, w, h) {
        const stops = this._style.gradientStops;
        const grad  = ctx.createLinearGradient(0, 0, 0, h);

        for (const stop of stops) {
            grad.addColorStop(stop.pos, stop.colour);
        }

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    _passNoise(ctx, w, h) {
        const s       = this._style;
        const cellPx  = s.noiseCellPx  ?? 4;
        const density = s.noiseDensity ?? 0.45;
        const colour  = s.noiseColour  ?? '#1e1e30';
        const alpha   = s.noiseAlpha   ?? 0.018;

        // Only draw noise when cells are >= 2px (performance guard)
        if (cellPx < 2) return;

        ctx.save();
        ctx.fillStyle = colour;
        ctx.globalAlpha = alpha;

        const cols = Math.ceil(w / cellPx);
        const rows = Math.ceil(h / cellPx);

        // Deterministic pseudo-random: avoid Math.random() so noise is stable
        // across frames (prevents shimmering on static terrain).
        // Use a simple LCG seeded on cell position.
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                // LCG: fast, deterministic per cell
                const seed = (c * 1664525 + r * 1013904223) & 0xffffffff;
                const frac = (seed >>> 0) / 0xffffffff;
                if (frac < density) {
                    ctx.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
                }
            }
        }

        ctx.restore();
    }

    _passGrid(ctx, proj, w, h) {
        const bounds = this._network?.bounds;
        // ✅ CRITICAL: network uses snake_case keys — min_x, max_x, min_z, max_z
        const minX = bounds?.min_x ?? -200;
        const maxX = bounds?.max_x ??  1000;
        const minZ = bounds?.min_z ?? -400;
        const maxZ = bounds?.max_z ??  1000;

        const STEP = 100; // metres

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth   = 0.5;

        // Vertical lines — vary worldX, clamp to canvas
        const xStart = Math.floor(minX / STEP) * STEP;
        const xEnd   = Math.ceil(maxX  / STEP) * STEP;

        for (let wx = xStart; wx <= xEnd; wx += STEP) {
            // Project the world point — use minZ as a fixed reference Z
            const { cx } = proj.project(wx, minZ);
            ctx.beginPath();
            ctx.moveTo(cx, 0);
            ctx.lineTo(cx, h);
            ctx.stroke();
        }

        // Horizontal lines — vary worldZ, clamp to canvas
        const zStart = Math.floor(minZ / STEP) * STEP;
        const zEnd   = Math.ceil(maxZ  / STEP) * STEP;

        for (let wz = zStart; wz <= zEnd; wz += STEP) {
            const { cy } = proj.project(minX, wz);
            ctx.beginPath();
            ctx.moveTo(0, cy);
            ctx.lineTo(w, cy);
            ctx.stroke();
        }

        ctx.restore();
    }

    _passOriginMarker(ctx, proj) {
        const { cx, cy } = proj.project(0, 0);
        const w = proj.cssWidth;
        const h = proj.cssHeight;

        // Skip if off-screen
        if (cx < -20 || cx > w + 20 || cy < -20 || cy > h + 20) return;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.4)';
        ctx.lineWidth   = 1;

        ctx.beginPath();
        ctx.moveTo(cx - 12, cy);
        ctx.lineTo(cx + 12, cy);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx, cy - 12);
        ctx.lineTo(cx, cy + 12);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 100, 100, 0.6)';
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    _passVignette(ctx, w, h) {
        const stops = this._vignette.stops;
        const cx    = w / 2;
        const cy    = h / 2;
        const r     = Math.sqrt(cx * cx + cy * cy); // corner-to-centre distance

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        for (const stop of stops) {
            grad.addColorStop(stop.pos, stop.colour);
        }

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }
}

// ---------------------------------------------------------------------------
// Fallback constants (used only if render-constants.js is not loaded first)
// ---------------------------------------------------------------------------

const _FALLBACK_TERRAIN_STYLE = {
    gradientStops: [
        { pos: 0.0, colour: '#141422' },
        { pos: 0.5, colour: '#111120' },
        { pos: 1.0, colour: '#0e0e1c' },
    ],
    noiseColour:  '#1e1e30',
    noiseAlpha:   0.018,
    noiseCellPx:  4,
    noiseDensity: 0.45,
};

const _FALLBACK_VIGNETTE_STYLE = {
    stops: [
        { pos: 0.00, colour: 'rgba(0,0,0,0)'    },
        { pos: 0.55, colour: 'rgba(0,0,0,0)'    },
        { pos: 0.80, colour: 'rgba(0,0,0,0.08)' },
        { pos: 1.00, colour: 'rgba(0,0,0,0.50)' },
    ],
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

window.TerrainRenderer = TerrainRenderer;
console.info('[TerrainRenderer] module loaded');

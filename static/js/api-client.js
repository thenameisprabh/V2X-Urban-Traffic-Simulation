/**
 * SimApiClient — Phase 6 Live Simulation Polling Client
 *
 * Responsibilities:
 *   - Poll GET /api/state at a configurable interval.
 *   - On each successful response, call window.updateVehicles(data.vehicles).
 *   - On each successful response, call window.updateMessages(data.messages).
 *   - Update window.v2vMessageStore with latest vehicle positions.
 *   - Handle network errors without crashing the render loop.
 *   - Expose start() / stop() / setInterval() for external control.
 *   - Hold NO vehicle state. Fire-and-forget to window.updateVehicles only.
 *
 * Coupling surface:
 *   - window.updateVehicles     (function) — set by rendering-bootstrap.js Step 10a
 *   - window.updateMessages     (function) — set by rendering-bootstrap.js Step 10b
 *   - window.v2vMessageStore    (object)   — stores V2V state & spatial index
 *
 * This file has zero knowledge of canvas, projector, or any renderer internals.
 *
 * Future V2X compatibility:
 *   - stop() can be called by a V2V layer that takes over vehicle state delivery.
 *   - setInterval(0) disables polling without destroying the instance.
 *   - The window.updateVehicles hook remains the canonical vehicle delivery surface.
 *   - The window.updateMessages hook remains the canonical message delivery surface.
 */

(function (window) {
    'use strict';

    // ── Constants ────────────────────────────────────────────────────────────
    const DEFAULT_POLL_MS  = 100;   // 10 Hz — matches backend simulation tick
    const MIN_POLL_MS      = 50;    // Hard floor — never faster than 20 Hz
    const MAX_POLL_MS      = 5000;  // Hard ceiling — never slower than 0.2 Hz
    const API_STATE_URL    = '/api/state';

    // ── SimApiClient class ───────────────────────────────────────────────────
    class SimApiClient {

        constructor(options = {}) {
            /** @type {number} Current poll interval in milliseconds. */
            this._pollMs = Math.min(
                MAX_POLL_MS,
                Math.max(MIN_POLL_MS, options.pollMs ?? DEFAULT_POLL_MS)
            );

            /** @type {number|null} setInterval handle. */
            this._intervalHandle = null;

            /** @type {boolean} Whether the client is running. */
            this._running = false;

            /** @type {number} Total successful polls since start(). */
            this._pollCount = 0;

            /** @type {number} Total consecutive errors since last success. */
            this._errorStreak = 0;

            /** @type {number} Max consecutive errors before backing off. */
            this._errorStreakLimit = options.errorStreakLimit ?? 5;

            console.info('[SimApiClient] constructed — pollMs:', this._pollMs);
        }

        // ── Public — Lifecycle ───────────────────────────────────────────────

        /**
         * Starts polling /api/state.
         * Safe to call multiple times — only one interval runs at a time.
         * Must be called AFTER window.updateVehicles is wired by the bootstrap.
         */
        start() {
            if (this._running) {
                console.warn('[SimApiClient] start() called while already running — ignored');
                return;
            }

            if (typeof window.updateVehicles !== 'function') {
                console.error('[SimApiClient] window.updateVehicles is not a function. ' +
                    'Ensure rendering-bootstrap.js Step 10a has completed before calling start().');
                return;
            }

            this._running        = true;
            this._pollCount      = 0;
            this._errorStreak    = 0;
            this._intervalHandle = setInterval(() => this._poll(), this._pollMs);

            console.info('[SimApiClient] polling started — interval:', this._pollMs, 'ms');
        }

        /**
         * Stops polling. The client can be restarted by calling start() again.
         */
        stop() {
            if (!this._running) return;

            this._running = false;

            if (this._intervalHandle !== null) {
                clearInterval(this._intervalHandle);
                this._intervalHandle = null;
            }

            console.info('[SimApiClient] polling stopped — total polls:', this._pollCount);
        }

        /**
         * Changes the polling interval without stopping and restarting.
         * @param {number} ms  New interval in milliseconds.
         */
        setPollInterval(ms) {
            const clamped = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, ms));

            if (clamped !== this._pollMs) {
                this._pollMs = clamped;

                if (this._running) {
                    // Restart the interval with the new timing
                    clearInterval(this._intervalHandle);
                    this._intervalHandle = setInterval(() => this._poll(), this._pollMs);
                }

                console.info('[SimApiClient] poll interval changed to:', this._pollMs, 'ms');
            }
        }

        // ── Public — Accessors ───────────────────────────────────────────────

        /** @returns {boolean} Whether the client is currently polling. */
        get running()    { return this._running; }

        /** @returns {number} Current poll interval in ms. */
        get pollMs()     { return this._pollMs; }

        /** @returns {number} Total successful polls since last start(). */
        get pollCount()  { return this._pollCount; }

        // ── Private — Fetch ──────────────────────────────────────────────────

        /**
         * Performs one poll. Called by setInterval.
         *
         * Delivery order per tick (all share the same response — zero
         * extra fetches):
         *   1. window.updateVehicles(vehicles)             → VehicleOverlayRenderer
         *   2. window.updateMessages(messages)             → V2V Message Renderer
         *   3. window.v2vMessageStore.updateVehiclePositions(vehicles) → Position index
         *
         * @private
         */
        async _poll() {
            try {
                const res = await fetch(API_STATE_URL);

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                const data = await res.json();

                const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
                const messages = Array.isArray(data.messages) ? data.messages : [];

                // ── existing vehicle wire ────────────────────────────────────────
                if (typeof window.updateVehicles === 'function') {
                    window.updateVehicles(vehicles);
                }

                // ── Traffic-light wire ───────────────────────────────────────────
                if (typeof window.updateTrafficLights === 'function') {
                    window.updateTrafficLights(data.traffic_lights);
                }

                // ── V2V message wire (Phase 9) ───────────────────────────────────
                if (typeof window.updateMessages === 'function') {
                    window.updateMessages(messages, vehicles, data);
                }

                // Keep vehicle position index in sync for beam rendering
                if (window.v2vMessageStore) {
                    window.v2vMessageStore.updateVehiclePositions(vehicles);
                }

                this._pollCount++;
                this._errorStreak = 0;

            } catch (err) {
                this._errorStreak++;

                if (this._errorStreak <= this._errorStreakLimit) {
                    console.warn(
                        `[SimApiClient] poll error (${this._errorStreak}):`,
                        err.message
                    );
                } else if (this._errorStreak === this._errorStreakLimit + 1) {
                    // Log once at the threshold, then go silent to avoid spam
                    console.error(
                        '[SimApiClient] poll errors exceed limit —',
                        'suppressing further warnings. Last error:', err.message
                    );
                }
            }
        }
    }

    // ── Expose on window ─────────────────────────────────────────────────────
    window.SimApiClient = SimApiClient;

    console.info('[SimApiClient] class registered on window.SimApiClient');

}(window));
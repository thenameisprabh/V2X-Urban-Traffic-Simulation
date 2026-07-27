/**
 * @file v2v-message-store.js
 * @description Single owner of all active V2V message state.
 *
 * Responsibilities:
 *   - Accept message snapshots from window.updateMessages
 *   - Evict messages older than TTL_TICKS simulation ticks
 *   - Provide O(1) de-duplicated active message list to renderers
 *   - Maintain a vehicle position index for beam rendering
 *
 * This store never triggers redraws, never references any renderer,
 * and never references SimApiClient.
 */

'use strict';

// ------------------------------------------------------------------ //
// TTL CONFIGURATION (simulation ticks)                               //
// Must be kept in sync with backend MAP_INTERVAL_TICKS = 30          //
// and MAP_TTL_TICKS = 90                                            //
// ------------------------------------------------------------------ //
const MSG_TTL_DEFAULT = 6;   // BSM, SPAT, EVA  — short-lived dynamic data
const MSG_TTL_MAP     = 35;  // MAP             — static topology, re-broadcast every 30 ticks

// Per-type TTL policy (Phase 9)
// MAP gets a 5-tick grace window over its 30-tick emit interval.
const TYPE_TTL = {
    BSM:  3,
    SPAT: 6,
    MAP:  90,   // ✅ must match MAP_TTL_TICKS in simulation_engine.py
    EVA:  30,
    ICA:  6,
};

class V2VMessageStore {

    /**
     * @param {number} ttlTicks  Default TTL for non-MAP messages.
     */
    constructor(ttlTicks = MSG_TTL_DEFAULT) {
        /** @type {Map<string, object>} id → message */
        this._messages = new Map();

        /** @type {number} */
        this._ttlTicks = ttlTicks;

        /** @type {number} Most recent tick seen */
        this._currentTick = 0;

        /** @type {Map<string, number[]>} uid → [x, z] */
        this._vehiclePositions = new Map();
    }

    // ------------------------------------------------------------------ //
    // PUBLIC API                                                         //
    // ------------------------------------------------------------------ //

    /**
     * Accept a new batch of messages from the polling hook.
     * Performs de-duplication via Map key and TTL eviction in one pass.
     *
     * @param {Array} messages  Raw message array from /api/state
     */
    update(messages, currentTick) {
        // Phase 8.2.1 — reset detection owned here, not in bootstrap
        if (typeof currentTick === 'number' && currentTick < this._currentTick) {
            console.info('[V2VMessageStore] simulation reset detected —', this._currentTick, '→', currentTick);
            this.clear();
        }

        if (!Array.isArray(messages) || messages.length === 0) {
            this._evict();
            return;
        }

        // Advance tick clock: scan the full batch for the highest valid tick.
        // Monotonic — never go backwards.
        // MAP/EVA are standing broadcasts that arrive with tick=0 from the
        // backend; scanning avoids freezing _currentTick at zero.
        let batchTick = 0;
        for (const msg of messages) {
            if (typeof msg.tick === 'number' && msg.tick > batchTick) {
                batchTick = msg.tick;
            }
        }
        if (batchTick > this._currentTick) {
            this._currentTick = batchTick;
        }

        // De-duplicate by id; re-stamp tick=0 messages so eviction works.
        for (const msg of messages) {
            if (msg.id) {
                if (!msg.tick || msg.tick === 0) {
                    msg.tick = this._currentTick;
                }
                this._messages.set(msg.id, msg);
            }
        }

        this._evict();
    }

    /**
     * Update the vehicle position index so V2VOverlayRenderer can draw
     * point-to-point beams without ever touching VehicleOverlayRenderer.
     *
     * @param {Array} vehicles  Vehicle array from /api/state
     */
    updateVehiclePositions(vehicles) {
        this._vehiclePositions.clear();
        if (!Array.isArray(vehicles)) return;
        for (let i = 0; i < vehicles.length; i++) {
            const v = vehicles[i];
            if (v && v.uid && Array.isArray(v.pos)) {
                this._vehiclePositions.set(v.uid, v.pos);
            }
        }
    }

    /**
     * Return snapshot of currently active messages.
     * Called once per frame by V2VOverlayRenderer.render().
     *
     * @returns {object[]}
     */
    getActive() {
        return Array.from(this._messages.values());
    }

    /**
     * Return last known world position of a vehicle by uid.
     * Used by V2VOverlayRenderer to draw point-to-point beams.
     *
     * @param   {string}          uid
     * @returns {number[]|null}   [x, z] or null if unknown
     */
    getVehiclePos(uid) {
        return this._vehiclePositions.get(uid) ?? null;
    }

    /**
     * Remove all state. Called when simulation is cleared.
     */
    clear() {
        this._messages.clear();
        this._vehiclePositions.clear();
        this._currentTick = 0;
        console.info('[V2VMessageStore] cleared — reset detected');
    }

    // ------------------------------------------------------------------ //
    // PRIVATE                                                            //
    // ------------------------------------------------------------------ //

    /**
     * Evict messages whose tick is older than their individual or default TTL.
     *
     * Prefers msg.ttl_ticks when present, falling back to store default.
     *
     * O(n) — acceptable since message count is bounded by vehicle count (≤20)
     * plus intersection count (≤3 × 2 message types = ≤6 infra messages).
     */
    _evict() {
        for (const [id, msg] of this._messages) {
            const ttl    = TYPE_TTL[msg.type] ?? msg.ttl_ticks ?? this._ttlTicks;
            const cutoff = this._currentTick - ttl;
            if (msg.tick < cutoff) {
                this._messages.delete(id);
            }
        }
    }

}

// Expose class and instantiate the singleton immediately.
// Both window.updateMessages and V2VOverlayRenderer.initialize()
// resolve the same object via window.v2vMessageStore.
window.V2VMessageStore = V2VMessageStore;
window.v2vMessageStore = new V2VMessageStore(MSG_TTL_DEFAULT);

console.info('[V2VMessageStore] singleton ready — Phase 9 TYPE_TTL active');

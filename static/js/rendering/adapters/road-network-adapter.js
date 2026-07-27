/**
 * @fileoverview road-network-adapter.js
 * Phase 1A — RenderNetwork Data Pipeline
 *
 * Converts the raw /api/road-network JSON response from the FastAPI backend
 * into an immutable, renderer-agnostic RenderNetwork object.
 *
 * IMPORTANT RULES (enforced here):
 *   - Coordinate system: local simulation metres [x, z]. NO lat/lon. NO Mercator.
 *   - Backend is single source of truth. This adapter only transforms; it never
 *     invents data that contradicts the backend.
 *   - This file is DATA ONLY. No rendering, no canvas, no animation, no DOM.
 *   - All returned objects are frozen (Object.freeze) to prevent accidental mutation.
 *
 * @version 1A
 */

'use strict';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------

/**
 * Default lane width in metres when the backend does not provide one.
 * Matches the Keskustori map definition (3.5 m per lane).
 * @const {number}
 */
const DEFAULT_LANE_WIDTH_M = 3.5;

/**
 * Default sidewalk width in metres.
 * @const {number}
 */
const DEFAULT_SIDEWALK_WIDTH_M = 2.0;

/**
 * Padding added to computed bounds in metres so the renderer
 * has breathing room at map edges.
 * @const {number}
 */
const BOUNDS_PADDING_M = 50;

/**
 * Fallback bounds matching the known Keskustori map extents.
 * Used only when no geometry points can be found.
 * @const {{ min_x: number, max_x: number, min_z: number, max_z: number }}
 */
const FALLBACK_BOUNDS = Object.freeze({ min_x: -100, max_x: 800, min_z: -300, max_z: 800 });

/**
 * Maps crosswalk direction strings to radians for the renderer.
 * NS roads run along the Z axis (0 rad), EW roads run along the X axis (π/2 rad).
 * @const {Object.<string, number>}
 */
const CROSSWALK_DIRECTION_ANGLES = Object.freeze({
    NS: 0,
    EW: Math.PI / 2
});

/**
 * Signal state normalisation map.
 * The backend emits uppercase strings; the renderer uses lowercase.
 * YELLOW in the backend becomes 'amber' in the renderer (industry standard).
 * @const {Object.<string, string>}
 */
const SIGNAL_STATE_MAP = Object.freeze({
    GREEN:  'green',
    YELLOW: 'amber',
    AMBER:  'amber',
    RED:    'red'
});

/**
 * Road type inference rules evaluated in order.
 * First matching rule wins.
 *
 * Rules are derived from the Keskustori map and general urban road standards:
 *   primary    — 50 km/h arterial with 3+ lanes
 *   secondary  — 50 km/h collector with 2 lanes
 *   tertiary   — 40 km/h distributor with 2 lanes
 *   residential — 30 km/h local road
 *   living_street — 20 km/h shared space
 *   service    — fallback for unclassified/low-speed roads
 *
 * @const {Array<{ speedMin: number, speedMax: number, lanesMin: number, type: string }>}
 */
const ROAD_TYPE_RULES = Object.freeze([
    { speedMin: 50, speedMax: Infinity, lanesMin: 3, type: 'primary'       },
    { speedMin: 50, speedMax: Infinity, lanesMin: 2, type: 'secondary'     },
    { speedMin: 40, speedMax: 49,       lanesMin: 2, type: 'tertiary'      },
    { speedMin: 30, speedMax: 39,       lanesMin: 1, type: 'residential'   },
    { speedMin: 20, speedMax: 29,       lanesMin: 1, type: 'living_street' }
]);

// ---------------------------------------------------------------------------
// COORDINATE HELPERS
// ---------------------------------------------------------------------------

/**
 * Validates and converts a raw [x, z] array to a {x, z} point object.
 * Returns null and emits a warning for any invalid input.
 *
 * @param {*} raw - Expected to be [number, number]
 * @param {string} context - Human-readable label for warning messages
 * @returns {{ x: number, z: number } | null}
 */
function _toPoint(raw, context) {
    if (!Array.isArray(raw) || raw.length < 2) {
        console.warn(`[RoadNetworkAdapter] Invalid point in ${context}:`, raw);
        return null;
    }
    const x = Number(raw[0]);
    const z = Number(raw[1]);
    if (!isFinite(x) || !isFinite(z)) {
        console.warn(`[RoadNetworkAdapter] Non-finite coordinates in ${context}:`, raw);
        return null;
    }
    return Object.freeze({ x, z });
}

/**
 * Converts an array of raw [x, z] pairs to an array of {x, z} point objects.
 * Silently filters out any invalid entries after warning about them.
 *
 * @param {Array<*>} rawArray - Array of [number, number] pairs
 * @param {string} context - Human-readable label for warning messages
 * @returns {Array<{ x: number, z: number }>}
 */
function _toPoints(rawArray, context) {
    if (!Array.isArray(rawArray)) {
        console.warn(`[RoadNetworkAdapter] Expected array of points in ${context}, got:`, typeof rawArray);
        return [];
    }
    return rawArray
        .map((pt, idx) => _toPoint(pt, `${context}[${idx}]`))
        .filter(pt => pt !== null);
}

// ---------------------------------------------------------------------------
// BOUNDS HELPERS
// ---------------------------------------------------------------------------

/**
 * Derives map bounds from an array of {x, z} points.
 * Adds BOUNDS_PADDING_M on all sides.
 * Falls back to FALLBACK_BOUNDS if the points array is empty.
 *
 * @param {Array<{ x: number, z: number }>} points
 * @returns {{ min_x: number, max_x: number, min_z: number, max_z: number }}
 */
function _computeBounds(points) {
    if (points.length === 0) {
        console.warn('[RoadNetworkAdapter] No geometry points found; using fallback bounds.');
        return FALLBACK_BOUNDS;
    }
    const xs = points.map(p => p.x);
    const zs = points.map(p => p.z);
    return Object.freeze({
        min_x: Math.min(...xs) - BOUNDS_PADDING_M,
        max_x: Math.max(...xs) + BOUNDS_PADDING_M,
        min_z: Math.min(...zs) - BOUNDS_PADDING_M,
        max_z: Math.max(...zs) + BOUNDS_PADDING_M
    });
}

/**
 * Validates a bounds object.
 * Warns if any bound produces a zero or negative extent.
 *
 * @param {{ min_x: number, max_x: number, min_z: number, max_z: number }} bounds
 * @param {string} source - Where bounds came from ('backend' | 'computed' | 'fallback')
 * @returns {boolean} True if bounds look valid.
 */
function _validateBounds(bounds, source) {
    const widthX  = bounds.max_x - bounds.min_x;
    const depthZ  = bounds.max_z - bounds.min_z;
    if (widthX <= 0 || depthZ <= 0) {
        console.warn(`[RoadNetworkAdapter] Bounds from ${source} have zero or negative extent:`, bounds);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// ROAD TYPE INFERENCE
// ---------------------------------------------------------------------------

/**
 * Infers a simulation-native highway type string from speed limit and lane count.
 * Evaluates ROAD_TYPE_RULES in order; returns 'service' if no rule matches.
 *
 * @param {number} speedLimit - Speed limit in km/h (0 = unknown)
 * @param {number} laneCount  - Total number of lanes
 * @returns {string} Highway type string
 */
function _inferRoadType(speedLimit, laneCount) {
    if (speedLimit <= 0) return 'service';
    for (const rule of ROAD_TYPE_RULES) {
        if (speedLimit >= rule.speedMin &&
            speedLimit <= rule.speedMax &&
            laneCount  >= rule.lanesMin) {
            return rule.type;
        }
    }
    return 'service';
}

// ---------------------------------------------------------------------------
// SIGNAL STATE NORMALISATION
// ---------------------------------------------------------------------------

/**
 * Normalises a backend signal state string to a renderer-friendly lowercase value.
 * Unknown states default to 'red' (safe/conservative fallback).
 *
 * @param {string} rawState - Backend state e.g. 'GREEN', 'YELLOW', 'RED'
 * @returns {string} Normalised state: 'green' | 'amber' | 'red'
 */
function _normaliseSignalState(rawState) {
    const normalised = SIGNAL_STATE_MAP[String(rawState).toUpperCase()];
    if (!normalised) {
        console.warn(`[RoadNetworkAdapter] Unknown signal state "${rawState}", defaulting to "red".`);
        return 'red';
    }
    return normalised;
}

// ---------------------------------------------------------------------------
// DUPLICATE ID TRACKING
// ---------------------------------------------------------------------------

/**
 * Checks a Set of seen IDs for duplicates and warns.
 * Mutates the seenIds set by adding the id.
 *
 * @param {string} id
 * @param {Set<string>} seenIds
 * @param {string} context
 */
function _checkDuplicateId(id, seenIds, context) {
    if (seenIds.has(id)) {
        console.warn(`[RoadNetworkAdapter] Duplicate ${context} id "${id}" — second occurrence ignored in index.`);
    }
    seenIds.add(id);
}

// ---------------------------------------------------------------------------
// LANE ADAPTATION
// ---------------------------------------------------------------------------

/**
 * Adapts a raw lane object from the backend into a typed RenderLane.
 * Falls back gracefully for every field.
 *
 * @param {Object} rawLane        - Lane object from backend
 * @param {Object} parentRoad     - Parent road object (used for speed_limit fallback)
 * @param {Array<{x,z}>} roadGeometry - Parent road geometry points (used for centreline fallback)
 * @returns {Readonly<RenderLane>}
 */
function _adaptLane(rawLane, parentRoad, roadGeometry) {
    if (!rawLane || typeof rawLane !== 'object') {
        console.warn('[RoadNetworkAdapter] Invalid lane object:', rawLane);
        return null;
    }

    const id        = String(rawLane.id        || '');
    const roadId    = String(rawLane.road_id   || parentRoad.id || '');
    const direction = String(rawLane.direction || 'forward');
    const widthM    = Number(rawLane.width)    || DEFAULT_LANE_WIDTH_M;

    // Speed limit: prefer lane-level, fall back to parent road, then 0
    const speedLimit = Number(rawLane.speed_limit)  ||
                       Number(parentRoad.speed_limit) ||
                       0;

    if (!id) {
        console.warn('[RoadNetworkAdapter] Lane missing id on road', roadId);
    }

    // Centreline: use lane-level if present, otherwise fall back to parent road geometry
    let centreline = [];
    if (Array.isArray(rawLane.centerline) && rawLane.centerline.length >= 2) {
        centreline = _toPoints(rawLane.centerline, `lane(${id}).centerline`);
    }
    if (centreline.length < 2) {
        // Use parent road geometry as the best available approximation
        centreline = roadGeometry;
    }

    return Object.freeze({
        id,
        roadId,
        direction,
        widthM,
        speedLimit,
        centreline  // Array<{ x: number, z: number }>
    });
}

// ---------------------------------------------------------------------------
// ROAD ADAPTATION
// ---------------------------------------------------------------------------

/**
 * Adapts a raw road object from the backend into a typed RenderWay.
 *
 * Computes:
 *   - laneCount    — number of lanes
 *   - totalWidthM  — sum of lane widths
 *   - isOneway     — true when all lanes share the same direction
 *   - speedLimit   — from road-level field, or max of lane speed limits
 *   - highway      — inferred type from speedLimit + laneCount
 *   - tags         — renderer-consumable tag object
 *
 * @param {Object} rawRoad - Road object from backend
 * @param {Set<string>} seenIds - Duplicate ID tracker
 * @returns {Readonly<RenderWay> | null}
 */
function _adaptRoad(rawRoad, seenIds) {
    if (!rawRoad || typeof rawRoad !== 'object') {
        console.warn('[RoadNetworkAdapter] Skipping invalid road object:', rawRoad);
        return null;
    }

    const id   = String(rawRoad.id   || '');
    const name = String(rawRoad.name || '');

    if (!id) {
        console.warn('[RoadNetworkAdapter] Road missing id, skipping.');
        return null;
    }

    _checkDuplicateId(id, seenIds, 'road');

    // Geometry
    const geometry = _toPoints(rawRoad.geometry || [], `road(${id}).geometry`);
    if (geometry.length < 2) {
        console.warn(`[RoadNetworkAdapter] Road "${id}" has fewer than 2 geometry points — it will render as a point/stub.`);
    }

    // Lanes
    const rawLanes = Array.isArray(rawRoad.lanes) ? rawRoad.lanes : [];
    if (rawLanes.length === 0) {
        console.warn(`[RoadNetworkAdapter] Road "${id}" has no lanes.`);
    }

    const lanes = rawLanes
        .map(rawLane => _adaptLane(rawLane, rawRoad, geometry))
        .filter(l => l !== null);

    const laneCount   = lanes.length;
    const totalWidthM = lanes.reduce((sum, l) => sum + l.widthM, 0) || DEFAULT_LANE_WIDTH_M * 2;

    // One-way: all lanes travel in the same direction
    const directions = [...new Set(lanes.map(l => l.direction))];
    const isOneway   = directions.length === 1;

    // Speed limit: prefer road-level, otherwise take the highest lane speed limit
    const roadSpeedLimit = Number(rawRoad.speed_limit) || 0;
    const laneMaxSpeed   = lanes.reduce((max, l) => Math.max(max, l.speedLimit), 0);
    const speedLimit     = roadSpeedLimit || laneMaxSpeed;

    // Highway type inference
    const highway = _inferRoadType(speedLimit, laneCount);

    // Renderer tags — matches OSM-like tag contract for downstream layers
    const tags = Object.freeze({
        highway,
        lanes:  laneCount,
        oneway: isOneway ? 'yes' : 'no',
        name,
        maxspeed: speedLimit > 0 ? String(speedLimit) : undefined
    });

    return Object.freeze({
        id,
        name,
        geometry,     // Array<{ x: number, z: number }>
        lanes,        // Array<RenderLane>
        laneCount,
        totalWidthM,
        isOneway,
        speedLimit,
        highway,
        tags
    });
}

// ---------------------------------------------------------------------------
// INTERSECTION ADAPTATION
// ---------------------------------------------------------------------------

/**
 * Adapts a raw intersection object from the backend into a typed RenderIntersection.
 *
 * @param {Object} rawIx  - Intersection object from backend
 * @param {Set<string>} seenIds
 * @returns {Readonly<RenderIntersection> | null}
 */
function _adaptIntersection(rawIx, seenIds) {
    if (!rawIx || typeof rawIx !== 'object') {
        console.warn('[RoadNetworkAdapter] Skipping invalid intersection object:', rawIx);
        return null;
    }

    const id = String(rawIx.id || '');
    if (!id) {
        console.warn('[RoadNetworkAdapter] Intersection missing id, skipping.');
        return null;
    }

    _checkDuplicateId(id, seenIds, 'intersection');

    // Position: prefer pos array, fall back to direct x/z fields
    let pos;
    if (Array.isArray(rawIx.pos) && rawIx.pos.length >= 2) {
        pos = _toPoint(rawIx.pos, `intersection(${id}).pos`);
    } else if (rawIx.x !== undefined && rawIx.z !== undefined) {
        pos = _toPoint([rawIx.x, rawIx.z], `intersection(${id}).x,z`);
    }

    if (!pos) {
        console.warn(`[RoadNetworkAdapter] Intersection "${id}" has no valid position.`);
        pos = Object.freeze({ x: 0, z: 0 });
    }

    return Object.freeze({
        id,
        pos,
        signalId:      rawIx.signal_id      || null,
        incomingLanes: Array.isArray(rawIx.incoming_lanes) ? Object.freeze([...rawIx.incoming_lanes]) : Object.freeze([]),
        outgoingLanes: Array.isArray(rawIx.outgoing_lanes) ? Object.freeze([...rawIx.outgoing_lanes]) : Object.freeze([])
    });
}

// ---------------------------------------------------------------------------
// SIGNAL ADAPTATION
// ---------------------------------------------------------------------------

/**
 * Adapts a raw traffic signal from the backend into a typed RenderSignal.
 *
 * Phase timers and animations are intentionally NOT implemented here.
 * The renderer reads live state from the backend at polling time (Phase 6).
 * A _clientState placeholder is provided for interim client-side display.
 *
 * @param {Object} rawSignal - Signal object from backend
 * @param {Set<string>} seenIds
 * @returns {Readonly<RenderSignal> | null}
 */
function _adaptSignal(rawSignal, seenIds) {
    if (!rawSignal || typeof rawSignal !== 'object') {
        console.warn('[RoadNetworkAdapter] Skipping invalid signal object:', rawSignal);
        return null;
    }

    const id = String(rawSignal.id || '');
    if (!id) {
        console.warn('[RoadNetworkAdapter] Signal missing id, skipping.');
        return null;
    }

    _checkDuplicateId(id, seenIds, 'signal');

    let pos;
    if (Array.isArray(rawSignal.pos) && rawSignal.pos.length >= 2) {
        pos = _toPoint(rawSignal.pos, `signal(${id}).pos`);
    }
    if (!pos) {
        console.warn(`[RoadNetworkAdapter] Signal "${id}" has no valid position.`);
        pos = Object.freeze({ x: 0, z: 0 });
    }

    // Normalise state: GREEN → 'green', YELLOW → 'amber', RED → 'red'
    const state = _normaliseSignalState(rawSignal.state || 'RED');

    return Object.freeze({
        id,
        pos,
        // _clientState: mutable placeholder updated by polling loop (Phase 6)
        // Stored outside the frozen object so Phase 6 can replace it without
        // reconstructing the entire signal structure.
        _clientState: state,
        state         // initial state from backend
    });
}

// ---------------------------------------------------------------------------
// SIDEWALK ADAPTATION
// ---------------------------------------------------------------------------

/**
 * Adapts a raw sidewalk from the backend into a typed RenderSidewalk.
 *
 * @param {Object} rawSw - Sidewalk object from backend
 * @param {Set<string>} seenIds
 * @returns {Readonly<RenderSidewalk> | null}
 */
function _adaptSidewalk(rawSw, seenIds) {
    if (!rawSw || typeof rawSw !== 'object') {
        console.warn('[RoadNetworkAdapter] Skipping invalid sidewalk object:', rawSw);
        return null;
    }

    const id = String(rawSw.id || '');
    if (!id) {
        console.warn('[RoadNetworkAdapter] Sidewalk missing id, skipping.');
        return null;
    }

    _checkDuplicateId(id, seenIds, 'sidewalk');

    const geometry = _toPoints(rawSw.geometry || [], `sidewalk(${id}).geometry`);
    if (geometry.length < 2) {
        console.warn(`[RoadNetworkAdapter] Sidewalk "${id}" has fewer than 2 geometry points.`);
    }

    const widthM = Number(rawSw.width) || DEFAULT_SIDEWALK_WIDTH_M;

    return Object.freeze({ id, geometry, widthM });
}

// ---------------------------------------------------------------------------
// CROSSWALK ADAPTATION
// ---------------------------------------------------------------------------

/**
 * Adapts a raw crosswalk from the backend into a typed RenderCrosswalk.
 * Converts direction string (NS/EW) to a rotation angle in radians.
 *
 * @param {Object} rawCw - Crosswalk object from backend
 * @param {Set<string>} seenIds
 * @returns {Readonly<RenderCrosswalk> | null}
 */
function _adaptCrosswalk(rawCw, seenIds) {
    if (!rawCw || typeof rawCw !== 'object') {
        console.warn('[RoadNetworkAdapter] Skipping invalid crosswalk object:', rawCw);
        return null;
    }

    const id = String(rawCw.id || '');
    if (!id) {
        console.warn('[RoadNetworkAdapter] Crosswalk missing id, skipping.');
        return null;
    }

    _checkDuplicateId(id, seenIds, 'crosswalk');

    let pos;
    if (Array.isArray(rawCw.pos) && rawCw.pos.length >= 2) {
        pos = _toPoint(rawCw.pos, `crosswalk(${id}).pos`);
    }
    if (!pos) {
        console.warn(`[RoadNetworkAdapter] Crosswalk "${id}" has no valid position.`);
        pos = Object.freeze({ x: 0, z: 0 });
    }

    const direction  = String(rawCw.direction || 'NS').toUpperCase();
    const rotationRad = CROSSWALK_DIRECTION_ANGLES[direction] !== undefined
        ? CROSSWALK_DIRECTION_ANGLES[direction]
        : 0;

    if (CROSSWALK_DIRECTION_ANGLES[direction] === undefined) {
        console.warn(`[RoadNetworkAdapter] Crosswalk "${id}" has unknown direction "${direction}", defaulting to 0 rad.`);
    }

    return Object.freeze({
        id,
        pos,
        signalId:    rawCw.signal_id || null,
        direction,
        rotationRad  // 0 = NS (along Z axis), π/2 = EW (along X axis)
    });
}

// ---------------------------------------------------------------------------
// SPAWN POINT ADAPTATION
// ---------------------------------------------------------------------------

/**
 * Adapts a raw spawn point from the backend into a typed RenderSpawnPoint.
 *
 * @param {Object} rawSp - Spawn point object from backend
 * @param {Set<string>} seenIds
 * @returns {Readonly<RenderSpawnPoint> | null}
 */
function _adaptSpawnPoint(rawSp, seenIds) {
    if (!rawSp || typeof rawSp !== 'object') {
        console.warn('[RoadNetworkAdapter] Skipping invalid spawn point object:', rawSp);
        return null;
    }

    const id     = String(rawSp.id      || '');
    const laneId = String(rawSp.lane_id || '');
    const type   = String(rawSp.type    || 'vehicle');
    const offset = Number(rawSp.offset) || 0;

    if (!id) {
        console.warn('[RoadNetworkAdapter] Spawn point missing id, skipping.');
        return null;
    }
    if (!laneId) {
        console.warn(`[RoadNetworkAdapter] Spawn point "${id}" missing lane_id.`);
    }

    _checkDuplicateId(id, seenIds, 'spawnPoint');

    return Object.freeze({ id, laneId, type, offset });
}

// ---------------------------------------------------------------------------
// METADATA ADAPTATION
// ---------------------------------------------------------------------------

/**
 * Adapts raw metadata from the backend.
 * Overrides the CRS field — the map uses local Cartesian metres, NOT EPSG:4326.
 *
 * @param {Object} rawMeta
 * @returns {Readonly<Object>}
 */
function _adaptMetadata(rawMeta) {
    const meta = Object.assign({}, rawMeta || {});

    // Override any incorrect CRS claim — coordinates are simulation-space metres.
    meta.crs = 'local_sim_metres';

    return Object.freeze(meta);
}

// ---------------------------------------------------------------------------
// BOUNDS RESOLUTION
// ---------------------------------------------------------------------------

/**
 * Resolves the final bounds for the RenderNetwork.
 * Priority: backend-provided bounds → computed from geometry → fallback constants.
 *
 * @param {Object|null} rawBounds  - Bounds object from backend (may be null)
 * @param {Array<{x,z}>} allPoints - All geometry points collected from roads
 * @returns {{ min_x: number, max_x: number, min_z: number, max_z: number }}
 */
function _resolveBounds(rawBounds, allPoints) {
    // 1. Trust backend if it provides valid bounds
    if (rawBounds &&
        typeof rawBounds === 'object' &&
        rawBounds.min_x !== undefined &&
        rawBounds.max_x !== undefined &&
        rawBounds.min_z !== undefined &&
        rawBounds.max_z !== undefined) {

        const b = Object.freeze({
            min_x: Number(rawBounds.min_x),
            max_x: Number(rawBounds.max_x),
            min_z: Number(rawBounds.min_z),
            max_z: Number(rawBounds.max_z)
        });

        if (_validateBounds(b, 'backend')) return b;
        console.warn('[RoadNetworkAdapter] Backend bounds invalid, computing from geometry.');
    }

    // 2. Compute from collected geometry points
    if (allPoints.length > 0) {
        const computed = _computeBounds(allPoints);
        if (_validateBounds(computed, 'computed')) return computed;
    }

    // 3. Absolute fallback
    console.warn('[RoadNetworkAdapter] Using FALLBACK_BOUNDS — no valid geometry or backend bounds found.');
    return FALLBACK_BOUNDS;
}

// ---------------------------------------------------------------------------
// MAIN ENTRY POINT
// ---------------------------------------------------------------------------

/**
 * Converts the raw /api/road-network JSON into an immutable RenderNetwork object.
 *
 * This is the single public function of this module. All downstream renderers
 * consume the RenderNetwork; none of them access the raw backend JSON directly.
 *
 * @param {Object} apiJson - Raw JSON response from GET /api/road-network
 * @returns {Readonly<RenderNetwork>}
 *
 * @example
 * const raw = await fetch('/api/road-network').then(r => r.json());
 * const network = roadNetworkAdapter(raw);
 * console.log(network.ways, network.signals, network.bounds);
 */
function roadNetworkAdapter(apiJson) {
    if (!apiJson || typeof apiJson !== 'object') {
        console.warn('[RoadNetworkAdapter] Received invalid input — returning empty RenderNetwork.');
        return _emptyNetwork();
    }

    if (apiJson.status === 'error') {
        console.warn('[RoadNetworkAdapter] Backend returned error status:', apiJson.message);
        return _emptyNetwork();
    }

    // ------------------------------------------------------------------
    // Duplicate ID trackers — one Set per entity type
    // ------------------------------------------------------------------
    const seenRoadIds        = new Set();
    const seenIntersectionIds = new Set();
    const seenSignalIds      = new Set();
    const seenSidewalkIds    = new Set();
    const seenCrosswalkIds   = new Set();
    const seenSpawnIds       = new Set();

    // ------------------------------------------------------------------
    // WAYS (roads)
    // ------------------------------------------------------------------
    const rawRoads = Array.isArray(apiJson.roads) ? apiJson.roads : [];
    if (rawRoads.length === 0) {
        console.warn('[RoadNetworkAdapter] No roads in backend response.');
    }

    const ways = rawRoads
        .map(r => _adaptRoad(r, seenRoadIds))
        .filter(w => w !== null);

    // Collect all geometry points for bounds computation
    const allGeometryPoints = ways.flatMap(w => w.geometry);

    // ------------------------------------------------------------------
    // NODES (intersections)
    // ------------------------------------------------------------------
    const rawIntersections = Array.isArray(apiJson.intersections) ? apiJson.intersections : [];
    const intersections = rawIntersections
        .map(ix => _adaptIntersection(ix, seenIntersectionIds))
        .filter(ix => ix !== null);

    // ------------------------------------------------------------------
    // SIGNALS
    // ------------------------------------------------------------------
    const rawSignals = Array.isArray(apiJson.traffic_signals) ? apiJson.traffic_signals : [];
    const signals = rawSignals
        .map(s => _adaptSignal(s, seenSignalIds))
        .filter(s => s !== null);

    // ------------------------------------------------------------------
    // SIDEWALKS
    // ------------------------------------------------------------------
    const rawSidewalks = Array.isArray(apiJson.sidewalks) ? apiJson.sidewalks : [];
    const sidewalks = rawSidewalks
        .map(sw => _adaptSidewalk(sw, seenSidewalkIds))
        .filter(sw => sw !== null);

    // ------------------------------------------------------------------
    // CROSSWALKS
    // ------------------------------------------------------------------
    const rawCrosswalks = Array.isArray(apiJson.crosswalks) ? apiJson.crosswalks : [];
    const crosswalks = rawCrosswalks
        .map(cw => _adaptCrosswalk(cw, seenCrosswalkIds))
        .filter(cw => cw !== null);

    // ------------------------------------------------------------------
    // SPAWN POINTS
    // ------------------------------------------------------------------
    const rawSpawnPoints = Array.isArray(apiJson.spawn_points) ? apiJson.spawn_points : [];
    const spawnPoints = rawSpawnPoints
        .map(sp => _adaptSpawnPoint(sp, seenSpawnIds))
        .filter(sp => sp !== null);

    // ------------------------------------------------------------------
    // BOUNDS
    // ------------------------------------------------------------------
    const bounds = _resolveBounds(apiJson.bounds || null, allGeometryPoints);

    // ------------------------------------------------------------------
    // METADATA
    // ------------------------------------------------------------------
    const metadata = _adaptMetadata(apiJson.metadata);

    // ------------------------------------------------------------------
    // INDEX MAPS — O(1) lookup by id for downstream consumers
    // ------------------------------------------------------------------
    const wayById          = Object.freeze(Object.fromEntries(ways.map(w  => [w.id,  w])));
    const intersectionById = Object.freeze(Object.fromEntries(intersections.map(ix => [ix.id, ix])));
    const signalById       = Object.freeze(Object.fromEntries(signals.map(s  => [s.id,  s])));

    // ------------------------------------------------------------------
    // SUMMARY LOG
    // ------------------------------------------------------------------
    console.info(
        `[RoadNetworkAdapter] ✅ RenderNetwork built — ` +
        `ways:${ways.length} | intersections:${intersections.length} | ` +
        `signals:${signals.length} | sidewalks:${sidewalks.length} | ` +
        `crosswalks:${crosswalks.length} | spawnPoints:${spawnPoints.length} | ` +
        `bounds: x[${bounds.min_x}→${bounds.max_x}] z[${bounds.min_z}→${bounds.max_z}]`
    );

    // ------------------------------------------------------------------
    // RETURN IMMUTABLE RenderNetwork
    // ------------------------------------------------------------------
    return Object.freeze({
        metadata,
        bounds,

        // nodes = intersections (named 'nodes' to match the renderer contract)
        nodes: Object.freeze([...intersections]),
        ways:  Object.freeze([...ways]),
        roads: Object.freeze([...ways]),

        intersections: Object.freeze([...intersections]),
        signals:       Object.freeze([...signals]),
        sidewalks:     Object.freeze([...sidewalks]),
        crosswalks:    Object.freeze([...crosswalks]),
        spawnPoints:   Object.freeze([...spawnPoints]),

        // O(1) index maps for fast downstream lookup
        wayById,
        intersectionById,
        signalById
    });
}

// ---------------------------------------------------------------------------
// EMPTY NETWORK FALLBACK
// ---------------------------------------------------------------------------

/**
 * Returns a safe, empty RenderNetwork for error conditions.
 * Prevents downstream null-reference errors.
 *
 * @returns {Readonly<RenderNetwork>}
 */
function _emptyNetwork() {
    return Object.freeze({
        metadata:       Object.freeze({ crs: 'local_sim_metres' }),
        bounds:         FALLBACK_BOUNDS,
        nodes:          Object.freeze([]),
        ways:           Object.freeze([]),
        roads:          Object.freeze([]),
        intersections:  Object.freeze([]),
        signals:        Object.freeze([]),
        sidewalks:      Object.freeze([]),
        crosswalks:     Object.freeze([]),
        spawnPoints:    Object.freeze([]),
        wayById:        Object.freeze({}),
        intersectionById: Object.freeze({}),
        signalById:     Object.freeze({})
    });
}

// ---------------------------------------------------------------------------
// MODULE EXPORT — supports both browser globals and ES module environments
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined') {
    window.roadNetworkAdapter = roadNetworkAdapter;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { roadNetworkAdapter };
}

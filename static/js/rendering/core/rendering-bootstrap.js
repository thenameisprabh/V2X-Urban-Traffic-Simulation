/**
 * @file rendering-bootstrap.js
 * @description Wires the complete 2D rendering infrastructure into the page.
 *
 * Execution order:
 *   1. Wait for DOMContentLoaded
 *   2. Wait for KeskustoriApp to finish its own initialisation (Three.js sim)
 *   3. Fetch /api/road-network → roadNetworkAdapter → RenderNetwork
 *   4. Load OSMSupplementProvider (empty datasets in Phase 1B — correct)
 *   5. Construct SimProjector, MapLayerManager, ViewModeController, MapInteraction
 *   6. Register all layer renderers (Phase 0 scaffolds — all no-op safely)
 *   7. Initialize MapLayerManager → starts render loop
 *   8. Enable MapInteraction
 *   9. Expose window.mapRenderer for console inspection and testing
 *
 * Isolation contract:
 *   - Does NOT modify main-app.js or KeskustoriApp in any way
 *   - Does NOT share state with Three.js renderer
 *   - The only shared resources are the DOM canvas elements
 *   - If bootstrap fails at any step, it logs clearly and stops gracefully
 *     without affecting the running simulation
 *
 * @module rendering/core/rendering-bootstrap
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long to wait for KeskustoriApp to appear on window (ms). */
const APP_WAIT_TIMEOUT_MS = 10_000;

/** Polling interval while waiting for KeskustoriApp (ms). */
const APP_WAIT_POLL_MS = 100;

/** Road network API endpoint — same one KeskustoriApp uses. */
const ROAD_NETWORK_ENDPOINT = '/api/road-network';

/** Supplement data paths (empty JSON files are fine — 404 is handled). */
const SUPPLEMENT_PATHS = {
    buildings  : '/static/data/static/buildings.json',
    vegetation : '/static/data/static/vegetation.json',
    water      : '/static/data/static/water.json',
};

// ---------------------------------------------------------------------------
// Bootstrap entry point
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    // Small delay so KeskustoriApp DOMContentLoaded handler runs first
    setTimeout(() => _boot().catch(_fatalError), 50);
});

// ---------------------------------------------------------------------------
// Main bootstrap sequence
// ---------------------------------------------------------------------------

/**
 * Full async bootstrap sequence.
 * Each step is clearly labelled so failures are easy to diagnose.
 * @returns {Promise<void>}
 */
async function _boot() {
    console.info('[Bootstrap] 2D rendering bootstrap starting...');

    // ── Step 1: Acquire canvas elements ────────────────────────────────────
    const simCanvas = document.getElementById('sim-canvas');
    const mapCanvas = document.getElementById('map-canvas');

    if (!simCanvas) throw new Error('[Bootstrap] #sim-canvas not found in DOM');
    if (!mapCanvas) throw new Error('[Bootstrap] #map-canvas not found in DOM');

    console.info('[Bootstrap] Step 1 ✓ — canvases acquired');

    // ── Step 2: KeskustoriApp (Three.js) is optional — 2D renderer is standalone
    console.info('[Bootstrap] Step 2 ✓ — proceeding without KeskustoriApp');

    // ── Step 3: Fetch road network from backend ─────────────────────────────
    const apiJson = await _fetchRoadNetwork();
    console.info('[Bootstrap] Step 3 ✓ — road network fetched');

    // ── Step 4: Adapt to RenderNetwork ─────────────────────────────────────
    const rawNetwork = window.roadNetworkAdapter(apiJson);

    if (!rawNetwork || typeof rawNetwork !== 'object') {
        throw new Error('[Bootstrap] roadNetworkAdapter returned null/undefined');
    }

    // FIX: The adapter returns `roads` (not `ways`).
    // RoadRenderer reads network.roads — this must be preserved here.
    const network = {
        ...rawNetwork,
        roads         : Array.isArray(rawNetwork.roads) ? [...rawNetwork.roads] : (Array.isArray(rawNetwork.ways) ? [...rawNetwork.ways] : []),
        intersections : Array.isArray(rawNetwork.intersections) ? rawNetwork.intersections : [],
        signals       : Array.isArray(rawNetwork.signals)       ? rawNetwork.signals       : [],
        sidewalks     : Array.isArray(rawNetwork.sidewalks)     ? rawNetwork.sidewalks     : [],
        crosswalks    : Array.isArray(rawNetwork.crosswalks)    ? rawNetwork.crosswalks    : [],
        spawnPoints   : Array.isArray(rawNetwork.spawnPoints)   ? rawNetwork.spawnPoints   : [],
        bounds        : rawNetwork.bounds || { min_x: 0, max_x: 800, min_z: 0, max_z: 800 },
        meta          : rawNetwork.meta   || {},
    };

    console.info('[Bootstrap] Step 4 ✓ — RenderNetwork built:', {
        roads         : network.roads.length,
        intersections : network.intersections.length,
        signals       : network.signals.length,
        sidewalks     : network.sidewalks.length,
        crosswalks    : network.crosswalks.length,
    });

    // ── Step 5: Load OSM supplement (empty datasets — correct for Phase 2) ─
    if (!window.OSMSupplementProvider && window.OSMSupplement) {
        window.OSMSupplementProvider = window.OSMSupplement;
    }
    if (typeof window.OSMSupplementProvider !== 'function') {
        throw new Error('[Bootstrap] OSMSupplementProvider not loaded — check script order');
    }
    const supplement = new window.OSMSupplementProvider(SUPPLEMENT_PATHS);
    await supplement.load();
    console.info('[Bootstrap] Step 5 ✓ — supplement loaded (buildings:',
        supplement.getBuildings().length,
        'vegetation:', supplement.getVegetation().length,
        'water:', supplement.getWater().length, ')');

    // ── Step 6: Construct SimProjector and fit to world bounds ─────────────
    if (typeof window.SimProjector !== 'function') {
        throw new Error('[Bootstrap] SimProjector not loaded — check script order');
    }
    const projector = new window.SimProjector(mapCanvas, network.bounds);
    projector.resize();   // set physical pixel buffer from real CSS dimensions
    projector.fit(); 
    window._simProjector = projector;     // fit world into canvas — origin and scale now valid

    console.info('[Bootstrap] Step 6 ✓ — SimProjector ready, scale:', projector.scale.toFixed(4));

    // ── Step 7: Construct MapLayerManager ──────────────────────────────────
    if (typeof window.MapLayerManager !== 'function') {
        throw new Error('[Bootstrap] MapLayerManager not loaded — check script order');
    }
    const layerManager = new window.MapLayerManager(mapCanvas, projector, network, supplement);

    // ── Step 8: Register layer renderers ───────────────────────────────────
    _registerLayers(layerManager, network, supplement);
    console.info('[Bootstrap] Step 8 ✓ — layers registered');

    // ── Step 9: Construct ViewModeController ───────────────────────────────
    if (typeof window.ViewModeController !== 'function') {
        throw new Error('[Bootstrap] ViewModeController not loaded — check script order');
    }
    const viewController = new window.ViewModeController(
        simCanvas, mapCanvas, layerManager,
        { initialMode: 'MAP_2D' }
    );
    viewController.showMap();
    console.info('[Bootstrap] Step 9 ✓ — ViewModeController ready, mode:', viewController.mode);

    // ── Step 10: Initialize MapLayerManager (starts render loop) ───────────
    await layerManager.initialize();
    console.info('[Bootstrap] Step 10 ✓ — render loop started');

    // ── Step 10a: Wire vehicle update hook ─────────────────────────────────
    // api-client.js calls window.updateVehicles(data.vehicles) at up to 60 Hz.
    // We install that hook here, after initialize(), so the renderer instance
    // is guaranteed to be ready before any poll result can arrive.
    const vehicleLayer = layerManager.getLayer('VehicleOverlayRenderer');
    if (vehicleLayer && typeof vehicleLayer.updateVehicles === 'function') {
        window.updateVehicles = (vehicles) => {
            vehicleLayer.updateVehicles(vehicles);
            layerManager.markDirty();
        };
        console.info('[Bootstrap] Step 10a ✓ — window.updateVehicles wired to VehicleOverlayRenderer');
    } else {
        window.updateVehicles = () => {};
        console.warn('[Bootstrap] Step 10a ⚠ — VehicleOverlayRenderer not found; updateVehicles is a no-op');
    }

    // ── Step 10b: Wire traffic-light update hook ─────────────────────────
    const trafficSignalLayer = layerManager.getLayer('TrafficSignalRenderer');
    if (trafficSignalLayer && typeof trafficSignalLayer.updateSignals === 'function') {
        window.updateTrafficLights = (lights) => {
            trafficSignalLayer.updateSignals(lights);
            layerManager.markDirty();
        };
        console.info('[Bootstrap] Step 10b ✓ — window.updateTrafficLights wired to TrafficSignalRenderer');
    } else {
        window.updateTrafficLights = () => {};
        console.warn('[Bootstrap] Step 10b ⚠ — TrafficSignalRenderer not found; updateTrafficLights is a no-op');
    }

    // ── Step 10c: Wire V2V message update hook ──────────────────────────────
    // Parallel to window.updateVehicles.
    // Called by SimApiClient after processing state.messages.
    // Updates V2VMessageStore (vehicle positions + messages) then marks dirty.
    if (window.v2vMessageStore) {
        window.updateMessages = (messages, vehicles, state) => {
            window.v2vMessageStore.updateVehiclePositions(vehicles);
            window.v2vMessageStore.update(messages, state.tick);   // ← correct
            layerManager.markDirty();
        };
        console.info('[Bootstrap] Step 10c ✓ — window.updateMessages wired to V2VMessageStore');
    } else {
        window.updateMessages = () => {};
        console.warn('[Bootstrap] Step 10c ⚠ — V2VMessageStore not found; updateMessages is a no-op');
    }

    // ── Step 11: Force one dirty frame so roads appear immediately ──────────
    layerManager.markDirty();

    // ── Step 12: Construct MapInteraction ──────────────────────────────────
    if (typeof window.MapInteraction !== 'function') {
        throw new Error('[Bootstrap] MapInteraction not loaded — check script order');
    }
    const interaction = new window.MapInteraction(mapCanvas, projector, layerManager);
    console.info('[Bootstrap] Step 12 ✓ — MapInteraction constructed (not enabled — SIM_3D mode)');

    // ── Step 13: Expose for testing and Phase 2+ wiring ────────────────────
    window.mapRenderer = Object.freeze({
        projector,
        layerManager,
        viewController,
        interaction,
        network,
        supplement,
    });

    console.info(
        '%c[Bootstrap] 2D rendering infrastructure READY ✓',
        'color: #00d4ff; font-weight: bold; font-size: 13px'
    );
    console.info('[Bootstrap] Access via window.mapRenderer');
    console.info('[Bootstrap] To test map view: window.mapRenderer.viewController.showMap()');
    console.info('[Bootstrap] To enable interaction: window.mapRenderer.interaction.enable()');
}

// ---------------------------------------------------------------------------
// Layer registration
// ---------------------------------------------------------------------------

/**
 * Registers all layer renderers in render order (bottom → top).
 * @param {MapLayerManager} mgr
 * @param {object} network
 * @param {object} supplement
 */
function _registerLayers(mgr, network, supplement) {
    const layerDefs = [
        // [name,                  Constructor,                     phase]
        ['TerrainRenderer',        window.TerrainRenderer,          1],
        ['WaterRenderer',          window.WaterRenderer,            4],
        ['VegetationRenderer',     window.VegetationRenderer,       4],
        ['RoadRenderer',           window.RoadRenderer,             2],
        ['SidewalkRenderer',       window.SidewalkRenderer,         2],
        ['CrosswalkRenderer',      window.CrosswalkRenderer,        2],
        ['BuildingRenderer',       window.BuildingRenderer,         3],
        ['TrafficSignalRenderer',  window.TrafficSignalRenderer,    2],
        ['VehicleOverlayRenderer', window.VehicleOverlayRenderer,   5],
        ['V2VOverlayRenderer',     window.V2VOverlayRenderer,       7],
    ];

    for (const [name, Ctor, phase] of layerDefs) {
        if (typeof Ctor !== 'function') {
            console.warn(`[Bootstrap] ${name} not available (Phase ${phase} scaffold) — skipping`);
            continue;
        }
        try {
            const instance = new Ctor(network, supplement);
            mgr.addLayer(instance);
            console.info(`[Bootstrap] registered layer: ${name} (Phase ${phase})`);
        } catch (err) {
            console.warn(`[Bootstrap] ${name} failed to construct (Phase ${phase}) — skipping:`, err.message);
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Waits for window.app (KeskustoriApp) to be defined.
 * @returns {Promise<void>}
 */
function _waitForApp() {
    return new Promise((resolve, reject) => {
        const start = performance.now();
        const poll = () => {
            if (window.app) { resolve(); return; }
            if (performance.now() - start > APP_WAIT_TIMEOUT_MS) {
                reject(new Error('[Bootstrap] Timed out waiting for KeskustoriApp (window.app)'));
                return;
            }
            setTimeout(poll, APP_WAIT_POLL_MS);
        };
        poll();
    });
}

/**
 * Fetches the road network JSON from the backend.
 * @returns {Promise<object>}
 */
async function _fetchRoadNetwork() {
    let response;
    try {
        response = await fetch(ROAD_NETWORK_ENDPOINT);
    } catch (err) {
        throw new Error(`[Bootstrap] Network error fetching ${ROAD_NETWORK_ENDPOINT}: ${err.message}`);
    }
    if (!response.ok) {
        throw new Error(`[Bootstrap] ${ROAD_NETWORK_ENDPOINT} returned HTTP ${response.status}`);
    }
    let json;
    try {
        json = await response.json();
    } catch (err) {
        throw new Error(`[Bootstrap] Failed to parse road network JSON: ${err.message}`);
    }
    return json;
}

/**
 * Handles a fatal bootstrap error without crashing the simulation.
 * @param {Error} err
 */
function _fatalError(err) {
    console.error('%c[Bootstrap] FATAL — 2D rendering failed to initialise',
        'color: #ff4444; font-weight: bold;');
    console.error('[Bootstrap]', err);
    console.info('[Bootstrap] Three.js simulation continues unaffected.');
}

console.info('[Bootstrap] rendering-bootstrap.js loaded');
/**
 * @file rendering-bootstrap.js
 * @description Wires the complete 2D rendering infrastructure into the page.
 *
 * Execution order:
 *   1. Wait for DOMContentLoaded
 *   2. Fetch /api/road-network → roadNetworkAdapter → RenderNetwork
 *   3. Load OSMSupplementProvider (empty datasets in Phase 1B — correct)
 *   4. Construct SimProjector, MapLayerManager, ViewModeController, MapInteraction
 *   5. Register all layer renderers
 *   6. Initialize MapLayerManager → starts render loop
 *   7. Wire window.updateVehicles / window.updateMessages hooks
 *   8. Expose window.mapRenderer for console inspection and testing
 *
 * Isolation contract:
 *   - Does NOT modify main-app.js or KeskustoriApp in any way
 *   - Does NOT share state with Three.js renderer
 *   - The only shared resources are the DOM canvas elements
 *   - If bootstrap fails at any step, it logs clearly and stops gracefully
 *
 * @module rendering/core/rendering-bootstrap
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Road network API endpoint. */
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
    // Small delay to let other DOMContentLoaded handlers (UI wiring, etc.) run first.
    // The 2D pipeline has no dependency on any legacy app initialisation.
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

    console.info('[Bootstrap] Step 1 ✓ — canvases acquired',
        '| sim-canvas:', simCanvas.id,
        '| map-canvas:', mapCanvas.id);

    // ── Step 2: Fetch road network from backend ─────────────────────────────
    // NOTE: The previous Step 2 waited for window.app (KeskustoriApp), but
    // main-app.js is not loaded in index.html, so window.app was never set
    // and the 10-second timeout killed the entire bootstrap before it touched
    // the network or canvas. The 2D pipeline has no runtime dependency on
    // KeskustoriApp; that gate has been removed.
    const apiJson = await _fetchRoadNetwork();
    console.info('[Bootstrap] Step 2 ✓ — road network fetched');

    // ── Step 3: Adapt to RenderNetwork ─────────────────────────────────────
    const rawNetwork = window.roadNetworkAdapter(apiJson);

    if (!rawNetwork || typeof rawNetwork !== 'object') {
        throw new Error('[Bootstrap] roadNetworkAdapter returned null/undefined');
    }

    // The adapter returns `roads` (not `ways`).
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

    console.info('[Bootstrap] Step 3 ✓ — RenderNetwork built:', {
        roads         : network.roads.length,
        intersections : network.intersections.length,
        signals       : network.signals.length,
        sidewalks     : network.sidewalks.length,
        crosswalks    : network.crosswalks.length,
    });

    // ── Step 4: Load OSM supplement ─────────────────────────────────────────
    if (!window.OSMSupplementProvider && window.OSMSupplement) {
        window.OSMSupplementProvider = window.OSMSupplement;
    }
    if (typeof window.OSMSupplementProvider !== 'function') {
        throw new Error('[Bootstrap] OSMSupplementProvider not loaded — check script order');
    }
    const supplement = new window.OSMSupplementProvider(SUPPLEMENT_PATHS);
    await supplement.load();
    console.info('[Bootstrap] Step 4 ✓ — supplement loaded (buildings:',
        supplement.getBuildings().length,
        'vegetation:', supplement.getVegetation().length,
        'water:', supplement.getWater().length, ')');

    // ── Step 5: Construct SimProjector and fit to world bounds ─────────────
    if (typeof window.SimProjector !== 'function') {
        throw new Error('[Bootstrap] SimProjector not loaded — check script order');
    }
    const projector = new window.SimProjector(mapCanvas, network.bounds);
    projector.resize();   // set physical pixel buffer from real CSS dimensions
    projector.fit();      // fit world into canvas — origin and scale now valid

    if (typeof projector.fitIntersections === 'function') {
        projector.fitIntersections(network.intersections);
    }

    window._simProjector = projector;

    console.info('[Bootstrap] Step 5 ✓ — SimProjector ready, scale:', projector.scale.toFixed(4));

    // ── Step 6: Construct MapLayerManager ──────────────────────────────────
    if (typeof window.MapLayerManager !== 'function') {
        throw new Error('[Bootstrap] MapLayerManager not loaded — check script order');
    }
    const layerManager = new window.MapLayerManager(mapCanvas, projector, network, supplement);
    console.info('[Bootstrap] Step 6 ✓ — MapLayerManager constructed');

    // ── Step 7: Register layer renderers ───────────────────────────────────
    _registerLayers(layerManager, network, supplement);
    console.info('[Bootstrap] Step 7 ✓ — layers registered');

    // ── Step 8: Construct ViewModeController ───────────────────────────────
    // IMPORTANT: initialMode is MAP_2D — the 2D pipeline is the active renderer.
    // SIM_3D mode hides #map-canvas (display:none, opacity:0) and pauses the
    // render loop, so nothing would ever appear on screen.
    if (typeof window.ViewModeController !== 'function') {
        throw new Error('[Bootstrap] ViewModeController not loaded — check script order');
    }
    const viewController = new window.ViewModeController(
        simCanvas, mapCanvas, layerManager,
        { initialMode: 'MAP_2D' }
    );
    console.info('[Bootstrap] Step 8 ✓ — ViewModeController ready, mode:', viewController.mode);

    // ── Step 9: Initialize MapLayerManager (starts render loop) ────────────
    await layerManager.initialize();
    console.info('[Bootstrap] Step 9 ✓ — render loop started');

    // ── Step 9a: Wire vehicle update hook ──────────────────────────────────
    // api-client.js calls window.updateVehicles(data.vehicles) at up to 10 Hz.
    // We install that hook here, after initialize(), so the renderer instance
    // is guaranteed to be ready before any poll result can arrive.
    const vehicleLayer = layerManager.getLayer('VehicleOverlayRenderer');
    if (vehicleLayer && typeof vehicleLayer.updateVehicles === 'function') {
        window.updateVehicles = (vehicles) => {
            vehicleLayer.updateVehicles(vehicles);
            layerManager.markDirty();
        };
        console.info('[Bootstrap] Step 9a ✓ — window.updateVehicles wired to VehicleOverlayRenderer');
    } else {
        window.updateVehicles = () => {};
        console.warn('[Bootstrap] Step 9a ⚠ — VehicleOverlayRenderer not found; updateVehicles is a no-op');
    }

    // ── Step 9b: Wire traffic-light update hook ─────────────────────────────
    const signalLayer = layerManager.getLayer('TrafficSignalRenderer');
    if (signalLayer && typeof signalLayer.updateSignals === 'function') {
        window.updateTrafficLights = (lights) => {
            signalLayer.updateSignals(lights);
            layerManager.markDirty();
        };
        console.info('[Bootstrap] Step 9b ✓ — window.updateTrafficLights wired to TrafficSignalRenderer');
    } else {
        window.updateTrafficLights = () => {};
        console.warn('[Bootstrap] Step 9b ⚠ — TrafficSignalRenderer.updateSignals not found; updateTrafficLights is a no-op');
    }

    // ── Step 9c: Wire V2V message update hook ──────────────────────────────
    if (window.v2vMessageStore) {
        window.updateMessages = (messages, vehicles, state) => {
            window.v2vMessageStore.updateVehiclePositions(vehicles);
            window.v2vMessageStore.update(messages, state.tick);
            layerManager.markDirty();
        };
        console.info('[Bootstrap] Step 9c ✓ — window.updateMessages wired to V2VMessageStore');
    } else {
        window.updateMessages = () => {};
        console.warn('[Bootstrap] Step 9c ⚠ — V2VMessageStore not found; updateMessages is a no-op');
    }

    // ── Step 10: Force one dirty frame so roads appear immediately ──────────
    layerManager.markDirty();

    // ── Step 11: Construct MapInteraction ──────────────────────────────────
    if (typeof window.MapInteraction !== 'function') {
        throw new Error('[Bootstrap] MapInteraction not loaded — check script order');
    }
    const interaction = new window.MapInteraction(mapCanvas, projector, layerManager);
    interaction.enable();   // MAP_2D mode — interaction active immediately
    console.info('[Bootstrap] Step 11 ✓ — MapInteraction enabled');

    // ── Step 12: Expose for testing and external UI wiring ─────────────────
    window.mapRenderer = Object.freeze({
        projector,
        layerManager,
        viewController,
        interaction,
        network,
        supplement,
    });

    // Camera control helpers for UI panels and vehicle list
    window.followVehicle = (uid) => {
        if (typeof projector.followVehicle === 'function') {
            projector.followVehicle(uid);
            layerManager.markDirty();
            console.info('[Bootstrap] followVehicle()', uid);
        }
    };
    window.stopFollow = () => {
        if (typeof projector.stopFollow === 'function') {
            projector.stopFollow();
            layerManager.markDirty();
            console.info('[Bootstrap] stopFollow()');
        }
    };

    console.info(
        '%c[Bootstrap] 2D rendering infrastructure READY ✓',
        'color: #00d4ff; font-weight: bold; font-size: 13px'
    );
    console.info('[Bootstrap] Access via window.mapRenderer');
    console.info('[Bootstrap] Camera: window.followVehicle(uid) / window.stopFollow() / Escape key');
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
 * Handles a fatal bootstrap error.
 * @param {Error} err
 */
function _fatalError(err) {
    console.error('%c[Bootstrap] FATAL — 2D rendering failed to initialise',
        'color: #ff4444; font-weight: bold;');
    console.error('[Bootstrap]', err);
}

console.info('[Bootstrap] rendering-bootstrap.js loaded');
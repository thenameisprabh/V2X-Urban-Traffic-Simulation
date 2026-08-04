"""
KESKUSTORI V2X - Traffic Simulation Server
Production-ready FastAPI implementation
UPDATED: Fixed state serialization and road network endpoint
"""

import asyncio
import time
import os
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# Add src to Python path
base_dir = Path(__file__).resolve().parent
src_path = base_dir / 'src'

# Support both direct module imports and package-style imports
sys.path.insert(0, str(base_dir))
if src_path.exists():
    sys.path.insert(0, str(src_path))

# Import simulation modules
try:
    from src.simulation_engine import SimulationEngine
    from src.road_network import RoadNetwork
    from src.prompt_parser import PromptParser
    from src.scenario_manager import ScenarioManager
    from src.metrics import MetricsAggregator
    from src.core.application import ApplicationContext
except ImportError as e:
    print(f"❌ CRITICAL: Import error: {e}")
    print("   Make sure these files exist in src/:")
    print("   - simulation_engine.py")
    print("   - road_network.py")
    print("   - prompt_parser.py")
    print("   - scenario_manager.py")
    print("   - metrics.py")
    sys.exit(1)

# ============================================================
# FASTAPI INITIALIZATION
# ============================================================

app = FastAPI(
    title="KESKUSTORI V2X",
    description="Traffic Simulation Engine",
    version="2.0"
)

# ============================================================
# MIDDLEWARE (CORS)
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# GLOBAL STATE
# ============================================================

road_network: Optional[RoadNetwork] = None
simulation_engine: Optional[SimulationEngine] = None
prompt_parser: Optional[PromptParser] = None
scenario_manager: Optional[ScenarioManager] = None
metrics_aggregator: Optional[MetricsAggregator] = None
app_context: Optional[ApplicationContext] = None

SIMULATION_TICK_RATE = 60
DELTA_TIME = 1.0 / SIMULATION_TICK_RATE

is_running = False
simulation_task = None

# ============================================================
# STARTUP EVENT
# ============================================================

@app.on_event("startup")
async def startup_event():
    """Initialize simulation on server startup"""
    global road_network, simulation_engine, prompt_parser, scenario_manager, metrics_aggregator, app_context
    
    print("\n" + "="*70)
    print("🚀 KESKUSTORI V2X - TRAFFIC SIMULATION ENGINE v2.0")
    print("="*70)
    
    # Load road network
    print("\n📍 [STARTUP] Loading road network...")
    road_network = RoadNetwork()
    
    network_paths = [
        'data/maps/keskustori.json',
        'maps/keskustori.json',
        './keskustori.json',
    ]
    
    loaded = False
    for path in network_paths:
        if os.path.exists(path):
            print(f"   ✅ Found: {path}")
            try:
                road_network.load_from_json(path)
                loaded = True
                print(f"   ✅ Loaded: {len(road_network.roads)} roads")
                break
            except Exception as e:
                print(f"   ⚠️  Error loading {path}: {e}")
    
    if not loaded:
        print(f"   ⚠️  Road network file not found. Using empty network.")
    
    # Initialize core application context
    print("\n🎯 [STARTUP] Initializing application context...")
    app_context = ApplicationContext()
    app_context.boot()

    # Initialize simulation engine
    print("\n🎮 [STARTUP] Initializing simulation engine...")
    simulation_engine = SimulationEngine(road_network)
    
    # Initialize utilities
    print("📊 [STARTUP] Initializing utilities...")
    prompt_parser = PromptParser()
    scenario_manager = ScenarioManager()
    metrics_aggregator = MetricsAggregator()
    
    print("\n✅ [STARTUP] Server initialization complete")
    print("="*70)
    print(f"🌐 API available at http://localhost:8000/api")
    print(f"🎨 Dashboard available at http://localhost:8000")
    print("="*70 + "\n")

    # ── Phase 9: auto-start simulation loop on boot ──────────────────────
    global is_running, simulation_task
    spawned = simulation_engine.spawn_agents({"vehicles": 10})
    print(f"🚗 [STARTUP] Auto-spawned {spawned['total']} vehicles")
    is_running = True
    simulation_task = asyncio.create_task(simulation_loop())
    print("▶️  [STARTUP] Simulation loop started automatically")
    # ─────────────────────────────────────────────────────────────────────

# ============================================================
# HEALTH & INFO ENDPOINTS
# ============================================================

@app.get("/")
async def root():
    """Root endpoint - serves dashboard"""
    static_path = Path(__file__).parent / "static" / "index.html"
    if static_path.exists():
        return FileResponse(
            static_path,
            media_type="text/html",
            headers={"Cache-Control": "no-store"},
        )

    return JSONResponse({
        "status": "ok",
        "message": "KESKUSTORI V2X Traffic Simulation",
        "api": "http://localhost:8000/api"
    })

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return JSONResponse({
        "status": "ok",
        "service": "KESKUSTORI V2X",
        "version": "2.0",
        "timestamp": time.time()
    })

# ============================================================
# ROAD NETWORK ENDPOINT - NEW
# ============================================================

@app.get("/api/road-network")
async def get_road_network():
    """Get road network data for frontend rendering"""
    global road_network

    try:
        if road_network is None:
            return JSONResponse({
                "status": "error",
                "message": "Road network not initialized"
            }, status_code=500)

        # ------------------------------------------------------------------
        # Serialize road network
        # ------------------------------------------------------------------
        network_data = {
            "status": "ok",
            "roads": [],
            "intersections": [],
            "traffic_signals": [],
            "sidewalks": [],
            "crosswalks": [],
            "spawn_points": [],
            "bounds": None,
            "metadata": {}
        }

        # ------------------------------------------------------------------
        # ROADS — preserve all existing fields, add lane width/speed/centerline
        # ------------------------------------------------------------------
        all_geometry_points = []  # collect for bounds computation

        if hasattr(road_network, 'roads'):
            for i, road in enumerate(road_network.roads):
                geometry = getattr(road, 'geometry', [
                    getattr(road, 'start', [0, 0]),
                    getattr(road, 'end', [0, 0])
                ])

                # Collect every point for bounds
                for pt in geometry:
                    if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                        all_geometry_points.append(pt)

                lanes = []
                for lane in getattr(road, 'lanes', []):
                    centerline = getattr(lane, 'centerline', None)
                    # Normalise centerline — accept list of lists or list of tuples
                    if centerline is not None and not isinstance(centerline, list):
                        centerline = None

                    lanes.append({
                        # --- existing fields (unchanged) ---
                        "id":        getattr(lane, 'id', ''),
                        "road_id":   getattr(lane, 'road_id', ''),
                        "direction": getattr(lane, 'direction', ''),
                        # --- new fields ---
                        "width":       getattr(lane, 'width', 3.5),
                        "speed_limit": getattr(lane, 'speed_limit', 0),
                        "centerline":  centerline if centerline is not None else []
                    })

                network_data["roads"].append({
                    # --- existing fields (unchanged) ---
                    "id":       getattr(road, 'id', f"road_{i}"),
                    "name":     getattr(road, 'name', ''),
                    "geometry": geometry,
                    "lanes":    lanes,
                    # --- new fields ---
                    "speed_limit": getattr(road, 'speed_limit', 0),
                    "type":        getattr(road, 'type', '')
                })

        # ------------------------------------------------------------------
        # INTERSECTIONS — preserve existing fields, add lanes + signal link
        # ------------------------------------------------------------------
        if hasattr(road_network, 'intersections'):
            for i, intersection in enumerate(road_network.intersections):
                pos = getattr(intersection, 'position', [0, 0])

                network_data["intersections"].append({
                    # --- existing fields (unchanged) ---
                    "id":  getattr(intersection, 'id', f"intersection_{i}"),
                    "pos": pos,
                    "x":   pos[0] if len(pos) > 0 else 0,
                    "z":   pos[1] if len(pos) > 1 else 0,
                    # --- new fields ---
                    "signal_id":      getattr(intersection, 'signal_id', None),
                    "incoming_lanes": getattr(intersection, 'incoming_lanes', []),
                    "outgoing_lanes": getattr(intersection, 'outgoing_lanes', [])
                })

        # ------------------------------------------------------------------
        # TRAFFIC SIGNALS — unchanged, preserved exactly
        # ------------------------------------------------------------------
        if hasattr(road_network, 'traffic_signals'):
            for i, signal in enumerate(road_network.traffic_signals):
                is_dict = isinstance(signal, dict)
                network_data["traffic_signals"].append({
                    "id":    getattr(signal, 'id',    signal.get('id',    f"signal_{i}"))  if is_dict else getattr(signal, 'id',    f"signal_{i}"),
                    "pos":   getattr(signal, 'pos',   signal.get('pos',   [0, 0]))         if is_dict else getattr(signal, 'pos',   [0, 0]),
                    "state": getattr(signal, 'state', signal.get('state', 'RED'))          if is_dict else getattr(signal, 'state', 'RED')
                })

        # ------------------------------------------------------------------
        # SIDEWALKS
        # ------------------------------------------------------------------
        if hasattr(road_network, 'sidewalks'):
            for i, sw in enumerate(road_network.sidewalks):
                is_dict = isinstance(sw, dict)
                network_data["sidewalks"].append({
                    "id":       (sw.get('id',       f"sidewalk_{i}") if is_dict else getattr(sw, 'id',       f"sidewalk_{i}")),
                    "geometry": (sw.get('geometry', [])              if is_dict else getattr(sw, 'geometry', [])),
                    "width":    (sw.get('width',    2.0)             if is_dict else getattr(sw, 'width',    2.0))
                })

        # ------------------------------------------------------------------
        # CROSSWALKS
        # ------------------------------------------------------------------
        if hasattr(road_network, 'crosswalks'):
            for i, cw in enumerate(road_network.crosswalks):
                is_dict = isinstance(cw, dict)
                network_data["crosswalks"].append({
                    "id":        (cw.get('id',        f"crosswalk_{i}") if is_dict else getattr(cw, 'id',        f"crosswalk_{i}")),
                    "pos":       (cw.get('pos',        [0, 0])          if is_dict else getattr(cw, 'pos',        [0, 0])),
                    "signal_id": (cw.get('signal_id',  None)            if is_dict else getattr(cw, 'signal_id',  None)),
                    "direction": (cw.get('direction',  'NS')            if is_dict else getattr(cw, 'direction',  'NS'))
                })

        # ------------------------------------------------------------------
        # SPAWN POINTS
        # ------------------------------------------------------------------
        if hasattr(road_network, 'spawn_points'):
            for i, sp in enumerate(road_network.spawn_points):
                is_dict = isinstance(sp, dict)
                network_data["spawn_points"].append({
                    "id":      (sp.get('id',      f"spawn_{i}") if is_dict else getattr(sp, 'id',      f"spawn_{i}")),
                    "lane_id": (sp.get('lane_id', '')           if is_dict else getattr(sp, 'lane_id', '')),
                    "type":    (sp.get('type',    'vehicle')    if is_dict else getattr(sp, 'type',    'vehicle')),
                    "offset":  (sp.get('offset',  0)            if is_dict else getattr(sp, 'offset',  0))
                })

        # ------------------------------------------------------------------
        # BOUNDS — compute from geometry if not stored on the road_network
        # ------------------------------------------------------------------
        stored_bounds = getattr(road_network, 'bounds', None)
        if stored_bounds:
            # Trust whatever the backend has stored
            network_data["bounds"] = {
                "min_x": getattr(stored_bounds, 'min_x', stored_bounds.get('min_x', 0) if isinstance(stored_bounds, dict) else 0),
                "max_x": getattr(stored_bounds, 'max_x', stored_bounds.get('max_x', 0) if isinstance(stored_bounds, dict) else 0),
                "min_z": getattr(stored_bounds, 'min_z', stored_bounds.get('min_z', 0) if isinstance(stored_bounds, dict) else 0),
                "max_z": getattr(stored_bounds, 'max_z', stored_bounds.get('max_z', 0) if isinstance(stored_bounds, dict) else 0)
            }
        elif all_geometry_points:
            # Derive bounds from collected road geometry points
            xs = [pt[0] for pt in all_geometry_points]
            zs = [pt[1] for pt in all_geometry_points]
            padding = 50  # metres — gives the renderer breathing room at edges
            network_data["bounds"] = {
                "min_x": min(xs) - padding,
                "max_x": max(xs) + padding,
                "min_z": min(zs) - padding,
                "max_z": max(zs) + padding
            }
        else:
            # Absolute fallback — matches Keskustori map known extents
            network_data["bounds"] = {
                "min_x": -100,
                "max_x":  800,
                "min_z": -300,
                "max_z":  800
            }

        # ------------------------------------------------------------------
        # METADATA
        # ------------------------------------------------------------------
        if hasattr(road_network, 'metadata'):
            network_data["metadata"] = road_network.metadata

        return JSONResponse(network_data)

    except Exception as e:
        print(f"❌ [ERROR] get_road_network: {e}")
        return JSONResponse({
            "status": "error",
            "message": str(e)
        }, status_code=500)


# ============================================================
# STATE ENDPOINTS - IMPROVED SERIALIZATION
# ============================================================

@app.get("/api/state")
async def get_state():
    """Get current simulation state with proper serialization"""
    global simulation_engine, road_network
    
    try:
        if simulation_engine is None:
            return JSONResponse({
                "status": "error",
                "message": "Simulation engine not initialized",
                "tick": 0,
                "vehicles": [],
                "intersections": [],
                "traffic_lights": [],
                "roads": [],
                "lanes": []
            }, status_code=500)
        
        # Get raw state from engine
        raw_state = simulation_engine.get_state()

        # Ensure proper format
        state = {
            "status": "ok",
            "tick": raw_state.get("tick", 0),
            "vehicles": [],
            "intersections": [],
            "traffic_lights": raw_state.get("traffic_lights", []),
            "roads": [],
            "lanes": [],
            "weather": raw_state.get("weather", {}),
            "time_of_day": raw_state.get("time_of_day", 12),
            "messages": raw_state.get("messages", [])
        }

        # Populate traffic lights from the road network when the engine does not
        # provide them explicitly. This is the live-state contract expected by the
        # frontend renderer.
        if road_network is not None and hasattr(road_network, "traffic_signals"):
            traffic_lights = []
            for idx, signal in enumerate(road_network.traffic_signals):
                if isinstance(signal, dict):
                    signal_id = signal.get("id", f"signal_{idx}")
                    signal_pos = signal.get("pos", [0, 0])
                    signal_state = signal.get("state", "RED")
                else:
                    signal_id = getattr(signal, "id", f"signal_{idx}")
                    signal_pos = getattr(signal, "pos", [0, 0])
                    signal_state = getattr(signal, "state", "RED")

                traffic_lights.append({
                    "id": signal_id or f"signal_{idx}",
                    "pos": signal_pos if isinstance(signal_pos, (list, tuple)) else [0, 0],
                    "state": signal_state or "RED",
                })

            if traffic_lights:
                state["traffic_lights"] = traffic_lights

        # Populate map data from road network for legacy UI
        if road_network is not None:
            state["roads"] = [
                {
                    "id": getattr(road, 'id', f'road_{idx}'),
                    "name": getattr(road, 'name', ''),
                    "start": {
                        "x": road.start[0] if isinstance(road.start, (list, tuple)) and len(road.start) >= 2 else 0,
                        "z": road.start[1] if isinstance(road.start, (list, tuple)) and len(road.start) >= 2 else 0
                    },
                    "end": {
                        "x": road.end[0] if isinstance(road.end, (list, tuple)) and len(road.end) >= 2 else 0,
                        "z": road.end[1] if isinstance(road.end, (list, tuple)) and len(road.end) >= 2 else 0
                    },
                    "geometry": [
                        {"x": point[0], "z": point[1]}
                        for point in getattr(road, 'geometry', [])
                        if isinstance(point, (list, tuple)) and len(point) >= 2
                    ]
                }
                for idx, road in enumerate(road_network.roads)
            ]
            state["intersections"] = [
                {
                    "id": getattr(intersection, 'id', f'intersection_{idx}'),
                    "pos": getattr(intersection, 'position', [0, 0]),
                    "x": getattr(intersection, 'position', [0, 0])[0],
                    "z": getattr(intersection, 'position', [0, 0])[1]
                }
                for idx, intersection in enumerate(road_network.intersections)
            ]
            state["lanes"] = [
                {
                    "id": getattr(lane, 'id', ''),
                    "road_id": getattr(lane, 'road_id', ''),
                    "direction": getattr(lane, 'direction', ''),
                    "centerline": [
                        {"x": point[0], "z": point[1]}
                        for point in getattr(lane, 'centerline', [])
                        if isinstance(point, (list, tuple)) and len(point) >= 2
                    ]
                }
                for lane in road_network.lanes
            ]
        else:
            state["roads"] = raw_state.get("roads", [])
            state["intersections"] = raw_state.get("intersections", [])
            state["lanes"] = raw_state.get("lanes", [])
        
        # Serialize vehicles with proper format
        if "vehicles" in raw_state and isinstance(raw_state["vehicles"], list):
            for vehicle in raw_state["vehicles"]:
                try:
                    # Handle different position formats
                    if isinstance(vehicle.get("pos"), (list, tuple)) and len(vehicle["pos"]) >= 2:
                        pos = [float(vehicle["pos"][0]), float(vehicle["pos"][1])]
                    elif isinstance(vehicle.get("pos"), dict):
                        pos = [float(vehicle["pos"].get("x", 0)), float(vehicle["pos"].get("z", 0))]
                    else:
                        pos = [0, 0]
                    
                    # Build vehicle data
                    vehicle_data = {
                        "uid": vehicle.get("uid", vehicle.get("id", -1)),
                        "id": vehicle.get("id", vehicle.get("uid", -1)),
                        "type": vehicle.get("type", "car"),
                        "pos": pos,
                        "x": pos[0],
                        "z": pos[1],
                        "rotation": float(vehicle.get("rotation", 0)),
                        "speed": float(vehicle.get("speed", 0)),
                        "is_emergency": bool(vehicle.get("is_emergency", False))
                    }
                    state["vehicles"].append(vehicle_data)
                except Exception as e:
                    print(f"⚠️  Warning: Could not serialize vehicle: {e}")
                    continue

        print(f"[STATE] traffic_lights={state['traffic_lights']} messages={len(state['messages'])}")
        return JSONResponse(state)
    
    except Exception as e:
        print(f"❌ [ERROR] get_state: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse({
            "status": "error",
            "message": str(e),
            "type": type(e).__name__
        }, status_code=500)

# ============================================================
# SIMULATION CONTROL ENDPOINTS
# ============================================================
@app.post("/api/simulation/start")
async def start_simulation(request: Request):
    """Start simulation"""
    global is_running, simulation_task, scenario_manager, simulation_engine

    try:
        if simulation_engine is None:
            return JSONResponse({
                "status": "error",
                "message": "Simulation engine not initialized"
            }, status_code=500)

        request_data = {}
        try:
            request_data = await request.json()
        except Exception:
            request_data = {}

        vehicle_count = int(request_data.get('vehicle_count', 10) or 10)
        scenario_name = request_data.get('scenario')

        spawned = {"total": 0, "vehicles": 0}
        if scenario_name and scenario_manager is not None:
            scenario_config = scenario_manager.get_scenario(scenario_name)
            spawned = simulation_engine.spawn_agents(scenario_config)
        else:
            spawned = simulation_engine.spawn_agents({"vehicles": vehicle_count})

        if not is_running:
            is_running = True
            simulation_task = asyncio.create_task(simulation_loop())

        print(f"▶️  [SIM] Simulation started, spawned {spawned['total']} vehicles")

        return JSONResponse({
            "status": "ok",
            "message": "Simulation started",
            "spawned": spawned
        })

    except Exception as e:
        print(f"❌ [ERROR] start_simulation: {e}")
        return JSONResponse({
            "status": "error",
            "message": str(e)
        }, status_code=500)


@app.post("/api/simulation/reset")
async def reset_simulation():
    """Reset simulation and restart the loop cleanly."""
    global simulation_engine, is_running, simulation_task

    try:
        is_running = False

        if simulation_task is not None and not simulation_task.done():
            simulation_task.cancel()
            try:
                await simulation_task
            except asyncio.CancelledError:
                pass
            finally:
                simulation_task = None

        if simulation_engine:
            simulation_engine.clear()
            simulation_engine.tick = 0
            simulation_engine._msg_counter = 0

        if simulation_engine is None:
            return JSONResponse({
                "status": "error",
                "message": "Simulation engine not initialized"
            }, status_code=500)

        is_running = True
        simulation_task = asyncio.create_task(simulation_loop())

        print("🔄 [SIM] Simulation reset and loop restarted")

        return JSONResponse({
            "status": "ok",
            "message": "Simulation reset"
        })

    except Exception as e:
        print(f"❌ [ERROR] reset_simulation: {e}")
        return JSONResponse({
            "status": "error",
            "message": str(e)
        }, status_code=500)

# ============================================================
# AGENT SPAWN ENDPOINTS
# ============================================================

@app.post("/api/spawn")
async def spawn_agents(request: Request):
    """Spawn agents from JSON config"""
    global simulation_engine, prompt_parser, is_running, simulation_task
    
    try:
        data = await request.json()
        prompt = data.get('prompt', '')
        
        if not prompt:
            return JSONResponse({
                "status": "error",
                "message": "Prompt is required"
            }, status_code=400)
        
        if prompt_parser is None or simulation_engine is None:
            return JSONResponse({
                "status": "error",
                "message": "Server not initialized"
            }, status_code=500)
        
        print(f"\n📤 [SPAWN] Request: '{prompt}'")
        
        config = prompt_parser.parse(prompt)
        print(f"   Parsed: {config}")
        
        spawned = simulation_engine.spawn_agents(config)

        # Auto-start simulation loop if not already running
        if not is_running:
            is_running = True
            simulation_task = asyncio.create_task(simulation_loop())
            print("▶️  [SPAWN] Auto-started simulation loop")

        print(f"   ✅ Spawned: {spawned['total']} total")

        return JSONResponse({
            "status": "ok",
            "message": f"Spawned {spawned['total']} agents",
            "spawned": spawned
        })

    
    except Exception as e:
        print(f"❌ [ERROR] spawn_agents: {e}")
        return JSONResponse({
            "status": "error",
            "message": str(e)
        }, status_code=500)

@app.post("/api/clear")
async def clear_simulation():
    """Clear all agents"""
    global simulation_engine
    
    try:
        if simulation_engine is None:
            return JSONResponse({
                "status": "error",
                "message": "Simulation engine not initialized"
            }, status_code=500)
        simulation_engine.clear()
        print("🗑️  [SIM] Simulation cleared")
        
        return JSONResponse({
            "status": "ok",
            "message": "Simulation cleared"
        })
    
    except Exception as e:
        print(f"❌ [ERROR] clear_simulation: {e}")
        return JSONResponse({
            "status": "error",
            "message": str(e)
        }, status_code=500)

# ============================================================
# SCENARIO ENDPOINTS
# ============================================================

@app.get("/api/scenarios")
async def list_scenarios():
    """Get available scenarios"""
    global scenario_manager
    
    try:
        if scenario_manager is None:
            return JSONResponse({
                "status": "error",
                "message": "Scenario manager not initialized"
            }, status_code=500)
        scenarios = scenario_manager.list_scenarios()
        
        return JSONResponse({
            "status": "ok",
            "scenarios": scenarios
        })
    
    except Exception as e:
        print(f"❌ [ERROR] list_scenarios: {e}")
        return JSONResponse({
            "status": "error",
            "message": str(e)
        }, status_code=500)

@app.post("/api/scenario/{scenario_name}")
async def load_scenario(scenario_name: str):
    """Load a predefined scenario"""
    global simulation_engine, scenario_manager
    
    try:
        if scenario_manager is None or simulation_engine is None:
            return JSONResponse({
                "status": "error",
                "message": "Server not initialized"
            }, status_code=500)
        
        print(f"\n📌 [SCENARIO] Loading: {scenario_name}")
        
        scenario_config = scenario_manager.get_scenario(scenario_name)
        spawned = simulation_engine.spawn_agents(scenario_config)
        
        print(f"   ✅ Loaded: {spawned['total']} agents")
        
        return JSONResponse({
            "status": "ok",
            "message": f"Loaded scenario: {scenario_name}",
            "spawned": spawned
        })
    
    except Exception as e:
        print(f"❌ [ERROR] load_scenario: {e}")
        return JSONResponse({
            "status": "error",
            "message": str(e)
        }, status_code=500)

# ============================================================
# SIMULATION LOOP
# ============================================================

import asyncio  # 1. Ensure asyncio is imported


async def simulation_loop():
    """Main simulation loop"""
    global simulation_engine, metrics_aggregator, DELTA_TIME, is_running

    print("🔄 [LOOP] Starting simulation loop...")
    tick_count = 0

    while is_running:
        try:
            # 2. Wait briefly if engine isn't ready instead of breaking out
            if simulation_engine is None or metrics_aggregator is None:
                print("⚠️ [LOOP] Waiting for simulation engine initialization...")
                await asyncio.sleep(0.5)
                continue

            # Update simulation
            simulation_engine.update(DELTA_TIME)

            # Update metrics
            metrics_aggregator.set_tick(simulation_engine.tick)
            metrics_aggregator.set_agent_counts(
                simulation_engine.get_vehicle_count(),
                simulation_engine.get_emergency_vehicle_count(),
                
            )

            tick_count += 1

            # Log every 60 ticks (1 second at 60Hz)
            if tick_count % 60 == 0:
                print(
                    f"   ⏱️  Tick: {simulation_engine.tick} | "
                    f"Vehicles: {simulation_engine.get_vehicle_count()} | "
                    f"Emergency: {simulation_engine.get_emergency_vehicle_count()}"
                )

            # Sleep to maintain frame timing (~60Hz if DELTA_TIME is ~0.016)
            await asyncio.sleep(DELTA_TIME * 0.9)

        except Exception as e:
            print(f"❌ [LOOP ERROR] {e}")
            await asyncio.sleep(0.1)

    print("🛑 [LOOP] Simulation loop stopped")

# ============================================================
# STATIC FILES
# ============================================================

# ============================================================
# STATIC FILES — no-cache for development
# ============================================================

static_path = Path(__file__).parent / "static"

if static_path.exists():
    @app.get("/static/{file_path:path}")
    async def serve_static_no_cache(file_path: str):
        """Serve static files with no-store headers so JS edits are
        picked up immediately without a browser hard-reload."""
        import mimetypes
        full_path = static_path / file_path
        if not full_path.exists() or not full_path.is_file():
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        mime, _ = mimetypes.guess_type(str(full_path))
        return FileResponse(
            str(full_path),
            media_type=mime or "application/octet-stream",
            headers={"Cache-Control": "no-store, no-cache, must-revalidate"}
        )
    print(f"✅ Static files mounted at /static (no-cache mode)")
else:
    print(f"⚠️  Warning: static/ directory not found")


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    import uvicorn
    
    print("\n🚀 Starting KESKUSTORI V2X server...\n")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
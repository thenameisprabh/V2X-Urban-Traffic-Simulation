import asyncio
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import server
from src.road_network import RoadNetwork
from src.simulation_engine import SimulationEngine


class DummyEngine:
    def get_state(self):
        return {
            "tick": 7,
            "vehicles": [],
            "messages": [],
            "roads": [],
            "lanes": [],
        }


class DummySignal:
    def __init__(self, signal_id, pos, state):
        self.id = signal_id
        self.pos = pos
        self.state = state


class DummyRoadNetwork:
    def __init__(self):
        self.roads = []
        self.intersections = []
        self.lanes = []
        self.traffic_signals = [
            DummySignal("signal_a", [10, 20], "GREEN"),
            DummySignal("signal_b", [30, 40], "RED"),
        ]


def test_state_endpoint_exposes_traffic_lights_from_road_network():
    server.simulation_engine = DummyEngine()
    server.road_network = DummyRoadNetwork()

    response = asyncio.run(server.get_state())
    payload = json.loads(response.body)

    assert payload["traffic_lights"][0]["id"] == "signal_a"
    assert payload["traffic_lights"][0]["state"] == "GREEN"
    assert payload["traffic_lights"][1]["state"] == "RED"


def test_vehicle_remains_active_after_crossing_lane_length():
    road_network = RoadNetwork()
    map_path = Path(__file__).resolve().parents[1] / "data" / "maps" / "keskustori.json"
    road_network.load_from_json(str(map_path))

    engine = SimulationEngine(road_network)
    engine.spawn_agents({"vehicles": 1})

    vehicle = engine.vehicles[0]
    vehicle.position = 1.2
    vehicle.speed = 0.05

    engine.update(1.0)

    assert len(engine.vehicles) == 1
    assert len(engine.get_state()["vehicles"]) == 1


def test_state_payload_includes_all_active_vehicles():
    road_network = RoadNetwork()
    map_path = Path(__file__).resolve().parents[1] / "data" / "maps" / "keskustori.json"
    road_network.load_from_json(str(map_path))

    engine = SimulationEngine(road_network)
    engine.spawn_agents({"vehicles": 25})

    state = engine.get_state()

    assert len(state["vehicles"]) == 25
    assert state["vehicle_count"] == 25

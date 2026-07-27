"""
Road network data structures and file loading.
Defines roads, lanes, intersections, and spawn points.
"""

import json
import math
from pathlib import Path

class SignalPhase:
    """Represents a yic signal phase (Red, Green, Yellow)"""
    
    def __init__(self, name, duration, state):
        """
        Args:
            name: Phase name (e.g., "Green NS")
            duration: How long phase lasts in seconds
            state: Signal state ("red", "green", "yellow")
        """
        self.name = name
        self.duration = duration
        self.state = state
    
    def __repr__(self):
        return f"SignalPhase({self.name}, {self.duration}s, {self.state})"


class Lane:
    """Represents a single traffic lane"""

    def __init__(self, id, road_id, direction, centerline=None,
                 width=3.5, speed_limit=0):
        """
        Args:
            id: Unique lane identifier
            road_id: ID of parent road
            direction: Direction of travel (e.g., "north", "east")
            centerline: Optional list of coordinates for lane centerline
            width: Lane width in metres (default 3.5)
            speed_limit: Speed limit in km/h (default 0 = unknown)
        """
        self.id = id
        self.road_id = road_id
        self.direction = direction
        self.centerline = centerline or []
        self.width = width
        self.speed_limit = speed_limit
        self.vehicles = []

    def __repr__(self):
        return f"Lane({self.id}, road={self.road_id}, dir={self.direction})"


class Road:
    """Represents a road with multiple lanes"""

    def __init__(self, id, name, start, end, geometry=None, speed_limit=0):
        """
        Args:
            id: Unique road identifier
            name: Road name (e.g., "Main Street")
            start: Starting coordinate [x, y]
            end: Ending coordinate [x, y]
            geometry: Optional polyline representing the road centerline
            speed_limit: Road-level speed limit in km/h (default 0 = unknown)
        """
        self.id = id
        self.name = name
        self.start = start
        self.end = end
        self.geometry = geometry or [start, end]
        self.speed_limit = speed_limit
        self.lanes = []

    def add_lane(self, lane):
        """Add a lane to this road"""
        self.lanes.append(lane)

    def __repr__(self):
        return f"Road({self.id}, {self.name}, {len(self.lanes)} lanes)"


class Intersection:
    """Represents a traffic intersection with signals"""
    
    def __init__(self, id, name, position):
        """
        Args:
            id: Unique intersection identifier
            name: Intersection name
            position: Position coordinate [x, y]
        """
        self.id = id
        self.name = name
        self.position = position
        self.phases = []
        self.current_phase = 0
        self.roads = []
    
    def add_phase(self, phase):
        """Add a signal phase to this intersection"""
        self.phases.append(phase)
    
    def add_road(self, road):
        """Add a connected road"""
        self.roads.append(road)
    
    def __repr__(self):
        return f"Intersection({self.id}, {self.name}, {len(self.phases)} phases)"


class SpawnPoint:
    """Represents where vehicles spawn"""
    
    def __init__(self, id, lane_id, position):
        """
        Args:
            id: Unique spawn point identifier
            lane_id: ID of lane where vehicles spawn
            position: Position along lane [0-1]
        """
        self.id = id
        self.lane_id = lane_id
        self.position = position
    
    def __repr__(self):
        return f"SpawnPoint({self.id}, lane={self.lane_id})"


class RoadNetwork:
    """
    Manages the entire road network structure.
    Handles loading from JSON files and querying network elements.
    """
    
    def __init__(self):
        """Initialize empty road network"""
        self.roads = []
        self.lanes = []
        self.intersections = []
        self.spawn_points = []
        self.traffic_signals = []
        self.sidewalks = []
        self.crosswalks = []
        self.bounds = None
        self.metadata = {}

    def load_from_json(self, filepath):
        """
        Load complete network from JSON file.
        
        Args:
            filepath: Path to JSON network file
            
        Raises:
            FileNotFoundError: If file doesn't exist
            json.JSONDecodeError: If JSON is invalid
        """
        filepath = Path(filepath)
        
        if not filepath.exists():
            raise FileNotFoundError(f"Network file not found: {filepath}")
        
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)

            self.metadata = data.get('metadata', {})
            
            # Load roads and lanes
            for road_data in data.get('roads', []):
                geometry = road_data.get('geometry', [])
                start = geometry[0] if isinstance(geometry, list) and len(geometry) >= 1 else road_data.get('start', [0, 0])
                end = geometry[-1] if isinstance(geometry, list) and len(geometry) >= 2 else road_data.get('end', [100, 100])
                road = Road(
                    id=road_data['id'],
                    name=road_data.get('name', f"Road {road_data['id']}"),
                    start=start,
                    end=end,
                    geometry=geometry if isinstance(geometry, list) and len(geometry) >= 2 else [start, end],
                    speed_limit=road_data.get('speed_limit', 0)
                )

                # Add lanes to road
                for lane_data in road_data.get('lanes', []):
                    centerline = lane_data.get('centerline') or road.geometry
                    lane = Lane(
                        id=lane_data['id'],
                        road_id=road.id,
                        direction=lane_data.get('direction', 'unknown'),
                        centerline=centerline,
                        width=lane_data.get('width', 3.5),
                        speed_limit=lane_data.get('speed_limit', 0)
                    )

                    road.add_lane(lane)
                    self.lanes.append(lane)
                
                self.roads.append(road)
            
            # Load intersections and phases
            for intersection_data in data.get('intersections', []):
                intersection = Intersection(
                    id=intersection_data['id'],
                    name=intersection_data.get('name', intersection_data.get('id', f"Intersection {intersection_data['id']}")),
                    position=intersection_data.get('position', intersection_data.get('pos', [0, 0]))
                )
                
                # Add phases to intersection
                for phase_data in intersection_data.get('phases', []):
                    phase = SignalPhase(
                        name=phase_data.get('name', 'Unknown'),
                        duration=phase_data.get('duration', 30.0),
                        state=phase_data.get('state', 'red')
                    )
                    intersection.add_phase(phase)
                
                self.intersections.append(intersection)
            
            # Load sidewalks
            for sidewalk_data in data.get('sidewalks', []):
                self.sidewalks.append({
                    'id': sidewalk_data.get('id', ''),
                    'geometry': sidewalk_data.get('geometry', []),
                    'width': sidewalk_data.get('width', 2.0)
                })

            # Load crosswalks
            for crosswalk_data in data.get('crosswalks', []):
                self.crosswalks.append({
                    'id': crosswalk_data.get('id', ''),
                    'pos': crosswalk_data.get('pos', [0, 0]),
                    'signal_id': crosswalk_data.get('traffic_signal_id') or crosswalk_data.get('signal_id'),
                    'direction': crosswalk_data.get('direction', 'NS')
                })

            # Load spawn points
            for spawn_data in data.get('spawn_points', []):
                spawn_position = spawn_data.get('position', None)
                if spawn_position is None:
                    offset = spawn_data.get('offset', None)
                    lane = self.get_lane(spawn_data.get('lane_id', ''))
                    if offset is not None and lane and lane.centerline:
                        total_length = 0.0
                        for i in range(1, len(lane.centerline)):
                            prev = lane.centerline[i - 1]
                            cur = lane.centerline[i]
                            dx = cur[0] - prev[0]
                            dy = cur[1] - prev[1]
                            total_length += math.hypot(dx, dy)
                        if total_length > 0:
                            spawn_position = min(max(offset / total_length, 0.0), 1.0)
                        else:
                            spawn_position = 0.0
                    else:
                        spawn_position = 0.0

                spawn = SpawnPoint(
                    id=spawn_data['id'],
                    lane_id=spawn_data.get('lane_id', ''),
                    position=spawn_position
                )
                self.spawn_points.append(spawn)

            # Load traffic signals
            for signal_data in data.get('traffic_signals', []):
                signal = {
                    'id': signal_data.get('id', ''),
                    'pos': signal_data.get('pos', [0, 0]),
                    'state': (signal_data.get('phases', [{}])[0].get('state', 'RED') if isinstance(signal_data.get('phases', None), list) else signal_data.get('state', 'RED'))
                }
                self.traffic_signals.append(signal)
            
            print(f"   ✅ Loaded {len(self.roads)} roads")
            print(f"   ✅ Loaded {len(self.lanes)} lanes")
            print(f"   ✅ Loaded {len(self.intersections)} intersections")
            print(f"   ✅ Loaded {len(self.spawn_points)} spawn points")
        
        except json.JSONDecodeError as e:
            print(f"   ❌ JSON parsing error: {e}")
            raise
        except KeyError as e:
            print(f"   ❌ Missing required field: {e}")
            raise
        except Exception as e:
            print(f"   ❌ Error loading network: {e}")
            raise
    
    def get_lane(self, lane_id):
        """Get lane by ID"""
        for lane in self.lanes:
            if lane.id == lane_id:
                return lane
        return None
    
    def get_road(self, road_id):
        """Get road by ID"""
        for road in self.roads:
            if road.id == road_id:
                return road
        return None
    
    def get_intersection(self, intersection_id):
        """Get intersection by ID"""
        for intersection in self.intersections:
            if intersection.id == intersection_id:
                return intersection
        return None
    
    def get_spawn_point(self, spawn_id):
        """Get spawn point by ID"""
        for spawn in self.spawn_points:
            if spawn.id == spawn_id:
                return spawn
        return None
    
    def __repr__(self):
        return (f"RoadNetwork({len(self.roads)} roads, {len(self.lanes)} lanes, "
                f"{len(self.intersections)} intersections, {len(self.spawn_points)} spawns)")

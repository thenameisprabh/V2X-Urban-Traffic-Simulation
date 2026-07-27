"""
Intersection Manager - Handles intersection logic and traffic signals
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

@dataclass
class IntersectionState:
    """State of an intersection"""
    intersection_id: str
    traffic_signal_id: Optional[str]
    signal_state: str
    signal_direction: str
    vehicles_in_intersection: List[int]  # ✅ Changed to List[int]

class IntersectionManager:
    """Manages all intersections"""
    
    def __init__(self, road_network):
        self.network = road_network
        self.intersection_states: Dict[str, IntersectionState] = {}
        
        for intersection_id, intersection in road_network.intersections.items():
            state = IntersectionState(
                intersection_id=intersection_id,
                traffic_signal_id=intersection.traffic_signal_id,
                signal_state='RED',
                signal_direction='NS',
                vehicles_in_intersection=[]
            )
            self.intersection_states[intersection_id] = state
        
        print(f"🚦 IntersectionManager initialized with {len(self.intersection_states)} intersections")
    
    def get_intersection_state(self, intersection_id: str) -> Optional[IntersectionState]:
        """Get intersection state"""
        return self.intersection_states.get(intersection_id)
    
    def get_traffic_signal_state(self, signal_id: str) -> Tuple[str, str]:
        """Get traffic signal state (color, direction)"""
        signal = self.network.traffic_signals.get(signal_id)
        if signal:
            return (signal.get_state(), signal.get_direction())
        return ('RED', 'NS')
    
    def can_vehicle_enter_intersection(self, intersection_id: str, lane_id: str) -> bool:
        """Check if vehicle can enter intersection"""
        intersection = self.network.intersections.get(intersection_id)
        if not intersection:
            return False
        
        if lane_id not in intersection.incoming_lanes:
            return False
        
        if intersection.traffic_signal_id:
            signal = self.network.traffic_signals.get(intersection.traffic_signal_id)
            if signal:
                signal_state = signal.get_state()
                if signal_state != 'GREEN':
                    return False
        
        return True
    
    def get_next_lanes(self, intersection_id: str) -> List[str]:
        """Get outgoing lanes from intersection"""
        intersection = self.network.intersections.get(intersection_id)
        if intersection:
            return intersection.outgoing_lanes
        return []
    
def register_vehicle_at_intersection(self, intersection_id: str, vehicle_id: int):  # ✅ Changed to int
    """Register vehicle at intersection"""
    state = self.intersection_states.get(intersection_id)
    if state and vehicle_id not in state.vehicles_in_intersection:
        state.vehicles_in_intersection.append(vehicle_id)

def unregister_vehicle_at_intersection(self, intersection_id: str, vehicle_id: int):  # ✅ Changed to int
    """Unregister vehicle from intersection"""
    state = self.intersection_states.get(intersection_id)
    if state and vehicle_id in state.vehicles_in_intersection:
        state.vehicles_in_intersection.remove(vehicle_id)

def get_vehicles_at_intersection(self, intersection_id: str) -> List[int]:  # ✅ Changed to List[int]
    """Get vehicles at intersection"""
    state = self.intersection_states.get(intersection_id)
    if state:
        return state.vehicles_in_intersection
    return []

    
    def update(self, delta_time: float):
        """Update intersection states"""
        for signal in self.network.traffic_signals.values():
            signal.update(delta_time)
            
            for intersection in self.network.intersections.values():
                if intersection.traffic_signal_id == signal.id:
                    state = self.intersection_states.get(intersection.id)
                    if state:
                        state.signal_state = signal.get_state()
                        state.signal_direction = signal.get_direction()

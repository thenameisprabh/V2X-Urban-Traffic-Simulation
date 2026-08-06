"""
Traffic signal and intersection management system
Handles traffic light phase transitions and coordination
"""

class IntersectionManager:
    """
    Manages traffic signals and intersection logic.
    Coordinates signal phases across multiple intersections.
    """
    
    def __init__(self, intersections):
        """
        Initialize intersection manager with a list of intersections.
        
        Args:
            intersections: List of Intersection objects
        """
        self.intersections = intersections
        self.current_phases = {}  # {intersection_id: current_phase_index}
        self.phase_timers = {}    # {intersection_id: elapsed_time_in_current_phase}
        self._base_durations = {}  # snapshot of original phase durations
        self._queue_counts = {}    # {intersection_id: queued_vehicle_count}
        self._emergency_active = {}  # {intersection_id: bool}
        
        print(f"🚦 IntersectionManager initialized with {len(intersections)} intersections")
        
        # Initialize state for each intersection
        for intersection in intersections:
            intersection_id = intersection.id
            self.current_phases[intersection_id] = 0
            self.phase_timers[intersection_id] = 0.0
            self._base_durations[intersection_id] = [p.duration for p in intersection.phases]
            self._queue_counts[intersection_id] = 0
            self._emergency_active[intersection_id] = False
    
    def update(self, dt):
        """
        Update all intersection signal phases.
        Called once per simulation tick.
        
        Args:
            dt: Delta time in seconds since last update
        """
        for intersection in self.intersections:
            self._update_intersection(intersection, dt)
    
    def _update_intersection(self, intersection, dt):
        """
        Update a single intersection's signal phase.
        Transitions to next phase when current phase duration expires.
        
        Args:
            intersection: Intersection object to update
            dt: Delta time in seconds
        """
        intersection_id = intersection.id
        
        # Guard against empty phases list
        if not intersection.phases:
            return
        
        current_phase_idx = self.current_phases[intersection_id]
        current_phase = intersection.phases[current_phase_idx]
        
        # Accumulate elapsed time
        self.phase_timers[intersection_id] += dt
        
        effective_duration = self._effective_duration(intersection_id, current_phase_idx)
        
        # Emergency pre-emption: force rapid transition if not green
        if self._emergency_active.get(intersection_id, False):
            state = (current_phase.state or '').lower()
            if state != 'green':
                effective_duration = min(effective_duration, self.phase_timers[intersection_id] + 0.5)
        
        # Check if we should transition to next phase
        if self.phase_timers[intersection_id] >= effective_duration:
            # Move to next phase (wrap around to start)
            next_phase_idx = (current_phase_idx + 1) % len(intersection.phases)
            self.current_phases[intersection_id] = next_phase_idx
            self.phase_timers[intersection_id] = 0.0
            
            # Update intersection's current phase
            intersection.current_phase = next_phase_idx
    
    def get_current_phase(self, intersection_id):
        """
        Get the current signal phase index for an intersection.
        
        Args:
            intersection_id: ID of the intersection
            
        Returns:
            Current phase index (0-based)
        """
        return self.current_phases.get(intersection_id, 0)
    
    def get_phase_info(self, intersection_id):
        """
        Get detailed information about current phase.
        
        Args:
            intersection_id: ID of the intersection
            
        Returns:
            Dictionary with phase information
        """
        for intersection in self.intersections:
            if intersection.id == intersection_id:
                phase_idx = self.current_phases[intersection_id]
                if phase_idx < len(intersection.phases):
                    phase = intersection.phases[phase_idx]
                    return {
                        "phase_index": phase_idx,
                        "phase_name": phase.name,
                        "phase_state": phase.state,
                        "elapsed_time": self.phase_timers[intersection_id],
                        "duration": self._effective_duration(intersection_id, phase_idx)
                    }
        return None

    def get_signal_state(self, intersection_id):
        """Return the current signal state for an intersection."""
        phase_info = self.get_phase_info(intersection_id)
        if phase_info is not None:
            return phase_info.get("phase_state", "RED")
        return "RED"
    
    def reset_intersection(self, intersection_id):
        """Reset a specific intersection to initial state"""
        self.current_phases[intersection_id] = 0
        self.phase_timers[intersection_id] = 0.0
        self._queue_counts[intersection_id] = 0
        self._emergency_active[intersection_id] = False

    def clear_traffic_state(self):
        """Reset transient traffic inputs before each tick."""
        for intersection in self.intersections:
            self._queue_counts[intersection.id] = 0
            self._emergency_active[intersection.id] = False

    def set_queue_count(self, intersection_id, count):
        """Report queued vehicles near an intersection."""
        if intersection_id in self._queue_counts:
            self._queue_counts[intersection_id] = count

    def set_emergency_active(self, intersection_id, active):
        """Report emergency vehicle proximity."""
        if intersection_id in self._emergency_active:
            self._emergency_active[intersection_id] = active

    def _effective_duration(self, intersection_id, phase_idx):
        """
        Compute adaptive phase duration.
        - Emergency: extend green up to 2x base / 60s cap.
        - Queue: extend green up to 1.5x base / 45s cap.
        """
        base_list = self._base_durations.get(intersection_id, [])
        base = base_list[phase_idx] if phase_idx < len(base_list) else 30.0
        
        phase_state = ''
        for inter in self.intersections:
            if inter.id == intersection_id:
                if phase_idx < len(inter.phases):
                    phase_state = (inter.phases[phase_idx].state or '').lower()
                break
        
        if phase_state != 'green':
            return base
        
        if self._emergency_active.get(intersection_id, False):
            elapsed = self.phase_timers.get(intersection_id, 0.0)
            return min(max(base, elapsed + 5.0), base * 2, 60.0)
        
        if self._queue_counts.get(intersection_id, 0) > 0:
            return min(base * 1.5, 45.0)
        
        return base
"""
Metrics collection and aggregation.
Tracks simulation statistics and performance data.
"""

from collections import deque
from datetime import datetime


class MetricsAggregator:
    """
    Aggregates and tracks simulation metrics.
    Maintains history of vehicle counts, congestion levels, etc.
    """
    
    def __init__(self, history_size=1000):
        """
        Initialize metrics aggregator.
        
        Args:
            history_size: Maximum number of history entries to keep
        """
        self.tick = 0
        self.vehicle_count = 0
        self.pedestrian_count = 0
        self.history_size = history_size
        self.history = deque(maxlen=history_size)
        self.start_time = datetime.now()
    
    def set_tick(self, tick):
        """
        Set current simulation tick.
        
        Args:
            tick: Current tick number
        """
        self.tick = tick
    
    def set_agent_counts(self, vehicles, pedestrians):
        """
        Set current agent counts and record in history.
        
        Args:
            vehicles: Number of vehicles
            pedestrians: Number of pedestrians
        """
        self.vehicle_count = vehicles
        self.pedestrian_count = pedestrians
        
        # Add to history
        self.history.append({
            "tick": self.tick,
            "timestamp": datetime.now().isoformat(),
            "vehicles": vehicles,
            "pedestrians": pedestrians,
            "total_agents": vehicles + pedestrians
        })
    
    def get_history(self, last_n=None):
        """
        Get metric history.
        
        Args:
            last_n: Return only last N entries (None = all)
            
        Returns:
            List of history entries
        """
        if last_n is None:
            return list(self.history)
        return list(self.history)[-last_n:]
    
    def get_statistics(self):
        """
        Calculate aggregate statistics from history.
        
        Returns:
            Dictionary with statistical data
        """
        if not self.history:
            return {
                "avg_vehicles": 0,
                "max_vehicles": 0,
                "min_vehicles": 0,
                "avg_pedestrians": 0
            }
        
        vehicles = [h["vehicles"] for h in self.history]
        pedestrians = [h["pedestrians"] for h in self.history]
        
        return {
            "avg_vehicles": sum(vehicles) / len(vehicles),
            "max_vehicles": max(vehicles),
            "min_vehicles": min(vehicles),
            "avg_pedestrians": sum(pedestrians) / len(pedestrians),
            "total_ticks": len(self.history)
        }
    
    def get_current_state(self):
        """
        Get current metrics state.
        
        Returns:
            Dictionary with current metrics
        """
        elapsed = (datetime.now() - self.start_time).total_seconds()
        
        return {
            "current_tick": self.tick,
            "vehicle_count": self.vehicle_count,
            "pedestrian_count": self.pedestrian_count,
            "elapsed_seconds": round(elapsed, 2),
            "history_entries": len(self.history)
        }
    
    def reset(self):
        """Reset all metrics"""
        self.tick = 0
        self.vehicle_count = 0
        self.pedestrian_count = 0
        self.history.clear()
        self.start_time = datetime.now()

"""
Predefined scenario management.
Provides templates for common traffic simulation scenarios.
"""


class ScenarioManager:
    """
    Manages predefined traffic scenarios.
    Provides templates for light, moderate, heavy traffic, etc.
    """
    
    def __init__(self):
        """Initialize scenario manager with predefined scenarios"""
        self.scenarios = {
            "light": {
                "name": "Light Traffic",
                "description": "Minimal traffic flow",
                "vehicles": 3,
                "pedestrians": 1,
                "vehicle_types": {"car": 3},
                "duration": 300
            },
            "moderate": {
                "name": "Moderate Traffic",
                "description": "Normal traffic conditions",
                "vehicles": 10,
                "pedestrians": 5,
                "vehicle_types": {"car": 8, "truck": 2},
                "duration": 300
            },
            "heavy": {
                "name": "Heavy Traffic",
                "description": "Congested conditions",
                "vehicles": 25,
                "pedestrians": 10,
                "vehicle_types": {"car": 20, "truck": 3, "bus": 2},
                "duration": 300
            },
            "rush_hour": {
                "name": "Rush Hour",
                "description": "Peak hour congestion",
                "vehicles": 50,
                "pedestrians": 30,
                "vehicle_types": {"car": 40, "truck": 5, "bus": 5},
                "duration": 600
            },
            "emergency": {
                "name": "Emergency Response",
                "description": "Emergency vehicle scenario",
                "vehicles": 15,
                "pedestrians": 8,
                "vehicle_types": {"car": 12, "emergency": 3},
                "duration": 300
            }
        }
    
    def list_scenarios(self):
        """
        Get list of available scenario names.
        
        Returns:
            List of scenario names
        """
        return list(self.scenarios.keys())
    
    def get_scenario(self, scenario_name):
        """
        Get scenario configuration.
        
        Args:
            scenario_name: Name of scenario
            
        Returns:
            Configuration dictionary for scenario
        """
        if scenario_name not in self.scenarios:
            print(f"⚠️  Unknown scenario: {scenario_name}. Using 'light' as default.")
            scenario_name = "light"
        
        scenario = self.scenarios[scenario_name]
        return {
            "vehicles": scenario["vehicles"],
            "pedestrians": scenario["pedestrians"],
            "vehicle_types": scenario["vehicle_types"],
            "duration": scenario["duration"]
        }
    
    def get_scenario_info(self, scenario_name):
        """
        Get detailed scenario information.
        
        Args:
            scenario_name: Name of scenario
            
        Returns:
            Full scenario dictionary with description
        """
        return self.scenarios.get(scenario_name, None)
    
    def list_all(self):
        """Get all scenarios with descriptions"""
        return [
            {
                "name": name,
                "info": scenario
            }
            for name, scenario in self.scenarios.items()
        ]

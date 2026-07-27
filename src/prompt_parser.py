"""
Natural language prompt parsing.
Converts user input into simulation configurations.
"""

import re


class PromptParser:
    """
    Parses natural language prompts into simulation configuration.
    Extracts vehicle count, types, and other parameters from text.
    """

    def __init__(self):
        """Initialize prompt parser"""
        self.default_config = {
            "vehicles": 5,
            "pedestrians": 0,
            "scenario": "light"
        }

    def parse(self, prompt):
        """
        Parse a natural language prompt.

        Args:
            prompt: User input string

        Returns:
            Configuration dictionary
        """
        config = self.default_config.copy()
        prompt_lower = prompt.lower()

        # Extract vehicle count
        vehicle_patterns = [
            r'(\d+)\s*(?:vehicles?|cars?|auto)',
            r'(?:spawn|add|create)\s*(?:up to\s*)?(\d+)',
            r'(\d+)\s*vehicles?'
        ]

        for pattern in vehicle_patterns:
            match = re.search(pattern, prompt_lower)
            if match:
                count = int(match.group(1))
                config['vehicles'] = max(1, min(count, 100))  # Clamp between 1-100
                break

        # Detect scenario keywords
        scenario_keywords = {
            'light':    ['light', 'empty', 'few', 'minimal'],
            'moderate': ['medium', 'normal', 'moderate', 'average'],
            'heavy':    ['heavy', 'congestion', 'busy', 'lots'],
            'rush':     ['rush', 'peak', 'hour', 'crowded']
        }

        for scenario, keywords in scenario_keywords.items():
            if any(kw in prompt_lower for kw in keywords):
                config['scenario'] = scenario
                break

        # Pedestrian detection
        if 'pedestrian' in prompt_lower or 'person' in prompt_lower:
            pedestrian_match = re.search(r'(\d+)\s*pedestrian', prompt_lower)
            if pedestrian_match:
                config['pedestrians'] = int(pedestrian_match.group(1))
            else:
                config['pedestrians'] = 5

        # ── Phase 11: Emergency vehicle type detection ─────────────────────
        # Recognises prompts such as:
        #   "spawn 1 emergency"
        #   "spawn emergency vehicle"
        #   "spawn 3 emergency vehicles"
        #   "add an emergency car"
        #
        # Detection is keyword-only: if the word 'emergency' appears anywhere
        # in the prompt we treat the entire batch as emergency vehicles.
        # This keeps the logic deterministic and avoids ambiguous mixed spawns.
        #
        # vehicle_type is intentionally NOT in default_config so that ordinary
        # spawns never carry a vehicle_type key — spawn_agents() falls back to
        # 'car' via config.get('vehicle_type', 'car') as before.
        if 'emergency' in prompt_lower:
            config['vehicle_type'] = 'emergency'
            # If the count was not captured by the existing patterns above,
            # default to 1 — a single emergency vehicle is the common case.
            # The existing patterns already handle "spawn 3 emergency vehicles"
            # via the r'(\d+)\s*vehicles?' pattern, so this only fires when
            # no digit was found at all (e.g. "spawn emergency vehicle").
            if config['vehicles'] == self.default_config['vehicles']:
                config['vehicles'] = 1
        # ── end Phase 11 ───────────────────────────────────────────────────

        return config

    def parse_command(self, prompt):
        """
        Parse control commands from prompt.

        Args:
            prompt: User input string

        Returns:
            Tuple of (config_dict, command_string or None)
        """
        prompt_lower = prompt.lower()

        commands = {
            'start': ['start', 'begin', 'go', 'run'],
            'pause': ['pause', 'stop', 'halt'],
            'reset': ['reset', 'clear', 'restart'],
            'spawn': ['spawn', 'add', 'create', 'send']
        }

        command = None
        for cmd, keywords in commands.items():
            if any(kw in prompt_lower for kw in keywords):
                command = cmd
                break

        config = self.parse(prompt)
        return config, command

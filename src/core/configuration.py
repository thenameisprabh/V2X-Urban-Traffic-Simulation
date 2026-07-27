"""
Configuration manager for KESKUSTORI V2X.
Handles environment, file-based, and default settings.
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

from .errors import ConfigurationError


class ConfigurationManager:
    """Central configuration manager for the application."""

    def __init__(self, defaults: Optional[Dict[str, Any]] = None, config_path: Optional[str] = None):
        self._config: Dict[str, Any] = {}
        self.defaults: Dict[str, Any] = defaults or {}
        self._config.update(self.defaults)
        self._config.update(self._load_environment())

        if config_path:
            self.load_file(config_path)

    def _load_environment(self) -> Dict[str, Any]:
        env_config: Dict[str, Any] = {}
        for key, value in os.environ.items():
            if key.startswith("KSV_"):
                normalized_key = key[4:].lower()
                env_config[normalized_key] = value
        return env_config

    def load_file(self, path: str) -> None:
        try:
            source = Path(path)
            if not source.exists():
                raise ConfigurationError(f"Configuration file not found: {path}")

            with source.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
                if not isinstance(data, dict):
                    raise ConfigurationError("Configuration file must contain a JSON object.")
                self._config.update(data)
        except json.JSONDecodeError as exception:
            raise ConfigurationError(f"Invalid JSON configuration: {exception}") from exception
        except OSError as exception:
            raise ConfigurationError(f"Unable to read configuration file: {exception}") from exception

    def get(self, key: str, default: Optional[Any] = None) -> Any:
        return self._config.get(key.lower(), default)

    def get_int(self, key: str, default: int = 0) -> int:
        value = self.get(key, default)
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def get_float(self, key: str, default: float = 0.0) -> float:
        value = self.get(key, default)
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def get_bool(self, key: str, default: bool = False) -> bool:
        value = self.get(key, default)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"true", "1", "yes", "on"}
        return bool(value)

    def set(self, key: str, value: Any) -> None:
        self._config[key.lower()] = value

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._config)

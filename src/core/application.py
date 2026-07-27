"""
Application context bootstrap for KESKUSTORI V2X.
Provides the central entrypoint for foundation service wiring.
"""

from pathlib import Path
from typing import Optional

from .asset_manager import AssetManager
from .configuration import ConfigurationManager
from .event_system import EventDispatcher
from .logger import Logger
from .scene_manager import SceneManager
from .errors import FoundationError


class ApplicationContext:
    """Wires foundation services for application startup."""

    def __init__(self, config_path: Optional[str] = None):
        self.config = ConfigurationManager(config_path=config_path)
        self.logger = Logger.from_config(self.config)
        self.events = EventDispatcher()
        self.assets = AssetManager()
        self.scene = SceneManager()

    def boot(self) -> None:
        self.logger.info("Booting application context")
        self._register_default_assets()
        self._prepare_scene()
        self.logger.info("Application context booted")

    def _register_default_assets(self) -> None:
        asset_directory = Path(self.config.get("asset.path", "static"))
        self.logger.debug(f"Default asset path: {asset_directory}")
        if asset_directory.exists():
            self.assets.register("root", str(asset_directory))

    def _prepare_scene(self) -> None:
        self.scene.reset()
        self.scene.add_node("foundation-root", metadata={"type": "foundation"})

    def shutdown(self) -> None:
        self.logger.info("Shutting down application context")
        self.events.clear()
        self.scene.reset()

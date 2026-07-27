"""
Asset manager foundation for KESKUSTORI V2X.
Provides lightweight registration and retrieval of assets without loading rendering or domain objects.
"""

from pathlib import Path
from typing import Dict, Optional

from .errors import AssetError


class AssetDescriptor:
    """Descriptor for a registered asset."""

    def __init__(self, asset_id: str, path: str, metadata: Optional[Dict[str, str]] = None):
        self.asset_id = asset_id
        self.path = path
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, str]:
        return {
            "asset_id": self.asset_id,
            "path": self.path,
            **self.metadata
        }


class AssetManager:
    """Registry for application assets."""

    def __init__(self):
        self._assets: Dict[str, AssetDescriptor] = {}

    def register(self, asset_id: str, path: str, metadata: Optional[Dict[str, str]] = None) -> None:
        if not asset_id or not path:
            raise AssetError("Asset id and path are required")
        if asset_id in self._assets:
            raise AssetError(f"Asset already registered: {asset_id}")

        asset_path = Path(path)
        if not asset_path.exists():
            raise AssetError(f"Asset file does not exist: {path}")

        self._assets[asset_id] = AssetDescriptor(asset_id, str(asset_path.resolve()), metadata)

    def get(self, asset_id: str) -> AssetDescriptor:
        if asset_id not in self._assets:
            raise AssetError(f"Asset not found: {asset_id}")
        return self._assets[asset_id]

    def list_assets(self) -> Dict[str, Dict[str, str]]:
        return {asset_id: descriptor.to_dict() for asset_id, descriptor in self._assets.items()}

    def unregister(self, asset_id: str) -> None:
        if asset_id in self._assets:
            del self._assets[asset_id]

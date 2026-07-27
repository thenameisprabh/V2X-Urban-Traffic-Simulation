"""
Scene manager foundation for KESKUSTORI V2X.
Tracks scene graph nodes and provides a stable interface for scene updates.
"""

from typing import Any, Dict, List, Optional

from .errors import SceneError


class SceneNode:
    """Lightweight scene graph node."""

    def __init__(self, node_id: str, metadata: Optional[Dict[str, Any]] = None):
        self.node_id = node_id
        self.metadata = metadata or {}
        self.children: List[SceneNode] = []
        self.parent: Optional[SceneNode] = None

    def add_child(self, node: "SceneNode") -> None:
        if node in self.children:
            raise SceneError(f"Node already child of {self.node_id}: {node.node_id}")
        node.parent = self
        self.children.append(node)

    def remove_child(self, node: "SceneNode") -> None:
        if node not in self.children:
            raise SceneError(f"Node not found in children of {self.node_id}")
        self.children.remove(node)
        node.parent = None

    def find(self, node_id: str) -> Optional["SceneNode"]:
        if self.node_id == node_id:
            return self
        for child in self.children:
            found = child.find(node_id)
            if found:
                return found
        return None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "node_id": self.node_id,
            "metadata": self.metadata,
            "children": [child.to_dict() for child in self.children]
        }


class SceneManager:
    """Manages scene graph nodes."""

    def __init__(self):
        self.root = SceneNode("root")

    def add_node(self, node_id: str, parent_id: str = "root", metadata: Optional[Dict[str, Any]] = None) -> SceneNode:
        parent = self.root.find(parent_id)
        if parent is None:
            raise SceneError(f"Parent node not found: {parent_id}")

        if self.root.find(node_id) is not None:
            raise SceneError(f"Node id already exists: {node_id}")

        node = SceneNode(node_id, metadata)
        parent.add_child(node)
        return node

    def remove_node(self, node_id: str) -> None:
        node = self.root.find(node_id)
        if node is None or node.parent is None:
            raise SceneError(f"Node not found or has no parent: {node_id}")
        node.parent.remove_child(node)

    def get_node(self, node_id: str) -> Optional[SceneNode]:
        return self.root.find(node_id)

    def reset(self) -> None:
        self.root = SceneNode("root")

    def to_dict(self) -> Dict[str, Any]:
        return self.root.to_dict()

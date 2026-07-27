"""
Foundation error definitions for KESKUSTORI V2X.
This module defines the base exception types used across the core architecture.
"""

class FoundationError(Exception):
    """Base error for foundation-level failures."""
    pass

class ConfigurationError(FoundationError):
    """Errors raised during configuration management."""
    pass

class LoggerError(FoundationError):
    """Errors raised by the logging subsystem."""
    pass

class AssetError(FoundationError):
    """Errors raised when asset resolution or registry operations fail."""
    pass

class SceneError(FoundationError):
    """Errors raised during scene graph operations."""
    pass

class EventError(FoundationError):
    """Errors raised in the event dispatch system."""
    pass

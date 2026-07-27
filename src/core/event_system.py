"""
Event dispatch system for KESKUSTORI V2X.
Defines a lightweight publish/subscribe mechanism for core events.
"""

from typing import Any, Callable, Dict, List

from .errors import EventError


EventListener = Callable[[Any], None]


class EventDispatcher:
    """Dispatches events to registered listeners."""

    def __init__(self):
        self._listeners: Dict[str, List[EventListener]] = {}

    def on(self, event_name: str, callback: EventListener) -> None:
        if not callable(callback):
            raise EventError("Event listener must be callable")
        self._listeners.setdefault(event_name, []).append(callback)

    def off(self, event_name: str, callback: EventListener) -> None:
        if event_name not in self._listeners:
            return
        try:
            self._listeners[event_name].remove(callback)
        except ValueError:
            pass

    def emit(self, event_name: str, payload: Any = None) -> None:
        listeners = list(self._listeners.get(event_name, []))
        for listener in listeners:
            try:
                listener(payload)
            except Exception as error:
                raise EventError(f"Error dispatching event '{event_name}': {error}") from error

    def clear(self) -> None:
        self._listeners.clear()

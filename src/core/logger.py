"""
Logging abstraction for KESKUSTORI V2X.
Encapsulates Python logging configuration and exposes a stable logger API.
"""

import logging
from typing import Optional

from .configuration import ConfigurationManager
from .errors import LoggerError


class Logger:
    """Simple logger wrapper for foundation-level logging."""

    def __init__(self, name: str = "keskustori", level: str = "INFO"):
        self.logger = logging.getLogger(name)
        self.level = level.upper()
        self._configure_logger()

    def _configure_logger(self) -> None:
        self.logger.setLevel(getattr(logging, self.level, logging.INFO))
        if not self.logger.handlers:
            formatter = logging.Formatter(
                "%(asctime)s %(levelname)s [%(name)s] %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S"
            )
            handler = logging.StreamHandler()
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)

    @classmethod
    def from_config(cls, config: Optional[ConfigurationManager] = None) -> "Logger":
        if config is None:
            return cls()

        log_level = config.get("log_level", "INFO")
        name = config.get("app_name", "keskustori")
        return cls(name=name, level=log_level)

    def debug(self, message: str, *args, **kwargs) -> None:
        try:
            self.logger.debug(message, *args, **kwargs)
        except Exception as error:
            raise LoggerError(f"Failed to log debug message: {error}") from error

    def info(self, message: str, *args, **kwargs) -> None:
        try:
            self.logger.info(message, *args, **kwargs)
        except Exception as error:
            raise LoggerError(f"Failed to log info message: {error}") from error

    def warning(self, message: str, *args, **kwargs) -> None:
        try:
            self.logger.warning(message, *args, **kwargs)
        except Exception as error:
            raise LoggerError(f"Failed to log warning message: {error}") from error

    def error(self, message: str, *args, **kwargs) -> None:
        try:
            self.logger.error(message, *args, **kwargs)
        except Exception as error:
            raise LoggerError(f"Failed to log error message: {error}") from error

    def exception(self, message: str, *args, **kwargs) -> None:
        try:
            self.logger.exception(message, *args, **kwargs)
        except Exception as error:
            raise LoggerError(f"Failed to log exception: {error}") from error

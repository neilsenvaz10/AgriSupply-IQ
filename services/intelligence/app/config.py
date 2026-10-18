"""Validated, environment-based configuration.

Rules (mirroring the Express API):
- Invalid configuration stops startup with a message naming the VARIABLE and the rule,
  never the supplied value.
- Nothing here requires model files or PostgreSQL to exist.
- Real environment variables win over ``.env`` files.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path, PurePath
from typing import Annotated, Literal

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_NAME = "fasalytics-intelligence"
SERVICE_VERSION = "0.1.0"


def _find_repo_root(service_dir: PurePath) -> Path:
    """Repository root for resolving relative paths and the shared ``.env``.

    In the repository the service lives at ``<repo>/services/intelligence``, so the root is two
    levels up. In a container image the service sits at a shallow path such as ``/app`` where
    there is no such parent; then the service directory itself is used.
    """
    parents = service_dir.parents
    return Path(parents[1] if len(parents) > 1 else service_dir)


_SERVICE_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = _find_repo_root(_SERVICE_DIR)

AppEnv = Literal["development", "test", "production"]
LogLevel = Literal["silent", "critical", "error", "warning", "info", "debug"]

# The Node apps use "warn"; accept it so one shared LOG_LEVEL works everywhere.
_LOG_LEVEL_ALIASES = {"warn": "warning", "fatal": "critical"}
_HOST_PATTERN = re.compile(r"^[A-Za-z0-9.:\-_]+$")


class ConfigurationError(Exception):
    """Raised when settings are invalid. ``issues`` never contain supplied values."""

    def __init__(self, issues: list[str]) -> None:
        self.issues = issues
        super().__init__("Invalid configuration:\n" + "\n".join(f"  - {i}" for i in issues))


class Settings(BaseSettings):
    """Service settings, validated at startup."""

    model_config = SettingsConfigDict(
        # Later files override earlier ones; process environment overrides both.
        env_file=(_REPO_ROOT / ".env", _SERVICE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",  # the shared root .env also holds variables for the Node apps
        populate_by_name=True,
    )

    app_env: Annotated[AppEnv, Field(validation_alias="APP_ENV")] = "development"
    host: Annotated[
        str, Field(validation_alias="ML_SERVICE_HOST", min_length=1, max_length=253)
    ] = "127.0.0.1"
    port: Annotated[int, Field(validation_alias="ML_SERVICE_PORT", ge=1, le=65535)] = 8000
    log_level: Annotated[LogLevel, Field(validation_alias="LOG_LEVEL")] = "info"
    model_dir: Annotated[Path, Field(validation_alias="ML_MODEL_DIR")] = Path("./models/artifacts")
    request_timeout_s: Annotated[
        float, Field(validation_alias="ML_REQUEST_TIMEOUT_S", gt=0, le=300)
    ] = 30.0
    max_body_bytes: Annotated[
        int, Field(validation_alias="ML_MAX_BODY_BYTES", ge=1024, le=10_485_760)
    ] = 1_048_576

    @field_validator("log_level", mode="before")
    @classmethod
    def _normalise_log_level(cls, value: object) -> object:
        if isinstance(value, str):
            lowered = value.strip().lower()
            return _LOG_LEVEL_ALIASES.get(lowered, lowered)
        return value

    @field_validator("host")
    @classmethod
    def _validate_host(cls, value: str) -> str:
        if not _HOST_PATTERN.fullmatch(value):
            raise ValueError("must be a hostname or IP address")
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def model_dir_resolved(self) -> Path:
        """Absolute model directory. Relative values resolve from the repository root."""
        path = self.model_dir.expanduser()
        return path if path.is_absolute() else (_REPO_ROOT / path).resolve()


# Variable names used in error messages (never the values).
_ENV_NAMES = {
    "app_env": "APP_ENV",
    "host": "ML_SERVICE_HOST",
    "port": "ML_SERVICE_PORT",
    "log_level": "LOG_LEVEL",
    "model_dir": "ML_MODEL_DIR",
    "request_timeout_s": "ML_REQUEST_TIMEOUT_S",
    "max_body_bytes": "ML_MAX_BODY_BYTES",
}


def load_settings(**overrides: object) -> Settings:
    """Build and validate settings, raising :class:`ConfigurationError` on any problem."""
    try:
        return Settings(**overrides)  # type: ignore[arg-type]
    except ValidationError as exc:
        issues: list[str] = []
        for error in exc.errors():
            location = error.get("loc", ())
            field = str(location[0]) if location else "settings"
            name = _ENV_NAMES.get(field, field)
            issues.append(f"{name} is invalid: {error.get('msg', 'invalid value')}.")
        raise ConfigurationError(issues) from None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings (cached)."""
    return load_settings()

"""Health and readiness response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Liveness: the FastAPI process is running. Says nothing about models."""

    status: Literal["ok"]
    service: str
    version: str
    uptime_seconds: int


class ApplicationStatus(BaseModel):
    available: bool


class ArtifactDirectoryStatus(BaseModel):
    configured: bool
    exists: bool


class ModelsStatus(BaseModel):
    loaded: bool
    loaded_count: int
    artifact_directory: ArtifactDirectoryStatus
    reason: str


class Capabilities(BaseModel):
    """Each capability is True only when a real, validated model backs it."""

    forecasting: bool
    risk_analysis: bool
    scenario_simulation: bool
    allocation: bool


class ReadinessResponse(BaseModel):
    """Readiness for ML work, distinct from process liveness."""

    status: Literal["ready", "not_ready"]
    service: str
    version: str
    model_ready: bool
    application: ApplicationStatus
    models: ModelsStatus
    capabilities: Capabilities

"""Operational endpoints.

``GET /health``  Liveness. 200 whenever the FastAPI process is running. It makes no claim
                 about models or data.
``GET /ready``   Readiness for ML work.
                   * 200 ``status: ready``      only when validated models are loaded.
                   * 503 ``status: not_ready``  the process is up, but ML capabilities are not
                                                available (always the case in Milestone 7).
                 The body is identical in shape for both statuses and explains why.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import SERVICE_NAME, SERVICE_VERSION
from app.core.model_registry import ModelRegistry
from app.schemas.health import (
    ApplicationStatus,
    ArtifactDirectoryStatus,
    Capabilities,
    HealthResponse,
    ModelsStatus,
    ReadinessResponse,
)

router = APIRouter(tags=["operations"])

_STARTED_AT = time.monotonic()


# HEAD is answered like GET (without a body) so simple probes and load balancers work. It is
# a separate, schema-hidden route so each operation id in the OpenAPI document stays unique.
@router.head("/health", include_in_schema=False)
@router.get("/health", response_model=HealthResponse, summary="Liveness")
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        uptime_seconds=int(time.monotonic() - _STARTED_AT),
    )


@router.head("/ready", include_in_schema=False)
@router.get(
    "/ready",
    response_model=ReadinessResponse,
    summary="Readiness for ML work",
    responses={503: {"model": ReadinessResponse, "description": "Process up, ML not ready."}},
)
def ready(request: Request) -> JSONResponse:
    registry: ModelRegistry = request.app.state.model_registry
    snapshot = registry.snapshot()
    models_loaded = snapshot.models_loaded

    # Every capability is False until a real validated model backs it. No capability is
    # derived from the mere existence of files or configuration.
    capabilities = Capabilities(
        forecasting=False,
        risk_analysis=False,
        scenario_simulation=False,
        allocation=False,
    )

    body = ReadinessResponse(
        status="ready" if models_loaded else "not_ready",
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        model_ready=models_loaded,
        application=ApplicationStatus(available=True),
        models=ModelsStatus(
            loaded=models_loaded,
            loaded_count=snapshot.loaded_count,
            artifact_directory=ArtifactDirectoryStatus(
                configured=snapshot.artifact_directory_configured,
                exists=snapshot.artifact_directory_exists,
            ),
            reason=snapshot.reason,
        ),
        capabilities=capabilities,
    )
    return JSONResponse(status_code=200 if models_loaded else 503, content=body.model_dump())

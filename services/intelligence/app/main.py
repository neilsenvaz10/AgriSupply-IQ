"""Application factory.

``create_app`` builds the service without binding a port, so tests can drive it in-process.
The process entry point is ``python -m app`` (see ``app/__main__.py``).

This is an INTERNAL service reached through the Express gateway. It intentionally installs
no CORS middleware: browsers must never call it directly.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import health
from app.config import SERVICE_NAME, SERVICE_VERSION, Settings, get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging
from app.core.middleware import install_request_guard
from app.core.model_registry import ModelRegistry

logger = logging.getLogger("app")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        snapshot = app.state.model_registry.snapshot()
        logger.info(
            "service starting",
            extra={
                "service": SERVICE_NAME,
                "version": SERVICE_VERSION,
                "env": settings.app_env,
                "host": settings.host,
                "port": settings.port,
                "modelsLoaded": snapshot.loaded_count,
                "artifactDirectoryExists": snapshot.artifact_directory_exists,
            },
        )
        yield
        logger.info("service stopped")

    app = FastAPI(
        title="FASALYTICS Intelligence Service",
        version=SERVICE_VERSION,
        description="Internal forecasting, risk, scenario and allocation service (foundation).",
        # Interactive docs are a development convenience only.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.model_registry = ModelRegistry(settings.model_dir_resolved)

    register_error_handlers(app)
    install_request_guard(app, settings)
    app.include_router(health.router)
    return app

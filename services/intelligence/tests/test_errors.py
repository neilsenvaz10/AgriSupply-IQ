from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.logging import redact_secrets


def test_unknown_route_uses_the_error_contract(client: TestClient) -> None:
    response = client.get("/definitely/not/here")

    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {
        "error": {
            "code": "NOT_FOUND",
            "message": "The requested resource was not found.",
            "requestId": response.headers["x-request-id"],
        }
    }


def test_validation_errors_do_not_echo_submitted_values(make_app: Callable[..., FastAPI]) -> None:
    app = make_app()

    @app.get("/probe/{count}")
    def probe(count: int) -> dict[str, int]:  # pragma: no cover - never reached
        return {"count": count}

    with TestClient(app) as client:
        response = client.get("/probe/secret-value")

    body = response.json()
    assert response.status_code == 422
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["details"][0]["field"].endswith("count")
    assert "secret-value" not in response.text


def test_unexpected_errors_become_a_generic_500_without_leaking(
    make_app: Callable[..., FastAPI], caplog: pytest.LogCaptureFixture
) -> None:
    app = make_app()

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("db password is hunter2 at C:/srv/app/secret.py:12")

    with TestClient(app, raise_server_exceptions=False) as client, caplog.at_level(logging.ERROR):
        response = client.get("/boom")

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert response.json()["error"]["message"] == "An unexpected error occurred."
    for leaked in ("hunter2", "secret.py", "Traceback", "RuntimeError"):
        assert leaked not in response.text
    assert response.headers["x-request-id"]


def test_oversized_declared_bodies_are_rejected_before_routing(
    make_app: Callable[..., FastAPI],
) -> None:
    with TestClient(make_app(max_body_bytes=1024)) as client:
        response = client.post("/health", content=b"x" * 2048)

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_slow_handlers_are_cut_off_with_503(make_app: Callable[..., FastAPI]) -> None:
    app = make_app(request_timeout_s=0.1)

    @app.get("/slow")
    async def slow() -> dict[str, bool]:
        await asyncio.sleep(2)
        return {"late": True}

    with TestClient(app) as client:
        response = client.get("/slow")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "REQUEST_TIMEOUT"


def test_interactive_docs_are_available_in_development_only(
    make_app: Callable[..., FastAPI],
) -> None:
    with TestClient(make_app(app_env="development")) as dev:
        assert dev.get("/openapi.json").status_code == 200
    with TestClient(make_app(app_env="production")) as prod:
        assert prod.get("/openapi.json").status_code == 404
        assert prod.get("/docs").status_code == 404


def test_no_forecast_or_market_endpoints_exist(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]

    assert set(paths) == {"/health", "/ready"}


def test_url_credentials_are_redacted_from_log_text() -> None:
    assert (
        redact_secrets("connect failed postgres://admin:pw123@db:5432/app")
        == "connect failed postgres://[redacted]@db:5432/app"
    )

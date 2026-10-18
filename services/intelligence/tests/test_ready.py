from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

CAPABILITIES = ("forecasting", "risk_analysis", "scenario_simulation", "allocation")


def test_ready_distinguishes_the_process_from_ml_readiness(client: TestClient) -> None:
    response = client.get("/ready")

    assert response.status_code == 503  # process up, ML not ready
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["application"] == {"available": True}
    assert body["model_ready"] is False
    assert body["models"]["loaded"] is False
    assert body["models"]["loaded_count"] == 0


def test_ready_never_claims_a_capability_without_a_model(client: TestClient) -> None:
    capabilities = client.get("/ready").json()["capabilities"]

    assert set(capabilities) == set(CAPABILITIES)
    assert not any(capabilities.values())


def test_ready_reports_a_missing_artifact_directory(client: TestClient) -> None:
    models = client.get("/ready").json()["models"]

    assert models["artifact_directory"] == {"configured": True, "exists": False}
    assert "does not exist" in models["reason"]


def test_an_existing_empty_artifact_directory_is_not_a_loaded_model(
    make_app: Callable[..., FastAPI], tmp_path: Path
) -> None:
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()

    with TestClient(make_app(model_dir=artifacts)) as client:
        response = client.get("/ready")

    body = response.json()
    assert body["models"]["artifact_directory"]["exists"] is True
    assert body["models"]["loaded"] is False
    assert response.status_code == 503


def test_a_file_in_the_artifact_directory_is_not_a_loaded_model(
    make_app: Callable[..., FastAPI], tmp_path: Path
) -> None:
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    (artifacts / "price_model.bin").write_bytes(b"not a validated model")

    with TestClient(make_app(model_dir=artifacts)) as client:
        response = client.get("/ready")

    body = response.json()
    assert body["model_ready"] is False
    assert body["models"]["loaded_count"] == 0
    assert not any(body["capabilities"].values())
    assert response.status_code == 503


def test_ready_does_not_expose_filesystem_paths(client: TestClient, tmp_path: Path) -> None:
    text = client.get("/ready").text

    assert str(tmp_path) not in text
    assert "artifacts" not in text.replace("artifact_directory", "")


def test_ready_has_the_documented_shape(client: TestClient) -> None:
    body = client.get("/ready").json()

    assert set(body) == {
        "status",
        "service",
        "version",
        "model_ready",
        "application",
        "models",
        "capabilities",
    }
    assert body["service"] == "fasalytics-intelligence"

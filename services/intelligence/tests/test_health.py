from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_reports_liveness(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "fasalytics-intelligence"
    assert body["version"] == "0.1.0"
    assert isinstance(body["uptime_seconds"], int)


def test_health_makes_no_claim_about_models(client: TestClient) -> None:
    text = client.get("/health").text.lower()

    for word in ("model", "forecast", "ready", "loaded", "postgres", "database"):
        assert word not in text


def test_health_sets_a_request_id_header(client: TestClient) -> None:
    response = client.get("/health")

    assert len(response.headers["x-request-id"]) == 36


def test_health_echoes_a_safe_client_request_id(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-Id": "client-req-12345"})

    assert response.headers["x-request-id"] == "client-req-12345"


def test_health_replaces_an_unsafe_client_request_id(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-Id": "bad id<script>"})

    assert "script" not in response.headers["x-request-id"]
    assert len(response.headers["x-request-id"]) == 36


def test_health_supports_head(client: TestClient) -> None:
    assert client.head("/health").status_code == 200


def test_health_has_no_cors_headers(client: TestClient) -> None:
    """The service is internal; browsers must not be granted cross-origin access."""
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})

    assert "access-control-allow-origin" not in response.headers


def test_health_rejects_other_methods_with_the_error_contract(client: TestClient) -> None:
    response = client.post("/health", json={})

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "METHOD_NOT_ALLOWED"

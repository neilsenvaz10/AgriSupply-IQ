"""Request-id propagation contract (the Express API forwards X-Request-Id to this service)."""

from __future__ import annotations

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.core.logging import JsonFormatter, request_id_var


@pytest.mark.parametrize("path", ["/health", "/ready"])
def test_the_supplied_id_is_returned_on_liveness_and_readiness(
    client: TestClient, path: str
) -> None:
    response = client.get(path, headers={"X-Request-Id": "express-trace-0001"})

    assert response.headers["x-request-id"] == "express-trace-0001"


def test_the_supplied_id_appears_in_structured_error_bodies(client: TestClient) -> None:
    response = client.get("/nope", headers={"X-Request-Id": "express-trace-0002"})

    assert response.status_code == 404
    assert response.json()["error"]["requestId"] == "express-trace-0002"
    assert response.headers["x-request-id"] == "express-trace-0002"


@pytest.mark.parametrize(
    "bad",
    ["short", "x" * 65, "has space in it", "semi;colon-id-1", "tab\tseparated-id"],
)
def test_unacceptable_ids_are_replaced_not_echoed(client: TestClient, bad: str) -> None:
    response = client.get("/health", headers={"X-Request-Id": bad})

    returned = response.headers["x-request-id"]
    assert returned != bad
    assert len(returned) == 36


def test_log_lines_carry_the_request_id_and_no_credentials() -> None:
    token = request_id_var.set("express-trace-0003")
    try:
        record = logging.LogRecord(
            "app.test", logging.INFO, __file__, 1, "dsn postgresql://u:hunter2@db:5432/x", (), None
        )
        line = json.loads(JsonFormatter().format(record))
    finally:
        request_id_var.reset(token)

    assert line["requestId"] == "express-trace-0003"
    assert "hunter2" not in json.dumps(line)

"""Startup and shutdown against a real network socket (no TestClient shortcuts)."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

import httpx2 as httpx
import pytest
import uvicorn

from app.config import Settings
from app.main import create_app

SERVICE_DIR = Path(__file__).resolve().parents[1]


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def test_real_server_starts_serves_and_shuts_down_gracefully(
    make_settings: Callable[..., Settings],
) -> None:
    port = _free_port()
    config = uvicorn.Config(
        create_app(make_settings(port=port)),
        host="127.0.0.1",
        port=port,
        log_config=None,
        access_log=False,
        timeout_graceful_shutdown=5,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    assert server.started, "server did not start in time"

    try:
        health = httpx.get(f"http://127.0.0.1:{port}/health", timeout=3)
        ready = httpx.get(f"http://127.0.0.1:{port}/ready", timeout=3)
    finally:
        server.should_exit = True
        thread.join(timeout=10)

    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert ready.status_code == 503
    assert ready.json()["model_ready"] is False
    assert not thread.is_alive(), "server did not shut down"

    with pytest.raises(httpx.TransportError):
        httpx.get(f"http://127.0.0.1:{port}/health", timeout=1)


def test_entry_point_refuses_to_start_with_invalid_configuration() -> None:
    env = {**os.environ, "ML_SERVICE_PORT": "99999-not-a-port", "APP_ENV": "development"}

    result = subprocess.run(
        [sys.executable, "-m", "app"],
        cwd=SERVICE_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 1
    assert "ML_SERVICE_PORT" in result.stderr
    assert "99999-not-a-port" not in result.stderr
    assert "Traceback" not in result.stderr

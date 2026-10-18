"""Shared fixtures.

Tests never read the developer's real ``.env`` files: settings are built with
``_env_file=None`` and explicit values.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def make_settings(tmp_path: Path) -> Callable[..., Settings]:
    def _make(**overrides: object) -> Settings:
        values: dict[str, object] = {
            "app_env": "test",
            "host": "127.0.0.1",
            "port": 8000,
            "log_level": "silent",
            # An isolated directory that does not exist unless a test creates it.
            "model_dir": tmp_path / "artifacts",
        }
        values.update(overrides)
        return Settings(_env_file=None, **values)  # type: ignore[arg-type]

    return _make


@pytest.fixture
def make_app(make_settings: Callable[..., Settings]) -> Callable[..., FastAPI]:
    def _make(**overrides: object) -> FastAPI:
        return create_app(make_settings(**overrides))

    return _make


@pytest.fixture
def client(make_app: Callable[..., FastAPI]):
    with TestClient(make_app()) as test_client:
        yield test_client

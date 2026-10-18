from __future__ import annotations

from pathlib import Path, PurePosixPath

import pytest

from app.config import ConfigurationError, Settings, _find_repo_root, load_settings

ENV_VARS = (
    "APP_ENV",
    "ML_SERVICE_HOST",
    "ML_SERVICE_PORT",
    "LOG_LEVEL",
    "ML_MODEL_DIR",
    "ML_REQUEST_TIMEOUT_S",
    "ML_MAX_BODY_BYTES",
)


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def test_defaults_are_safe_for_local_development() -> None:
    settings = Settings(_env_file=None)

    assert settings.host == "127.0.0.1"
    assert settings.port == 8000
    assert settings.app_env == "development"
    assert settings.log_level == "info"
    assert settings.is_production is False


def test_configuration_does_not_require_models_or_a_database(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, model_dir=tmp_path / "does" / "not" / "exist")

    assert not settings.model_dir_resolved.exists()


def test_values_are_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ML_SERVICE_HOST", "0.0.0.0")
    monkeypatch.setenv("ML_SERVICE_PORT", "9100")
    monkeypatch.setenv("LOG_LEVEL", "debug")
    monkeypatch.setenv("ML_REQUEST_TIMEOUT_S", "12.5")

    settings = Settings(_env_file=None)

    assert settings.app_env == "production"
    assert settings.host == "0.0.0.0"
    assert settings.port == 9100
    assert settings.log_level == "debug"
    assert settings.request_timeout_s == 12.5
    assert settings.is_production is True


def test_node_style_warn_log_level_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    """LOG_LEVEL is shared with the Node apps, which use "warn"."""
    monkeypatch.setenv("LOG_LEVEL", "warn")

    assert Settings(_env_file=None).log_level == "warning"


def test_unrelated_variables_in_a_shared_env_file_are_ignored(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("API_PORT=4000\nDATABASE_URL=postgres://u:p@h/db\nML_SERVICE_PORT=8123\n")

    settings = Settings(_env_file=env_file)

    assert settings.port == 8123


def test_relative_model_dir_resolves_from_the_repository_root() -> None:
    resolved = Settings(_env_file=None, model_dir=Path("./models/artifacts")).model_dir_resolved

    assert resolved.is_absolute()
    assert resolved.parts[-2:] == ("models", "artifacts")
    assert "services" not in resolved.parts[-3:]


@pytest.mark.parametrize(
    ("variable", "value"),
    [
        ("ML_SERVICE_PORT", "0"),
        ("ML_SERVICE_PORT", "65536"),
        ("ML_SERVICE_PORT", "eighty"),
        ("APP_ENV", "staging"),
        ("LOG_LEVEL", "loud"),
        ("ML_SERVICE_HOST", "bad host!"),
        ("ML_REQUEST_TIMEOUT_S", "-7.25"),
        ("ML_REQUEST_TIMEOUT_S", "9999"),
        ("ML_MAX_BODY_BYTES", "77"),
    ],
)
def test_invalid_values_are_rejected_naming_the_variable_only(
    monkeypatch: pytest.MonkeyPatch, variable: str, value: str
) -> None:
    monkeypatch.setenv(variable, value)

    with pytest.raises(ConfigurationError) as caught:
        load_settings(_env_file=None)

    message = str(caught.value)
    assert variable in message
    assert value not in message.replace(variable, "")


def test_all_problems_are_reported_together(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ML_SERVICE_PORT", "nope")
    monkeypatch.setenv("APP_ENV", "staging")

    with pytest.raises(ConfigurationError) as caught:
        load_settings(_env_file=None)

    assert len(caught.value.issues) == 2


def test_repo_root_is_two_levels_above_the_service_in_the_repository() -> None:
    assert _find_repo_root(PurePosixPath("/work/fasalytics/services/intelligence")) == Path(
        "/work/fasalytics"
    )


def test_repo_root_falls_back_to_the_service_dir_in_a_shallow_container_path() -> None:
    """In the container image the service is at /app, which has no grandparent directory."""
    assert _find_repo_root(PurePosixPath("/app")) == Path("/app")

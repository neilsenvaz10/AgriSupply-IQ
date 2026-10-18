"""Model registry: the single source of truth for "are models loaded?".

Milestone 7 has no model loader, so nothing can ever be reported as loaded. The registry
nonetheless inspects the configured artifact directory so that readiness output is truthful
about WHY no model is available.

A file sitting in the artifact directory is NOT a loaded model. A model becomes "loaded" only
when a future loader has deserialised it AND validated it against its evaluation record
(see ``app/artifacts``). Until then ``loaded_count`` stays 0.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RegistrySnapshot:
    artifact_directory_configured: bool
    artifact_directory_exists: bool
    loaded_count: int
    reason: str

    @property
    def models_loaded(self) -> bool:
        return self.loaded_count > 0


class ModelRegistry:
    """Tracks validated, loaded models. Empty by construction in Milestone 7."""

    def __init__(self, artifact_dir: Path | None) -> None:
        self._artifact_dir = artifact_dir
        # name -> validated model object. Populated only by a future validated loader.
        self._loaded: dict[str, object] = {}

    def snapshot(self) -> RegistrySnapshot:
        configured = self._artifact_dir is not None
        exists = bool(configured and self._artifact_dir is not None and self._artifact_dir.is_dir())
        loaded = len(self._loaded)

        if loaded > 0:
            reason = "validated models are loaded"
        elif not configured:
            reason = "no model artifact directory is configured"
        elif not exists:
            reason = "the model artifact directory does not exist and no models are loaded"
        else:
            reason = "no validated model loader is implemented yet, so no models are loaded"

        return RegistrySnapshot(
            artifact_directory_configured=configured,
            artifact_directory_exists=exists,
            loaded_count=loaded,
            reason=reason,
        )

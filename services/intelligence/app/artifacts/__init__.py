"""EXTENSION POINT: model artifact management (Phase 3). Nothing is implemented in Milestone 7.

Responsibility
    Versioned, validated model artifacts under ``ML_MODEL_DIR`` (outside version control).
    Each artifact ships with metadata: training data snapshot, feature schema, evaluation
    record, creation time and a checksum.

Loading contract (to be enforced by ``app.core.model_registry``)
    1. Verify the checksum and feature schema.
    2. Require a passing evaluation record.
    3. Only then register the model as "loaded".

A file in the artifact directory is never, by itself, a loaded model.
"""

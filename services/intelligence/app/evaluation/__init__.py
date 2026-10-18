"""EXTENSION POINT: model evaluation (Phase 3). Nothing is implemented in Milestone 7.

Responsibility
    Rolling-origin backtests and the evaluation records that decide whether a series may be
    forecast: MAE, RMSE, WAPE, directional accuracy, interval coverage, per horizon, per
    commodity and per market, always compared with a naive baseline.

Rules
    * Splits are chronological; never shuffle time series.
    * Publish weaknesses as well as successes.
    * An evaluation record (not a model file) is what makes a model eligible to be loaded.
"""

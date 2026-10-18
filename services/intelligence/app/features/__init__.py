"""EXTENSION POINT: feature engineering (Phase 3). Nothing is implemented in Milestone 7.

Responsibility
    Build features available AT the forecast cutoff: price lags, rolling statistics, calendar
    and seasonal terms, and arrival features at their true granularity.

Rules
    * No target leakage: the latest feature timestamp must be <= the forecast cutoff, and this
      must be asserted in tests.
    * Missingness is a feature, not something to hide: do not silently impute.
    * Commodity-agnostic: features are derived from the series, not from crop names.
"""

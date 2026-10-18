"""EXTENSION POINT: forecasting (Phase 3). Nothing is implemented in Milestone 7.

Responsibility
    1-7 day modal-price forecasts with uncertainty, for series that pass eligibility AND
    backtesting.

Rules
    * Baselines first (persistence, seasonal naive). A model is used only if it beats the
      baseline on held-out, time-ordered data; otherwise report the baseline or "unavailable".
    * No endpoint may return a forecast without ``model_version``, ``generated_at``,
      ``last_observed_date`` and an honestly defined uncertainty interval.
    * Never return placeholder or synthetic predictions. "Unavailable, because ..." is a
      valid and required answer.
    * Heavy dependencies (pandas, scikit-learn, XGBoost) are added only when this package is
      actually implemented.
"""

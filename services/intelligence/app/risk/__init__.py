"""EXTENSION POINT: risk analysis (Phase 4). Nothing is implemented in Milestone 7.

Responsibility
    Transparent, evidence-linked signals: price volatility, downside scenarios, arrival
    changes, data staleness, forecast reliability.

Rules
    * Every signal carries its evidence, threshold and a failure state.
    * No arbitrary weighted "risk score" presented as a calibrated probability.
    * Correlation is not causation: weather and arrivals are described, not asserted as causes.
"""

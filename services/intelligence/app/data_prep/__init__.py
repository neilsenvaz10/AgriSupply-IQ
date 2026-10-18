"""EXTENSION POINT: data preparation (Phase 2/3). Nothing is implemented in Milestone 7.

Responsibility
    Turn canonical market observations (read through the API/database, never the raw CSVs
    directly) into clean, leakage-safe series per (commodity, market) and per
    (commodity, state), keeping geographic and temporal granularity explicit.

Rules every implementation must follow (see PROJECT.md section 4)
    * Never fabricate observations and never interpolate long gaps.
    * Mandi-level, state-level and national records are different things: do not blend them.
    * State-level arrivals are never presented as mandi-level arrivals.
    * Carry provenance (source file, reporting date, units) through every transformation.
    * Do not hardcode any state, commodity or mandi.
"""

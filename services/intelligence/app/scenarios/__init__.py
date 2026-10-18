"""EXTENSION POINT: what-if scenarios (Phase 8). Nothing is implemented in Milestone 7.

Responsibility
    Deterministic recalculation of a stored baseline under bounded parameter changes
    (for example transport cost +20%, a price shock, holding for N days).

Rules
    * Scenario values are hypothetical and never overwrite observed data.
    * Apply a price shock to GROSS revenue before costs, not to a net figure.
    * Storage, spoilage and transport parameters are labelled assumptions unless verified.
    * The LLM explains results; it never computes them.
"""

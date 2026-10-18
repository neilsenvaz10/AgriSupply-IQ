"""EXTENSION POINT: harvest allocation (Phase 6). Nothing is implemented in Milestone 7.

Responsibility
    Constrained optimisation of how a harvest is split across eligible mandis and days,
    always compared with the best single-mandi baseline.

Rules
    * Allocations never exceed stock, are non-negative and respect only EVIDENCED capacity.
    * Include fixed trip costs; 100% to one market is a valid optimum.
    * Do not invent crowding, capacity or arrival information.
"""

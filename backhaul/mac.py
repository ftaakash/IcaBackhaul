"""MAC comparison: 802.11 CSMA/CA (with hidden nodes) vs WORP token passing.

Times are in backoff slots. A frame occupies `payload + overhead` slots; overhead
covers preamble, SIFS, ACK and DIFS. Only `payload` slots count as useful airtime.
"""
from __future__ import annotations

import numpy as np


def simulate_csma(n_stations: int, n_frames: int = 20_000, payload: int = 20, overhead: int = 8,
                  cw_min: int = 16, cw_max: int = 1024, hidden_frac: float = 0.0,
                  seed: int = 0) -> float:
    """Saturated CSMA/CA with binary exponential backoff.

    hidden_frac: probability that any two stations cannot hear each other (outdoor
    directional antennas). A hidden station keeps counting down during another's
    frame and collides with it if its backoff expires mid-frame.
    Returns normalised useful throughput (0..1).
    """
    rng = np.random.default_rng(seed)
    n = n_stations
    frame = payload + overhead
    cw = np.full(n, cw_min)
    backoff = rng.integers(0, cw)
    hidden = rng.random((n, n)) < hidden_frac
    hidden = np.triu(hidden, 1)
    hidden = hidden | hidden.T
    t = 0
    successes = 0
    attempts = 0
    while attempts < n_frames:
        m = backoff.min()
        t += m
        backoff -= m
        tx = np.flatnonzero(backoff == 0)
        attempts += 1
        if len(tx) == 1:
            s = tx[0]
            others = np.flatnonzero(hidden[s])
            fire = others[backoff[others] < frame] if len(others) else others
            if len(fire) == 0:
                successes += 1
                cw[s] = cw_min
                if len(others):
                    backoff[others] -= frame  # hidden stations kept counting
                    backoff[others] = np.maximum(backoff[others], 0)
                failed = np.array([], dtype=int)
            else:
                failed = np.concatenate(([s], fire))
        else:
            failed = tx
        for f in failed:
            cw[f] = min(cw[f] * 2, cw_max)
        for s in (tx if len(failed) == 0 else failed):
            backoff[s] = rng.integers(0, cw[s]) + 1
        t += frame
    return successes * payload / t


def simulate_worp(n_stations: int, n_frames: int = 20_000, payload: int = 20,
                  poll_overhead: float = 6.67) -> float:
    """Base station polls each subscriber in turn: no contention, no collisions.

    poll_overhead is calibrated so a saturated sector delivers ~75% of the radio
    rate, matching Proxim's published WORP figure. Efficiency is independent of
    the number of subscribers and of hidden nodes, which is the point.
    """
    del n_frames  # deterministic schedule
    if n_stations <= 0:
        return 0.0
    cycle = n_stations * (payload + poll_overhead)
    return n_stations * payload / cycle

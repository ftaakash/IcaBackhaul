"""RF engineering: link budget, Fresnel clearance, MCS/throughput tables."""
from __future__ import annotations

import math
from dataclasses import dataclass

# 2x2 VHT (802.11ac-style OFDM) PHY rates in Mbps, long guard interval.
# MCS9 is not defined at 20 MHz for 2 spatial streams.
PHY_RATE_MBPS: dict[int, list[float | None]] = {
    20: [13, 26, 39, 52, 78, 104, 117, 130, 156, None],
    40: [27, 54, 81, 108, 162, 216, 243, 270, 324, 360],
    80: [58.5, 117, 175.5, 234, 351, 468, 526.5, 585, 702, 780],
}
# Datasheet maximum throughput / top PHY rate -> MAC efficiency per width.
DATASHEET_MAX_MBPS = {20: 137.0, 40: 324.0, 80: 633.0}
MAC_EFFICIENCY = {w: DATASHEET_MAX_MBPS[w] / max(r for r in PHY_RATE_MBPS[w] if r) for w in PHY_RATE_MBPS}

# Approximate SINR (dB) needed for ~10% PER at each MCS (BPSK 1/2 ... 256-QAM 5/6).
SNR_THRESHOLD_DB = [5, 8, 11, 14, 18, 22, 24, 26, 30, 32]
MODULATION = ["BPSK 1/2", "QPSK 1/2", "QPSK 3/4", "16-QAM 1/2", "16-QAM 3/4",
              "64-QAM 2/3", "64-QAM 3/4", "64-QAM 5/6", "256-QAM 3/4", "256-QAM 5/6"]


def fspl_db(distance_km: float, freq_mhz: float) -> float:
    """Free-space path loss."""
    return 20 * math.log10(distance_km) + 20 * math.log10(freq_mhz) + 32.44


def noise_floor_dbm(bandwidth_mhz: float, noise_figure_db: float = 6.0) -> float:
    """Thermal noise kTB plus receiver noise figure."""
    return -174 + 10 * math.log10(bandwidth_mhz * 1e6) + noise_figure_db


def fresnel_radius_m(d1_km: float, d2_km: float, freq_ghz: float, zone: int = 1) -> float:
    return 17.32 * math.sqrt(zone * d1_km * d2_km / (freq_ghz * (d1_km + d2_km)))


def earth_bulge_m(d1_km: float, d2_km: float, k: float = 4 / 3) -> float:
    return d1_km * d2_km / (12.74 * k)


def required_mast_height_m(distance_km: float, freq_ghz: float, obstacle_m: float,
                           clearance: float = 0.6, k: float = 4 / 3) -> float:
    """Equal-height masts at both ends; worst case is an obstacle at mid-path.

    The beam must clear the obstacle + earth bulge + 60% of the first Fresnel zone.
    This is the "tower and antenna sizing" step the integrator performed.
    """
    half = distance_km / 2
    return obstacle_m + earth_bulge_m(half, half, k) + clearance * fresnel_radius_m(half, half, freq_ghz)


def power_sum_dbm(*levels_dbm: float) -> float:
    """Add powers expressed in dBm."""
    total_mw = sum(10 ** (l / 10) for l in levels_dbm if l is not None and l > -200)
    return 10 * math.log10(total_mw) if total_mw > 0 else -300.0


def best_mcs(sinr_db: float, width_mhz: int, margin_db: float = 3.0) -> int:
    """Highest MCS whose threshold plus margin is met (DDRS). -1 means no link."""
    best = -1
    for mcs, thr in enumerate(SNR_THRESHOLD_DB):
        if PHY_RATE_MBPS[width_mhz][mcs] is None:
            continue
        if sinr_db >= thr + margin_db:
            best = mcs
    return best


def packet_error_rate(sinr_db: float, mcs: int) -> float:
    """Logistic PER curve: ~50% at threshold - 1.5 dB, falling ~1.5x per dB."""
    if mcs < 0:
        return 1.0
    x = sinr_db - SNR_THRESHOLD_DB[mcs]
    return 1.0 / (1.0 + math.exp(1.5 * (x + 1.5)))


def mac_throughput_mbps(mcs: int, width_mhz: int) -> float:
    if mcs < 0:
        return 0.0
    rate = PHY_RATE_MBPS[width_mhz][mcs]
    return 0.0 if rate is None else rate * MAC_EFFICIENCY[width_mhz]


@dataclass
class LinkBudget:
    distance_km: float
    freq_mhz: float
    eirp_dbm: float
    fspl_db: float
    rx_dbm: float
    noise_dbm: float
    snr_db: float
    mcs: int
    throughput_mbps: float
    mast_height_m: float


def link_budget(distance_km: float, freq_mhz: float, width_mhz: int, tx_dbm: float,
                gain_dbi: float, cable_db: float = 0.5, nf_db: float = 6.0,
                extra_loss_db: float = 0.0, obstacle_m: float = 10.0,
                eirp_limit_dbm: float | None = None) -> LinkBudget:
    eirp = tx_dbm + gain_dbi - cable_db
    if eirp_limit_dbm is not None:
        eirp = min(eirp, eirp_limit_dbm)
    loss = fspl_db(distance_km, freq_mhz)
    rx = eirp - loss - extra_loss_db + gain_dbi - cable_db
    noise = noise_floor_dbm(width_mhz, nf_db)
    snr = rx - noise
    mcs = best_mcs(snr, width_mhz)
    return LinkBudget(distance_km, freq_mhz, eirp, loss, rx, noise, snr, mcs,
                      mac_throughput_mbps(mcs, width_mhz),
                      required_mast_height_m(distance_km, freq_mhz / 1000, obstacle_m))

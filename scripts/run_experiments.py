"""Reproducible experiments -> results/*.png, results/summary.json, results/link_budget.csv

    python scripts/run_experiments.py [--days 7] [--seeds 3]
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backhaul import Network, rf  # noqa: E402
from backhaul.mac import simulate_csma, simulate_worp  # noqa: E402

OUT = Path("results")
ORANGE, TEAL, GREY, INK = "#B5571A", "#2A6F7A", "#9AA5AE", "#14212B"
plt.rcParams.update({"font.size": 11, "axes.spines.top": False, "axes.spines.right": False})


def save(fig, name):
    fig.tight_layout()
    fig.savefig(OUT / name, dpi=150)
    plt.close(fig)


def e1_channel_width():
    widths = [20, 40, 80]
    vals = [rf.DATASHEET_MAX_MBPS[w] for w in widths]
    fig, ax = plt.subplots(figsize=(6, 4))
    bars = ax.bar([f"{w} MHz" for w in widths], vals, color=[GREY, ORANGE, INK])
    ax.bar_label(bars, fmt="%.0f")
    ax.axhline(320, ls="--", color=TEAL)
    ax.text(2.45, 330, "10100L licence cap (320)", ha="right", color=TEAL)
    ax.set_ylabel("Max throughput per link (Mbps)")
    ax.set_title("E1  Throughput vs channel width")
    save(fig, "e1_channel_width.png")
    return dict(zip(map(str, widths), vals))


def e2_mac():
    ns = [1, 2, 5, 10, 15, 20, 30, 40, 50]
    csma0 = [simulate_csma(n, hidden_frac=0.0, seed=n) for n in ns]
    csma3 = [simulate_csma(n, hidden_frac=0.3, seed=n) for n in ns]
    worp = [simulate_worp(n) for n in ns]
    fig, ax = plt.subplots(figsize=(6.5, 4))
    ax.plot(ns, [100 * v for v in worp], "-o", color=ORANGE, label="WORP token passing")
    ax.plot(ns, [100 * v for v in csma0], "-s", color=GREY, label="CSMA/CA, all nodes hear each other")
    ax.plot(ns, [100 * v for v in csma3], "-^", color=INK, label="CSMA/CA, 30% hidden pairs")
    ax.set_xlabel("Contending stations")
    ax.set_ylabel("Useful airtime (%)")
    ax.set_ylim(0, 100)
    ax.set_title("E2  MAC efficiency under contention")
    ax.legend(frameon=False)
    save(fig, "e2_mac_efficiency.png")
    return {"stations": ns, "worp": worp, "csma": csma0, "csma_hidden30": csma3}


def e3_clearconnect(days: int, seeds: int):
    rows = {"ClearConnect on": [], "Legacy (fixed rate, no DCS)": []}
    for s in range(seeds):
        for label, cc in (("ClearConnect on", True), ("Legacy (fixed rate, no DCS)", False)):
            net = Network(seed=100 + s, clearconnect=cc)
            net.run(days * 1440)
            k = net.kpis()
            rows[label].append({"availability": k["availability_pct"], "scada": k["scada_delivery_pct"],
                                "mean_delivered_mbps": float(np.mean(net.total_history)) if net.total_history else 0,
                                "dcs": k["dcs_events"]})
    summary = {}
    fig, axes = plt.subplots(1, 2, figsize=(9, 4))
    for ax, metric, title in ((axes[0], "availability", "Mean link availability (%)"),
                              (axes[1], "scada", "SCADA telemetry delivered (%)")):
        means = [np.mean([r[metric] for r in rows[k]]) for k in rows]
        errs = [np.std([r[metric] for r in rows[k]]) for k in rows]
        bars = ax.bar(["ClearConnect", "Legacy"], means, yerr=errs, color=[ORANGE, GREY], capsize=4)
        ax.bar_label(bars, fmt="%.2f")
        ax.set_ylim(min(means) - 8, 102.5)
        ax.set_title(title, pad=14)
    fig.suptitle(f"E3  Interference resilience, {days} days x {seeds} seeds")
    save(fig, "e3_clearconnect.png")
    for k, v in rows.items():
        summary[k] = {m: round(float(np.mean([r[m] for r in v])), 3) for m in v[0]}
    return summary


def e4_thermal():
    out = {}
    fig, ax = plt.subplots(figsize=(6.5, 4))
    for label, shield, heat, col in (("No shield", False, 0, INK), ("No shield + heatwave", False, 5, ORANGE),
                                     ("Sun shield + heatwave", True, 5, TEAL)):
        net = Network(seed=1, sun_shield=shield, month=2)
        net.env.heatwave_c = heat
        net.env.minute = 0
        temps = []
        for _ in range(1440):
            net.env.minute += 1
            temps.append(net.env.radio_temp_c())
        hours = np.arange(1440) / 60
        ax.plot(hours, temps, color=col, label=label)
        out[label] = {"peak_c": round(max(temps), 1), "minutes_over_60c": int(sum(t > 60 for t in temps))}
    ax.axhline(60, ls="--", color="#C0392B")
    ax.text(0.3, 61, "datasheet max 60 °C", color="#C0392B")
    ax.set_xlabel("Hour of day (March, Ica)")
    ax.set_ylabel("Radio enclosure temperature (°C)")
    ax.set_xlim(0, 24)
    ax.set_title("E4  Thermal stress and the sun-shield fix")
    ax.legend(frameon=False, loc="upper left", bbox_to_anchor=(0, 0.92))
    save(fig, "e4_thermal.png")
    return out


def e5_link_budget():
    net = Network(seed=7)
    rows = []
    for l in net.links:
        b = rf.link_budget(l.distance_km, l.channel.center, l.channel.width, l.max_tx_dbm, l.gain_dbi,
                           net.radio.cable_loss_db, net.radio.noise_figure_db, obstacle_m=l.site.obstacle_m,
                           eirp_limit_dbm=net.radio.eirp_limit_dbm)
        rows.append({"site": l.site.name, "km": l.distance_km, "channel": l.channel.label(),
                     "antenna_dbi": l.gain_dbi, "eirp_dbm": round(b.eirp_dbm, 1), "fspl_db": round(b.fspl_db, 1),
                     "rx_dbm": round(b.rx_dbm, 1), "snr_db": round(b.snr_db, 1), "clear_sky_mcs": b.mcs,
                     "mast_height_m": round(b.mast_height_m, 1)})
    with open(OUT / "link_budget.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    fig, ax = plt.subplots(figsize=(6.5, 4))
    ax.scatter([r["km"] for r in rows], [r["mast_height_m"] for r in rows], color=ORANGE)
    d = np.linspace(1, 14, 50)
    ax.plot(d, [rf.required_mast_height_m(x, 5.6, 0) for x in d], color=GREY,
            label="clearance only (no obstacle)")
    ax.set_xlabel("Link distance (km)")
    ax.set_ylabel("Required mast height (m)")
    ax.set_title("E5  Tower sizing: obstacle + earth bulge + 0.6 F1")
    ax.legend(frameon=False)
    save(fig, "e5_mast_height.png")
    return rows


def e6_hub_spectrum(days: int):
    """Is the licence upgrade worth it? Only if the hub has spectrum to spare."""
    configs = (("Today\n40 MHz, 320", False, 0.0), ("Licence only\n670, 80 MHz", True, 0.0),
               ("+20 dB hub\nisolation", False, 20.0), ("Isolation +\nlicence", True, 20.0))
    out, caps, avail = {}, [], []
    for label, up, iso in configs:
        net = Network(seed=21, licence_upgraded=up, hub_isolation_bonus_db=iso, demand_scale=3.0)
        samples = []
        for _ in range(days * 1440):
            net.step()
            samples.append(sum(l.capacity_mbps for l in net.links))
        k = net.kpis()
        cap = float(np.mean(samples))  # time-averaged total capacity
        caps.append(cap)
        avail.append(k["availability_pct"])
        key = label.replace("\n", " ")
        out[key] = {"total_capacity_mbps": round(cap), "availability_pct": k["availability_pct"],
                    "wide_links": [l.id + 1 for l in net.links if l.wide]}
    fig, ax = plt.subplots(figsize=(7.5, 4))
    bars = ax.bar([c[0] for c in configs], caps, color=[GREY, "#C0392B", TEAL, ORANGE])
    ax.bar_label(bars, labels=[f"{c:.0f} Mbps\n{a:.2f}% up" for c, a in zip(caps, avail)])
    ax.set_ylabel("Total backhaul capacity (Mbps)")
    ax.set_ylim(0, max(caps) * 1.25)
    ax.set_title("E6  The hub mast, not the licence, limits capacity")
    save(fig, "e6_hub_spectrum.png")
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--days", type=int, default=7)
    p.add_argument("--seeds", type=int, default=3)
    a = p.parse_args()
    OUT.mkdir(exist_ok=True)
    summary = {
        "e1_channel_width_mbps": e1_channel_width(),
        "e2_mac": e2_mac(),
        "e3_clearconnect": e3_clearconnect(a.days, a.seeds),
        "e4_thermal": e4_thermal(),
        "e5_link_budget": e5_link_budget(),
        "e6_hub_spectrum": e6_hub_spectrum(1),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({k: v for k, v in summary.items() if k not in ("e2_mac", "e5_link_budget")}, indent=2))


if __name__ == "__main__":
    main()

"""Regenerate src/data/results.ts from the simulator's experiment outputs.

    python scripts/run_experiments.py          # in the repo root, refreshes results/
    python story/scripts/export_results.py     # copies them into the story
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[1] / "src" / "data" / "results.ts"

data = json.loads((ROOT / "results" / "summary.json").read_text())
rows = list(csv.DictReader(open(ROOT / "results" / "link_budget.csv")))
for r in rows:
    for k in ("km", "antenna_dbi", "eirp_dbm", "fspl_db", "rx_dbm", "snr_db", "mast_height_m"):
        r[k] = float(r[k])
    r["clear_sky_mcs"] = int(r["clear_sky_mcs"])
data["e5_link_budget"] = rows

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("// Generated from results/ by story/scripts/export_results.py. Do not edit.\n"
               "export const PY = " + json.dumps(data, indent=1) + " as const;\n")
print(f"wrote {OUT}")

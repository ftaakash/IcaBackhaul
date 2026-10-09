// Statistical check of the TS port against the Python engine's published results.
// Python (results/summary.json, E3): ClearConnect 99.767 %, legacy 85.071 % (7 days x seeds 100-102).
import { Network, mastHeightM, fsplDb, SITES } from "../src/engine/engine.ts";

const DAYS = Number(process.argv[2] ?? 7);
for (const cc of [true, false]) {
  const av: number[] = [];
  for (let s = 0; s < 3; s++) {
    const n = new Network({ seed: 100 + s, clearconnect: cc });
    n.run(DAYS * 1440);
    av.push(n.kpis().availability);
  }
  const m = av.reduce((a, b) => a + b, 0) / av.length;
  console.log(cc ? "ClearConnect" : "Legacy", av.map((v) => v.toFixed(2)).join(" "), "mean", m.toFixed(2));
}
// Deterministic formulas must match Python exactly.
console.log("fspl 1km 5800", fsplDb(1, 5800).toFixed(2), "(python 107.71)");
console.log("mast", SITES.map((s) => mastHeightM(s.distanceKm, 5.6, s.obstacleM).toFixed(1)).join(" "));

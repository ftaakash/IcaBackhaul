# Fifteen Links Over Ica

A scroll-driven story of the Electro Dunas deployment. As you scroll, the narrative moves through fourteen chapters while a sticky stage beside it changes to a new live visualisation for each one.

**Open it:** [`dist/fifteen-links-over-ica.html`](dist/fifteen-links-over-ica.html) is a single self-contained page. Download it and open it in any browser; no server is needed.

| Chapter | What the stage shows | Interactive |
|---|---|---|
| Overview | Live radial map of the 15 links, traffic flowing to the data center | — |
| Ica | SENAMHI monthly temperature normals | — |
| Electro Dunas | Site roster and live offered load by traffic class | — |
| The problem | Live 5 GHz spectrum: third-party transmitters, DFS band, our channels | — |
| The radio | Throughput by channel width with the 320 / 670 Mbps licence lines | — |
| Survey | Side profile with Fresnel zone, earth bulge and mast height | pick any link |
| ClearConnect | Live network with channel hops and an event log | jam a link, toggle ClearConnect |
| Measured | Downtime per link per day, ClearConnect vs fixed rate | — |
| WORP | Useful airtime vs contending stations | pick station count |
| Security | Real AES-256-GCM frame sealed in the browser | seal, flip a bit, replay |
| Heat | Radio enclosure temperature through a March day | heatwave, sun shield |
| Outcome | The finished network, live | — |
| The next limit | Hub-mast capacity experiment | — |
| Sources | How to read the provenance tags | — |

## Where the numbers come from

Every figure on the page is tagged with its source: **Reported** (Proxim's case study), **Measured** (SENAMHI), **Datasheet**, **Simulated** (the Python engine in this repo) or **Live model** (the TypeScript port below).

- [`src/data/results.ts`](src/data/results.ts) is generated from `../results/` by `scripts/export_results.py`, so every chart in the "Simulated" chapters shows the repo's own experiment output.
- [`src/engine/engine.ts`](src/engine/engine.ts) is a line-for-line TypeScript port of `backhaul/`. Its constants and formulas are the same; only the random generator differs. `pnpm run validate` checks the port:

| Check | Python | TypeScript port |
|---|---|---|
| Availability with ClearConnect (7 days × 3 seeds) | 99.77 % | 99.68 % |
| Availability, fixed rate (same runs) | 85.07 % | 85.40 % |
| Path loss, 1 km at 5.8 GHz | 107.71 dB | 107.71 dB |
| Heat: peak / heatwave minutes over 60 °C / shielded peak | 57.7 / 218 / 52.4 | 57.7 / 218 / 52.4 |

The availability gaps are within run-to-run spread between seeds. Every deterministic result matches exactly.

## Build

```bash
cd story
pnpm install
pnpm run dev          # live development server
pnpm run typecheck
pnpm run validate     # TS engine vs Python results
pnpm run build        # → dist/fifteen-links-over-ica.html
```

After changing the simulator, refresh the data with `python scripts/run_experiments.py` from the repo root, then run `python story/scripts/export_results.py`.

**Stack:** React, TypeScript, Tailwind CSS, Canvas and SVG, built by Parcel into one inlined HTML file. The scaffold came from Anthropic's *web-artifacts-builder* skill, and the design system was cross-checked with *UI/UX Pro Max*. The live views draw to canvas at the display refresh rate. Chart values ease between states, and `prefers-reduced-motion` is respected.

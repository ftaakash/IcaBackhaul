import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTween } from "@/lib/motion";
import { PY } from "@/data/results";
import { ICA_HIGH, ICA_LOW, Environment, Rng, RADIO, SITES, fresnelRadiusM, earthBulgeM } from "@/engine/engine";

/** SVG drawn in real pixels, so text stays legible at any width. */
export function Frame({ children, label }: { children: (w: number, h: number) => ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setS({ w: r.width, h: r.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      {s.w > 0 && <svg width={s.w} height={s.h} viewBox={`0 0 ${s.w} ${s.h}`} role="img" aria-label={label}>{children(s.w, s.h)}</svg>}
    </div>
  );
}

const T = { fill: "var(--faint)", fontFamily: "var(--f-data)", fontSize: 11 } as const;
const TB = { fill: "var(--bone)", fontFamily: "var(--f-data)", fontSize: 12 } as const;
const linear = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
const pathOf = (pts: [number, number][]) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

/* ------------------------------------------------------------------ Ica climate */
export function ClimateChart({ on }: { on: boolean }) {
  const k = useTween(on ? 1 : 0, 1100, on, 0);
  return (
    <Frame label="Monthly average high and low temperatures in Ica, 1991 to 2020; March is hottest at 33.3 degrees.">
      {(w, h) => {
        const L = 44, R = w - 18, Tp = 28, B = h - 34;
        const x = linear(0, 11, L + 10, R - 10), y = linear(0, 40, B, Tp);
        const hi = ICA_HIGH.map((v, i) => [x(i), y(v * k)] as [number, number]);
        const lo = ICA_LOW.map((v, i) => [x(i), y(v * k)] as [number, number]);
        const area = pathOf(hi) + pathOf([...lo].reverse()).replace("M", "L") + "Z";
        return (
          <g>
            {[0, 10, 20, 30, 40].map((t) => (
              <g key={t}><line x1={L} x2={R} y1={y(t)} y2={y(t)} stroke="var(--rule)" /><text x={L - 8} y={y(t) + 4} textAnchor="end" style={T}>{t}°</text></g>
            ))}
            <path d={area} fill="var(--dune)" opacity={0.16} />
            <path d={pathOf(hi)} fill="none" stroke="var(--dune)" strokeWidth={2.5} />
            <path d={pathOf(lo)} fill="none" stroke="var(--dim)" strokeWidth={1.5} strokeDasharray="4 4" />
            {hi.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === 2 ? 5 : 2.5} fill={i === 2 ? "var(--dune)" : "var(--panel)"} stroke="var(--dune)" strokeWidth={1.5} />)}
            <text x={hi[2][0] + 10} y={hi[2][1] - 10} style={{ ...TB, fill: "var(--dune)" }}>33.3 °C March high</text>
            <text x={lo[6][0]} y={lo[6][1] + 20} textAnchor="middle" style={T}>10.6 °C winter lows</text>
            {MONTHS.map((m, i) => <text key={i} x={x(i)} y={B + 18} textAnchor="middle" style={T}>{m}</text>)}
          </g>
        );
      }}
    </Frame>
  );
}

/* ------------------------------------------------------------------ E1 channel width */
export function WidthBars({ on, highlight = 40 }: { on: boolean; highlight?: number }) {
  const vals = [20, 40, 80].map((w) => PY.e1_channel_width_mbps[String(w) as "20" | "40" | "80"]);
  const v = useTween(on ? vals : [0, 0, 0], 1000, on, [0, 0, 0]);
  return (
    <Frame label="Maximum throughput per link: 137 Mbps at 20 MHz, 324 at 40 MHz, 633 at 80 MHz; the 10100L licence caps usable throughput at 320 Mbps.">
      {(w, h) => {
        const L = 52, R = w - 20, Tp = 30, B = h - 40;
        const y = linear(0, 700, B, Tp), bw = Math.min(110, (R - L) / 5);
        const xs = [0, 1, 2].map((i) => L + ((R - L) * (i + 0.5)) / 3 - bw / 2);
        return (
          <g>
            {[0, 200, 400, 600].map((t) => <g key={t}><line x1={L} x2={R} y1={y(t)} y2={y(t)} stroke="var(--rule)" /><text x={L - 8} y={y(t) + 4} textAnchor="end" style={T}>{t}</text></g>)}
            <text x={L - 8} y={Tp - 12} textAnchor="end" style={T}>Mbps</text>
            {[20, 40, 80].map((wd, i) => (
              <g key={wd}>
                <rect x={xs[i]} y={y(v[i])} width={bw} height={Math.max(0, B - y(v[i]))} fill={wd === highlight ? "var(--signal)" : "var(--rule)"} />
                <text x={xs[i] + bw / 2} y={y(v[i]) - 8} textAnchor="middle" style={{ ...TB, fontSize: 14 }}>{Math.round(v[i])}</text>
                <text x={xs[i] + bw / 2} y={B + 20} textAnchor="middle" style={T}>{wd} MHz</text>
              </g>
            ))}
            <line x1={L} x2={R} y1={y(320)} y2={y(320)} stroke="var(--dune)" strokeWidth={1.5} strokeDasharray="6 4" />
            <text x={R} y={y(320) - 7} textAnchor="end" style={{ ...T, fill: "var(--dune)" }}>10100L licence: 320 Mbps usable</text>
            <line x1={L} x2={R} y1={y(670)} y2={y(670)} stroke="var(--dim)" strokeWidth={1} strokeDasharray="2 5" />
            <text x={R} y={y(670) - 7} textAnchor="end" style={T}>field upgrade by licence key: 670</text>
          </g>
        );
      }}
    </Frame>
  );
}

/* ------------------------------------------------------------------ Link profile (E5) */
export function LinkProfile({ index }: { index: number }) {
  const row = PY.e5_link_budget[index];
  const km = row.km, ghz = Number(row.channel.split("/")[0]) / 1000;
  const obstacle = SITES[index].obstacleM;
  const v = useTween([km, row.mast_height_m, obstacle, fresnelRadiusM(km / 2, km / 2, ghz), earthBulgeM(km / 2, km / 2)], 800);
  const [d, mast, obs, f1, bulge] = v;
  return (
    <Frame label={`Side profile of the ${row.site} link: ${km} km, masts ${row.mast_height_m} m, keeping 60 percent of the first Fresnel zone clear of a ${obstacle} m obstacle and the earth bulge.`}>
      {(w, h) => {
        const L = 48, R = w - 48, Tp = 30, B = h - 44;
        const yTop = Math.max(30, Math.ceil((mast + f1 + 3) / 10) * 10);
        const X = linear(0, d, L, R), Y = linear(-2, yTop, B, Tp + 14);
        const n = 48;
        const earth: [number, number][] = [], top: [number, number][] = [], f6t: [number, number][] = [], f6b: [number, number][] = [], ft: [number, number][] = [], fb: [number, number][] = [];
        for (let i = 0; i <= n; i++) {
          const s = (d * i) / n, b = (s * (d - s)) / (12.74 * (4 / 3));
          const beam = mast;
          const r = i === 0 || i === n ? 0 : 17.32 * Math.sqrt((s * (d - s)) / (ghz * d));
          earth.push([X(s), Y(b)]);
          top.push([X(s), Y(beam)]);
          ft.push([X(s), Y(beam + r)]); fb.push([X(s), Y(beam - r)]);
          f6t.push([X(s), Y(beam + 0.6 * r)]); f6b.push([X(s), Y(beam - 0.6 * r)]);
        }
        const mid = d / 2;
        const obsX = X(mid);
        const zone = pathOf(ft) + pathOf([...fb].reverse()).replace("M", "L") + "Z";
        const zone6 = pathOf(f6t) + pathOf([...f6b].reverse()).replace("M", "L") + "Z";
        return (
          <g>
            {Array.from({ length: yTop / 10 + 1 }, (_, j) => j * 10).map((t) => <g key={t}><line x1={L} x2={R} y1={Y(t)} y2={Y(t)} stroke="var(--rule)" /><text x={L - 8} y={Y(t) + 4} textAnchor="end" style={T}>{t} m</text></g>)}
            <path d={pathOf(earth) + `L${R},${B + 30}L${L},${B + 30}Z`} fill="var(--dune)" opacity={0.18} />
            <path d={pathOf(earth)} stroke="var(--dune)" strokeWidth={1.5} fill="none" />
            <rect x={obsX - 9} y={Y(bulge + obs)} width={18} height={Math.max(0, Y(bulge) - Y(bulge + obs))} fill="var(--dim)" opacity={0.55} />
            <text x={obsX} y={Y(bulge + obs) - 8} textAnchor="middle" style={T}>obstacle {obs.toFixed(0)} m</text>
            <path d={zone} fill="var(--signal)" opacity={0.08} stroke="var(--signal)" strokeOpacity={0.35} strokeDasharray="3 4" />
            <path d={zone6} fill="var(--signal)" opacity={0.16} />
            <line x1={L} x2={R} y1={Y(mast)} y2={Y(mast)} stroke="var(--signal)" strokeWidth={2} />
            <text x={(L + R) / 2} y={Y(mast + f1) - 8} textAnchor="middle" style={{ ...T, fill: "var(--signal)" }}>1st Fresnel zone, r = {f1.toFixed(1)} m at midpoint · inner band: 60% kept clear</text>
            {[L, R].map((mx, i) => (
              <g key={i}>
                <line x1={mx} x2={mx} y1={Y(0)} y2={Y(mast)} stroke="var(--bone)" strokeWidth={3} />
                <rect x={mx - 5} y={Y(mast) - 8} width={10} height={16} fill="var(--bone)" />
              </g>
            ))}
            <text x={L} y={B + 22} textAnchor="middle" style={TB}>DC</text>
            <text x={R} y={B + 22} textAnchor="end" style={TB}>{row.site}</text>
            <text x={(L + R) / 2} y={B + 22} textAnchor="middle" style={T}>{d.toFixed(1)} km · earth bulge {bulge.toFixed(2)} m</text>
            <text x={L + 10} y={Y(mast) - 12} style={{ ...TB, fill: "var(--bone)" }}>mast {mast.toFixed(1)} m</text>
          </g>
        );
      }}
    </Frame>
  );
}

/* ------------------------------------------------------------------ E3 downtime */
export function DowntimeBars({ on }: { on: boolean }) {
  const cc = PY.e3_clearconnect["ClearConnect on"].availability;
  const lg = PY.e3_clearconnect["Legacy (fixed rate, no DCS)"].availability;
  const mins = [cc, lg].map((a) => ((100 - a) / 100) * 1440);
  const v = useTween(on ? mins : [0, 0], 1200, on, [0, 0]);
  return (
    <Frame label={`Average downtime per link per day: ${mins[0].toFixed(1)} minutes with ClearConnect, ${mins[1].toFixed(0)} minutes with fixed-rate radios.`}>
      {(w, h) => {
        const L = 16, R = w - 16, rowH = Math.min(46, (h - 70) / 2);
        const X = linear(0, 240, L, R - 70);
        const rows = [["ClearConnect", cc, "var(--signal)"], ["Fixed rate, no DCS", lg, "var(--crit)"]] as const;
        return (
          <g>
            <text x={L} y={22} style={{ ...T, fontSize: 11.5 }}>DOWNTIME PER LINK PER DAY · 7 days × 3 seeds</text>
            {rows.map(([name, av, col], i) => {
              const y0 = 44 + i * (rowH + 30);
              return (
                <g key={name}>
                  <text x={L} y={y0} style={TB}>{name}</text>
                  <text x={R} y={y0} textAnchor="end" style={{ ...T, fontSize: 12 }}>{av.toFixed(2)}% available</text>
                  <rect x={L} y={y0 + 8} width={Math.max(2, X(v[i]) - L)} height={rowH - 12} fill={col} opacity={0.9} />
                  <text x={Math.max(2, X(v[i]) - L) + L + 8} y={y0 + 8 + (rowH - 12) / 2 + 5} style={{ ...TB, fontSize: 15 }}>{v[i].toFixed(v[i] < 10 ? 1 : 0)} min</text>
                </g>
              );
            })}
          </g>
        );
      }}
    </Frame>
  );
}

/* ------------------------------------------------------------------ E2 MAC */
export function MacChart({ on, stations }: { on: boolean; stations: number }) {
  const m = PY.e2_mac;
  const k = useTween(on ? 1 : 0, 1600, on, 0);
  const idx = m.stations.indexOf(stations as never);
  return (
    <Frame label="Useful airtime versus number of contending stations: WORP stays at 75 percent, CSMA/CA falls to 42 percent, and to 27 percent with hidden nodes.">
      {(w, h) => {
        const L = 46, R = w - 20, Tp = 24, B = h - 40;
        const X = linear(1, 50, L, R), Y = linear(0, 1, B, Tp);
        const series = [
          { d: m.worp, c: "var(--signal)", name: "WORP token passing" },
          { d: m.csma, c: "var(--dim)", name: "CSMA/CA" },
          { d: m.csma_hidden30, c: "var(--crit)", name: "CSMA/CA, 30% hidden pairs" },
        ];
        return (
          <g>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={L} x2={R} y1={Y(t)} y2={Y(t)} stroke="var(--rule)" /><text x={L - 8} y={Y(t) + 4} textAnchor="end" style={T}>{t * 100}%</text></g>)}
            {[1, 10, 20, 30, 40, 50].map((t) => <text key={t} x={X(t)} y={B + 18} textAnchor="middle" style={T}>{t}</text>)}
            <text x={R} y={B + 34} textAnchor="end" style={T}>contending stations</text>
            {idx >= 0 && <line x1={X(stations)} x2={X(stations)} y1={Tp} y2={B} stroke="var(--bone)" strokeOpacity={0.4} strokeDasharray="2 4" />}
            {series.map((s) => {
              const pts = m.stations.map((n, i) => [X(n), Y(s.d[i])] as [number, number]);
              const len = 2000;
              return (
                <g key={s.name}>
                  <path d={pathOf(pts)} fill="none" stroke={s.c} strokeWidth={2.4} strokeDasharray={len} strokeDashoffset={len * (1 - k)} />
                  {idx >= 0 && k > 0.95 && (
                    <g>
                      <circle cx={pts[idx][0]} cy={pts[idx][1]} r={5} fill={s.c} />
                      <text x={pts[idx][0] + (pts[idx][0] > R - 60 ? -10 : 10)} y={pts[idx][1] - 8} textAnchor={pts[idx][0] > R - 60 ? "end" : "start"} style={{ ...TB, fill: s.c }}>{(s.d[idx] * 100).toFixed(0)}%</text>
                    </g>
                  )}
                </g>
              );
            })}
            {series.map((s, i) => (
              <g key={s.name} transform={`translate(${L + 10}, ${B - 14 - (2 - i) * 18})`}>
                <rect width={14} height={3} y={-4} fill={s.c} /><text x={20} y={0} style={{ ...T, fill: "var(--dim)" }}>{s.name}</text>
              </g>
            ))}
          </g>
        );
      }}
    </Frame>
  );
}

/* ------------------------------------------------------------------ E4 heat */
export function heatCurve(heatwave: number, shield: boolean): number[] {
  // Mirrors scripts/run_experiments.py e4: March, minute stepped 1..1440, no jitter.
  const env = new Environment(new Rng(1), 2, 0);
  env.heatwave = heatwave; env.sunShield = shield; env.minute = 0;
  const out: number[] = [];
  for (let i = 0; i < 1440; i++) { env.minute += 1; out.push(env.radioTemp()); }
  return out;
}
export function HeatChart({ on, heatwave, shield }: { on: boolean; heatwave: boolean; shield: boolean }) {
  const curve = heatCurve(heatwave ? 5 : 0, shield).filter((_, i) => i % 10 === 9);
  const base = heatCurve(0, false).filter((_, i) => i % 10 === 9);
  const v = useTween(on ? curve : curve.map(() => 20), 900, on, curve.map(() => 20));
  return (
    <Frame label="Radio enclosure temperature over a March day in Ica against the 60 degree rating.">
      {(w, h) => {
        const L = 44, R = w - 18, Tp = 24, B = h - 38;
        const X = linear(0, 24, L, R), Y = linear(10, 70, B, Tp);
        const pts = v.map((t, i) => [X(((i + 1) * 10) / 60), Y(t)] as [number, number]);
        const basePts = base.map((t, i) => [X(((i + 1) * 10) / 60), Y(t)] as [number, number]);
        const over = pts.map((p, i) => [p[0], Math.min(p[1], Y(RADIO.maxTemp)), v[i] > RADIO.maxTemp] as const);
        return (
          <g>
            {[10, 20, 30, 40, 50, 60, 70].map((t) => <g key={t}><line x1={L} x2={R} y1={Y(t)} y2={Y(t)} stroke="var(--rule)" /><text x={L - 8} y={Y(t) + 4} textAnchor="end" style={T}>{t}°</text></g>)}
            {[0, 6, 12, 18, 24].map((t) => <text key={t} x={X(t)} y={B + 18} textAnchor="middle" style={T}>{String(t).padStart(2, "0")}:00</text>)}
            <rect x={L} y={Y(70)} width={R - L} height={Y(RADIO.maxTemp) - Y(70)} fill="var(--crit)" opacity={0.08} />
            <line x1={L} x2={R} y1={Y(RADIO.maxTemp)} y2={Y(RADIO.maxTemp)} stroke="var(--crit)" strokeWidth={1.5} strokeDasharray="6 4" />
            <text x={L + 6} y={Y(RADIO.maxTemp) - 7} style={{ ...T, fill: "var(--crit)" }}>datasheet maximum 60 °C</text>
            {(heatwave || shield) && <path d={pathOf(basePts)} fill="none" stroke="var(--dim)" strokeWidth={1.2} strokeDasharray="3 4" />}
            <path d={pathOf(pts) + `L${X(24)},${B}L${X(10 / 60)},${B}Z`} fill="var(--dune)" opacity={0.12} />
            <path d={pathOf(pts)} fill="none" stroke="var(--dune)" strokeWidth={2.5} />
            {over.some((o) => o[2]) && <path d={over.map((o, i) => `${i && over[i - 1][2] && o[2] ? "L" : "M"}${o[0]},${pts[i][1]}`).join("")} fill="none" stroke="var(--crit)" strokeWidth={3.5} />}
          </g>
        );
      }}
    </Frame>
  );
}

/* ------------------------------------------------------------------ E6 hub */
export function HubBars({ on }: { on: boolean }) {
  const rows = Object.entries(PY.e6_hub_spectrum).map(([k, r]) => ({ k, cap: r.total_capacity_mbps, av: r.availability_pct }));
  const labels = ["Today: 40 MHz channels", "Licence only: 80 MHz", "+20 dB isolation at hub", "Isolation + licence"];
  const colors = ["var(--dim)", "var(--crit)", "var(--signal)", "var(--signal)"];
  const v = useTween(on ? rows.map((r) => r.cap) : rows.map(() => 0), 1200, on, rows.map(() => 0));
  return (
    <Frame label="Average total backhaul capacity at three times today's demand: 3872 Mbps today, 3233 with the licence alone, 4243 with better hub isolation, 4129 with both.">
      {(w, h) => {
        const L = 16, R = w - 16, Tp = 40, gap = 18, rowH = Math.min(52, (h - Tp - 20 - gap * 3) / 4);
        const X = linear(0, 5000, L, R - 90);
        return (
          <g>
            <text x={L} y={22} style={{ ...T, fontSize: 11.5 }}>TOTAL CAPACITY ACROSS 15 LINKS · demand ×3 · 1 day</text>
            {rows.map((r, i) => {
              const y0 = Tp + i * (rowH + gap);
              return (
                <g key={r.k}>
                  <text x={L} y={y0 + 4} style={{ ...TB, fontSize: 12.5 }}>{labels[i]}</text>
                  <rect x={L} y={y0 + 12} width={Math.max(2, X(v[i]) - L)} height={rowH - 18} fill={colors[i]} opacity={i === 3 ? 0.55 : 0.9} />
                  <text x={X(v[i]) + 8} y={y0 + 12 + (rowH - 18) / 2 + 5} style={{ ...TB, fontSize: 14 }}>{Math.round(v[i])} Mbps</text>
                  <text x={R} y={y0 + 4} textAnchor="end" style={T}>{r.av.toFixed(2)}% up</text>
                </g>
              );
            })}
          </g>
        );
      }}
    </Frame>
  );
}

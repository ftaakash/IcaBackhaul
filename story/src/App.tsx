import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Topology, TopologyLegend } from "@/scenes/Topology";
import { SpectrumView } from "@/scenes/Spectrum";
import { ClimateChart, DowntimeBars, HeatChart, HubBars, LinkProfile, MacChart, WidthBars, heatCurve } from "@/scenes/Charts";
import { SecurityScene } from "@/scenes/Security";
import { live, useLive, clock } from "@/lib/live";
import { useTween } from "@/lib/motion";
import { PY } from "@/data/results";
import { MODULATION, SITES } from "@/engine/engine";
import { Switch } from "@/lib/Toggle";

type Src = "reported" | "measured" | "datasheet" | "model" | "live";
const SRC_LABEL: Record<Src, string> = { reported: "Reported", measured: "Measured", datasheet: "Datasheet", model: "Simulated", live: "Live model" };
const Tag = ({ s }: { s: Src }) => <span className={`src ${s}`}>{SRC_LABEL[s]}</span>;
const Tags = ({ s }: { s: Src[] }) => <span className="legend-src">{s.map((x) => <Tag key={x} s={x} />)}</span>;

function Num({ v, d = 0 }: { v: number; d?: number }) {
  const t = useTween(v, 700);
  return <>{t.toFixed(d)}</>;
}
const pad2 = (n: number) => String(n).padStart(2, "0");
const minuteClock = (m: number) => `${pad2(Math.floor((m % 1440) / 60))}:${pad2(m % 60)}`;

/* ================================================================ scenes */
function SceneShell({ on, title, tags, children, foot }: { on: boolean; title: string; tags: Src[]; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="scene" data-on={on} aria-hidden={!on}>
      <div className="stage-head"><div className="stage-title">{title}</div><Tags s={tags} /></div>
      <div className="figure">{children}</div>
      {foot}
    </section>
  );
}

function HeroScene({ on }: { on: boolean }) {
  const L = useLive(on);
  const k = L.net.kpis();
  return (
    <SceneShell on={on} title="The backhaul, running" tags={["live"]}
      foot={<>
        <div className="readout">
          <div><span className="k">Local time</span><span className="v">{clock(L.net)}</span></div>
          <div><span className="k">Links up</span><span className="v">{k.linksUp} / 15</span></div>
          <div><span className="k">Delivered</span><span className="v"><Num v={k.delivered} /> Mbps</span></div>
          <div><span className="k">Capacity</span><span className="v"><Num v={k.capacity} /> Mbps</span></div>
        </div>
        <TopologyLegend />
      </>}>
      <Topology active={on} />
    </SceneShell>
  );
}

function PlaceScene({ on }: { on: boolean }) {
  return (
    <SceneShell on={on} title="Ica: monthly temperature" tags={["measured"]}
      foot={<div className="caption">Average daily high (solid) and low (dashed), SENAMHI 1991–2020 normals, San Camilo station 3 km from Ica. Annual rainfall is close to zero.</div>}>
      <ClimateChart on={on} />
    </SceneShell>
  );
}

function UtilityScene({ on }: { on: boolean }) {
  const L = useLive(on);
  const tot = { scada: 0, cctv: 0, data: 0 };
  for (const l of L.net.links) { const c = 4 * l.site.cameras; tot.scada += 0.3; tot.cctv += c; tot.data += Math.max(0, l.offered - 0.3 - c); }
  const sum = tot.scada + tot.cctv + tot.data;
  const parts = [["SCADA telemetry", tot.scada, "var(--dune)"], ["CCTV video", tot.cctv, "var(--signal)"], ["Corporate data", tot.data, "var(--dim)"]] as const;
  return (
    <SceneShell on={on} title="Fifteen sites, one data center" tags={["model", "live"]}
      foot={<div className="caption">Site names, distances and camera counts are illustrative. The case study confirms 15 links between offices, thermal plants and the data center but does not publish the site map.</div>}>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "1rem", gap: "1rem" }}>
        <div>
          <div className="mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: "0.08em", marginBottom: 6 }}>OFFERED LOAD RIGHT NOW · {sum.toFixed(0)} Mbps</div>
          <div style={{ display: "flex", height: 16, gap: 2 }}>
            {parts.map(([n, v, c]) => <div key={n} style={{ flex: `${Math.max(v, 1.2)} 1 0`, background: c, transition: "flex-grow 600ms" }} />)}
          </div>
          <div className="caption" style={{ marginTop: 6 }}>
            {parts.map(([n, v, c]) => <span key={n}><span style={{ display: "inline-block", width: 9, height: 9, background: c, marginRight: 5 }} />{n} {v.toFixed(v < 10 ? 1 : 0)} Mbps</span>)}
          </div>
        </div>
        <div style={{ overflow: "auto", minHeight: 0, flex: 1 }}>
          <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead><tr style={{ color: "var(--faint)", textAlign: "left" }}>
              <th style={{ padding: "4px 6px", fontWeight: 400 }}>#</th><th style={{ fontWeight: 400 }}>Site</th><th style={{ fontWeight: 400 }}>Type</th>
              <th style={{ textAlign: "right", fontWeight: 400 }}>km</th><th style={{ textAlign: "right", fontWeight: 400, paddingRight: 6 }}>Cameras</th></tr></thead>
            <tbody>
              {SITES.map((s, i) => (
                <tr key={s.name} style={{ borderTop: "1px solid var(--rule)" }}>
                  <td style={{ padding: "5px 6px", color: "var(--faint)" }}>{pad2(i + 1)}</td>
                  <td style={{ color: "var(--bone)", whiteSpace: "nowrap" }}>{s.name}</td>
                  <td style={{ color: s.kind === "thermal" ? "var(--dune)" : "var(--dim)" }}>{s.kind === "thermal" ? "thermal plant" : s.kind}</td>
                  <td style={{ textAlign: "right" }}>{s.distanceKm.toFixed(1)}</td>
                  <td style={{ textAlign: "right", paddingRight: 6 }}>{s.cameras}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SceneShell>
  );
}

function BandScene({ on }: { on: boolean }) {
  const L = useLive(on);
  const activeItf = L.net.spectrum.interferers.filter((i) => i.active).length;
  return (
    <SceneShell on={on} title="The 5 GHz band over Ica" tags={["live"]}
      foot={<>
        <div className="readout">
          <div><span className="k">Other transmitters on air</span><span className="v">{activeItf} / {L.net.spectrum.interferers.length}</span></div>
          <div><span className="k">Band</span><span className="v">5.150–5.925 GHz</span></div>
          <div><span className="k">Our channels</span><span className="v">15 × 40 MHz</span></div>
        </div>
        <div className="caption">Ochre: other users of the unlicensed band, switching on and off. Teal: the fifteen Electro Dunas links. The third-party traffic is a statistical model, not a measured survey.</div>
      </>}>
      <SpectrumView active={on} />
    </SceneShell>
  );
}

function RadioScene({ on }: { on: boolean }) {
  return (
    <SceneShell on={on} title="Tsunami QB-10100L: capacity by channel width" tags={["datasheet"]}
      foot={<div className="facts">
        <div className="fact"><span className="v">2×2</span><span className="k">MIMO, OFDM up to 256-QAM</span></div>
        <div className="fact"><span className="v">2–3 ms</span><span className="k">latency over the link</span></div>
        <div className="fact"><span className="v">IP67</span><span className="k">enclosure, rated for 180 km/h wind</span></div>
        <div className="fact"><span className="v">60 °C</span><span className="k">maximum operating temperature</span></div>
      </div>}>
      <WidthBars on={on} />
    </SceneShell>
  );
}

function SurveyScene({ on }: { on: boolean }) {
  const [i, setI] = useState(12);
  const r = PY.e5_link_budget[i];
  return (
    <SceneShell on={on} title="Link profile and budget" tags={["model"]}
      foot={<>
        <div className="controls">
          <label className="toggle" htmlFor="link-pick">Link</label>
          <select id="link-pick" className="select" value={i} onChange={(e) => setI(Number(e.target.value))}>
            {PY.e5_link_budget.map((row, k) => <option key={row.site} value={k}>{pad2(k + 1)} · {row.site} · {row.km} km</option>)}
          </select>
        </div>
        <div className="readout">
          <div><span className="k">EIRP</span><span className="v"><Num v={r.eirp_dbm} d={1} /> dBm</span></div>
          <div><span className="k">Path loss</span><span className="v"><Num v={r.fspl_db} d={1} /> dB</span></div>
          <div><span className="k">Received</span><span className="v"><Num v={r.rx_dbm} d={1} /> dBm</span></div>
          <div><span className="k">Clear-sky SNR</span><span className="v"><Num v={r.snr_db} d={1} /> dB</span></div>
          <div><span className="k">Antenna</span><span className="v">{r.antenna_dbi} dBi</span></div>
        </div>
      </>}>
      <LinkProfile index={i} />
    </SceneShell>
  );
}

function AdaptScene({ on }: { on: boolean }) {
  const L = useLive(on);
  const net = L.net;
  const [sel, setSel] = useState<number | null>(8);
  const [speed, setSpeed] = useState(2);
  useEffect(() => { live.speed = on ? speed : 2; }, [speed, on]);
  const k = net.kpis();
  const link = sel !== null ? net.links[sel] : null;
  const events = net.events.filter((e) => e.kind !== "licence").slice(0, 4);
  return (
    <SceneShell on={on} title="ClearConnect, live" tags={["live"]}
      foot={<>
        <div className="controls">
          <label className="toggle" htmlFor="cc-switch">
            <Switch id="cc-switch" checked={net.clearconnect} onCheckedChange={(v) => { net.clearconnect = v; L.emit(); }} />
            ClearConnect {net.clearconnect ? "on" : "off"}
          </label>
          <button className="btn danger" disabled={sel === null} onClick={() => { if (sel !== null) { net.injectInterference(sel); L.emit(); } }}>
            Jam link {sel !== null ? pad2(sel + 1) : ""}
          </button>
          <label className="toggle hide-sm" htmlFor="speed">Speed
            <select id="speed" className="select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={1}>1 min / tick</option><option value={2}>2 min / tick</option><option value={10}>10 min / tick</option>
            </select>
          </label>
          <button className="btn hide-sm" onClick={() => live.reset(net.clearconnect)}>Reset</button>
        </div>
        <div className="readout">
          <div><span className="k">Selected</span><span className="v">{link ? `${pad2(link.id + 1)} · ${link.channel!.label()}` : "tap a site"}</span></div>
          <div><span className="k">SINR</span><span className="v" style={{ color: link && !link.up ? "var(--crit)" : undefined }}>{link ? `${link.sinr.toFixed(1)} dB` : "–"}</span></div>
          <div><span className="k">Modulation</span><span className="v">{link && link.up && link.mcs >= 0 ? MODULATION[link.mcs] : "link down"}</span></div>
          <div><span className="k">Availability</span><span className="v">{k.availability.toFixed(2)}%</span></div>
          <div><span className="k">Channel hops</span><span className="v">{k.dcs}</span></div>
        </div>
        <div className="ticker" aria-live="polite">
          {events.length === 0 && <div className="row"><span className="t">{clock(net)}</span><span>No channel changes yet. Jam a link to force one.</span></div>}
          {events.map((e) => (
            <div className="row" key={`${e.t}-${e.link}-${e.text}`}>
              <span className="t">{minuteClock(360 + e.t)}</span>
              <span style={{ color: e.kind === "dcs" ? "var(--signal)" : e.kind === "inject" || e.kind === "down" ? "var(--crit)" : "var(--dim)" }}>
                {e.link >= 0 ? `L${pad2(e.link + 1)} ` : ""}{e.text}
              </span>
            </div>
          ))}
        </div>
      </>}>
      <Topology active={on} selected={sel} onSelect={setSel} labels={false} />
    </SceneShell>
  );
}

function MeasureScene({ on }: { on: boolean }) {
  const cc = PY.e3_clearconnect["ClearConnect on"], lg = PY.e3_clearconnect["Legacy (fixed rate, no DCS)"];
  return (
    <SceneShell on={on} title="What adaptation is worth" tags={["model"]}
      foot={<div className="facts">
        <div className="fact"><span className="v">{cc.availability.toFixed(2)}%</span><span className="k">mean link availability with ClearConnect</span></div>
        <div className="fact"><span className="v">{lg.availability.toFixed(2)}%</span><span className="k">fixed rate, no channel hopping</span></div>
        <div className="fact"><span className="v">{cc.mean_delivered_mbps.toFixed(0)}</span><span className="k">Mbps delivered on average, against {lg.mean_delivered_mbps.toFixed(0)}</span></div>
      </div>}>
      <DowntimeBars on={on} />
    </SceneShell>
  );
}

function MacScene({ on }: { on: boolean }) {
  const [n, setN] = useState(50);
  return (
    <SceneShell on={on} title="Useful airtime under contention" tags={["model"]}
      foot={<div className="controls">
        <label className="toggle" htmlFor="stations">Stations</label>
        <select id="stations" className="select" value={n} onChange={(e) => setN(Number(e.target.value))}>
          {PY.e2_mac.stations.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="caption">CSMA/CA is a Monte Carlo run with exponential backoff. WORP is calibrated to Proxim's published 75%.</span>
      </div>}>
      <MacChart on={on} stations={n} />
    </SceneShell>
  );
}

function SecurityStage({ on }: { on: boolean }) {
  return (
    <SceneShell on={on} title="One SCADA frame, sealed" tags={["live"]}
      foot={<div className="caption">Real AES-256-GCM running in this page, with the frame header used by the simulator. Proxim's WORP frame format is proprietary and is not reproduced here.</div>}>
      <SecurityScene active={on} />
    </SceneShell>
  );
}

function HeatScene({ on }: { on: boolean }) {
  const [hw, setHw] = useState(false), [sh, setSh] = useState(false);
  const c = useMemo(() => heatCurve(hw ? 5 : 0, sh), [hw, sh]);
  const peak = Math.max(...c), over = c.filter((t) => t > 60).length;
  return (
    <SceneShell on={on} title="Radio temperature through a March day" tags={["measured", "model"]}
      foot={<>
        <div className="controls">
          <label className="toggle" htmlFor="hw"><Switch id="hw" checked={hw} onCheckedChange={setHw} />Heatwave, +5 °C</label>
          <label className="toggle" htmlFor="sh"><Switch id="sh" checked={sh} onCheckedChange={setSh} />Sun shield</label>
        </div>
        <div className="readout">
          <div><span className="k">Peak enclosure</span><span className="v" style={{ color: peak > 60 ? "var(--crit)" : undefined }}><Num v={peak} d={1} /> °C</span></div>
          <div><span className="k">Minutes over 60 °C</span><span className="v" style={{ color: over ? "var(--crit)" : undefined }}><Num v={over} /></span></div>
          <div><span className="k">Air at peak</span><span className="v">{(33.3 + (hw ? 5 : 0)).toFixed(1)} °C</span></div>
        </div>
      </>}>
      <HeatChart on={on} heatwave={hw} shield={sh} />
    </SceneShell>
  );
}

function OutcomeScene({ on }: { on: boolean }) {
  const L = useLive(on);
  const k = L.net.kpis();
  return (
    <SceneShell on={on} title="The finished network" tags={["reported", "live"]}
      foot={<div className="facts">
        <div className="fact"><span className="v">15</span><span className="k">point-to-point links in service</span><Tag s="reported" /></div>
        <div className="fact"><span className="v">1</span><span className="k">console managing every radio</span><Tag s="reported" /></div>
        <div className="fact"><span className="v">{k.availability.toFixed(1)}%</span><span className="k">availability in this run</span><Tag s="live" /></div>
      </div>}>
      <Topology active={on} />
    </SceneShell>
  );
}

function LimitScene({ on }: { on: boolean }) {
  return (
    <SceneShell on={on} title="Where the next megabit comes from" tags={["model"]}
      foot={<div className="caption">Average over one simulated day at three times today's demand. With the licence alone, the wider channels collide on the shared mast.</div>}>
      <HubBars on={on} />
    </SceneShell>
  );
}

function CodaScene({ on }: { on: boolean }) {
  const rows: [Src, string][] = [
    ["reported", "Stated in Proxim's Electro Dunas case study"],
    ["measured", "Public measurements: SENAMHI climate normals"],
    ["datasheet", "Proxim Tsunami QB-10100 series datasheet"],
    ["model", "IcaBackhaul simulator (Python), seeded experiments"],
    ["live", "TypeScript port of the same engine, running in this page"],
  ];
  return (
    <SceneShell on={on} title="How to read the numbers" tags={[]}>
      <div style={{ position: "absolute", inset: 0, padding: "1.2rem", display: "flex", flexDirection: "column", gap: "0.9rem", overflow: "auto" }}>
        {rows.map(([s, t]) => (
          <div key={s} style={{ display: "grid", gridTemplateColumns: "7.5rem minmax(0, 1fr)", gap: "1rem", alignItems: "baseline", borderTop: "1px solid var(--rule)", paddingTop: "0.8rem" }}>
            <span><Tag s={s} /></span><span style={{ color: "var(--dim)" }}>{t}</span>
          </div>
        ))}
        <p style={{ color: "var(--dim)", fontSize: 14, borderTop: "1px solid var(--rule)", paddingTop: "0.8rem", margin: 0 }}>
          The live port and the Python engine agree within run-to-run spread: mean availability 99.68% against 99.77% with ClearConnect, and 85.40% against 85.07% without, over seven simulated days and three seeds. Path loss, mast heights and the heat curve match exactly.
        </p>
      </div>
    </SceneShell>
  );
}

/* ================================================================ chapters */
interface Chapter { id: string; name: string; scene: (on: boolean) => ReactNode; body: ReactNode }
const ccDown = ((100 - PY.e3_clearconnect["ClearConnect on"].availability) / 100) * 1440;
const lgDown = ((100 - PY.e3_clearconnect["Legacy (fixed rate, no DCS)"].availability) / 100) * 1440;
const ext = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--signal)" }}>{text}</a>;

const chapters: Chapter[] = [
  {
    id: "top", name: "Overview", scene: (on) => <HeroScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>Case study</span><span className="idx">Electro Dunas S.A.A. · Ica, Peru</span></div>
        <h1 className="h-display">Fifteen links over the <em>desert</em></h1>
        <p className="dek">How a regional power utility rebuilt the radio backbone that carries its telemetry, video and data across one of the driest places on earth.</p>
        <p>The network beside this text is running now. Each line is a radio link from a company site to the data center. Its weight shows the capacity it holds, and the moving dots are traffic on its way in.</p>
        <p style={{ fontSize: "0.92rem" }}>Every figure in this story is tagged with where it came from: <Tags s={["reported", "measured", "datasheet", "model", "live"]} /></p>
      </>
    ),
  },
  {
    id: "place", name: "Ica", scene: (on) => <PlaceScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The place</span></div>
        <h2 className="h-chapter">Ica, 310 km south of Lima</h2>
        <p>Ica sits on Peru's south-central coast in a hot desert where rain barely registers. It is a working region: <strong>mining, agro-industry, fishing, commerce, gas and textiles</strong> all draw on the same grid.</p>
        <p>March is the hottest month, with afternoon highs averaging <strong>33.3 °C</strong>. Most afternoons the <em>paracas</em> winds blow in from the coast and carry fine sand over everything left outdoors, radio masts included.</p>
      </>
    ),
  },
  {
    id: "utility", name: "Electro Dunas", scene: (on) => <UtilityScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The utility</span></div>
        <h2 className="h-chapter">A power company that runs its own network</h2>
        <p><strong>Electro Dunas</strong> has distributed electricity in the region since 1912. It holds the concession for Ica and parts of Huancavelica and Ayacucho, serving about <strong>270,000 customers</strong> over roughly 2,690 km of medium-voltage line.</p>
        <p>Its offices and <strong>thermal power plants</strong> report to one data center over a private network. The backhaul links carry three kinds of traffic: corporate data, CCTV video, and the telemetry that tells operators what the plants and breakers are doing.</p>
      </>
    ),
  },
  {
    id: "problem", name: "The problem", scene: (on) => <BandScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The problem</span></div>
        <h2 className="h-chapter">Old links, a hard climate, a crowded band</h2>
        <p>As the private network grew, its wireless backhaul links had to be renewed. The case study names the obstacles at the sites: <strong>high temperatures and desert dust</strong>.</p>
        <p>The radios work in the <strong>unlicensed 5 GHz band</strong>, which anyone may use. Other operators' transmitters come and go on the same channels. Part of the band is shared with weather radar, and a link there must leave the moment radar appears.</p>
        <p>The IT team also had a mandate: certificate-secured access to every device, encrypted data over the air, and traffic kept in separate subnets.</p>
      </>
    ),
  },
  {
    id: "radio", name: "The radio", scene: (on) => <RadioScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The choice</span></div>
        <h2 className="h-chapter">Tsunami QB-10100L</h2>
        <p>After what the case study calls a rigorous selection process, Electro Dunas chose Proxim Wireless's <strong>Tsunami QB-10100L</strong> point-to-point radio. Two qualities decided it: strong security features, and the ability to keep working in harsh weather at power plants.</p>
        <p>The 10100L is the licence-controlled model of its family. It ships with <strong>over 320 Mbps of usable throughput</strong>, which fits a 40 MHz channel, and can be raised to over 670 Mbps in the field with a licence key.</p>
      </>
    ),
  },
  {
    id: "survey", name: "Survey", scene: (on) => <SurveyScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The process</span></div>
        <h2 className="h-chapter">Survey before steel</h2>
        <p>The local integrator, <strong>JA Telecom</strong>, ran spectrum studies at the sites and sized the towers and antennas to keep interference out.</p>
        <p>Sizing a tower is geometry. A radio beam needs more than a clear line of sight: the oval around it, called the <strong>first Fresnel zone</strong>, must stay mostly clear as well. On the longer links the curve of the earth rises into the path. Pick a link to see the mast height it needs.</p>
      </>
    ),
  },
  {
    id: "adapt", name: "ClearConnect", scene: (on) => <AdaptScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The solution</span></div>
        <h2 className="h-chapter">Holding the link when the band gets loud</h2>
        <p>The case study credits Proxim's <strong>ClearConnect</strong> with keeping capacity up in the crowded 5 GHz band. It is a set of controls that each radio runs by itself.</p>
        <p>The radio <strong>steps its modulation down</strong> when the signal weakens and back up when it recovers. It <strong>trims transmit power</strong> to what the link needs. When retries stay high for three minutes, it <strong>moves to a cleaner channel</strong>.</p>
        <p>Select a site on the map and jam it. Then switch ClearConnect off and jam it again.</p>
      </>
    ),
  },
  {
    id: "measure", name: "Measured", scene: (on) => <MeasureScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The evidence</span></div>
        <h2 className="h-chapter">Minutes of downtime</h2>
        <p>Run the same week of interference, radar and dust storms twice. Once with adaptive radios, once with radios that fix their rate at installation and never change channel.</p>
        <p>The adaptive network loses about <strong>{ccDown.toFixed(1)} minutes per link per day</strong>. The fixed one loses about <strong>{Math.round(lgDown)}</strong>. For telemetry from a power plant, that gap decides whether operators see a breaker trip as it happens.</p>
      </>
    ),
  },
  {
    id: "worp", name: "WORP", scene: (on) => <MacScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>Under the hood</span></div>
        <h2 className="h-chapter">Radios that take turns</h2>
        <p>Wi-Fi radios listen first and transmit when the channel sounds free. Outdoors, with narrow directional antennas, many radios cannot hear each other, so they transmit over one another and have to resend.</p>
        <p>Proxim's <strong>WORP</strong> protocol replaces that with a schedule. The base station hands out turns, so frames never collide. The chart shows how much airtime stays useful as more stations share a channel.</p>
      </>
    ),
  },
  {
    id: "security", name: "Security", scene: (on) => <SecurityStage on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The mandate</span></div>
        <h2 className="h-chapter">A frame that cannot be altered</h2>
        <p>Security was a deciding factor. José Alegría, IT team leader at JA Telecom, set out the requirement: device access secured with certificates, management over <strong>TLS 1.2</strong> with a self-generated certificate, and data over the air <strong>encrypted with AES</strong>.</p>
        <p>Seal a reading from a thermal plant. Then flip one bit in transit, or send the same frame twice. The hub checks every frame before anything reaches the SCADA network.</p>
      </>
    ),
  },
  {
    id: "heat", name: "Heat", scene: (on) => <HeatScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The environment</span></div>
        <h2 className="h-chapter">Sixty degrees</h2>
        <p>The radio is rated to <strong>60 °C</strong>. The air is only part of what it faces: a sealed box in full sun on a mast runs far hotter than the air around it, and the electronics add heat of their own.</p>
        <p>On an average March day the enclosure peaks near <strong>{PY.e4_thermal["No shield"].peak_c} °C</strong>, inside the rating. Add a 5 °C heatwave and it spends <strong>{PY.e4_thermal["No shield + heatwave"].minutes_over_60c} minutes</strong> above it. A sun shield brings the peak back down to {PY.e4_thermal["Sun shield + heatwave"].peak_c} °C.</p>
      </>
    ),
  },
  {
    id: "outcome", name: "Outcome", scene: (on) => <OutcomeScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>The result</span></div>
        <h2 className="h-chapter">A secure, reliable backhaul</h2>
        <p>The case study reports that Electro Dunas now runs <strong>a secure and reliable backhaul radio link system</strong>: fifteen Tsunami 10100L point-to-point links joining its offices and thermal plants in Ica.</p>
        <p>ClearConnect holds capacity in the crowded band, and <strong>ProximVision Advanced</strong> manages every radio from one place.</p>
        <p>The case study publishes no uptime or cost figures. The simulation estimates them and labels every estimate.</p>
      </>
    ),
  },
  {
    id: "limit", name: "The next limit", scene: (on) => <LimitScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>Looking ahead</span></div>
        <h2 className="h-chapter">The next constraint is the mast</h2>
        <p>Fifteen radios share one data-center mast, and between them they already use nearly every 40 MHz channel in the band. That mast sets the ceiling.</p>
        <p>At three times today's demand, buying the 670 Mbps licence alone pushes links onto wider, overlapping channels, and <strong>total capacity falls</strong>. Better isolation between the hub antennas, for example a second mast, raises it. The licence pays off only after that.</p>
      </>
    ),
  },
  {
    id: "coda", name: "Sources", scene: (on) => <CodaScene on={on} />,
    body: (
      <>
        <div className="eyebrow"><span>Method and sources</span></div>
        <h2 className="h-chapter">What is known, and what is modelled</h2>
        <p>The account of the deployment comes from Proxim Wireless's case study. Where it stops, an open simulation of the same network takes over, and every modelled number says so.</p>
        <ul style={{ color: "var(--dim)", display: "flex", flexDirection: "column", gap: 6, paddingLeft: "1.1rem", listStyle: "square" }}>
          <li>{ext("https://proxim.com/resources/case-studies/electro-dunas-saa-peru/", "Proxim · Case study: Electro Dunas S.A.A., Peru")}</li>
          <li>{ext("https://proxim.com/technology/proxim-clearconnect/", "Proxim · ClearConnect")} and {ext("https://proxim.com/technology/worp/", "WORP")}</li>
          <li>Proxim · Tsunami QB-10100 series datasheet</li>
          <li>{ext("https://www.climate-zone.com/climate/pe/ica/", "SENAMHI 1991–2020 climate normals for Ica")}</li>
          <li>{ext("https://github.com/ftaakash/IcaBackhaul", "IcaBackhaul simulator: source and experiments")}</li>
        </ul>
      </>
    ),
  },
];

/* ================================================================ app */
export default function App() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.idx));
    }, { rootMargin: "-45% 0px -50% 0px" });
    refs.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, []);
  const go = (i: number) => refs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <>
      <header className="topbar">
        <div className="brand">Ica Backhaul <span>· case study</span></div>
        <div className="chapter-name" aria-live="polite">{pad2(active + 1)} / {chapters.length} · {chapters[active].name}</div>
        <nav className="progress" aria-label="Chapters">
          {chapters.map((c, i) => (
            <button key={c.id} onClick={() => go(i)} aria-current={i === active ? "step" : undefined} aria-label={c.name} title={c.name}><span /></button>
          ))}
        </nav>
      </header>
      <main className="story">
        <div className="narrative">
          {chapters.map((c, i) => (
            <article key={c.id} id={c.id} data-idx={i} ref={(el) => { refs.current[i] = el; }}
              className={`chapter${i === 0 ? " hero" : ""}`} data-active={i === active}>
              <div className="prose">{c.body}</div>
            </article>
          ))}
        </div>
        <div className="stage-wrap">
          <div className="stage">{chapters.map((c, i) => <div key={c.id} style={{ display: "contents" }}>{c.scene(i === active)}</div>)}</div>
        </div>
      </main>
    </>
  );
}

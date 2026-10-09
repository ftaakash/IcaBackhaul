// TypeScript port of the IcaBackhaul Python engine (backhaul/*.py).
// Every constant and formula mirrors the Python source; only the random number
// generator differs (seeded mulberry32 instead of NumPy PCG64), so runs agree
// statistically, not draw-for-draw. See scripts/validate.ts.

// ---------------------------------------------------------------- RNG
export class Rng {
  private s: number;
  private spare: number | null = null;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  random(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a: number, b: number) { return a + (b - a) * this.random(); }
  integers(a: number, b: number) { return a + Math.floor(this.random() * (b - a)); }
  normal(mu = 0, sd = 1): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return mu + sd * v; }
    let u = 0, v = 0, s = 0;
    do { u = this.random() * 2 - 1; v = this.random() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    return mu + sd * u * m;
  }
  lognormal(mean: number, sigma: number) { return Math.exp(this.normal(mean, sigma)); }
  choice<T>(items: T[], p: number[]): T {
    let r = this.random();
    for (let i = 0; i < items.length; i++) { r -= p[i]; if (r < 0) return items[i]; }
    return items[items.length - 1];
  }
}

// ---------------------------------------------------------------- config.py
export type Kind = "office" | "thermal" | "substation";
export interface Site { name: string; kind: Kind; bearing: number; distanceKm: number; cameras: number; obstacleM: number }

export const SITES: Site[] = [
  { name: "Head Office", kind: "office", bearing: 15, distanceKm: 1.8, cameras: 2, obstacleM: 12 },
  { name: "Commercial Office Centro", kind: "office", bearing: 70, distanceKm: 2.5, cameras: 1, obstacleM: 15 },
  { name: "Substation Norte", kind: "substation", bearing: 350, distanceKm: 3.2, cameras: 2, obstacleM: 10 },
  { name: "Thermal Plant A", kind: "thermal", bearing: 200, distanceKm: 4.0, cameras: 4, obstacleM: 8 },
  { name: "Branch Office Sur", kind: "office", bearing: 165, distanceKm: 4.6, cameras: 1, obstacleM: 12 },
  { name: "Substation Este", kind: "substation", bearing: 95, distanceKm: 5.5, cameras: 2, obstacleM: 9 },
  { name: "Operations Base", kind: "office", bearing: 300, distanceKm: 6.3, cameras: 3, obstacleM: 10 },
  { name: "Thermal Plant B", kind: "thermal", bearing: 230, distanceKm: 7.0, cameras: 4, obstacleM: 6 },
  { name: "Substation Oeste", kind: "substation", bearing: 270, distanceKm: 7.8, cameras: 2, obstacleM: 8 },
  { name: "Branch Office Norte", kind: "office", bearing: 30, distanceKm: 8.5, cameras: 1, obstacleM: 10 },
  { name: "Thermal Plant C", kind: "thermal", bearing: 130, distanceKm: 9.4, cameras: 4, obstacleM: 7 },
  { name: "Substation Sureste", kind: "substation", bearing: 145, distanceKm: 10.2, cameras: 2, obstacleM: 9 },
  { name: "Branch Office Valle", kind: "office", bearing: 320, distanceKm: 11.5, cameras: 1, obstacleM: 14 },
  { name: "Thermal Plant D", kind: "thermal", bearing: 185, distanceKm: 12.6, cameras: 4, obstacleM: 6 },
  { name: "Substation Lejana", kind: "substation", bearing: 55, distanceKm: 13.8, cameras: 2, obstacleM: 12 },
];

export const RADIO = {
  txMax: 28, txMin: 1, gain: 22, longGain: 28, longKm: 8, cable: 0.5, nf: 6,
  eirpLimit: 50, width: 40, cap: 320, capUp: 670, maxTemp: 60, shutdownTemp: 70,
};

// SENAMHI 1991-2020 normals, Ica (San Camilo), deg C.
export const ICA_HIGH = [31.7, 32.8, 33.3, 31.7, 29.4, 26.1, 25.0, 26.1, 27.8, 29.4, 30.0, 31.1];
export const ICA_LOW = [17.8, 18.9, 17.8, 15.6, 12.2, 10.6, 10.6, 10.6, 11.1, 12.2, 13.3, 15.6];

// ---------------------------------------------------------------- rf.py
export const PHY: Record<number, (number | null)[]> = {
  20: [13, 26, 39, 52, 78, 104, 117, 130, 156, null],
  40: [27, 54, 81, 108, 162, 216, 243, 270, 324, 360],
  80: [58.5, 117, 175.5, 234, 351, 468, 526.5, 585, 702, 780],
};
export const DATASHEET_MAX: Record<number, number> = { 20: 137, 40: 324, 80: 633 };
const topRate = (w: number) => Math.max(...(PHY[w].filter((r) => r !== null) as number[]));
export const MAC_EFF: Record<number, number> = { 20: 137 / topRate(20), 40: 324 / topRate(40), 80: 633 / topRate(80) };
export const SNR_THR = [5, 8, 11, 14, 18, 22, 24, 26, 30, 32];
export const MODULATION = ["BPSK 1/2", "QPSK 1/2", "QPSK 3/4", "16-QAM 1/2", "16-QAM 3/4",
  "64-QAM 2/3", "64-QAM 3/4", "64-QAM 5/6", "256-QAM 3/4", "256-QAM 5/6"];

const log10 = Math.log10;
export const fsplDb = (km: number, mhz: number) => 20 * log10(km) + 20 * log10(mhz) + 32.44;
export const noiseFloorDbm = (bwMhz: number, nf = 6) => -174 + 10 * log10(bwMhz * 1e6) + nf;
export const fresnelRadiusM = (d1: number, d2: number, ghz: number, zone = 1) =>
  17.32 * Math.sqrt((zone * d1 * d2) / (ghz * (d1 + d2)));
export const earthBulgeM = (d1: number, d2: number, k = 4 / 3) => (d1 * d2) / (12.74 * k);
export const mastHeightM = (km: number, ghz: number, obstacle: number, clearance = 0.6) =>
  obstacle + earthBulgeM(km / 2, km / 2) + clearance * fresnelRadiusM(km / 2, km / 2, ghz);

export function powerSumDbm(...levels: number[]): number {
  let mw = 0;
  for (const l of levels) if (l > -200) mw += 10 ** (l / 10);
  return mw > 0 ? 10 * log10(mw) : -300;
}
export function bestMcs(sinr: number, width: number, margin = 3): number {
  let best = -1;
  SNR_THR.forEach((thr, mcs) => { if (PHY[width][mcs] !== null && sinr >= thr + margin) best = mcs; });
  return best;
}
export function per(sinr: number, mcs: number): number {
  if (mcs < 0) return 1;
  const x = sinr - SNR_THR[mcs];
  return 1 / (1 + Math.exp(1.5 * (x + 1.5)));
}
export function macThroughput(mcs: number, width: number): number {
  if (mcs < 0) return 0;
  const r = PHY[width][mcs];
  return r === null ? 0 : r * MAC_EFF[width];
}

// ---------------------------------------------------------------- spectrum.py
export const BLOCKS: number[][] = [
  [5180, 5200, 5220, 5240, 5260, 5280, 5300, 5320],
  [5500, 5520, 5540, 5560, 5580, 5600, 5620, 5640, 5660, 5680, 5700, 5720],
  [5745, 5765, 5785, 5805, 5825, 5845, 5865, 5885, 5905],
];
const DFS = [5250, 5730];

export class Channel {
  readonly key: string;
  constructor(readonly members: number[]) { this.key = members.join(","); }
  get width() { return 20 * this.members.length; }
  get center() { return this.members.reduce((a, b) => a + b, 0) / this.members.length; }
  get dfs() { return this.members.some((m) => m >= DFS[0] && m <= DFS[1]); }
  get lo() { return this.center - this.width / 2; }
  overlap(o: Channel) { let n = 0; for (const m of this.members) if (o.members.includes(m)) n++; return 20 * n; }
  label() { return `${this.center.toFixed(0)}/${this.width}`; }
}
const chanCache: Record<number, Channel[]> = {};
export function channelsForWidth(width: number): Channel[] {
  if (chanCache[width]) return chanCache[width];
  const k = width / 20, out: Channel[] = [];
  for (const b of BLOCKS) for (let s = 0; s + k <= b.length; s += k) out.push(new Channel(b.slice(s, s + k)));
  return (chanCache[width] = out);
}

export interface Interferer { channel: Channel; level: number; pOn: number; pOff: number; active: boolean; coupling: Map<number, number>; injected?: boolean }
export const HUB = -1;

export class Spectrum {
  interferers: Interferer[] = [];
  nol = new Map<string, { ch: Channel; steps: number }>();
  constructor(private rng: Rng, n = 30, public radarRate = 2e-4) { for (let i = 0; i < n; i++) this.add(); }
  add(channel?: Channel, level?: number, duty?: number, receivers?: Record<number, number>): Interferer {
    const r = this.rng;
    if (!channel) {
      const w = r.choice([20, 40, 80], [0.5, 0.35, 0.15]);
      const cs = channelsForWidth(w);
      channel = cs[r.integers(0, cs.length)];
    }
    const d = duty ?? r.uniform(0.1, 0.7);
    const pOff = r.uniform(0.02, 0.2);
    const pOn = (pOff * d) / Math.max(1e-6, 1 - d);
    const itf: Interferer = { channel, level: level ?? r.uniform(-96, -66), pOn: Math.min(pOn, 1), pOff,
      active: r.random() < d, coupling: new Map() };
    if (receivers) { for (const [k, v] of Object.entries(receivers)) itf.coupling.set(Number(k), v); itf.injected = true; }
    this.interferers.push(itf);
    return itf;
  }
  private coupling(itf: Interferer, rx: number) {
    let c = itf.coupling.get(rx);
    if (c === undefined) { c = Math.min(6, Math.max(-40, this.rng.normal(-10, 7))); itf.coupling.set(rx, c); }
    return c;
  }
  step() {
    for (const i of this.interferers) i.active = i.active ? this.rng.random() >= i.pOff : this.rng.random() < i.pOn;
    for (const [k, v] of this.nol) { v.steps -= 1; if (v.steps <= 0) this.nol.delete(k); }
  }
  interference(ch: Channel, rx: number, includeInactive = false): number {
    const levels: number[] = [];
    for (const i of this.interferers) {
      if (!(i.active || includeInactive)) continue;
      const ov = ch.overlap(i.channel);
      if (ov === 0) continue;
      const frac = ov / i.channel.width, weight = i.active ? 1 : 0.4;
      levels.push(i.level + this.coupling(i, rx) + 10 * log10(frac * weight));
    }
    return powerSumDbm(...levels);
  }
  radarHit(ch: Channel) { return ch.dfs && this.rng.random() < this.radarRate; }
  block(ch: Channel, steps = 30) { this.nol.set(ch.key, { ch, steps }); }
  allowed(ch: Channel) { for (const v of this.nol.values()) if (ch.overlap(v.ch)) return false; return true; }
}

// ---------------------------------------------------------------- environment.py
export class Environment {
  static SOLAR = 18; static SELF = 8;
  minute: number; storm: { severity: number; remaining: number } | null = null;
  heatwave = 0; sunShield = false;
  constructor(private rng: Rng, public month = 2, startHour = 6, public stormRate = 4e-4) { this.minute = Math.round(startHour * 60); }
  get hour() { return (this.minute / 60) % 24; }
  get day() { return Math.floor(this.minute / 1440); }
  ambient() {
    const hi = ICA_HIGH[this.month], lo = ICA_LOW[this.month];
    const phase = Math.sin((2 * Math.PI * (this.hour - 9)) / 24);
    return lo + (hi - lo) * (0.5 + 0.5 * phase) + this.heatwave;
  }
  solar() { const sun = Math.max(0, Math.sin((Math.PI * (this.hour - 6)) / 12)); return Environment.SOLAR * sun * (this.sunShield ? 0.4 : 1); }
  radioTemp(jitter = 0) { return this.ambient() + this.solar() + Environment.SELF + jitter; }
  dustLoss(km: number) { return this.storm ? this.storm.severity + 0.05 * km : 0; }
  startStorm(severity?: number, minutes?: number) {
    this.storm = { severity: severity ?? this.rng.uniform(1, 4), remaining: minutes ?? this.rng.integers(60, 240) };
  }
  step() {
    this.minute += 1;
    if (this.storm) { this.storm.remaining -= 1; if (this.storm.remaining <= 0) this.storm = null; }
    else if (this.hour >= 12 && this.hour <= 18 && this.rng.random() < this.stormRate) this.startStorm();
  }
}

// ---------------------------------------------------------------- network.py
const DCS_RETRY = 0.15, DCS_HOLD = 3, DDRS_MARGIN = 3, ATPC_FADE = 4, WIDE_MAX_KM = 5, CLEAN_SIR = 38;
const SCADA = 0.3, CCTV_PER_CAM = 4;
const DATA_MEAN: Record<Kind, number> = { office: 60, thermal: 15, substation: 6 };

export function hubIsolationDb(a: number, b: number): number {
  const diff = Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);
  if (diff >= 60) return 40;
  if (diff >= 30) return 30;
  if (diff >= 15) return 20;
  return 10;
}

export interface Stats { offered: number; delivered: number }
export class Link {
  channel: Channel | null = null; tx = 0; mcs = -1; fixedMcs = 0; wide = false;
  sinr = 0; per = 1; capacity = 0; up = false; temp = 25; retryStreak = 0; outage = 0;
  steps = 0; upSteps = 0; dcsEvents = 0; radarEvents = 0; offered = 0; delivered = 0;
  stats: Record<"scada" | "cctv" | "data", Stats> = { scada: { offered: 0, delivered: 0 }, cctv: { offered: 0, delivered: 0 }, data: { offered: 0, delivered: 0 } };
  lastHop = -1e9;
  constructor(readonly id: number, readonly site: Site) {}
  get km() { return this.site.distanceKm; }
  get gain() { return this.km > RADIO.longKm ? RADIO.longGain : RADIO.gain; }
  get maxTx() { return Math.min(RADIO.txMax, RADIO.eirpLimit - this.gain + RADIO.cable); }
  get availability() { return this.steps ? this.upSteps / this.steps : 0; }
}

export interface NetEvent { t: number; link: number; kind: "dcs" | "radar" | "down" | "up" | "storm" | "inject" | "licence"; text: string }

export interface NetOptions { seed?: number; clearconnect?: boolean; licence?: boolean; sunShield?: boolean; month?: number;
  nInterferers?: number; radarRate?: number; stormRate?: number; demandScale?: number; isolationBonus?: number }

export class Network {
  rng: Rng; env: Environment; spectrum: Spectrum; links: Link[]; t = 0;
  clearconnect: boolean; licence: boolean; demandScale: number; isolationBonus: number;
  events: NetEvent[] = [];
  constructor(o: NetOptions = {}) {
    this.rng = new Rng(o.seed ?? 7);
    this.clearconnect = o.clearconnect ?? true;
    this.licence = o.licence ?? false;
    this.demandScale = o.demandScale ?? 1;
    this.isolationBonus = o.isolationBonus ?? 0;
    this.env = new Environment(this.rng, o.month ?? 2, 6, o.stormRate ?? 4e-4);
    this.env.sunShield = o.sunShield ?? false;
    this.spectrum = new Spectrum(this.rng, o.nInterferers ?? 30, o.radarRate ?? 2e-4);
    this.links = SITES.map((s, i) => new Link(i, s));
    this.install();
  }
  private log(e: NetEvent) { this.events.unshift(e); if (this.events.length > 80) this.events.pop(); }

  // installation
  private clearSkyRx(l: Link, ch: Channel) {
    const tx = l.tx || l.maxTx;
    return tx + 2 * (l.gain - RADIO.cable) - fsplDb(l.km, ch.center);
  }
  ownInterference(victim: Link, aggr: Link, vch?: Channel | null, ach?: Channel | null): number {
    vch = vch ?? victim.channel; ach = ach ?? aggr.channel;
    if (aggr === victim || !vch || !ach) return -300;
    const ov = vch.overlap(ach);
    if (ov === 0) return -300;
    const tx = aggr.tx || aggr.maxTx;
    return tx - 45 - this.isolationBonus - hubIsolationDb(victim.site.bearing, aggr.site.bearing) + 10 * log10(ov / ach.width);
  }
  score(l: Link, ch: Channel, assigned: Link[]): number {
    const ext = powerSumDbm(this.spectrum.interference(ch, HUB, true), this.spectrum.interference(ch, l.id, true));
    const ownIn = assigned.map((o) => this.ownInterference(l, o, ch, null));
    let worst = this.clearSkyRx(l, ch) - powerSumDbm(ext, ...ownIn);
    for (const o of assigned) {
      const leak = this.ownInterference(o, l, null, ch);
      if (leak > -200) worst = Math.min(worst, this.clearSkyRx(o, o.channel!) - leak);
    }
    return -worst;
  }
  widthFor(l: Link) { return l.wide ? 80 : RADIO.width; }
  private wideEligible(l: Link) { return this.licence && l.km <= WIDE_MAX_KM; }
  acs(l: Link, others?: Link[]): Channel {
    const os = (others ?? this.links).filter((o) => o !== l && o.channel);
    const cands = channelsForWidth(this.widthFor(l)).filter((c) => this.spectrum.allowed(c));
    let best = cands[0], bs = Infinity;
    for (const c of cands) { const s = this.score(l, c, os); if (s < bs) { bs = s; best = c; } }
    return best;
  }
  install() {
    const assigned: Link[] = [];
    for (const l of this.links) l.channel = null;
    const order = [...this.links].sort((a, b) => (Number(!this.wideEligible(a)) - Number(!this.wideEligible(b))) || (b.km - a.km));
    for (const l of order) {
      l.tx = l.maxTx;
      l.wide = this.wideEligible(l);
      l.channel = this.acs(l, assigned);
      if (l.wide && this.score(l, l.channel, assigned) > -CLEAN_SIR) { l.wide = false; l.channel = this.acs(l, assigned); }
      assigned.push(l);
    }
    for (const l of this.links) { l.fixedMcs = Math.max(0, bestMcs(this.sinrOf(l, 0), this.widthFor(l), 6)); l.mcs = l.fixedMcs; }
  }

  // physics
  private rx(l: Link, fading: number) {
    const eirp = l.tx + l.gain - RADIO.cable;
    const loss = fsplDb(l.km, l.channel!.center) + this.env.dustLoss(l.km);
    return eirp - loss + l.gain - RADIO.cable + fading;
  }
  sinrOf(l: Link, fading: number) {
    const rx = this.rx(l, fading), ch = l.channel!;
    const noise = noiseFloorDbm(ch.width, RADIO.nf);
    const iHub = powerSumDbm(this.spectrum.interference(ch, HUB), ...this.links.map((o) => this.ownInterference(l, o)));
    const iSite = this.spectrum.interference(ch, l.id);
    return Math.min(rx - powerSumDbm(noise, iHub), rx - powerSumDbm(noise, iSite));
  }
  get cap() { return this.licence ? RADIO.capUp : RADIO.cap; }
  setLicence(up: boolean) {
    if (up === this.licence) return;
    this.licence = up; this.install();
    this.log({ t: this.t, link: -1, kind: "licence", text: up ? `Licence upgraded: ${this.links.filter((l) => l.wide).length} links moved to clean 80 MHz channels` : "Licence returned to 320 Mbps" });
  }

  step() {
    this.t += 1; this.env.step(); this.spectrum.step();
    for (const l of this.links) {
      const width = this.widthFor(l);
      l.steps += 1;
      l.temp = this.env.radioTemp(this.rng.normal(0, 0.8));
      if (this.spectrum.radarHit(l.channel!)) {
        this.spectrum.block(l.channel!);
        const old = l.channel!;
        l.channel = this.acs(l);
        if (!this.clearconnect) l.fixedMcs = Math.max(0, bestMcs(this.sinrOf(l, 0), this.widthFor(l), 6));
        l.radarEvents += 1; l.outage = 1; l.lastHop = this.t;
        this.log({ t: this.t, link: l.id, kind: "radar", text: `Radar on ${old.label()}, moved to ${l.channel.label()}` });
      }
      const derate = l.temp > RADIO.maxTemp ? 3 : 0;
      const shutdown = l.temp > RADIO.shutdownTemp;
      const fading = this.rng.normal(0, 1);
      const saved = l.tx; l.tx = saved - derate;
      const sinr = this.sinrOf(l, fading);
      l.tx = saved; l.sinr = sinr;
      let mcs: number;
      if (this.clearconnect) {
        l.mcs = bestMcs(sinr, width, DDRS_MARGIN);
        const top = Math.max(...PHY[width].map((r, i) => (r ? i : -1)));
        const target = SNR_THR[top] + DDRS_MARGIN + ATPC_FADE;
        if (sinr > target + 1) l.tx = Math.max(RADIO.txMin, l.tx - 1);
        else if (sinr < target - 1) l.tx = Math.min(l.maxTx, l.tx + 1);
        mcs = l.mcs;
      } else { l.tx = l.maxTx; mcs = l.fixedMcs; l.mcs = mcs; }
      const p = mcs >= 0 ? per(sinr, mcs) : 1;
      l.per = p;
      const goodput = this.clearconnect ? 1 - 0.5 * p : 1 - p;
      const raw = macThroughput(mcs, width) * goodput;
      const inOutage = l.outage > 0;
      l.outage = Math.max(0, l.outage - 1);
      const wasUp = l.up;
      l.up = mcs >= 0 && p < 0.5 && !shutdown && !inOutage;
      l.capacity = l.up ? Math.min(raw, this.cap) : 0;
      l.upSteps += l.up ? 1 : 0;
      if (wasUp && !l.up && !inOutage) this.log({ t: this.t, link: l.id, kind: "down", text: `Link down, SINR ${sinr.toFixed(0)} dB` });
      if (this.clearconnect && !inOutage) {
        const bad = p > DCS_RETRY || !l.up;
        l.retryStreak = bad ? l.retryStreak + 1 : 0;
        if (l.retryStreak >= DCS_HOLD && !shutdown) {
          const nw = this.acs(l);
          if (nw.key !== l.channel!.key) {
            this.log({ t: this.t, link: l.id, kind: "dcs", text: `Hopped ${l.channel!.label()} → ${nw.label()} (retries ${(p * 100).toFixed(0)}%)` });
            l.channel = nw; l.dcsEvents += 1; l.outage = nw.dfs ? 1 : 0; l.lastHop = this.t;
          }
          l.retryStreak = 0;
        }
      }
      this.traffic(l);
    }
  }
  private traffic(l: Link) {
    const g = this.demandScale;
    const demand = { scada: SCADA, cctv: CCTV_PER_CAM * l.site.cameras * g, data: this.rng.lognormal(Math.log(DATA_MEAN[l.site.kind] * g), 0.5) };
    let left = l.capacity;
    for (const c of ["scada", "cctv", "data"] as const) {
      const got = Math.min(demand[c], left); left -= got;
      l.stats[c].offered += demand[c]; l.stats[c].delivered += got;
    }
    l.offered = demand.scada + demand.cctv + demand.data;
    l.delivered = l.capacity - left;
  }
  injectInterference(id: number, level = -45) {
    const l = this.links[id];
    this.spectrum.add(l.channel!, level, 0.95, { [HUB]: 0, [l.id]: 0 });
    this.log({ t: this.t, link: id, kind: "inject", text: `Strong interferer switched on at ${l.channel!.label()}` });
  }
  run(n: number) { for (let i = 0; i < n; i++) this.step(); }
  kpis() {
    const L = this.links, n = L.length;
    const sum = (f: (l: Link) => number) => L.reduce((a, l) => a + f(l), 0);
    const so = sum((l) => l.stats.scada.offered), sd = sum((l) => l.stats.scada.delivered);
    return {
      linksUp: L.filter((l) => l.up).length,
      availability: (100 * sum((l) => l.availability)) / n,
      capacity: sum((l) => l.capacity),
      delivered: sum((l) => l.delivered),
      meanSinr: sum((l) => l.sinr) / n,
      scada: so ? (100 * sd) / so : 100,
      dcs: sum((l) => l.dcsEvents),
      radar: sum((l) => l.radarEvents),
    };
  }
}

// ---------------------------------------------------------------- mac.py (WORP)
export const worpEfficiency = (n: number, payload = 20, poll = 6.67) => (n <= 0 ? 0 : (n * payload) / (n * (payload + poll)));

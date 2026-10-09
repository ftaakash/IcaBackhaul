import { useRef } from "react";
import { css, useCanvas } from "@/lib/motion";
import { live } from "@/lib/live";
import { noiseFloorDbm, RADIO } from "@/engine/engine";

const F0 = 5150, F1 = 5925, DB_LO = -100, DB_HI = -40;
const BANDS = [
  { lo: 5150, hi: 5250, name: "U-NII-1" }, { lo: 5250, hi: 5350, name: "U-NII-2A" },
  { lo: 5470, hi: 5725, name: "U-NII-2C" }, { lo: 5725, hi: 5850, name: "U-NII-3" }, { lo: 5850, hi: 5925, name: "5.9" },
];

/** The unlicensed 5 GHz band, live: third-party transmitters flicker on and off above the
 *  noise floor while Electro Dunas' 15 channels sit in lanes underneath. */
export function SpectrumView({ active }: { active: boolean }) {
  const alpha = useRef(new Map<object, number>());
  const xs = useRef<number[]>([]);
  const last = useRef(0);
  const ref = useCanvas((ctx, w, h, now) => {
    const C = (k: string) => css(k);
    const dt = Math.min(0.1, (now - (last.current || now)) / 1000); last.current = now;
    const net = live.net;
    const padL = 46, padR = 14, top = 34, laneH = 15;
    const lanesTop = h - 8 - laneH * 5;
    const plotB = lanesTop - 46;
    const X = (f: number) => padL + ((f - F0) / (F1 - F0)) * (w - padL - padR);
    const Y = (db: number) => top + ((DB_HI - db) / (DB_HI - DB_LO)) * (plotB - top);
    ctx.clearRect(0, 0, w, h);
    const mono = css("--f-data") || "monospace";

    // bands + DFS shading
    ctx.font = `10.5px ${mono}`; ctx.textAlign = "center";
    for (const b of BANDS) {
      ctx.fillStyle = C("--ground"); ctx.globalAlpha = 0.55;
      ctx.fillRect(X(b.lo), top, X(b.hi) - X(b.lo), plotB - top);
      ctx.globalAlpha = 1; ctx.fillStyle = C("--faint");
      ctx.fillText(b.name, (X(b.lo) + X(b.hi)) / 2, top - 10);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(X(5250), top, X(5730) - X(5250), plotB - top); ctx.clip();
    ctx.strokeStyle = C("--rule"); ctx.lineWidth = 1;
    for (let i = -h; i < w; i += 9) { ctx.beginPath(); ctx.moveTo(i, plotB); ctx.lineTo(i + (plotB - top), top); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = C("--faint"); ctx.textAlign = "left";
    ctx.fillText("DFS: radar-protected, must vacate on detection", X(5256), plotB - 8);

    // y grid
    ctx.textAlign = "right";
    for (let db = -100; db <= -40; db += 20) {
      ctx.strokeStyle = C("--rule"); ctx.beginPath(); ctx.moveTo(padL, Y(db)); ctx.lineTo(w - padR, Y(db)); ctx.stroke();
      ctx.fillStyle = C("--faint"); ctx.fillText(`${db}`, padL - 6, Y(db) + 3.5);
    }
    ctx.save(); ctx.translate(12, (top + plotB) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("dBm", 0, 0); ctx.restore();

    // third-party interferers
    const sig = C("--dune"), crit = C("--crit");
    for (const itf of net.spectrum.interferers) {
      const a0 = alpha.current.get(itf) ?? 0;
      const target = itf.active ? 1 : 0.1;
      const a = a0 + (target - a0) * Math.min(1, dt * 6);
      alpha.current.set(itf, a);
      const lo = itf.channel.lo, hi = lo + itf.channel.width;
      const lvl = Math.min(DB_HI, itf.level);
      ctx.globalAlpha = 0.22 * a; ctx.fillStyle = itf.injected ? crit : sig;
      ctx.fillRect(X(lo) + 1, Y(lvl), X(hi) - X(lo) - 2, plotB - Y(lvl));
      ctx.globalAlpha = 0.9 * a; ctx.strokeStyle = itf.injected ? crit : sig; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(X(lo) + 1, Y(lvl)); ctx.lineTo(X(hi) - 1, Y(lvl)); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // noise floor for a 40 MHz channel
    const nf = noiseFloorDbm(RADIO.width, RADIO.nf);
    ctx.strokeStyle = C("--dim"); ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(padL, Y(nf)); ctx.lineTo(w - padR, Y(nf)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C("--dim"); ctx.textAlign = "right";
    ctx.fillText(`noise floor, 40 MHz: ${nf.toFixed(0)} dBm`, w - padR - 4, Y(nf) - 6);

    // our 15 channels in lanes
    ctx.strokeStyle = C("--rule"); ctx.beginPath(); ctx.moveTo(padL, lanesTop - 6); ctx.lineTo(w - padR, lanesTop - 6); ctx.stroke();
    ctx.fillStyle = C("--signal"); ctx.textAlign = "left";
    ctx.font = `10.5px ${mono}`; ctx.fillText("ELECTRO DUNAS LINKS", padL, lanesTop - 12);
    const lanes: number[][] = [[], [], [], [], []];
    net.links.forEach((l, i) => {
      const ch = l.channel!;
      const tx = X(ch.lo);
      const cur = xs.current[i] ?? tx;
      const x = cur + (tx - cur) * Math.min(1, dt * 5);
      xs.current[i] = x;
      const wpx = X(ch.lo + ch.width) - X(ch.lo);
      let lane = lanes.findIndex((ln) => ln.every((e) => Math.abs(e - x) > wpx - 1));
      if (lane < 0) lane = 4;
      lanes[lane].push(x);
      const y = lanesTop + lane * laneH;
      ctx.fillStyle = l.up ? C("--signal") : C("--crit");
      ctx.globalAlpha = l.up ? 0.85 : 0.6;
      ctx.fillRect(x + 1, y, wpx - 2, laneH - 4);
      ctx.globalAlpha = 1; ctx.fillStyle = C("--ground"); ctx.font = `600 9.5px ${mono}`; ctx.textAlign = "center";
      ctx.fillText(String(i + 1).padStart(2, "0"), x + wpx / 2, y + 8.5);
    });

    // x axis labels
    ctx.font = `10.5px ${mono}`; ctx.fillStyle = C("--faint"); ctx.textAlign = "center";
    for (const f of [5200, 5400, 5600, 5800]) ctx.fillText(`${(f / 1000).toFixed(1)} GHz`, X(f), plotB + 14);
  }, active);
  return <canvas ref={ref} role="img" aria-label="Live 5 GHz spectrum: third-party transmitters switching on and off, DFS radar band shaded, and the fifteen Electro Dunas channels in lanes below." />;
}

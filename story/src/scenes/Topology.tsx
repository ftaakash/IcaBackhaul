import { useRef } from "react";
import { css, reducedMotion, useCanvas } from "@/lib/motion";
import { live } from "@/lib/live";
import { SITES } from "@/engine/engine";

interface Props { active: boolean; selected?: number | null; onSelect?: (id: number) => void; labels?: boolean }

const MAX_KM = 13.8;

/** Radial map of the 15 point-to-point links around the data-center mast.
 *  Line weight = capacity, colour = link state, moving dots = delivered traffic. */
export function Topology({ active, selected = null, onSelect, labels = true }: Props) {
  const anim = useRef(SITES.map(() => ({ w: 1, c: 0, packets: [] as number[], acc: 0, hopSeen: -1, pulse: 0 })));
  const geom = useRef<{ cx: number; cy: number; R: number }>({ cx: 0, cy: 0, R: 1 });
  const last = useRef(0);
  const colors = useRef<Record<string, string> | null>(null);

  const ref = useCanvas((ctx, w, h, now) => {
    if (!colors.current) colors.current = Object.fromEntries(["--rule", "--faint", "--dim", "--bone", "--signal", "--dune", "--ok", "--warn", "--crit", "--panel", "--ground"].map((k) => [k, css(k)]));
    const C = colors.current;
    const dt = Math.min(0.1, (now - (last.current || now)) / 1000); last.current = now;
    const net = live.net;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 34;
    geom.current = { cx, cy, R };
    const rOf = (km: number) => 34 + (R - 34) * (km / MAX_KM);
    ctx.clearRect(0, 0, w, h);

    // range rings
    ctx.font = `11px ${css("--f-data") || "monospace"}`;
    ctx.textAlign = "left";
    for (const km of [5, 10]) {
      ctx.beginPath(); ctx.arc(cx, cy, rOf(km), 0, Math.PI * 2);
      ctx.strokeStyle = C["--rule"]; ctx.setLineDash([2, 5]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = C["--faint"]; ctx.fillText(`${km} km`, cx + 4, cy - rOf(km) - 4);
    }
    // compass ticks
    for (let a = 0; a < 360; a += 30) {
      const ang = ((a - 90) * Math.PI) / 180, r1 = R + 6, r2 = R + (a % 90 === 0 ? 16 : 11);
      ctx.beginPath(); ctx.moveTo(cx + r1 * Math.cos(ang), cy + r1 * Math.sin(ang)); ctx.lineTo(cx + r2 * Math.cos(ang), cy + r2 * Math.sin(ang));
      ctx.strokeStyle = C["--rule"]; ctx.stroke();
    }
    ctx.fillStyle = C["--faint"]; ctx.textAlign = "center"; ctx.fillText("N", cx, cy - R - 20);

    const rm = reducedMotion();
    net.links.forEach((l, i) => {
      const a = anim.current[i];
      const ang = ((l.site.bearing - 90) * Math.PI) / 180;
      const r = rOf(l.km), x = cx + r * Math.cos(ang), y = cy + r * Math.sin(ang);
      const targetW = l.up ? 1.2 + 4.5 * (l.capacity / net.cap) : 1;
      const state = !l.up ? 2 : l.sinr < 18 || l.per > 0.1 ? 1 : 0;
      a.w += (targetW - a.w) * Math.min(1, dt * 4);
      a.c += (state - a.c) * Math.min(1, dt * 5);
      const col = a.c < 0.5 ? C["--ok"] : a.c < 1.5 ? C["--warn"] : C["--crit"];
      const dim = selected !== null && selected !== i;

      // link line
      ctx.globalAlpha = dim ? 0.28 : 0.9;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y);
      ctx.strokeStyle = col; ctx.lineWidth = a.w;
      if (!l.up) ctx.setLineDash([3, 5]);
      ctx.stroke(); ctx.setLineDash([]);

      // packets: uplink traffic flowing to the data center
      if (l.up && !rm) {
        a.acc += dt * (0.4 + l.delivered / 22);
        while (a.acc > 1) { a.acc -= 1; a.packets.push(0); }
        const speed = 0.55;
        a.packets = a.packets.map((p) => p + dt * speed).filter((p) => p < 1);
        ctx.fillStyle = C["--bone"];
        for (const p of a.packets) {
          const px = x + (cx - x) * p, py = y + (cy - y) * p;
          ctx.globalAlpha = (dim ? 0.25 : 0.85) * Math.sin(Math.PI * p);
          ctx.beginPath(); ctx.arc(px, py, 1.6, 0, Math.PI * 2); ctx.fill();
        }
      } else a.packets = [];

      // channel hop pulse
      if (l.lastHop !== a.hopSeen) { if (a.hopSeen !== -1) a.pulse = 1; a.hopSeen = l.lastHop; }
      if (a.pulse > 0) {
        a.pulse = Math.max(0, a.pulse - dt * 0.7);
        ctx.globalAlpha = a.pulse; ctx.strokeStyle = C["--signal"]; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 8 + (1 - a.pulse) * 26, 0, Math.PI * 2); ctx.stroke();
      }

      // node glyph by site type
      ctx.globalAlpha = dim ? 0.4 : 1;
      ctx.fillStyle = C["--panel"]; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath();
      const s = selected === i ? 8.5 : 6.5;
      if (l.site.kind === "thermal") ctx.rect(x - s, y - s, 2 * s, 2 * s);
      else if (l.site.kind === "substation") { ctx.moveTo(x, y - s - 1.5); ctx.lineTo(x + s + 1.5, y); ctx.lineTo(x, y + s + 1.5); ctx.lineTo(x - s - 1.5, y); ctx.closePath(); }
      else ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();

      if (labels || selected === i) {
        ctx.fillStyle = selected === i ? C["--bone"] : C["--dim"];
        ctx.font = `${selected === i ? 12 : 10.5}px ${css("--f-data") || "monospace"}`;
        const right = Math.cos(ang) >= 0;
        ctx.textAlign = right ? "left" : "right";
        const label = selected === i ? `${String(i + 1).padStart(2, "0")} ${l.site.name}` : String(i + 1).padStart(2, "0");
        ctx.fillText(label, x + (right ? 13 : -13), y + 4);
      }
      ctx.globalAlpha = 1;
    });

    // hub
    ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fillStyle = C["--dune"]; ctx.fill();
    ctx.fillStyle = C["--ground"]; ctx.font = `700 12px ${css("--f-data") || "monospace"}`; ctx.textAlign = "center";
    ctx.fillText("DC", cx, cy + 4);
  }, active);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelect) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const { cx, cy, R } = geom.current;
    let best = -1, bd = 22;
    SITES.forEach((s, i) => {
      const ang = ((s.bearing - 90) * Math.PI) / 180, r = 34 + (R - 34) * (s.distanceKm / MAX_KM);
      const d = Math.hypot(cx + r * Math.cos(ang) - mx, cy + r * Math.sin(ang) - my);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) onSelect(best);
  };

  return (
    <canvas ref={ref} onClick={click} style={{ cursor: onSelect ? "pointer" : "default" }}
      role="img" aria-label="Radial map of fifteen radio links from the data center; line weight shows capacity and colour shows link health." />
  );
}

export function TopologyLegend() {
  const item = (shape: React.ReactNode, text: string) => (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>{shape}{text}</span>
  );
  const sq = { width: 10, height: 10, border: "2px solid var(--dim)", display: "inline-block" } as const;
  return (
    <div className="caption">
      {item(<span style={{ ...sq, borderRadius: "50%" }} />, "office")}
      {item(<span style={{ ...sq, transform: "rotate(45deg) scale(.85)" }} />, "substation")}
      {item(<span style={sq} />, "thermal plant")}
      {item(<span style={{ width: 14, height: 3, background: "var(--ok)", display: "inline-block" }} />, "healthy")}
      {item(<span style={{ width: 14, height: 3, background: "var(--warn)", display: "inline-block" }} />, "degraded")}
      {item(<span style={{ width: 14, height: 0, borderTop: "3px dashed var(--crit)", display: "inline-block" }} />, "down")}
    </div>
  );
}

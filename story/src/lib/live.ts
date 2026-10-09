import { useEffect, useState } from "react";
import { Network, type NetOptions } from "@/engine/engine";

/** One shared live network. It steps only while a scene that shows it is on screen. */
class LiveSim {
  net: Network;
  opts: NetOptions = { seed: 7 };
  speed = 2;            // simulated minutes per tick
  private users = 0;
  private timer: number | null = null;
  private listeners = new Set<() => void>();
  constructor() { this.net = new Network(this.opts); this.net.run(360); } // start mid-morning with history
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((f) => f()); }
  acquire() { this.users++; this.ensure(); }
  release() { this.users = Math.max(0, this.users - 1); this.ensure(); }
  private ensure() {
    const want = this.users > 0;
    if (want && this.timer === null) {
      this.timer = window.setInterval(() => {
        if (document.hidden) return;
        this.net.run(this.speed);
        this.emit();
      }, 160);
    } else if (!want && this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }
  reset(clearconnect = this.net.clearconnect) {
    this.net = new Network({ ...this.opts, clearconnect });
    this.net.run(360);
    this.emit();
  }
}
export const live = new LiveSim();

/** Re-render on every live tick while `active`. */
export function useLive(active: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    live.acquire();
    const off = live.subscribe(() => setN((n) => n + 1));
    return () => { off(); live.release(); };
  }, [active]);
  return live;
}

export const clock = (net: Network) => {
  const m = net.env.minute % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

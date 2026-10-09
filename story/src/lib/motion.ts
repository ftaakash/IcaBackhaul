import { useEffect, useRef, useState } from "react";

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Tween a number (or array of numbers) toward its target; replays from `from` when `replayKey` changes. */
export function useTween<T extends number | number[]>(target: T, ms = 900, replayKey?: unknown, from?: T): T {
  const [val, setVal] = useState<T>(target);
  const cur = useRef<T>(target);
  const lastKey = useRef(replayKey);
  useEffect(() => {
    let start = cur.current;
    if (replayKey !== lastKey.current) { lastKey.current = replayKey; if (from !== undefined) start = from; }
    if (reducedMotion()) { cur.current = target; setVal(target); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = ease(Math.min(1, (now - t0) / ms));
      let next: T;
      if (Array.isArray(target)) {
        const s = start as number[];
        next = target.map((v, i) => (s[i] ?? v) + (v - (s[i] ?? v)) * k) as T;
      } else next = ((start as number) + ((target as number) - (start as number)) * k) as T;
      cur.current = next;
      setVal(next);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(target), replayKey]);
  return val;
}

/** Canvas sized to its box with devicePixelRatio, redrawn every frame by `draw`. */
export function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void, active: boolean) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const c = ref.current;
    if (!c || !active) return;
    const ctx = c.getContext("2d")!;
    let raf = 0, w = 0, h = 0;
    const resize = () => {
      const r = c.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
      w = r.width; h = r.height;
      c.width = Math.max(1, Math.round(w * d)); c.height = Math.max(1, Math.round(h * d));
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(c); resize();
    const loop = (t: number) => { if (w > 0) drawRef.current(ctx, w, h, t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [active]);
  return ref;
}

export const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

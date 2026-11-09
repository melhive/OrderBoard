// The Talk mode "AI orb": a living, glowing sphere drawn on a canvas.
//
// - listening: liquid layers wobble with your voice (mic level on Android,
//   a gentle simulated motion in the browser) and ripples spring off it
// - thinking:  the layers swirl and sparks orbit around it
// - speaking:  it pulses with every word that is spoken
// - paused / error: it dims and breathes slowly
//
// One requestAnimationFrame loop; no React re-renders per frame (live values
// arrive through refs). Colours and motion ease between states, so changes
// never jump. Respects "reduce motion".

import { useEffect, useRef, type MutableRefObject } from "react";

export type OrbState = "starting" | "listening" | "thinking" | "speaking" | "paused" | "error";

interface Props {
  state: OrbState;
  /** Mic loudness 0–1 (updated by the caller; read every frame). */
  level: MutableRefObject<number>;
  /** Set to 1 on each spoken word; the orb decays it. */
  pulse: MutableRefObject<number>;
  size?: number;
}

type RGB = [number, number, number];
interface Palette {
  a: RGB; // main body
  b: RGB; // second layer
  c: RGB; // accent / highlights
  glow: RGB;
  dim: number; // 0 = full colour, 1 = greyed out
}

const PALETTES: Record<OrbState, Palette> = {
  starting: { a: [240, 97, 79], b: [242, 169, 59], c: [255, 214, 150], glow: [240, 97, 79], dim: 0.2 },
  listening: { a: [240, 90, 72], b: [255, 150, 60], c: [255, 222, 160], glow: [245, 100, 70], dim: 0 },
  thinking: { a: [214, 64, 110], b: [240, 97, 79], c: [255, 190, 120], glow: [220, 80, 110], dim: 0 },
  speaking: { a: [255, 110, 70], b: [255, 190, 70], c: [255, 240, 200], glow: [255, 150, 70], dim: 0 },
  paused: { a: [120, 108, 100], b: [150, 132, 118], c: [210, 200, 190], glow: [120, 100, 90], dim: 0.75 },
  error: { a: [150, 110, 80], b: [190, 140, 70], c: [230, 210, 170], glow: [170, 120, 60], dim: 0.55 },
};

const mix = (x: number, y: number, t: number) => x + (y - x) * t;
const mixRGB = (p: RGB, q: RGB, t: number): RGB => [mix(p[0], q[0], t), mix(p[1], q[1], t), mix(p[2], q[2], t)];
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;

interface Ripple {
  r: number;
  a: number;
}

export function AiOrb({ state, level, pulse, size = 260 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    // jsdom (tests) has no canvas.
    if (!canvas || /jsdom/i.test(navigator.userAgent)) return;
    const ctx = canvas.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const C = size / 2;
    const R = size * 0.22; // resting radius of the body (leaves room for the glow)
    const pal: Palette = { ...PALETTES[stateRef.current], a: [...PALETTES[stateRef.current].a], b: [...PALETTES[stateRef.current].b], c: [...PALETTES[stateRef.current].c], glow: [...PALETTES[stateRef.current].glow] };
    let energy = 0.15; // smoothed overall liveliness 0..1
    let swirl = 0; // smoothed "thinking" amount 0..1
    let spin = 0; // extra rotation while thinking
    let lastPeak = 0;
    const ripples: Ripple[] = [];
    let raf = 0;
    let last = performance.now();
    let t = 0;

    /** A soft, wobbly closed blob around the centre. */
    const blob = (radius: number, amp: number, phase: number, speed: number, lobes: [number, number, number], fill: string | CanvasGradient) => {
      const N = 72;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const th = (i / N) * Math.PI * 2;
        const w =
          0.5 * Math.sin(lobes[0] * th + t * 1.3 * speed + phase) +
          0.3 * Math.sin(lobes[1] * th - t * 1.9 * speed + phase * 1.7) +
          0.2 * Math.sin(lobes[2] * th + t * 2.7 * speed + phase * 0.6);
        const r = radius * (1 + amp * w);
        const x = C + Math.cos(th + spin) * r;
        const y = C + Math.sin(th + spin) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += reduce ? dt * 0.25 : dt;
      const st = stateRef.current;
      const target = PALETTES[st];

      // Ease colours toward the current state's palette.
      const k = 1 - Math.pow(0.02, dt); // ~ fast but smooth
      pal.a = mixRGB(pal.a, target.a, k);
      pal.b = mixRGB(pal.b, target.b, k);
      pal.c = mixRGB(pal.c, target.c, k);
      pal.glow = mixRGB(pal.glow, target.glow, k);
      pal.dim = mix(pal.dim, target.dim, k);

      // How lively the orb should be right now.
      const p = pulse.current;
      pulse.current = Math.max(0, p - dt * 3.2); // each word pulse fades in ~0.3 s
      let want: number;
      if (st === "listening") {
        const lv = level.current;
        // Browser: no mic level, so a calm "I'm listening" motion.
        want = Math.max(0.22 + 0.06 * Math.sin(t * 2.2), lv * 1.1);
        if (lv > 0.45 && now - lastPeak > 260 && !reduce) {
          ripples.push({ r: R * 1.05, a: 0.38 * Math.min(1, lv + 0.2) });
          lastPeak = now;
        }
      } else if (st === "speaking") {
        want = 0.4 + 0.5 * p + 0.08 * Math.sin(t * 9);
        if (p > 0.95 && !reduce) ripples.push({ r: R * 1.05, a: 0.22 });
      } else if (st === "thinking") want = 0.35;
      else if (st === "paused" || st === "error") want = 0.06 + 0.04 * Math.sin(t * 1.2);
      else want = 0.18 + 0.05 * Math.sin(t * 1.6);
      if (reduce) want = Math.min(want, 0.2);
      energy += (want - energy) * (want > energy ? 1 - Math.pow(0.0005, dt) : 1 - Math.pow(0.08, dt));
      swirl += ((st === "thinking" ? 1 : 0) - swirl) * (1 - Math.pow(0.05, dt));
      spin += dt * (0.15 + swirl * 2.2);

      ctx.clearRect(0, 0, size, size);
      const breathe = 1 + 0.02 * Math.sin(t * 1.6) + energy * 0.1;
      const body = R * breathe;
      const bright = 1 - pal.dim * 0.6;

      // 1. Aura.
      // Fades to nothing before the canvas edge, so the glow never shows a square border.
      const auraR = Math.min(C * 0.98, body * (1.75 + energy * 0.55));
      const aura = ctx.createRadialGradient(C, C, body * 0.6, C, C, auraR);
      aura.addColorStop(0, rgba(pal.glow, (0.42 + energy * 0.3) * bright));
      aura.addColorStop(0.45, rgba(pal.glow, (0.13 + energy * 0.12) * bright));
      aura.addColorStop(1, rgba(pal.glow, 0));
      ctx.fillStyle = aura;
      ctx.beginPath();
      ctx.arc(C, C, auraR, 0, Math.PI * 2);
      ctx.fill();

      // 2. Ripples springing off the surface.
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i]!;
        rp.r += dt * R * 1.6;
        rp.a -= dt * 0.55;
        // Fade out as they approach the edge of the canvas.
        if (rp.r > C * 0.8) rp.a -= dt * 2.5;
        if (rp.a <= 0 || rp.r > C * 0.97) {
          ripples.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(C, C, rp.r, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(pal.c, rp.a * bright);
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 3. Liquid layers, blended additively for a glowing, molten look.
      const amp = 0.035 + energy * 0.17 + swirl * 0.05;
      ctx.globalCompositeOperation = "lighter";
      const layer = (scale: number, col: RGB, alpha: number, phase: number, speed: number, lobes: [number, number, number], ox: number, oy: number) => {
        const r = body * scale;
        const g = ctx.createRadialGradient(C + ox * r, C + oy * r, r * 0.1, C, C, r * 1.25);
        g.addColorStop(0, rgba(col, alpha * bright));
        g.addColorStop(0.7, rgba(col, alpha * 0.55 * bright));
        g.addColorStop(1, rgba(col, 0));
        blob(r, amp * (scale > 1 ? 1.25 : 1), phase, speed, lobes, g);
      };
      layer(1.12, pal.a, 0.55, 0, 1, [3, 5, 7], Math.cos(t * 0.7) * 0.3, Math.sin(t * 0.9) * 0.3);
      layer(1.0, pal.b, 0.5, 2.1, 1.25, [4, 6, 9], Math.cos(t * 1.1 + 2) * 0.35, Math.sin(t * 0.8 + 1) * 0.35);
      layer(0.86, pal.a, 0.45, 4.2, 1.5, [2, 5, 8], Math.sin(t * 1.3) * 0.3, Math.cos(t * 1.2) * 0.3);
      ctx.globalCompositeOperation = "source-over";

      // 4. Glassy core with a highlight, so it reads as a sphere.
      const core = ctx.createRadialGradient(C - body * 0.32, C - body * 0.38, body * 0.05, C, C, body * 0.98);
      core.addColorStop(0, rgba(mixRGB(pal.c, [255, 255, 255], 0.55), 0.95 * bright + 0.05));
      core.addColorStop(0.35, rgba(pal.b, 0.85 * bright + 0.1));
      core.addColorStop(0.8, rgba(pal.a, 0.9 * bright + 0.1));
      core.addColorStop(1, rgba(mixRGB(pal.a, [40, 10, 10], 0.35), 0.95));
      blob(body * 0.82, amp * 0.45, 1.3, 0.9, [3, 4, 6], core);
      // Rim light.
      const rim = ctx.createRadialGradient(C, C, body * 0.55, C, C, body * 0.86);
      rim.addColorStop(0, "rgba(255,255,255,0)");
      rim.addColorStop(1, rgba(pal.c, 0.28 * bright));
      blob(body * 0.84, amp * 0.45, 1.3, 0.9, [3, 4, 6], rim);
      // Specular glint.
      const glint = ctx.createRadialGradient(C - body * 0.3, C - body * 0.36, 0, C - body * 0.3, C - body * 0.36, body * 0.32);
      glint.addColorStop(0, `rgba(255,255,255,${0.55 * bright + 0.1})`);
      glint.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glint;
      ctx.beginPath();
      ctx.arc(C - body * 0.3, C - body * 0.36, body * 0.32, 0, Math.PI * 2);
      ctx.fill();

      // 5. Sparks orbiting while thinking.
      if (swirl > 0.02) {
        for (let i = 0; i < 7; i++) {
          const ang = t * (2.4 + i * 0.12) + (i * Math.PI * 2) / 7;
          const rr = body * (1.28 + 0.1 * Math.sin(t * 3 + i));
          for (let j = 0; j < 4; j++) {
            const a2 = ang - j * 0.09;
            ctx.beginPath();
            ctx.arc(C + Math.cos(a2) * rr, C + Math.sin(a2) * rr, Math.max(0.6, 2.6 - j * 0.6), 0, Math.PI * 2);
            ctx.fillStyle = rgba(pal.c, swirl * (0.9 - j * 0.22));
            ctx.fill();
          }
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, level, pulse]);

  return <canvas ref={canvasRef} className="ai-orb" style={{ width: size, height: size }} aria-hidden />;
}

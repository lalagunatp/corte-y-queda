import type { Clip, Project } from "./types";

export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const clipEnd = (c: Clip) => c.start + c.duration;

export function projectDuration(p: Project): number {
  return p.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

export function formatTime(t: number, fps = 30): string {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const f = Math.floor((total % 1) * fps);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

/** Multiplicador de opacidad/volumen por fundidos de entrada y salida. */
export function fadeFactor(c: Clip, t: number): number {
  const local = t - c.start;
  let k = 1;
  if (c.fadeIn > 0) k = Math.min(k, local / c.fadeIn);
  if (c.fadeOut > 0) k = Math.min(k, (c.duration - local) / c.fadeOut);
  return clamp(k, 0, 1);
}

export const isActive = (c: Clip, t: number) => t >= c.start && t < clipEnd(c);

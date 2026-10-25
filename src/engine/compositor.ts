import type { Clip, MediaClip, Project, TextClip } from "../types";
import { fadeFactor, isActive } from "../util";

export type FrameSource = HTMLVideoElement | HTMLImageElement;

/** Clips visibles en t, en orden de dibujo (de abajo arriba). */
export function visibleClips(p: Project, t: number): Clip[] {
  const out: Clip[] = [];
  // La pista de arriba en la lista se dibuja encima, así que se recorren al revés.
  for (const track of [...p.tracks].reverse()) {
    if (track.kind === "audio" || track.hidden) continue;
    const clips = p.clips.filter((c) => c.trackId === track.id && isActive(c, t)).sort((a, b) => a.start - b.start);
    out.push(...clips);
  }
  return out;
}

/** Tiempo dentro del archivo fuente que corresponde al instante t del proyecto. */
export const sourceTime = (c: MediaClip, t: number) => c.inPoint + (t - c.start) * c.speed;

function sourceSize(s: FrameSource): [number, number] {
  return s instanceof HTMLVideoElement ? [s.videoWidth, s.videoHeight] : [s.naturalWidth, s.naturalHeight];
}

function drawMedia(ctx: CanvasRenderingContext2D, p: Project, c: MediaClip, src: FrameSource, t: number) {
  const [sw, sh] = sourceSize(src);
  if (!sw || !sh) return;
  const fit = Math.min(p.width / sw, p.height / sh) * c.scale;
  const w = sw * fit;
  const h = sh * fit;
  ctx.save();
  ctx.globalAlpha = c.opacity * fadeFactor(c, t);
  ctx.filter = `brightness(${c.brightness}) contrast(${c.contrast}) saturate(${c.saturation})`;
  ctx.translate(p.width / 2 + (c.x * p.width) / 2, p.height / 2 + (c.y * p.height) / 2);
  if (c.rotation) ctx.rotate((c.rotation * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, p: Project, c: TextClip, t: number) {
  const lines = c.text.split("\n");
  const lineHeight = c.fontSize * 1.2;
  ctx.save();
  ctx.globalAlpha = fadeFactor(c, t);
  ctx.font = `${c.bold ? 700 : 500} ${c.fontSize}px "Segoe UI", Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = p.width / 2 + (c.x * p.width) / 2;
  const cy = p.height / 2 + (c.y * p.height) / 2;
  const top = cy - (lineHeight * (lines.length - 1)) / 2;
  const hasBg = !/^#[0-9a-f]{6}00$/i.test(c.background);
  if (hasBg) {
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const pad = c.fontSize * 0.3;
    ctx.fillStyle = c.background;
    ctx.fillRect(cx - width / 2 - pad, top - lineHeight / 2 - pad / 2, width + pad * 2, lineHeight * lines.length + pad);
  } else {
    // Sombra suave para que el texto se lea sobre cualquier fondo.
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = c.fontSize * 0.12;
  }
  ctx.fillStyle = c.color;
  lines.forEach((l, i) => ctx.fillText(l, cx, top + i * lineHeight));
  ctx.restore();
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  p: Project,
  t: number,
  sourceFor: (c: MediaClip) => FrameSource | null,
) {
  ctx.save();
  ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, p.width, p.height);
  for (const c of visibleClips(p, t)) {
    if (c.type === "text") drawText(ctx, p, c, t);
    else {
      const src = sourceFor(c);
      if (src) drawMedia(ctx, p, c, src, t);
    }
  }
  ctx.restore();
}

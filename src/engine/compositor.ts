import type { VideoSample } from "mediabunny";
import type { Clip, MediaClip, Project, TextClip } from "../types";
import { fadeFactor, isActive } from "../util";

/** Imagen de un clip: elemento del navegador (vista previa) o fotograma decodificado (exportación). */
export type FrameSource = HTMLVideoElement | HTMLImageElement | VideoSample;

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
  if (s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
  if (s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
  // Tamaño ya girado según los metadatos del video (p. ej. grabaciones de celular).
  return [s.displayWidth, s.displayHeight];
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
  if (src instanceof HTMLVideoElement || src instanceof HTMLImageElement) ctx.drawImage(src, -w / 2, -h / 2, w, h);
  else src.draw(ctx, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Parte cada renglón en líneas que caben en maxWidth; una palabra más larga que el ancho queda sola. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

function drawText(ctx: CanvasRenderingContext2D, p: Project, c: TextClip, t: number): Rect {
  ctx.save();
  ctx.globalAlpha = fadeFactor(c, t);
  ctx.font = `${c.bold ? 700 : 500} ${c.fontSize}px "Segoe UI", Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const margin = Math.min(p.width, p.height) * 0.05;
  // El texto salta de línea antes de salirse del encuadre (clave en formato vertical).
  const lines = wrap(ctx, c.text, p.width - margin * 2);
  const lineHeight = c.fontSize * 1.2;
  const pad = c.fontSize * 0.3;
  const blockH = lineHeight * lines.length + pad;
  const width = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
  const cx = Math.min(Math.max(p.width / 2 + (c.x * p.width) / 2, margin + width / 2), p.width - margin - width / 2);
  // El bloque entero se mantiene dentro del cuadro aunque tenga varias líneas.
  const wantedCy = p.height / 2 + (c.y * p.height) / 2;
  const cy = Math.min(Math.max(wantedCy, margin + blockH / 2), p.height - margin - blockH / 2);
  const top = cy - (lineHeight * (lines.length - 1)) / 2;
  const box: Rect = { x: cx - width / 2 - pad, y: cy - blockH / 2, w: width + pad * 2, h: blockH };
  const hasBg = !/^#[0-9a-f]{6}00$/i.test(c.background);
  if (hasBg) {
    ctx.fillStyle = c.background;
    ctx.fillRect(box.x, box.y, box.w, box.h);
  } else {
    // Sombra suave para que el texto se lea sobre cualquier fondo.
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = c.fontSize * 0.12;
  }
  ctx.fillStyle = c.color;
  lines.forEach((l, i) => ctx.fillText(l, cx, top + i * lineHeight));
  ctx.restore();
  return box;
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  p: Project,
  t: number,
  sourceFor: (c: MediaClip) => FrameSource | null,
  /** Recibe el recuadro de cada texto dibujado (coordenadas del proyecto), para poder tocarlo. */
  onText?: (c: TextClip, box: Rect) => void,
) {
  ctx.save();
  ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, p.width, p.height);
  for (const c of visibleClips(p, t)) {
    if (c.type === "text") {
      const box = drawText(ctx, p, c, t);
      onText?.(c, box);
    }
    else {
      const src = sourceFor(c);
      if (src) drawMedia(ctx, p, c, src, t);
    }
  }
  ctx.restore();
}

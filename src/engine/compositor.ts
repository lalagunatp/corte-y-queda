import type { VideoSample } from "mediabunny";
import type { Clip, MediaClip, Project, TextClip } from "../types";
import { applyCase, cssFont, isClear } from "../text";
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

const requested = new Set<string>();

/** Si la fuente aún no está cargada, la pide; el siguiente fotograma ya la usa. */
function ensureFont(font: string, sample: string) {
  if (typeof document === "undefined" || !document.fonts || requested.has(font)) return;
  if (document.fonts.check(font, sample)) return;
  requested.add(font);
  void document.fonts.load(font, sample).finally(() => requested.delete(font));
}

function boxPath(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath();
  const rr = Math.min(r.w, r.h) / 2 * Math.min(1, Math.max(0, radius));
  if (rr > 0 && ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, rr);
  else ctx.rect(r.x, r.y, r.w, r.h);
}

/** Dibuja un texto (o subtítulo); se usa también para las miniaturas de estilos. */
export function drawText(ctx: CanvasRenderingContext2D, p: Pick<Project, "width" | "height">, c: TextClip, t: number): Rect {
  ctx.save();
  ctx.globalAlpha = fadeFactor(c, t) * c.opacity;
  const text = applyCase(c.text, c.textCase);
  const font = cssFont(c);
  ensureFont(font, text || "Aa");
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const spacing = c.letterSpacing * c.fontSize;
  const spaced = "letterSpacing" in ctx;
  if (spaced) ctx.letterSpacing = `${spacing}px`;
  // El espaciado se suma también tras la última letra; se descuenta para que el renglón quede centrado.
  const measure = (l: string) => Math.max(0, ctx.measureText(l).width - (spaced && l ? spacing : 0));
  const margin = Math.min(p.width, p.height) * 0.05;
  // El texto salta de línea antes de salirse del encuadre (clave en formato vertical).
  const lines = wrap(ctx, text, p.width - margin * 2);
  const widths = lines.map(measure);
  const lineHeight = c.fontSize * c.lineHeight;
  const padX = c.fontSize * c.bgPadding;
  const padY = padX / 2;
  const blockH = lineHeight * lines.length + padY * 2;
  const width = Math.max(0, ...widths);
  const cx = Math.min(Math.max(p.width / 2 + (c.x * p.width) / 2, margin + width / 2), p.width - margin - width / 2);
  // El bloque entero se mantiene dentro del cuadro aunque tenga varias líneas.
  const wantedCy = p.height / 2 + (c.y * p.height) / 2;
  const cy = Math.min(Math.max(wantedCy, margin + blockH / 2), p.height - margin - blockH / 2);
  const box: Rect = { x: cx - width / 2 - padX, y: cy - blockH / 2, w: width + padX * 2, h: blockH };

  ctx.translate(cx, cy);
  if (c.rotation) ctx.rotate((c.rotation * Math.PI) / 180);
  const top = -blockH / 2 + padY + lineHeight / 2;
  const lineX = (w: number) => (c.align === "left" ? -width / 2 : c.align === "right" ? width / 2 - w : -w / 2);

  if (!isClear(c.background)) {
    ctx.fillStyle = c.background;
    if (c.bgShape === "lines") {
      lines.forEach((l, i) => {
        if (!l) return;
        boxPath(ctx, { x: lineX(widths[i]) - padX, y: top + i * lineHeight - lineHeight / 2 - padY / 2, w: widths[i] + padX * 2, h: lineHeight + padY }, c.bgRadius);
        ctx.fill();
      });
    } else {
      boxPath(ctx, { x: -width / 2 - padX, y: -blockH / 2, w: width + padX * 2, h: blockH }, c.bgRadius);
      ctx.fill();
    }
  }

  let fill: string | CanvasGradient = c.color;
  if (c.gradient) {
    const g = ctx.createLinearGradient(0, top - c.fontSize / 2, 0, top + (lines.length - 1) * lineHeight + c.fontSize / 2);
    g.addColorStop(0, c.color);
    g.addColorStop(1, c.gradient);
    fill = g;
  }
  const shadow = !isClear(c.shadowColor);
  const setShadow = (on: boolean) => {
    ctx.shadowColor = on ? c.shadowColor : "transparent";
    ctx.shadowBlur = on ? c.shadowBlur * c.fontSize : 0;
    ctx.shadowOffsetX = on ? c.shadowX * c.fontSize : 0;
    ctx.shadowOffsetY = on ? c.shadowY * c.fontSize : 0;
  };
  const decorate = (x: number, y: number, w: number) => {
    if (c.decoration === "none" || !w) return;
    const h = Math.max(1, c.fontSize * 0.06);
    ctx.fillRect(x, y + (c.decoration === "underline" ? c.fontSize * 0.42 : 0) - h / 2, w, h);
  };
  const stroke = c.strokeWidth > 0;
  if (stroke) {
    // El contorno va debajo del relleno, así solo se ve la mitad exterior.
    setShadow(shadow);
    ctx.strokeStyle = c.strokeColor;
    ctx.lineWidth = c.strokeWidth * c.fontSize * 2;
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    lines.forEach((l, i) => ctx.strokeText(l, lineX(widths[i]), top + i * lineHeight));
  }
  setShadow(shadow && !stroke);
  ctx.fillStyle = fill;
  lines.forEach((l, i) => {
    const x = lineX(widths[i]);
    const y = top + i * lineHeight;
    ctx.fillText(l, x, y);
    decorate(x, y, widths[i]);
  });
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

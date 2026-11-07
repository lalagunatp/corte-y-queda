import { speak } from "./ai/voices";
import { saveGeneratedAudio } from "./media";
import type { MediaAsset, MediaClip, Narration, SubtitleLine, TextClip } from "./types";
import { clipEnd } from "./util";

/** Lo más que se acelera una voz para que quepa en su subtítulo; más rápido ya no se entiende. */
const MAX_FIT = 1.35;

export interface NarrateOptions {
  signal?: AbortSignal;
  onProgress?(stage: string, fraction: number | null): void;
}

const short = (text: string) => (text.length > 32 ? `${text.slice(0, 31).trimEnd()}…` : text);

/** Lee el texto y guarda el audio como recurso del proyecto. */
export async function narrate(n: Narration, opts: NarrateOptions = {}): Promise<MediaAsset> {
  const speech = await speak(n.text, n.voice, { speed: n.speed, ...opts });
  return saveGeneratedAudio(speech.wav, `Narración · ${short(n.text)}`, speech.duration);
}

/**
 * Lee un subtítulo cuidando que la voz termine antes del siguiente: si no cabe, se repite un
 * poco más rápido (hasta MAX_FIT). `fits` es false si ni así cupo.
 */
export async function narrateLine(line: TextClip, next: TextClip | undefined, voice: string, speed: number, opts: NarrateOptions = {}) {
  const n: Narration = { text: line.text.trim(), voice, speed, lineId: line.id };
  const slot = Math.max(line.duration, next ? next.start - line.start - 0.05 : Infinity);
  let speech = await speak(n.text, voice, { speed, ...opts });
  if (speech.duration > slot) {
    const faster = Math.min(speed * MAX_FIT, speed * (speech.duration / slot) * 1.02);
    speech = await speak(n.text, voice, { speed: faster, ...opts });
  }
  const asset = await saveGeneratedAudio(speech.wav, `Narración · ${short(n.text)}`, speech.duration);
  return { asset, narration: n, fits: speech.duration <= slot };
}

/** Si la narración ya no corresponde a lo que se le pidió (texto o voz cambiados). */
export function narrationStale(clip: MediaClip, want: { text: string; voice: string; speed: number }): boolean {
  const n = clip.narration;
  return !n || n.text !== want.text.trim() || n.voice !== want.voice || n.speed !== want.speed;
}

/**
 * Subtítulos para una narración escrita: el texto se parte en líneas legibles y el tiempo se
 * reparte según los caracteres de cada una (la voz lee a ritmo casi constante).
 */
export function subtitlesFor(text: string, start: number, duration: number, maxChars: number): SubtitleLine[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (current && candidate.length > maxChars) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
    // Un punto cierra la línea aunque quepan más palabras: la frase siguiente empieza limpia.
    if (/[.!?…]["»”)]*$/.test(w) && current.length >= maxChars / 3) {
      lines.push(current);
      current = "";
    }
  }
  if (current) lines.push(current);
  const total = lines.reduce((n, l) => n + l.length, 0) || 1;
  let t = start;
  return lines.map((l) => {
    const end = t + (duration * l.length) / total;
    const line = { start: t, end, text: l };
    t = end;
    return line;
  });
}

/** Dónde empieza una narración nueva del guion: en el cabezal, o tras la que ya suena ahí. */
export function scriptStart(clips: MediaClip[], time: number): number {
  let start = time;
  for (const c of clips) if (start >= c.start && start < clipEnd(c)) start = clipEnd(c);
  return start;
}

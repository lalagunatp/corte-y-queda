import { decodedAudio } from "../media";
import type { MediaClip, TextClip } from "../types";
import type { CaptionMessage } from "./captionsWorker";

const WHISPER_RATE = 16000;

export const CAPTION_MODELS = [
  { id: "onnx-community/whisper-base", label: "Whisper base (equilibrado, ~80 MB)" },
  { id: "onnx-community/whisper-tiny", label: "Whisper tiny (rápido, ~40 MB)" },
  { id: "onnx-community/whisper-small", label: "Whisper small (preciso, ~250 MB)" },
];

/** Extrae el tramo del clip como audio mono a 16 kHz, el formato que espera Whisper. */
async function clipAudio16k(c: MediaClip): Promise<Float32Array> {
  const buffer = await decodedAudio(c.assetId);
  if (!buffer) throw new Error("Este clip no tiene audio que se pueda leer.");
  const length = Math.ceil(c.duration * WHISPER_RATE);
  const ctx = new OfflineAudioContext(1, length, WHISPER_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = c.speed;
  src.connect(ctx.destination);
  src.start(0, c.inPoint, c.duration * c.speed);
  return (await ctx.startRendering()).getChannelData(0);
}

/** Divide las frases largas para que cada subtítulo quepa en dos líneas cortas. */
function splitLong(text: string, start: number, end: number, maxChars = 42) {
  const words = text.split(/\s+/);
  if (text.length <= maxChars) return [{ text, start, end }];
  const parts: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      parts.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) parts.push(cur);
  const span = (end - start) / text.length;
  let t = start;
  return parts.map((p) => {
    const d = Math.max(0.6, p.length * span);
    const r = { text: p, start: t, end: Math.min(end, t + d) };
    t += d;
    return r;
  });
}

export async function generateCaptions(
  c: MediaClip,
  opts: { language: string | null; model: string; onProgress(stage: string, fraction: number | null): void },
): Promise<Omit<TextClip, "id" | "trackId">[]> {
  opts.onProgress("Preparando audio", null);
  const audio = await clipAudio16k(c);
  const worker = new Worker(new URL("./captionsWorker.ts", import.meta.url), { type: "module" });
  try {
    const chunks = await new Promise<{ start: number; end: number; text: string }[]>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<CaptionMessage>) => {
        const m = ev.data;
        if (m.type === "progress") opts.onProgress(m.stage, m.fraction);
        else if (m.type === "done") resolve(m.chunks);
        else reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ audio, language: opts.language, model: opts.model }, [audio.buffer]);
    });
    return chunks
      .flatMap((ch) => splitLong(ch.text, ch.start, ch.end))
      .map((s) => ({
        type: "text" as const,
        // Las marcas de Whisper son relativas al tramo extraído, que ya está a la velocidad del clip.
        start: c.start + s.start,
        duration: Math.max(0.3, Math.min(s.end, c.duration) - s.start),
        fadeIn: 0,
        fadeOut: 0,
        text: s.text,
        fontSize: 56,
        color: "#ffffff",
        background: "#000000aa",
        bold: true,
        x: 0,
        y: 0.72,
      }))
      .filter((s) => s.start < c.start + c.duration);
  } finally {
    worker.terminate();
  }
}

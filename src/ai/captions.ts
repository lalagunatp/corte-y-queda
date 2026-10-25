import { decodedAudio } from "../media";
import type { MediaClip, SubtitleLine } from "../types";
import type { CaptionChunk, CaptionMessage } from "./captionsWorker";

const WHISPER_RATE = 16000;

/**
 * Calidades ofrecidas. La variante exacta (y su tamaño) depende del equipo; la descarga real se
 * muestra al generar. `speed` es la fracción de la duración del clip que tardó con aceleración
 * gráfica en las pruebas (base: 61 s para 2:23); `downloadMB` es el rango aproximado GPU/CPU.
 */
export const CAPTION_MODELS = [
  { id: "onnx-community/whisper-tiny", name: "Rápida", hint: "Menos exacta", speed: 0.25, downloadMB: "40–60" },
  { id: "onnx-community/whisper-base", name: "Normal", hint: "Recomendada", speed: 0.45, downloadMB: "80–150" },
  { id: "onnx-community/whisper-small", name: "Precisa", hint: "Más lenta", speed: 1, downloadMB: "250–480" },
];
export const DEFAULT_CAPTION_MODEL = CAPTION_MODELS[1].id;

const READY_KEY = (model: string) => `corte-y-queda:asr-ready:${model}`;

/** Si el modelo ya se usó con éxito en este navegador (y por tanto está descargado). */
export function captionModelReady(model: string): boolean {
  try {
    return localStorage.getItem(READY_KEY(model)) === "1";
  } catch {
    return false;
  }
}

function markCaptionModelReady(model: string) {
  try {
    localStorage.setItem(READY_KEY(model), "1");
  } catch {
    // Sin almacenamiento solo se pierde el aviso de "primera vez".
  }
}

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
  opts: { language: string | null; model: string; signal?: AbortSignal; onProgress(stage: string, fraction: number | null): void },
): Promise<SubtitleLine[]> {
  opts.onProgress("Preparando audio", null);
  const audio = await clipAudio16k(c);
  const worker = new Worker(new URL("./captionsWorker.ts", import.meta.url), { type: "module" });
  try {
    const chunks = await new Promise<CaptionChunk[]>((resolve, reject) => {
      // Cancelar termina el worker al instante, también a mitad de la descarga o de un tramo.
      const abort = () => reject(new DOMException("Cancelado", "AbortError"));
      if (opts.signal?.aborted) return abort();
      opts.signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (ev: MessageEvent<CaptionMessage>) => {
        const m = ev.data;
        if (m.type === "progress") opts.onProgress(m.stage, m.fraction);
        else if (m.type === "done") resolve(m.chunks);
        else reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || "No se pudo iniciar el reconocimiento de voz"));
      worker.postMessage({ audio, language: opts.language, model: opts.model }, [audio.buffer]);
    });
    markCaptionModelReady(opts.model);
    // Las marcas de Whisper son relativas al tramo extraído, que ya está a la velocidad del clip.
    return chunks
      .flatMap((ch) => splitLong(ch.text, ch.start, ch.end))
      .filter((s) => s.start < c.duration)
      .map((s) => ({
        start: c.start + s.start,
        end: c.start + Math.max(s.start + 0.3, Math.min(s.end, c.duration)),
        text: s.text,
      }));
  } finally {
    worker.terminate();
  }
}

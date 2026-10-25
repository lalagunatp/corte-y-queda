import { decodedAudio } from "../media";
import type { MediaClip, SubtitleLine } from "../types";
import type { CaptionMessage } from "./captionsWorker";

const WHISPER_RATE = 16000;

/**
 * Calidades ofrecidas. La variante exacta (y su tamaño) depende del equipo; la descarga real se
 * muestra al generar. `speed` es la fracción de la duración del clip que tardó con aceleración
 * gráfica en las pruebas (base: 61 s para 2:23); `downloadMB` es el rango aproximado GPU/CPU.
 */
export const CAPTION_MODELS = [
  // Variantes "_timestamped": exportadas con atenciones cruzadas para dar tiempos por palabra.
  { id: "onnx-community/whisper-tiny_timestamped", name: "Rápida", hint: "Menos exacta", speed: 0.25, downloadMB: "40–80" },
  { id: "onnx-community/whisper-base_timestamped", name: "Normal", hint: "Recomendada", speed: 0.45, downloadMB: "80–150" },
  { id: "onnx-community/whisper-small_timestamped", name: "Precisa", hint: "Más lenta", speed: 1, downloadMB: "250–480" },
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

let worker: Worker | null = null;

/** Un solo worker que vive entre usos: así el modelo ya cargado se reutiliza. */
function captionWorker(): Worker {
  worker ??= new Worker(new URL("./captionsWorker.ts", import.meta.url), { type: "module" });
  return worker;
}

export interface CaptionStream {
  /** Líneas nuevas ya en tiempo del proyecto; `until` es hasta dónde está procesado el clip. */
  onLines(lines: SubtitleLine[], until: number): void;
  /** Descarta las líneas entregadas en esta pasada (el motor se reinicia en la CPU). */
  onReset(): void;
  onProgress(stage: string, fraction: number | null): void;
}

/**
 * Genera subtítulos de un clip y los entrega por partes, en tiempo del proyecto.
 * Devuelve cuántas líneas se crearon. Cancelar detiene el trabajo al instante.
 */
export async function generateCaptions(
  c: MediaClip,
  opts: { language: string | null; model: string; maxChars: number; signal?: AbortSignal } & CaptionStream,
): Promise<number> {
  opts.onProgress("Preparando audio", null);
  const audio = await clipAudio16k(c);
  // Los tiempos del worker son del tramo extraído, que ya está a la velocidad del clip.
  const toProject = (l: SubtitleLine): SubtitleLine => ({ start: c.start + l.start, end: c.start + Math.min(l.end, c.duration), text: l.text });
  const w = captionWorker();
  let count = 0;
  let onAbort = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      onAbort = () => {
        // Terminar es la única forma de cortar un modelo a mitad; el siguiente uso lo recarga.
        w.terminate();
        worker = null;
        reject(new DOMException("Cancelado", "AbortError"));
      };
      if (opts.signal?.aborted) return onAbort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      w.onmessage = (ev: MessageEvent<CaptionMessage>) => {
        const m = ev.data;
        if (m.type === "progress") opts.onProgress(m.stage, m.fraction);
        else if (m.type === "lines") {
          const lines = m.lines.filter((l) => l.start < c.duration).map(toProject);
          count += lines.length;
          opts.onLines(lines, c.start + Math.min(m.until, c.duration));
        } else if (m.type === "reset") {
          count = 0;
          opts.onReset();
        } else if (m.type === "done") resolve();
        else reject(new Error(m.message));
      };
      w.onerror = (e) => {
        worker = null;
        reject(new Error(e.message || "No se pudo iniciar el reconocimiento de voz"));
      };
      w.postMessage({ audio, language: opts.language, model: opts.model, maxChars: opts.maxChars }, [audio.buffer]);
    });
    markCaptionModelReady(opts.model);
    return count;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

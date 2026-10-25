/// <reference lib="webworker" />
import { type AutomaticSpeechRecognitionPipeline, pipeline } from "@huggingface/transformers";

/**
 * Transcripción con Whisper dentro del navegador. El modelo se descarga una vez desde
 * Hugging Face y queda en la caché del navegador; el audio nunca sale del equipo.
 */
export interface CaptionRequest {
  /** Audio mono a 16 kHz. */
  audio: Float32Array;
  language: string | null;
  model: string;
}

export interface CaptionChunk {
  start: number;
  end: number;
  text: string;
}

export type CaptionMessage =
  | { type: "progress"; stage: string; fraction: number | null }
  | { type: "done"; chunks: CaptionChunk[]; device: string }
  | { type: "error"; message: string };

const RATE = 16000;
/** Whisper procesa ventanas de 30 s; se corta un poco antes para buscar un silencio. */
const WINDOW = 28;
const SEARCH = 4;

const post = (m: CaptionMessage) => (self as DedicatedWorkerGlobalScope).postMessage(m);

/**
 * Variante del modelo por motor, medida con Whisper base sobre un tramo de 28 s:
 * - webgpu-f16: fp16/fp16, ~150 MB, ~10 s por tramo.
 * - webgpu: codificador fp32 + decodificador q4 (MatMulNBits corre en la GPU), ~205 MB.
 * - wasm: q8/q8, ~77 MB; en WebGPU esta variante tardaba ~33 s por tramo, por eso solo se usa en CPU.
 */
type Device = "webgpu-f16" | "webgpu" | "wasm";
const DTYPES: Record<Device, Record<string, string>> = {
  "webgpu-f16": { encoder_model: "fp16", decoder_model_merged: "fp16" },
  webgpu: { encoder_model: "fp32", decoder_model_merged: "q4" },
  wasm: { encoder_model: "q8", decoder_model_merged: "q8" },
};

let loaded: { key: string; asr: AutomaticSpeechRecognitionPipeline } | null = null;

async function bestDevice(): Promise<Device> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (!adapter) return "wasm";
  return adapter.features.has("shader-f16") ? "webgpu-f16" : "webgpu";
}

async function load(model: string, device: Device): Promise<AutomaticSpeechRecognitionPipeline> {
  const key = `${model}|${device}`;
  if (loaded?.key === key) return loaded.asr;
  const dtype = DTYPES[device];
  const files = new Map<string, { loaded: number; total: number }>();
  const asr = (await pipeline("automatic-speech-recognition", model, {
    device: device === "wasm" ? "wasm" : "webgpu",
    dtype: dtype as never,
    progress_callback: (e: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (e.status !== "progress" || !e.file || !e.total) return;
      files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
      let done = 0;
      let total = 0;
      for (const f of files.values()) {
        done += f.loaded;
        total += f.total;
      }
      post({ type: "progress", stage: `Descargando modelo · ${(done / 1e6).toFixed(0)} de ${(total / 1e6).toFixed(0)} MB`, fraction: done / total });
    },
  })) as AutomaticSpeechRecognitionPipeline;
  loaded = { key, asr };
  return asr;
}

/** Divide el audio en tramos de ~28 s cortando en el punto más silencioso cercano. */
function segments(audio: Float32Array): [number, number][] {
  const out: [number, number][] = [];
  const frame = RATE / 50; // 20 ms
  let start = 0;
  while (start < audio.length) {
    const ideal = start + WINDOW * RATE;
    if (ideal >= audio.length) {
      out.push([start, audio.length]);
      break;
    }
    let best = ideal;
    let bestEnergy = Infinity;
    for (let p = ideal - SEARCH * RATE; p < ideal; p += frame) {
      let e = 0;
      for (let i = p; i < p + frame; i++) e += audio[i] * audio[i];
      if (e < bestEnergy) {
        bestEnergy = e;
        best = p + frame / 2;
      }
    }
    out.push([start, Math.round(best)]);
    start = Math.round(best);
  }
  return out;
}

async function transcribe(req: CaptionRequest, device: Device): Promise<CaptionChunk[]> {
  post({ type: "progress", stage: "Cargando modelo", fraction: null });
  const asr = await load(req.model, device);
  const parts = segments(req.audio);
  const chunks: CaptionChunk[] = [];
  for (let i = 0; i < parts.length; i++) {
    post({ type: "progress", stage: `Transcribiendo tramo ${i + 1} de ${parts.length} · ${chunks.length} frases`, fraction: i / parts.length });
    const [a, b] = parts[i];
    const offset = a / RATE;
    const out = await asr(req.audio.subarray(a, b), {
      return_timestamps: true,
      ...(req.language ? { language: req.language, task: "transcribe" } : {}),
    });
    const result = Array.isArray(out) ? out[0] : out;
    for (const c of (result.chunks ?? []) as { timestamp: [number, number | null]; text: string }[]) {
      const text = c.text.trim();
      if (!text) continue;
      const s = offset + c.timestamp[0];
      const e = offset + (c.timestamp[1] ?? Math.min(c.timestamp[0] + 2, (b - a) / RATE));
      chunks.push({ start: s, end: Math.max(e, s + 0.3), text });
    }
  }
  return chunks;
}

self.onmessage = async (ev: MessageEvent<CaptionRequest>) => {
  const device = await bestDevice();
  try {
    post({ type: "done", chunks: await transcribe(ev.data, device), device });
  } catch (first) {
    if (device === "wasm") {
      post({ type: "error", message: first instanceof Error ? first.message : String(first) });
      return;
    }
    // Algunas tarjetas o controladores fallan con WebGPU: se reintenta en la CPU.
    loaded = null;
    try {
      post({ type: "progress", stage: "La aceleración gráfica falló; reintentando con el procesador", fraction: null });
      post({ type: "done", chunks: await transcribe(ev.data, "wasm"), device: "wasm" });
    } catch (second) {
      post({ type: "error", message: second instanceof Error ? second.message : String(second) });
    }
  }
};

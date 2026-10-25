/// <reference lib="webworker" />
import { type AutomaticSpeechRecognitionPipeline, pipeline } from "@huggingface/transformers";

/**
 * Transcripción con Whisper dentro del navegador. El modelo se descarga una vez desde
 * Hugging Face y queda en la caché del navegador; el audio nunca sale del equipo.
 */
export interface CaptionRequest {
  audio: Float32Array;
  language: string | null;
  model: string;
}

export type CaptionMessage =
  | { type: "progress"; stage: string; fraction: number | null }
  | { type: "done"; chunks: { start: number; end: number; text: string }[] }
  | { type: "error"; message: string };

const post = (m: CaptionMessage) => (self as DedicatedWorkerGlobalScope).postMessage(m);

let loaded: { model: string; asr: AutomaticSpeechRecognitionPipeline } | null = null;

async function load(model: string): Promise<AutomaticSpeechRecognitionPipeline> {
  if (loaded?.model === model) return loaded.asr;
  const webgpu = "gpu" in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  const asr = (await pipeline("automatic-speech-recognition", model, {
    device: webgpu ? "webgpu" : "wasm",
    dtype: webgpu ? "fp32" : "q8",
    progress_callback: (e: { status: string; progress?: number; file?: string }) => {
      if (e.status === "progress") post({ type: "progress", stage: `Descargando modelo (${e.file ?? ""})`, fraction: (e.progress ?? 0) / 100 });
    },
  })) as AutomaticSpeechRecognitionPipeline;
  loaded = { model, asr };
  return asr;
}

self.onmessage = async (ev: MessageEvent<CaptionRequest>) => {
  try {
    const { audio, language, model } = ev.data;
    post({ type: "progress", stage: "Cargando modelo", fraction: null });
    const asr = await load(model);
    post({ type: "progress", stage: "Transcribiendo", fraction: null });
    const out = await asr(audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(language ? { language, task: "transcribe" } : {}),
    });
    const result = Array.isArray(out) ? out[0] : out;
    const chunks = (result.chunks ?? [])
      .map((c: { timestamp: [number, number | null]; text: string }) => ({
        start: c.timestamp[0],
        end: c.timestamp[1] ?? c.timestamp[0] + 2,
        text: c.text.trim(),
      }))
      .filter((c: { text: string }) => c.text.length > 0);
    post({ type: "done", chunks });
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};

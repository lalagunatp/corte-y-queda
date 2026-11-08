import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import simdWasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import { decodedAudio } from "../media";
import type { DenoiseReply, DenoiseRequest } from "./denoiseWorker";

/**
 * Reducción de ruido con RNNoise (el mismo modelo que trae CapCut, `rnnoise_v2.0.model`), todo en
 * el equipo. La vista previa la aplica en tiempo real con un AudioWorklet; la exportación limpia
 * el archivo completo de una vez en un worker. RNNoise trabaja a 48 kHz.
 */
export const DENOISE_RATE = 48000;

/**
 * Retardo del nodo en tiempo real: su búfer circular entrega cada bloque 512 muestras después y
 * RNNoise añade 480 más. La señal original se retrasa lo mismo antes de mezclarlas, para que no
 * suenen desfasadas (un eco metálico).
 */
export const WORKLET_DELAY = (512 + 480) / DENOISE_RATE;

let binary: Promise<ArrayBuffer> | null = null;
const modules = new WeakMap<BaseAudioContext, Promise<void>>();

/** Carga el procesador en el contexto (una vez por contexto). */
export function prepareDenoise(ctx: BaseAudioContext): Promise<void> {
  let ready = modules.get(ctx);
  if (!ready) {
    binary ??= loadRnnoise({ url: wasmUrl, simdUrl: simdWasmUrl });
    ready = ctx.audioWorklet.addModule(workletUrl).then(() => binary!.then(() => {}));
    modules.set(ctx, ready);
  }
  return ready;
}

/** Nodo de RNNoise en tiempo real; requiere `prepareDenoise` resuelto en ese contexto. */
export async function createDenoiseNode(ctx: AudioContext): Promise<RnnoiseWorkletNode> {
  await prepareDenoise(ctx);
  return new RnnoiseWorkletNode(ctx, { wasmBinary: await binary!, maxChannels: 2 });
}

const cleaned = new Map<string, Promise<AudioBuffer | null>>();

/** Audio del archivo ya limpio de ruido, alineado con el original (se calcula una vez). */
export function denoisedAudio(assetId: string): Promise<AudioBuffer | null> {
  let p = cleaned.get(assetId);
  if (!p) {
    p = (async () => {
      const source = await decodedAudio(assetId);
      if (!source) return null;
      const channels = Array.from({ length: source.numberOfChannels }, (_, i) => source.getChannelData(i).slice());
      const worker = new Worker(new URL("./denoiseWorker.ts", import.meta.url), { type: "module" });
      try {
        const reply = await new Promise<DenoiseReply>((resolve, reject) => {
          worker.onmessage = (ev: MessageEvent<DenoiseReply>) => resolve(ev.data);
          worker.onerror = (e) => reject(new Error(e.message || "No se pudo iniciar la reducción de ruido"));
          // Dirección absoluta: el worker vive en otra carpeta (assets/) y resolvería mal una relativa.
          const wasm = new URL(simdWasmUrl, document.baseURI).href;
          worker.postMessage({ channels, wasmUrl: wasm } satisfies DenoiseRequest, channels.map((c) => c.buffer));
        });
        if ("error" in reply) throw new Error(reply.error);
        const out = new AudioBuffer({ length: source.length, numberOfChannels: source.numberOfChannels, sampleRate: source.sampleRate });
        reply.channels.forEach((c, i) => out.copyToChannel(c as Float32Array<ArrayBuffer>, i));
        return out;
      } finally {
        worker.terminate();
      }
    })();
    // Un fallo no se recuerda: el siguiente intento vuelve a probar.
    p.catch(() => cleaned.delete(assetId));
    cleaned.set(assetId, p);
  }
  return p;
}

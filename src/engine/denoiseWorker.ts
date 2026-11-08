/// <reference lib="webworker" />
import { Rnnoise } from "@shiguredo/rnnoise-wasm";

/**
 * Reducción de ruido para la exportación: pasa cada canal por RNNoise de una vez, fuera del hilo
 * de la interfaz. Es la misma compilación de RNNoise que usa la vista previa en tiempo real.
 */
export interface DenoiseRequest {
  /** Canales a 48 kHz (lo que espera RNNoise). */
  channels: Float32Array[];
  wasmUrl: string;
}

export type DenoiseReply = { channels: Float32Array[] } | { error: string };

/**
 * Retardo propio de RNNoise (ventana con solape): la salida va un bloque de 10 ms por detrás de la
 * entrada. Se descuenta para que la voz limpia quede alineada con la imagen.
 */
export const RNNOISE_DELAY = 480;

let engine: Promise<Rnnoise> | null = null;

function load(wasmUrl: string): Promise<Rnnoise> {
  const url = new URL(wasmUrl, self.location.href);
  const slash = url.href.lastIndexOf("/");
  engine ??= Rnnoise.load({ assetsPath: url.href.slice(0, slash), wasmFileName: url.href.slice(slash + 1) } as never);
  return engine;
}

self.onmessage = async (ev: MessageEvent<DenoiseRequest>) => {
  try {
    const rnnoise = await load(ev.data.wasmUrl);
    const size = rnnoise.frameSize;
    const out = ev.data.channels.map((input) => {
      const state = rnnoise.createDenoiseState();
      // Se procesa con un bloque extra de silencio al final para recuperar la cola retrasada.
      const padded = new Float32Array(Math.ceil((input.length + RNNOISE_DELAY) / size) * size);
      padded.set(input);
      const frame = new Float32Array(size);
      for (let i = 0; i < padded.length; i += size) {
        for (let j = 0; j < size; j++) frame[j] = padded[i + j] * 32767;
        state.processFrame(frame);
        for (let j = 0; j < size; j++) padded[i + j] = frame[j] / 32767;
      }
      state.destroy();
      return padded.slice(RNNOISE_DELAY, RNNOISE_DELAY + input.length);
    });
    (self as DedicatedWorkerGlobalScope).postMessage({ channels: out } satisfies DenoiseReply, out.map((c) => c.buffer));
  } catch (e) {
    (self as DedicatedWorkerGlobalScope).postMessage({ error: e instanceof Error ? e.message : String(e) } satisfies DenoiseReply);
  }
};

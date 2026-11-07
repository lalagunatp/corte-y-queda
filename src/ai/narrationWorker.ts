/// <reference lib="webworker" />
import createPiperPhonemize from "@diffusionstudio/piper-wasm/build/piper_phonemize.js";
import phonemizeData from "@diffusionstudio/piper-wasm/build/piper_phonemize.data?url";
import phonemizeWasm from "@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url";
// La misma variante de ONNX Runtime que usa Whisper: así su .wasm (27 MB) se empaqueta una sola vez.
import * as ort from "onnxruntime-web/webgpu";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

/**
 * Narración con voces Piper dentro del navegador (el texto nunca sale del equipo).
 *
 * 1. espeak-ng (compilado a WASM) pasa el texto a fonemas con el acento de la voz.
 * 2. El modelo VITS de la voz convierte los fonemas en audio con ONNX Runtime en la CPU.
 *
 * Los modelos se descargan una vez de Hugging Face y se guardan en la Cache Storage.
 */

export interface NarrationRequest {
  id: number;
  /** Ruta del modelo dentro de rhasspy/piper-voices, sin la extensión .onnx. */
  model: string;
  speaker: number;
  text: string;
  /** 1 = velocidad natural de la voz; 1,2 = un 20 % más rápido. */
  speed: number;
}

export type NarrationMessage =
  | { type: "progress"; id: number; stage: string; fraction: number | null }
  | { type: "audio"; id: number; pcm: Float32Array; sampleRate: number }
  | { type: "error"; id: number; message: string };

interface VoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
}

const MODELS_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
const CACHE = "corte-y-queda-voces";
/** Pausa entre frases, como la que hace una persona al leer. */
const SENTENCE_PAUSE = 0.18;
/** Frases más largas se parten: el modelo empeora y usa mucha memoria con textos largos. */
const MAX_CHUNK = 300;

ort.env.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
// Varios hilos solo existen con aislamiento de origen; sin él ONNX usaría uno igualmente.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const post = (m: NarrationMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

/** Descarga con progreso y guarda en caché; las siguientes veces se lee del equipo. */
async function cachedFetch(url: string, onProgress?: (fraction: number | null) => void): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("No se pudo descargar la voz. Revisa la conexión a internet.");
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(total ? loaded / total : null);
  }
  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  // Sin caché (modo privado, cuota llena) la voz funciona igual, solo se vuelve a descargar.
  await cache?.put(url, new Response(data)).catch(() => {});
  return data.buffer;
}

let phonemizer: Promise<{ wasm: ArrayBuffer; data: ArrayBuffer }> | null = null;

/** espeak-ng y sus diccionarios (18 MB, empaquetados con la app). */
function phonemizerFiles() {
  phonemizer ??= Promise.all([fetch(phonemizeWasm).then((r) => r.arrayBuffer()), fetch(phonemizeData).then((r) => r.arrayBuffer())]).then(
    ([wasm, data]) => ({ wasm, data }),
    (e) => {
      phonemizer = null;
      throw e;
    },
  );
  return phonemizer;
}

/**
 * Fonemas de una frase. El programa de espeak termina al responder, así que se crea una
 * instancia por frase; los archivos ya están en memoria, por lo que es rápido.
 */
async function phonemeIds(text: string, voice: string): Promise<number[]> {
  const files = await phonemizerFiles();
  // espeak imprime una línea JSON por cada oración que detecta; se juntan todas.
  const lines: string[] = [];
  const errors: string[] = [];
  const m = await createPiperPhonemize({
    wasmBinary: files.wasm,
    getPreloadedPackage: () => files.data,
    locateFile: (name) => name,
    print: (out) => lines.push(out),
    printErr: (message) => errors.push(message),
  });
  m.callMain(["-l", voice, "--input", JSON.stringify([{ text }]), "--espeak_data", "/espeak-ng-data"]);
  const ids = lines.flatMap((l) => (JSON.parse(l) as { phoneme_ids: number[] }).phoneme_ids);
  if (!ids.length) throw new Error(errors.join("\n") || "No se pudo leer el texto.");
  return ids;
}

/** Las dos últimas voces usadas quedan cargadas: alternar entre dos personajes no recarga nada. */
const sessions = new Map<string, Promise<{ session: ort.InferenceSession; config: VoiceConfig }>>();
const KEEP = 2;

function loadVoice(model: string, onProgress: (fraction: number | null) => void) {
  let s = sessions.get(model);
  if (s) {
    sessions.delete(model);
    sessions.set(model, s);
    return s;
  }
  s = (async () => {
    const config = JSON.parse(new TextDecoder().decode(await cachedFetch(`${MODELS_BASE}/${model}.onnx.json`))) as VoiceConfig;
    const weights = await cachedFetch(`${MODELS_BASE}/${model}.onnx`, onProgress);
    const session = await ort.InferenceSession.create(weights, { executionProviders: ["wasm"] });
    return { session, config };
  })();
  s.catch(() => sessions.delete(model));
  sessions.set(model, s);
  for (const [key, old] of sessions) {
    if (sessions.size <= KEEP) break;
    sessions.delete(key);
    void old.then((v) => v.session.release()).catch(() => {});
  }
  return s;
}

/** Frases para sintetizar por separado; las muy largas se cortan por comas o espacios. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\s+/g, " ").match(/[^.!?¡¿…]*[.!?…]+["»”)]*|[^.!?…]+$/g) ?? []) {
    let rest = raw.trim();
    while (rest.length > MAX_CHUNK) {
      const cut = Math.max(rest.lastIndexOf(", ", MAX_CHUNK), rest.lastIndexOf(" ", MAX_CHUNK));
      const at = cut > MAX_CHUNK / 2 ? cut + 1 : MAX_CHUNK;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (/[\p{L}\p{N}]/u.test(rest)) out.push(rest);
  }
  return out;
}

async function speak(req: NarrationRequest) {
  const progress = (stage: string, fraction: number | null) => post({ type: "progress", id: req.id, stage, fraction });
  progress("Preparando la voz", null);
  const [{ session, config }] = await Promise.all([loadVoice(req.model, (f) => progress("Descargando la voz", f)), phonemizerFiles()]);
  const rate = config.audio.sample_rate;
  const parts = sentences(req.text);
  if (!parts.length) throw new Error("No hay texto para leer.");
  const pause = new Float32Array(Math.round(SENTENCE_PAUSE * rate));
  const pcm: Float32Array[] = [];
  for (let i = 0; i < parts.length; i++) {
    progress("Leyendo el texto", i / parts.length);
    const ids = await phonemeIds(parts[i], config.espeak.voice);
    const feeds: Record<string, ort.Tensor> = {
      input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor("float32", Float32Array.from([config.inference.noise_scale, config.inference.length_scale / req.speed, config.inference.noise_w]), [3]),
    };
    if (config.num_speakers > 1) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(req.speaker)]), [1]);
    const { output } = await session.run(feeds);
    if (i > 0) pcm.push(pause);
    pcm.push(output.data as Float32Array);
  }
  const out = new Float32Array(pcm.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of pcm) {
    out.set(p, offset);
    offset += p.length;
  }
  post({ type: "audio", id: req.id, pcm: out, sampleRate: rate }, [out.buffer]);
}

// Una petición a la vez: el modelo no se beneficia de correr dos frases en paralelo.
let queue = Promise.resolve();
self.onmessage = (ev: MessageEvent<NarrationRequest>) => {
  const req = ev.data;
  queue = queue.then(() => speak(req)).catch((e) => post({ type: "error", id: req.id, message: e instanceof Error ? e.message : String(e) }));
};

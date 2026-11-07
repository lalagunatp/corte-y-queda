import type { NarrationMessage, NarrationRequest } from "./narrationWorker";

export interface Voice {
  id: string;
  name: string;
  /** Acento, para elegir sin tener que escuchar todas. */
  accent: string;
  /** Ruta del modelo en rhasspy/piper-voices; dos voces pueden compartir modelo (y descarga). */
  model: string;
  speaker: number;
  downloadMB: number;
}

/**
 * Voces Piper en español (licencias abiertas, ver rhasspy/piper-voices). Los nombres son los
 * de cada voz en el catálogo; «Probar» deja oírlas antes de elegir.
 */
export const VOICES: Voice[] = [
  { id: "sharvard-f", name: "Sharvard (mujer)", accent: "España", model: "es/es_ES/sharvard/medium/es_ES-sharvard-medium", speaker: 1, downloadMB: 77 },
  { id: "sharvard-m", name: "Sharvard (hombre)", accent: "España", model: "es/es_ES/sharvard/medium/es_ES-sharvard-medium", speaker: 0, downloadMB: 77 },
  { id: "davefx", name: "Davefx", accent: "España", model: "es/es_ES/davefx/medium/es_ES-davefx-medium", speaker: 0, downloadMB: 63 },
  { id: "carlfm", name: "Carlfm", accent: "España", model: "es/es_ES/carlfm/x_low/es_ES-carlfm-x_low", speaker: 0, downloadMB: 28 },
  { id: "ald", name: "Ald", accent: "México", model: "es/es_MX/ald/medium/es_MX-ald-medium", speaker: 0, downloadMB: 63 },
  { id: "claude", name: "Claude", accent: "México", model: "es/es_MX/claude/high/es_MX-claude-high", speaker: 0, downloadMB: 63 },
  { id: "daniela", name: "Daniela", accent: "Argentina", model: "es/es_AR/daniela/high/es_AR-daniela-high", speaker: 0, downloadMB: 114 },
];
export const DEFAULT_VOICE = VOICES[0].id;

export const voiceById = (id: string): Voice => VOICES.find((v) => v.id === id) ?? VOICES[0];

const READY_KEY = (model: string) => `corte-y-queda:voice-ready:${model}`;

/** Si la voz ya se usó en este navegador (y por tanto está descargada). */
export function voiceReady(id: string): boolean {
  try {
    return localStorage.getItem(READY_KEY(voiceById(id).model)) === "1";
  } catch {
    return false;
  }
}

function markVoiceReady(model: string) {
  try {
    localStorage.setItem(READY_KEY(model), "1");
  } catch {
    // Sin almacenamiento solo se pierde el aviso de "primera vez".
  }
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve(a: { pcm: Float32Array; sampleRate: number }): void; reject(e: Error): void; onProgress?(stage: string, fraction: number | null): void }>();

/** Un solo worker que vive entre usos: así las voces ya cargadas se reutilizan. */
function narrationWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./narrationWorker.ts", import.meta.url), { type: "module" });
  w.onmessage = (ev: MessageEvent<NarrationMessage>) => {
    const m = ev.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === "progress") p.onProgress?.(m.stage, m.fraction);
    else {
      pending.delete(m.id);
      if (m.type === "audio") p.resolve(m);
      else p.reject(new Error(m.message));
    }
  };
  w.onerror = (e) => {
    stopNarration(new Error(e.message || "No se pudo iniciar la narración"));
  };
  worker = w;
  return w;
}

/** Corta lo que se esté leyendo; terminar es la única forma de detener un modelo a mitad. */
export function stopNarration(reason: Error = new DOMException("Cancelado", "AbortError")) {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(reason);
  pending.clear();
}

export interface Speech {
  wav: Blob;
  duration: number;
}

/** Lee un texto con una voz y devuelve el audio en WAV. */
export async function speak(text: string, voiceId: string, opts: { speed?: number; signal?: AbortSignal; onProgress?(stage: string, fraction: number | null): void } = {}): Promise<Speech> {
  const voice = voiceById(voiceId);
  const req: NarrationRequest = { id: nextId++, model: voice.model, speaker: voice.speaker, text, speed: opts.speed ?? 1 };
  const onAbort = () => stopNarration();
  if (opts.signal?.aborted) throw new DOMException("Cancelado", "AbortError");
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const { pcm, sampleRate } = await new Promise<{ pcm: Float32Array; sampleRate: number }>((resolve, reject) => {
      pending.set(req.id, { resolve, reject, onProgress: opts.onProgress });
      narrationWorker().postMessage(req);
    });
    markVoiceReady(voice.model);
    return { wav: toWav(pcm, sampleRate), duration: pcm.length / sampleRate };
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** WAV mono de 16 bits: lo lee cualquier navegador y pesa poco para voz. */
function toWav(pcm: Float32Array, rate: number): Blob {
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([view.buffer], { type: "audio/wav" });
}

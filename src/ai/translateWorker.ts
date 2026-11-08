/// <reference lib="webworker" />
import { type TranslationPipeline, pipeline } from "@huggingface/transformers";

/**
 * Traducción dentro del navegador con modelos Opus-MT (Helsinki-NLP), uno por par de idiomas.
 * Cada frase sale del equipo solo hacia el modelo local; nada se envía a internet.
 */
export interface TranslateRequest {
  model: string;
  sentences: string[];
}

export type TranslateMessage =
  | { type: "progress"; stage: string; fraction: number | null }
  | { type: "done"; sentences: string[] }
  | { type: "error"; message: string };

const post = (m: TranslateMessage) => (self as DedicatedWorkerGlobalScope).postMessage(m);

// Los modelos cargados se conservan entre usos del worker.
const loaded = new Map<string, Promise<TranslationPipeline>>();

function load(model: string): Promise<TranslationPipeline> {
  let p = loaded.get(model);
  if (!p) {
    const files = new Map<string, { loaded: number; total: number }>();
    p = pipeline("translation", model, {
      // q8 en la CPU: los modelos Opus-MT son pequeños y así funcionan en cualquier equipo.
      device: "wasm",
      dtype: "q8",
      progress_callback: ((e: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status !== "progress" || !e.file || !e.total) return;
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
        let done = 0;
        let total = 0;
        for (const f of files.values()) {
          done += f.loaded;
          total += f.total;
        }
        if (total < 1e6) return;
        post({ type: "progress", stage: `Preparando el traductor · ${(done / 1e6).toFixed(0)} de ${(total / 1e6).toFixed(0)} MB`, fraction: done / total });
      }) as never,
    }) as Promise<TranslationPipeline>;
    p.catch(() => loaded.delete(model));
    loaded.set(model, p);
  }
  return p;
}

/** Frases por tanda: aprovecha el cálculo en lote sin bloquear el avance mucho tiempo. */
const BATCH = 8;

/**
 * Opus-MT cuantizado a veces se queda repitiendo signos al final («...?..????»). Se cortan las
 * rachas de puntuación a un solo signo. Medido con subtítulos reales: pasaba en 2 de 18 frases.
 */
export function cleanTranslation(text: string): string {
  return text
    .replace(/([.!?…])[\s.!?…]{2,}$/u, "$1")
    .replace(/([.!?…,;:])\1{3,}/gu, "$1")
    .trim();
}

/** Tope de longitud: una traducción rara vez pasa del doble de palabras del original. */
const maxTokens = (sentences: string[]) => Math.min(256, 16 + 3 * Math.max(...sentences.map((s) => s.split(/\s+/).length)));

self.onmessage = async (ev: MessageEvent<TranslateRequest>) => {
  try {
    const { model, sentences } = ev.data;
    const translator = await load(model);
    const out: string[] = [];
    for (let i = 0; i < sentences.length; i += BATCH) {
      post({ type: "progress", stage: `Traduciendo · ${i} de ${sentences.length} frases`, fraction: i / sentences.length });
      const batch = sentences.slice(i, i + BATCH);
      const result = (await translator(batch, { max_new_tokens: maxTokens(batch) } as never)) as { translation_text: string }[];
      out.push(...result.map((r) => cleanTranslation(r.translation_text)));
    }
    post({ type: "done", sentences: out });
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};

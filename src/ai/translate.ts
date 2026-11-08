import type { TranslateMessage, TranslateRequest } from "./translateWorker";

/** Idiomas de los subtítulos que la app sabe traducir. */
export const TRANSLATION_LANGUAGES = [
  { id: "es", name: "Español" },
  { id: "en", name: "Inglés" },
  { id: "fr", name: "Francés" },
  { id: "de", name: "Alemán" },
  { id: "it", name: "Italiano" },
] as const;

export type LanguageId = (typeof TRANSLATION_LANGUAGES)[number]["id"];

export const languageName = (id: string) => TRANSLATION_LANGUAGES.find((l) => l.id === id)?.name ?? id;

/** Idiomas desde los que se puede traducir (hay modelo directo a varios destinos). */
export const SOURCE_LANGUAGES: LanguageId[] = ["es", "en"];

/**
 * Pares con modelo Opus-MT oficial (Helsinki-NLP, convertidos por Hugging Face). Probado: llegar al
 * portugués con el modelo inglés→lenguas romances mezclaba español, portugués y francés, así que
 * no se ofrece hasta tener un modelo directo de confianza.
 */
const PAIRS = new Set(["es-en", "es-fr", "es-de", "es-it", "en-es", "en-fr", "en-de", "en-it"]);

/** Modelo que traduce de `from` a `to`, o null si no hay. */
export function translationModel(from: LanguageId, to: LanguageId): string | null {
  return PAIRS.has(`${from}-${to}`) ? `Xenova/opus-mt-${from}-${to}` : null;
}

/** Descarga aproximada la primera vez: cada modelo comprimido pesa unos 115 MB. */
export const MODEL_DOWNLOAD_MB = 115;

/**
 * Agrupa las líneas en frases completas: un subtítulo suele cortar la frase a la mitad y el
 * traductor necesita la frase entera para entenderla. Devuelve, por frase, qué líneas abarca.
 */
export function groupSentences(lines: string[]): { text: string; lines: number[] }[] {
  const out: { text: string; lines: number[] }[] = [];
  let current: { text: string; lines: number[] } | null = null;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+/g, " ").trim();
    current ??= { text: "", lines: [] };
    current.text = current.text ? `${current.text} ${line}` : line;
    current.lines.push(i);
    // Se cierra en punto, interrogación o exclamación, o si la frase ya ocupa muchas líneas.
    if (/[.!?…]["»”)]?$/.test(line) || current.lines.length >= 4) {
      out.push(current);
      current = null;
    }
  });
  if (current) out.push(current);
  return out;
}

/**
 * Reparte una frase traducida entre las líneas originales, en proporción a lo que ocupaba cada una
 * y sin partir palabras: así cada subtítulo conserva sus tiempos.
 */
export function splitAcross(translated: string, originals: string[]): string[] {
  if (originals.length === 1) return [translated];
  const words = translated.split(/\s+/).filter(Boolean);
  const weights = originals.map((o) => Math.max(1, o.length));
  const total = weights.reduce((a, b) => a + b, 0);
  const totalChars = words.join(" ").length;
  const out: string[] = [];
  let w = 0;
  let used = 0;
  let acc = 0;
  for (let i = 0; i < originals.length; i++) {
    acc += weights[i];
    const target = (acc / total) * totalChars;
    const last = i === originals.length - 1;
    const taken: string[] = [];
    while (w < words.length) {
      // Cada línea siguiente se queda al menos con una palabra; la última se lleva el resto.
      if (!last && words.length - w <= originals.length - 1 - i) break;
      // Hasta la parte proporcional de la línea (una palabra a medias cuenta si cabe más de la mitad).
      if (!last && taken.length && used + words[w].length / 2 > target) break;
      taken.push(words[w]);
      used += words[w].length + 1;
      w++;
    }
    out.push(taken.join(" "));
  }
  return out;
}

let worker: Worker | null = null;

/** Traduce las líneas, respetando cuántas son, en el orden dado. */
export async function translateLines(
  lines: string[],
  from: LanguageId,
  to: LanguageId,
  opts: { signal?: AbortSignal; onProgress(stage: string, fraction: number | null): void },
): Promise<string[]> {
  const model = translationModel(from, to);
  if (!model) throw new Error("No se puede traducir entre esos idiomas.");
  const groups = groupSentences(lines);
  worker ??= new Worker(new URL("./translateWorker.ts", import.meta.url), { type: "module" });
  const w = worker;
  let onAbort = () => {};
  try {
    const sentences = await new Promise<string[]>((resolve, reject) => {
      onAbort = () => {
        w.terminate();
        worker = null;
        reject(new DOMException("Cancelado", "AbortError"));
      };
      if (opts.signal?.aborted) return onAbort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      w.onmessage = (ev: MessageEvent<TranslateMessage>) => {
        const m = ev.data;
        if (m.type === "progress") opts.onProgress(m.stage, m.fraction);
        else if (m.type === "done") resolve(m.sentences);
        else reject(new Error(m.message));
      };
      w.onerror = (e) => {
        worker = null;
        reject(new Error(e.message || "No se pudo iniciar el traductor"));
      };
      w.postMessage({ model, sentences: groups.map((g) => g.text) } satisfies TranslateRequest);
    });
    const out = new Array<string>(lines.length).fill("");
    groups.forEach((g, i) => {
      const parts = splitAcross(sentences[i] ?? "", g.lines.map((n) => lines[n]));
      g.lines.forEach((n, k) => (out[n] = parts[k]));
    });
    return out;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

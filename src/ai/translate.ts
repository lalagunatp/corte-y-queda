import { latinize } from "./latinize";
import type { TranslateMessage, TranslateRequest } from "./translateWorker";

/** Idiomas en los que pueden estar los subtítulos para traducirlos. */
export const SOURCE_LANGUAGES = [
  { id: "es", name: "Español" },
  { id: "en", name: "Inglés" },
  { id: "fr", name: "Francés" },
  { id: "pt", name: "Portugués" },
  { id: "de", name: "Alemán" },
  { id: "it", name: "Italiano" },
] as const;

/**
 * Idiomas a los que se puede traducir. El español sale en dos variantes: los modelos escriben
 * español de España y, para Latinoamérica, se adapta después (ver `latinize`). `text` es el nombre
 * dentro de una frase («traducidos al …»).
 */
export const TARGET_LANGUAGES = [
  { id: "es", name: "Español (Latinoamérica)", text: "español latino" },
  { id: "es-ES", name: "Español (España)", text: "español de España" },
  { id: "en", name: "Inglés", text: "inglés" },
  { id: "fr", name: "Francés", text: "francés" },
  { id: "de", name: "Alemán", text: "alemán" },
  { id: "it", name: "Italiano", text: "italiano" },
] as const;

export type SourceId = (typeof SOURCE_LANGUAGES)[number]["id"];
export type TargetId = (typeof TARGET_LANGUAGES)[number]["id"];

export const sourceName = (id: string) => SOURCE_LANGUAGES.find((l) => l.id === id)?.name ?? id;
export const targetName = (id: string) => TARGET_LANGUAGES.find((l) => l.id === id)?.name ?? id;
export const targetText = (id: string) => TARGET_LANGUAGES.find((l) => l.id === id)?.text ?? id;

/** Idioma de origen que corresponde al de una pista (las dos variantes de español son «es»). */
export function sourceOf(lang: string | undefined): SourceId | null {
  const base = lang?.split("-")[0];
  return SOURCE_LANGUAGES.find((l) => l.id === base)?.id ?? null;
}

/**
 * Pares con modelo Opus-MT oficial (Helsinki-NLP, convertidos por Hugging Face). No hay modelo que
 * escriba portugués con fiabilidad (el de inglés→lenguas romances mezclaba español, portugués y
 * francés), así que el portugués solo es origen: el modelo lenguas romances→inglés sí lo entiende.
 */
const PAIRS = new Set([
  "es-en", "es-fr", "es-de", "es-it",
  "en-es", "en-fr", "en-de", "en-it",
  "fr-es", "fr-en", "fr-de",
  "de-es", "de-en", "de-fr",
  "it-es", "it-en", "it-fr",
]);

function directModel(from: string, to: string): string | null {
  if (from === "pt") return to === "en" ? "Xenova/opus-mt-ROMANCE-en" : null;
  return PAIRS.has(`${from}-${to}`) ? `Xenova/opus-mt-${from}-${to}` : null;
}

/**
 * Modelos que hay que encadenar para traducir de `from` a `to`: uno si hay modelo directo, dos si
 * hay que pasar por el inglés (algo menos fiel), ninguno si solo hay que adaptar el español de
 * España al latino. Null si no se puede.
 */
export function translationRoute(from: SourceId, to: TargetId): string[] | null {
  const base = to === "es-ES" ? "es" : to;
  if (from === base) return to === "es" ? [] : null;
  const direct = directModel(from, base);
  if (direct) return [direct];
  const first = directModel(from, "en");
  const second = directModel("en", base);
  return first && second ? [first, second] : null;
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
  from: SourceId,
  to: TargetId,
  opts: { signal?: AbortSignal; onProgress(stage: string, fraction: number | null): void },
): Promise<string[]> {
  const models = translationRoute(from, to);
  if (!models) throw new Error("No se puede traducir entre esos idiomas.");
  const finish = (text: string) => (to === "es" ? latinize(text) : text);
  // Solo adaptar el español: línea por línea, sin tocar cómo están repartidas.
  if (!models.length) return lines.map(finish);
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
      w.postMessage({ models, sentences: groups.map((g) => g.text) } satisfies TranslateRequest);
    });
    const out = new Array<string>(lines.length).fill("");
    groups.forEach((g, i) => {
      const parts = splitAcross(finish(sentences[i] ?? ""), g.lines.map((n) => lines[n]));
      g.lines.forEach((n, k) => (out[n] = parts[k]));
    });
    return out;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

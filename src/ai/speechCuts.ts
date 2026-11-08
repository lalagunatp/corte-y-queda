import type { SubtitleLine } from "../types";
import type { Transcript } from "./captions";

/**
 * Recorte inteligente de voz (como «quitar muletillas, pausas y repeticiones» de CapCut): a partir
 * de la transcripción por palabra y de los tramos con voz propone tramos a quitar. Nada se aplica
 * solo; el editor muestra la propuesta para revisarla.
 */
export type CutKind = "pause" | "silent" | "filler" | "maybe-filler" | "repeat";

export interface Cut {
  /** Segundos desde el inicio del clip. */
  start: number;
  end: number;
  kind: CutKind;
  /** Lo que se quita, para la lista («pausa de 1,8 s», «eh», «yo yo»). */
  label: string;
  on: boolean;
}

/** Sonidos de duda: siempre son muletilla. */
const FILLERS = new Set(["eh", "ehh", "ehm", "em", "emm", "mm", "mmm", "hmm", "mhm", "ah", "ahh", "uh", "um", "umm", "uhm"]);
/** Palabras que a veces son muletilla y a veces no («este video»): se proponen sin marcar. */
const MAYBE_FILLERS = new Set(["este", "o sea", "bueno", "pues", "digamos"]);

/** Margen de voz que nunca se toca alrededor de lo que se dice, para no comerse sílabas. */
const GUARD = 0.06;
/**
 * Un hueco sin voz más largo que esto rara vez es una pausa: suele ser música o una escena sin
 * diálogo. Se propone sin marcar.
 */
const SILENT_PART = 3;
/** Lo que se quita por debajo de esto no se nota y solo añade cortes. */
const MIN_CUT = 0.12;

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();

/**
 * Propone los tramos a quitar.
 * @param pause pausa que se deja como máximo entre frases (s); las más largas se acortan a esta.
 */
export function proposeCuts(t: Transcript, duration: number, pause: number): Cut[] {
  const words = [...t.words].sort((a, b) => a.start - b.start);
  const cuts: Cut[] = [...pauses(t.voice, words, duration, pause), ...fillers(words), ...repeats(words)];
  return merge(cuts.filter((c) => c.end - c.start >= MIN_CUT));
}

/**
 * Pausas: huecos entre tramos con voz (el detector es más fiable que Whisper, que alarga los
 * finales de palabra dentro del silencio). Se deja `pause` repartido a cada lado; al principio y
 * al final del clip, media pausa.
 */
function pauses(voice: [number, number][], words: SubtitleLine[], duration: number, pause: number): Cut[] {
  const out: Cut[] = [];
  const speech = [...voice].sort((a, b) => a[0] - b[0]);
  if (!speech.length) return out;
  const gaps: [number, number, "edge" | "mid"][] = [[0, speech[0][0], "edge"]];
  for (let i = 1; i < speech.length; i++) gaps.push([speech[i - 1][1], speech[i][0], "mid"]);
  gaps.push([speech.at(-1)![1], duration, "edge"]);
  for (const [a, b, where] of gaps) {
    const keep = pause / 2;
    let start = a === 0 && where === "edge" ? 0 : a + keep;
    let end = b === duration && where === "edge" ? duration : b - keep;
    // Una palabra que Whisper oyó dentro del hueco (el detector no la marcó) no se corta.
    const inside = words.filter((w) => (w.start + w.end) / 2 > start && (w.start + w.end) / 2 < end);
    if (inside.length) {
      // Se conserva desde la primera hasta la última de esas palabras.
      const first = inside[0];
      const last = inside.at(-1)!;
      if (first.start - GUARD - start >= MIN_CUT) out.push(pauseCut(start, first.start - GUARD));
      start = last.end + GUARD;
    }
    if (end - start >= MIN_CUT) out.push(pauseCut(start, end));
  }
  return out;
}

function pauseCut(start: number, end: number): Cut {
  const seconds = (end - start).toLocaleString("es", { maximumFractionDigits: 1 });
  return end - start > SILENT_PART
    ? { start, end, kind: "silent", label: `Parte sin voz de ${seconds} s`, on: false }
    : { start, end, kind: "pause", label: `Pausa de ${seconds} s`, on: true };
}

/** Muletillas: la palabra entera, hasta donde empieza la siguiente si está pegada. */
function fillers(words: SubtitleLine[]): Cut[] {
  const out: Cut[] = [];
  for (let i = 0; i < words.length; i++) {
    const one = norm(words[i].text);
    const two = i + 1 < words.length ? `${one} ${norm(words[i + 1].text)}` : "";
    const sure = FILLERS.has(one);
    const pair = MAYBE_FILLERS.has(two);
    // «este» es muletilla cuando va suelto, seguido de una pausa («este… vamos a ver»).
    const pauseAfter = i + 1 < words.length ? words[i + 1].start - words[i].end > 0.25 : true;
    const maybe = pair || (MAYBE_FILLERS.has(one) && pauseAfter);
    if (!sure && !maybe) continue;
    const last = pair ? words[i + 1] : words[i];
    const prevEnd = i > 0 ? words[i - 1].end : 0;
    const next = words[i + (pair ? 2 : 1)];
    out.push({
      start: Math.max(prevEnd + GUARD, words[i].start - 0.05),
      end: next ? Math.min(next.start - GUARD, last.end + 0.05) : last.end + 0.05,
      kind: sure ? "filler" : "maybe-filler",
      label: `«${pair ? two : one}»`,
      on: sure,
    });
    if (pair) i++;
  }
  return out;
}

/**
 * Repeticiones inmediatas («yo yo quiero», «que vamos que vamos a»): se quita la primera vez.
 * Una sola palabra repetida con coma o exclamación («no, no») suele ser énfasis: sin marcar.
 */
function repeats(words: SubtitleLine[]): Cut[] {
  const out: Cut[] = [];
  const tokens = words.map((w) => norm(w.text));
  for (let i = 0; i < words.length; i++) {
    for (let n = 4; n >= 1; n--) {
      if (i + 2 * n > words.length) continue;
      const a = tokens.slice(i, i + n);
      const b = tokens.slice(i + n, i + 2 * n);
      if (a.some((x) => !x) || a.join(" ") !== b.join(" ")) continue;
      const emphatic = n === 1 && /[,!¡]/.test(words[i].text);
      out.push({
        start: words[i].start - 0.03,
        end: words[i + n].start - 0.03,
        kind: "repeat",
        label: `«${words
          .slice(i, i + 2 * n)
          .map((w) => w.text)
          .join(" ")}»`,
        on: !emphatic,
      });
      i += n - 1;
      break;
    }
  }
  return out;
}

/** Ordena y junta los tramos que se pisan; el resultado conserva el tipo del más largo. */
function merge(cuts: Cut[]): Cut[] {
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  const out: Cut[] = [];
  for (const c of sorted) {
    const last = out.at(-1);
    if (last && c.start <= last.end) {
      if (c.end - c.start > last.end - last.start) Object.assign(last, { kind: c.kind, label: c.label, on: c.on || last.on });
      last.end = Math.max(last.end, c.end);
    } else out.push({ ...c, start: Math.max(0, c.start) });
  }
  return out;
}

/** Tramos que se quedan tras quitar `cuts` de [0, duration]. */
export function keptRanges(cuts: { start: number; end: number }[], duration: number): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
    if (c.start > at) out.push([at, Math.min(c.start, duration)]);
    at = Math.max(at, c.end);
  }
  if (at < duration) out.push([at, duration]);
  return out.filter(([a, b]) => b - a > 0.001);
}

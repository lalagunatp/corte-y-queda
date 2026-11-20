import { useRef, useState } from "react";
import {
  MODEL_DOWNLOAD_MB,
  SOURCE_LANGUAGES,
  type SourceId,
  TARGET_LANGUAGES,
  type TargetId,
  sourceName,
  sourceOf,
  targetName,
  targetText,
  translateLines,
  translationRoute,
} from "../ai/translate";
import { useEditor } from "../store";
import type { TextClip } from "../types";
import { Icon } from "./Icon";

const READY_KEY = (model: string) => `corte-y-queda:mt-ready:${model}`;

function modelReady(model: string): boolean {
  try {
    return localStorage.getItem(READY_KEY(model)) === "1";
  } catch {
    return false;
  }
}

function markReady(model: string) {
  try {
    localStorage.setItem(READY_KEY(model), "1");
  } catch {
    // Sin almacenamiento solo se pierde el aviso de «primera vez».
  }
}

/**
 * Traduce todos los subtítulos a otro idioma sin cambiar sus tiempos. Los originales pueden
 * quedarse en una fila oculta para exportar el video en los dos idiomas.
 */
export function TranslateSubtitles({ lines, onDone }: { lines: TextClip[]; onDone(message: string): void }) {
  const trackLang = useEditor((s) => s.project.tracks.find((t) => t.role === "subtitles")?.lang);
  const [from, setFrom] = useState<SourceId>(sourceOf(trackLang) ?? "es");
  const targets = TARGET_LANGUAGES.filter((l) => translationRoute(from, l.id));
  const [to, setTo] = useState<TargetId>(from === "es" ? "en" : "es");
  const target = targets.some((l) => l.id === to) ? to : targets[0].id;
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState<{ stage: string; fraction: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const route = translationRoute(from, target)!;
  const missing = route.filter((m) => !modelReady(m)).length;
  // La pista conserva su variante (es-ES) si coincide con el idioma elegido.
  const fromLang = sourceOf(trackLang) === from ? trackLang! : from;
  const fromName = fromLang === "es-ES" ? targetName(fromLang) : sourceName(from);

  const run = async () => {
    setError(null);
    abort.current = new AbortController();
    try {
      const texts = await translateLines(
        lines.map((l) => l.text),
        from,
        target,
        { signal: abort.current.signal, onProgress: (stage, fraction) => setBusy({ stage, fraction }) },
      );
      route.forEach(markReady);
      useEditor.getState().translateSubtitles(texts, { from: fromLang, to: target, fromName, toName: targetName(target), keepOriginal: keep });
      onDone(
        `Subtítulos ${route.length ? "traducidos" : "adaptados"} al ${targetText(target)}. Revísalos en la lista.` +
          (keep ? ` Los originales quedaron en la fila oculta «Subtítulos originales · ${fromName}».` : ""),
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  return (
    <section className="group translate">
      <div className="inline">
        <label className="stack">
          <span>Están en</span>
          <select value={from} onChange={(e) => setFrom(e.target.value as SourceId)} disabled={!!busy}>
            {SOURCE_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="stack">
          <span>Traducir al</span>
          <select value={target} onChange={(e) => setTo(e.target.value as TargetId)} disabled={!!busy}>
            {targets.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={!!busy} />
        Guardar los originales en una fila oculta (para exportar en los dos idiomas)
      </label>
      {route.length > 1 && <p className="muted small">No hay traductor directo: pasa primero por el inglés, así que puede quedar algo menos fiel.</p>}
      {!route.length && <p className="muted small">Cambia «vosotros» por «ustedes» y las palabras de España por las de Latinoamérica (ordenador → computadora, coger → tomar…).</p>}
      {missing > 0 && (
        <p className="muted small">
          La primera vez descarga {missing > 1 ? `${missing} traductores` : "el traductor"} (unos {missing * MODEL_DOWNLOAD_MB} MB). Después funciona sin internet.
        </p>
      )}
      {busy ? (
        <>
          <div className="progress" aria-label={busy.stage}>
            <div style={{ width: `${(busy.fraction ?? 0) * 100}%` }} />
            <span>{busy.stage}</span>
          </div>
          <button onClick={() => abort.current?.abort()}>Cancelar</button>
        </>
      ) : (
        <button className="primary" onClick={() => void run()} disabled={!lines.length}>
          <Icon name="sparkles" /> {route.length ? "Traducir" : "Adaptar"} {lines.length} subtítulos
        </button>
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted small">La traducción automática puede fallar con expresiones coloquiales o nombres propios: revisa el texto en la lista.</p>
    </section>
  );
}

import { useRef, useState } from "react";
import { type LanguageId, MODEL_DOWNLOAD_MB, SOURCE_LANGUAGES, TRANSLATION_LANGUAGES, languageName, translateLines, translationModel } from "../ai/translate";
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
  const [from, setFrom] = useState<LanguageId>(SOURCE_LANGUAGES.includes(trackLang as LanguageId) ? (trackLang as LanguageId) : "es");
  const targets = TRANSLATION_LANGUAGES.filter((l) => translationModel(from, l.id));
  const [to, setTo] = useState<LanguageId>(from === "en" ? "es" : "en");
  const target = targets.some((l) => l.id === to) ? to : targets[0].id;
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState<{ stage: string; fraction: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const model = translationModel(from, target)!;

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
      markReady(model);
      useEditor.getState().translateSubtitles(texts, { from, to: target, fromName: languageName(from), toName: languageName(target), keepOriginal: keep });
      onDone(
        `Subtítulos traducidos al ${languageName(target).toLowerCase()}. Revísalos en la lista.` +
          (keep ? ` Los originales quedaron en la fila oculta «Subtítulos originales · ${languageName(from)}».` : ""),
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
          <select value={from} onChange={(e) => setFrom(e.target.value as LanguageId)} disabled={!!busy}>
            {SOURCE_LANGUAGES.map((id) => (
              <option key={id} value={id}>
                {languageName(id)}
              </option>
            ))}
          </select>
        </label>
        <label className="stack">
          <span>Traducir al</span>
          <select value={target} onChange={(e) => setTo(e.target.value as LanguageId)} disabled={!!busy}>
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
      {!modelReady(model) && <p className="muted small">La primera vez descarga el traductor (unos {MODEL_DOWNLOAD_MB} MB). Después funciona sin internet.</p>}
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
          <Icon name="sparkles" /> Traducir {lines.length} subtítulos
        </button>
      )}
      {error && <p className="error">{error}</p>}
      <p className="muted small">La traducción automática puede fallar con expresiones coloquiales o nombres propios: revisa el texto en la lista.</p>
    </section>
  );
}

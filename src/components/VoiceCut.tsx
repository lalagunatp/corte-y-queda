import { useEffect, useRef, useState } from "react";
import { DEFAULT_CAPTION_MODEL, type Transcript, captionModelReady, transcribeClip } from "../ai/captions";
import { type Cut, type CutKind, proposeCuts } from "../ai/speechCuts";
import { useEditor } from "../store";
import type { MediaClip } from "../types";
import { useUi } from "../ui";
import { formatTime } from "../util";
import { Icon } from "./Icon";
import { Segmented } from "./controls";

const PAUSES = [
  { value: 0.3, label: "Cortas" },
  { value: 0.5, label: "Normales" },
  { value: 0.8, label: "Largas" },
];

const GROUPS: { kinds: CutKind[]; label: string }[] = [
  { kinds: ["pause"], label: "Pausas" },
  { kinds: ["silent"], label: "Partes sin voz (música, escenas)" },
  { kinds: ["filler", "maybe-filler"], label: "Muletillas" },
  { kinds: ["repeat"], label: "Repeticiones" },
];

const KIND_TAG: Record<CutKind, string> = { pause: "Pausa", silent: "Sin voz", filler: "Muletilla", "maybe-filler": "¿Muletilla?", repeat: "Repetición" };

const secs = (s: number) => `${s.toLocaleString("es", { maximumFractionDigits: 1 })} s`;

/**
 * Recorte inteligente de voz: escucha el clip, propone quitar pausas largas, muletillas y
 * repeticiones, las marca en la línea de tiempo y solo corta lo que se aprueba.
 */
export function VoiceCut({ clip }: { clip: MediaClip }) {
  const [busy, setBusy] = useState<{ stage: string; fraction: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [pause, setPause] = useState(0.5);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const abort = useRef<AbortController | null>(null);
  const stopTimer = useRef(0);
  const setCutPreview = useUi((s) => s.setCutPreview);

  // La propuesta vale para este tramo del archivo; si el clip cambia, se descarta.
  const shape = `${clip.id}|${clip.assetId}|${clip.inPoint}|${clip.duration}|${clip.speed}`;
  useEffect(() => {
    setTranscript(null);
    setCuts([]);
    setError(null);
    return () => {
      abort.current?.abort();
      clearTimeout(stopTimer.current);
      setCutPreview(null);
    };
  }, [shape, setCutPreview]);

  useEffect(() => {
    setCutPreview(transcript ? { clipId: clip.id, cuts } : null);
  }, [transcript, cuts, clip.id, setCutPreview]);

  const analyze = async () => {
    setError(null);
    abort.current = new AbortController();
    try {
      const t = await transcribeClip(clip, {
        language: "spanish",
        model: DEFAULT_CAPTION_MODEL,
        signal: abort.current.signal,
        onProgress: (stage, fraction) => setBusy({ stage, fraction }),
      });
      if (!t.voice.length) {
        setError("No se oye a nadie hablar en este clip.");
        return;
      }
      setTranscript(t);
      setCuts(proposeCuts(t, clip.duration, pause));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const repropose = (p: number) => {
    setPause(p);
    if (transcript) setCuts(proposeCuts(transcript, clip.duration, p));
  };

  const toggle = (i: number) => setCuts((cs) => cs.map((c, j) => (j === i ? { ...c, on: !c.on } : c)));
  const setGroup = (kinds: CutKind[], on: boolean) => setCuts((cs) => cs.map((c) => (kinds.includes(c.kind) ? { ...c, on } : c)));

  /** Escucha el tramo con un poco antes y después, tal como está ahora. */
  const listen = (c: Cut) => {
    const st = useEditor.getState();
    clearTimeout(stopTimer.current);
    st.setTime(Math.max(0, clip.start + c.start - 1.2));
    st.setPlaying(true);
    stopTimer.current = window.setTimeout(() => useEditor.getState().setPlaying(false), (c.end - c.start + 2.4) * 1000);
  };

  const apply = () => {
    const chosen = cuts.filter((c) => c.on);
    const total = chosen.reduce((t, c) => t + c.end - c.start, 0);
    setCutPreview(null);
    setTranscript(null);
    setCuts([]);
    useEditor.getState().removeRanges(clip.id, chosen);
    useEditor.getState().setStatus(`Se quitaron ${secs(total)}. Si no te gusta, usa Deshacer.`);
  };

  const chosen = cuts.filter((c) => c.on);
  const removed = chosen.reduce((t, c) => t + c.end - c.start, 0);

  return (
    <section className="group voicecut">
      <h4>Recortar la voz</h4>
      {!transcript && !busy && (
        <>
          <p className="muted small">Quita pausas largas, muletillas («eh», «este») y frases repetidas. Tú revisas los cortes antes de aplicarlos.</p>
          <button onClick={() => void analyze()}>
            <Icon name="sparkles" /> Buscar pausas y muletillas
          </button>
          {!captionModelReady(DEFAULT_CAPTION_MODEL) && <p className="muted small">La primera vez descarga el modelo de voz (una sola vez).</p>}
        </>
      )}

      {busy && (
        <>
          <div className="progress" aria-label={busy.stage}>
            <div style={{ width: `${(busy.fraction ?? 0) * 100}%` }} />
            <span>{busy.stage}</span>
          </div>
          <button onClick={() => abort.current?.abort()}>Cancelar</button>
        </>
      )}

      {error && <p className="error">{error}</p>}

      {transcript && (
        <>
          <p className="small">
            {chosen.length ? (
              <>
                Se quitarán <b>{secs(removed)}</b> de {secs(clip.duration)} en {chosen.length} cortes, marcados en rojo en la línea de tiempo.
              </>
            ) : (
              "No hay cortes elegidos."
            )}
          </p>
          <span className="small">Pausas que se dejan entre frases</span>
          <Segmented value={pause} onPick={repropose} options={PAUSES} />
          <div className="cut-groups">
            {GROUPS.map((g) => {
              const of = cuts.filter((c) => g.kinds.includes(c.kind));
              if (!of.length) return null;
              const on = of.filter((c) => c.on).length;
              return (
                <label key={g.label} className="check">
                  <input type="checkbox" checked={on === of.length} ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < of.length;
                    }} onChange={(e) => setGroup(g.kinds, e.target.checked)} />
                  {g.label} ({on}/{of.length})
                </label>
              );
            })}
          </div>
          {cuts.length > 0 && (
            <details>
              <summary>Revisar uno por uno ({cuts.length})</summary>
              <ul className="cut-list">
                {cuts.map((c, i) => (
                  <li key={`${c.start}-${c.kind}`} className={c.on ? "on" : ""}>
                    <input type="checkbox" checked={c.on} onChange={() => toggle(i)} aria-label={`Quitar ${c.label}`} />
                    <span className="muted small">{formatTime(clip.start + c.start)}</span>
                    <span className="grow">{c.kind === "pause" || c.kind === "silent" ? c.label : `${KIND_TAG[c.kind]} ${c.label}`}</span>
                    <button className="ghost square" onClick={() => listen(c)} aria-label="Escuchar este tramo" title="Escuchar este tramo">
                      <Icon name="play" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="row-end">
            <button
              onClick={() => {
                setTranscript(null);
                setCuts([]);
              }}
            >
              Cancelar
            </button>
            <button className="primary" onClick={apply} disabled={!chosen.length}>
              <Icon name="scissors" /> Aplicar recorte
            </button>
          </div>
        </>
      )}
    </section>
  );
}

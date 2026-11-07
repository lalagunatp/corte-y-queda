import { useEffect, useRef, useState } from "react";
import { DEFAULT_VOICE, VOICES, speak, voiceById, voiceReady } from "../ai/voices";
import { narrate, narrateLine, narrationStale, scriptStart, subtitlesFor } from "../narration";
import { narrationClips, subtitleClips, useEditor } from "../store";
import { formatEditable } from "../subtitles";
import type { MediaClip, TextClip } from "../types";
import { useUi } from "../ui";
import { clipEnd } from "../util";
import { Icon } from "./Icon";
import { Segmented, Toggle } from "./controls";
import { engineRef } from "./Preview";

const ACCENTS = [...new Set(VOICES.map((v) => v.accent))];
const SAMPLE = "Hola, así suena mi voz cuando leo tu video.";

type Busy = { stage: string; fraction: number | null };

function VoiceSelect({ value, onChange, disabled, label }: { value: string; onChange(v: string): void; disabled?: boolean; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={label} title={label}>
      {ACCENTS.map((a) => (
        <optgroup key={a} label={a}>
          {VOICES.filter((v) => v.accent === a).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Lee una frase de muestra con la voz elegida, sin tocar el proyecto. */
function TryVoice({ voice, speed, disabled }: { voice: string; speed: number; disabled: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const run = async () => {
    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const { wav } = await speak(SAMPLE, voice, { speed });
      const url = URL.createObjectURL(wav);
      const a = new Audio(url);
      audio.current = a;
      a.onended = a.onpause = () => {
        URL.revokeObjectURL(url);
        setState("idle");
      };
      setState("playing");
      await a.play();
    } catch {
      setState("idle");
    }
  };
  return (
    <button onClick={() => void run()} disabled={disabled || state === "loading"} title="Escuchar cómo suena esta voz">
      <Icon name={state === "playing" ? "pause" : "play"} size={14} />
      {state === "loading" ? "Preparando…" : state === "playing" ? "Parar" : "Probar"}
    </button>
  );
}

function Progress({ busy, onCancel }: { busy: Busy; onCancel(): void }) {
  return (
    <>
      <div className={`progress slim ${busy.fraction == null ? "indeterminate" : ""}`} role="progressbar" aria-valuenow={busy.fraction == null ? undefined : Math.round(busy.fraction * 100)}>
        <div style={{ width: busy.fraction == null ? undefined : `${Math.max(3, busy.fraction * 100)}%` }} />
        <span>{busy.stage}</span>
      </div>
      <button className="wide" onClick={onCancel}>
        Cancelar
      </button>
    </>
  );
}

/** Ejecuta un trabajo de narración como un solo paso de Deshacer, con progreso y cancelación. */
function useJob() {
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const run = async (job: (signal: AbortSignal, progress: (b: Busy) => void) => Promise<void>) => {
    const s = useEditor.getState;
    setError(null);
    setBusy({ stage: "Preparando la voz", fraction: null });
    abort.current = new AbortController();
    engineRef.current?.resumeAudio();
    s().beginGesture();
    try {
      await job(abort.current.signal, setBusy);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      s().endGesture();
      setBusy(null);
      abort.current = null;
    }
  };
  return { busy, error, run, cancel: () => abort.current?.abort() };
}

/** Progreso de una frase dentro de un trabajo de varias: la descarga se muestra tal cual. */
const stepProgress = (progress: (b: Busy) => void, i: number, n: number) => (stage: string, fraction: number | null) =>
  progress(stage === "Descargando la voz" ? { stage: `${stage} (solo la primera vez)`, fraction } : { stage: n > 1 ? `Leyendo frase ${i + 1} de ${n}` : "Leyendo", fraction: (i + (fraction ?? 0)) / n });

function ReadSubtitles({ voice, speed }: { voice: string; speed: number }) {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const lines = subtitleClips(project).filter((l) => l.text.trim());
  const narrations = narrationClips(project);
  const byLine = new Map(narrations.filter((c) => c.narration?.lineId).map((c) => [c.narration!.lineId!, c]));
  const orphans = narrations.filter((c) => c.narration?.lineId && !lines.some((l) => l.id === c.narration!.lineId));
  // Los subtítulos que salen de un texto escrito ya suenan con esa narración: no se leen otra vez.
  const script = narrations.filter((c) => !c.narration?.lineId);
  const inScript = (l: TextClip) => !byLine.has(l.id) && script.some((c) => l.start >= c.start - 0.05 && l.start < clipEnd(c));
  const { busy, error, run, cancel } = useJob();
  const s = useEditor.getState;

  const voiceOf = (l: TextClip) => byLine.get(l.id)?.narration?.voice ?? voice;
  const stateOf = (l: TextClip): "none" | "ok" | "stale" | "script" => {
    if (inScript(l)) return "script";
    const c = byLine.get(l.id);
    if (!c) return "none";
    return narrationStale(c, { text: l.text, voice: c.narration!.voice, speed: c.narration!.speed }) ? "stale" : "ok";
  };
  const pending = lines.filter((l) => stateOf(l) === "none" || stateOf(l) === "stale");
  const moved = lines.filter((l) => stateOf(l) === "ok" && Math.abs(byLine.get(l.id)!.start - l.start) > 0.01);

  /** Lee esas líneas; las que ya tenían voz se cambian en su sitio. */
  const read = (targets: TextClip[], voiceFor: (l: TextClip) => string) =>
    run(async (signal, progress) => {
      let tight = 0;
      for (let i = 0; i < targets.length; i++) {
        const l = targets[i];
        const next = lines.find((o) => o.start > l.start + 0.01);
        const r = await narrateLine(l, next, voiceFor(l), speed, { signal, onProgress: stepProgress(progress, i, targets.length) });
        if (!r.fits) tight++;
        const existing = byLine.get(l.id);
        if (existing) {
          s().replaceNarration(existing.id, r.asset, r.narration);
          s().updateClip(existing.id, { start: l.start });
        } else {
          s().addNarration([{ start: l.start, asset: r.asset, narration: r.narration }]);
        }
      }
      // Subtítulos que se movieron: su voz los sigue sin volver a leerse.
      for (const l of moved) s().updateClip(byLine.get(l.id)!.id, { start: l.start });
      if (orphans.length) {
        const gone = new Set(orphans.map((c) => c.id));
        s().edit((p) => ({ clips: p.clips.filter((c) => !gone.has(c.id)) }));
      }
      s().setStatus(
        tight ? `${targets.length} frases leídas · ${tight} no caben en su tiempo: alarga esos subtítulos o elige «Rápida»` : `${targets.length} frases leídas`,
      );
    });

  if (!lines.length) {
    return (
      <div className="gen">
        <p className="lead">Primero crea o escribe los subtítulos: la voz los leerá en su momento.</p>
        <button className="c-subs" onClick={() => useUi.getState().openSubtitles()}>
          <Icon name="captions" /> Ir a Subtítulos
        </button>
      </div>
    );
  }

  const activeId = lines.find((l) => time >= l.start && time < clipEnd(l))?.id;
  const sync = pending.length || moved.length || orphans.length;

  return (
    <>
      {busy ? (
        <Progress busy={busy} onCancel={cancel} />
      ) : sync ? (
        <button className="primary wide big" onClick={() => void read(pending, voiceOf)}>
          <Icon name="mic" /> {pending.length ? `Leer ${pending.length === lines.length ? "los subtítulos" : `${pending.length} frase(s) pendiente(s)`}` : "Poner las voces en su sitio"}
        </button>
      ) : (
        <button className="wide" onClick={() => confirm(`¿Leer otra vez las ${lines.filter((l) => !inScript(l)).length} frases con la voz ${voiceById(voice).name}?`) && void read(lines.filter((l) => !inScript(l)), () => voice)}>
          <Icon name="mic" /> Volver a leer todo con esta voz
        </button>
      )}
      {error && <p className="error">{error}</p>}

      <div className="subs-list">
        {lines.map((l, i) => {
          const st = stateOf(l);
          return (
            <div key={l.id} className={`sub-row narr-row ${l.id === activeId ? "active" : ""}`}>
              <div className="sub-head">
                <button
                  className="sub-index"
                  onClick={() => {
                    s().setPlaying(false);
                    s().setTime(l.start);
                  }}
                  title="Ir a esta frase"
                >
                  {i + 1}
                </button>
                <span className={`narr-state ${st}`}>{st === "ok" ? "Leída" : st === "stale" ? "Cambió el texto" : st === "script" ? "Del texto escrito" : "Sin voz"}</span>
                <span className="grow" />
                {st !== "script" && (
                  <>
                    <VoiceSelect label="Voz de esta frase" value={voiceOf(l)} disabled={!!busy} onChange={(v) => void read([l], () => v)} />
                    <button className="ghost mini" onClick={() => void read([l], voiceOf)} disabled={!!busy} title="Leer esta frase otra vez" aria-label="Leer esta frase">
                      <Icon name="mic" size={14} />
                    </button>
                  </>
                )}
              </div>
              <p className="narr-text">{l.text}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ScriptRow({ clip, index, busy, onRead }: { clip: MediaClip; index: number; busy: boolean; onRead(c: MediaClip, text: string, voice: string): void }) {
  const n = clip.narration!;
  const [draft, setDraft] = useState(n.text);
  useEffect(() => setDraft(n.text), [n.text]);
  const s = useEditor.getState;
  const changed = draft.trim() !== n.text && draft.trim() !== "";
  return (
    <div className="sub-row narr-row">
      <div className="sub-head">
        <button
          className="sub-index"
          onClick={() => {
            s().setPlaying(false);
            s().setTime(clip.start);
            s().select([clip.id]);
          }}
          title="Ir a esta parte"
        >
          {index + 1}
        </button>
        <span className="muted">{formatEditable(clip.start)}</span>
        <span className="grow" />
        <VoiceSelect label="Voz de esta parte" value={n.voice} disabled={busy} onChange={(v) => onRead(clip, n.text, v)} />
        <button
          className="ghost mini"
          onClick={() => {
            s().select([clip.id]);
            s().deleteSelected();
          }}
          title="Borrar esta parte"
          aria-label="Borrar parte"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} />
      {changed && (
        <button className="primary" onClick={() => onRead(clip, draft, n.voice)} disabled={busy}>
          <Icon name="mic" size={14} /> Leer el texto nuevo
        </button>
      )}
    </div>
  );
}

function Script({ voice, speed }: { voice: string; speed: number }) {
  const project = useEditor((s) => s.project);
  const items = narrationClips(project).filter((c) => !c.narration?.lineId);
  const [draft, setDraft] = useState("");
  const [withSubs, setWithSubs] = useState(true);
  const { busy, error, run, cancel } = useJob();
  const s = useEditor.getState;
  const maxChars = project.width < project.height ? 32 : 42;

  const add = () =>
    run(async (signal, progress) => {
      const text = draft.trim();
      const n = { text, voice, speed };
      const asset = await narrate(n, { signal, onProgress: stepProgress(progress, 0, 1) });
      const start = scriptStart(items, s().time);
      const [id] = s().addNarration([{ start, asset, narration: n }]);
      if (withSubs) s().addSubtitles(subtitlesFor(text, start, asset.duration, maxChars));
      s().select([id]);
      s().setTime(start + asset.duration);
      setDraft("");
      s().setStatus("Narración añadida");
    });

  const reread = (c: MediaClip, text: string, v: string) =>
    run(async (signal, progress) => {
      const n = { ...c.narration!, text: text.trim(), voice: v };
      const asset = await narrate(n, { signal, onProgress: stepProgress(progress, 0, 1) });
      s().replaceNarration(c.id, asset, n);
    });

  return (
    <>
      <div className="gen">
        <textarea className="narr-draft" rows={3} value={draft} placeholder="Escribe lo que dirá la voz…" onChange={(e) => setDraft(e.target.value)} disabled={!!busy} />
        <Toggle on={withSubs} label="Poner también los subtítulos" onChange={setWithSubs} />
        {busy ? (
          <Progress busy={busy} onCancel={cancel} />
        ) : (
          <button className="primary wide big" onClick={() => void add()} disabled={!draft.trim()} title="La voz empieza donde está la línea verde">
            <Icon name="mic" /> Añadir en la línea verde
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>
      {items.length > 0 && (
        <div className="subs-list">
          {items.map((c, i) => (
            <ScriptRow key={c.id} clip={c} index={i} busy={!!busy} onRead={(clip, text, v) => void reread(clip, text, v)} />
          ))}
        </div>
      )}
    </>
  );
}

const VOICE_KEY = "corte-y-queda:narration-voice";

function savedVoice(): string {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    return v && VOICES.some((x) => x.id === v) ? v : DEFAULT_VOICE;
  } catch {
    return DEFAULT_VOICE;
  }
}

export function Narration() {
  const hasSubs = useEditor((s) => subtitleClips(s.project).length > 0);
  const [mode, setMode] = useState<"subtitles" | "script">(hasSubs ? "subtitles" : "script");
  const [voice, setVoiceState] = useState(savedVoice);
  const [speed, setSpeed] = useState(1);
  const setVoice = (v: string) => {
    setVoiceState(v);
    try {
      localStorage.setItem(VOICE_KEY, v);
    } catch {
      // Sin almacenamiento solo se olvida la voz elegida.
    }
  };
  const v = voiceById(voice);

  return (
    <div className="subs">
      <Segmented<"subtitles" | "script">
        value={mode}
        onPick={setMode}
        options={[
          { value: "subtitles", label: "Leer los subtítulos" },
          { value: "script", label: "Escribir lo que dice" },
        ]}
      />
      <p className="lead">
        {mode === "subtitles"
          ? "Una voz lee cada subtítulo justo cuando aparece. Puedes darle otra voz a cada frase, como si hablaran varias personas."
          : "Escribe lo que quieres que se diga y una voz lo lee desde la línea verde. Usa otra voz para cada parte si hay varios personajes."}
      </p>

      <div className="gen">
        <label className="step">
          <span className="num">1</span>
          <span className="step-body">
            <b>{mode === "subtitles" ? "Voz para las frases nuevas" : "¿Qué voz?"}</b>
            <span className="narr-voice">
              <VoiceSelect label="Voz" value={voice} onChange={setVoice} />
              <TryVoice voice={voice} speed={speed} disabled={false} />
            </span>
          </span>
        </label>
        <div className="step">
          <span className="num">2</span>
          <span className="step-body">
            <b>Velocidad</b>
            <Segmented<number>
              value={speed}
              onPick={setSpeed}
              options={[
                { value: 0.85, label: "Lenta" },
                { value: 1, label: "Normal" },
                { value: 1.15, label: "Rápida" },
              ]}
            />
          </span>
        </div>
        <ul className="facts">
          {!voiceReady(voice) && <li>La primera vez se descarga la voz {v.name} ({v.downloadMB} MB). Solo ocurre una vez.</li>}
          <li>El texto no se sube a internet: la voz se crea en este equipo.</li>
          <li>Las voces van en la fila «Narración»: silénciala para ver el video sin voz.</li>
        </ul>
      </div>

      {mode === "subtitles" ? <ReadSubtitles voice={voice} speed={speed} /> : <Script voice={voice} speed={speed} />}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { CAPTION_MODELS, generateCaptions } from "../ai/captions";
import { saveFile } from "../platform";
import { DEFAULT_SUBTITLE_STYLE, subtitleClips, subtitleStyleOf, useEditor } from "../store";
import { formatEditable, parseEditable, parseSubtitles, toSrt } from "../subtitles";
import type { MediaClip, TextClip } from "../types";
import { useUi } from "../ui";
import { clipEnd } from "../util";
import { Icon } from "./Icon";

const LANGUAGES: [string, string][] = [
  ["spanish", "Español"],
  ["english", "Inglés"],
  ["portuguese", "Portugués"],
  ["french", "Francés"],
  ["german", "Alemán"],
  ["italian", "Italiano"],
  ["", "Detectar automáticamente"],
];

const COLORS = ["#ffffff", "#facc15", "#60a5fa", "#4ade80", "#f472b6", "#111111"];
const MIN_LINE = 0.2;

/** Campo de tiempo editable (mm:ss.d) que solo confirma valores válidos al salir del campo. */
function TimeField({ value, label, onCommit }: { value: number; label: string; onCommit(v: number): boolean }) {
  const [draft, setDraft] = useState(formatEditable(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(formatEditable(value)), [value]);
  const commit = () => {
    const v = parseEditable(draft);
    const ok = v != null && onCommit(v);
    setBad(!ok);
    if (!ok) setDraft(formatEditable(value));
  };
  return (
    <input
      className={`time ${bad ? "bad" : ""}`}
      value={draft}
      inputMode="decimal"
      aria-label={label}
      title={`${label} (mm:ss.d)`}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Generate({ onDone }: { onDone(n: number): void }) {
  const clips = useEditor((s) => s.project.clips);
  const assets = useEditor((s) => s.project.assets);
  const addSubtitles = useEditor((s) => s.addSubtitles);
  const preferred = useUi((s) => s.subtitleSource);
  const kinds = new Map(assets.map((a) => [a.id, a]));
  const sources = clips.filter((c): c is MediaClip => c.type === "media" && kinds.get(c.assetId)?.kind !== "image").sort((a, b) => a.start - b.start);
  const [source, setSource] = useState<string>(preferred && sources.some((c) => c.id === preferred) ? preferred : (sources[0]?.id ?? ""));
  const [language, setLanguage] = useState("spanish");
  const [model, setModel] = useState(CAPTION_MODELS[0].id);
  const [busy, setBusy] = useState<{ stage: string; fraction: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (preferred && sources.some((c) => c.id === preferred)) setSource(preferred);
    // Solo reacciona a una nueva petición desde el inspector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferred]);

  const clip = sources.find((c) => c.id === source);

  const run = async () => {
    if (!clip) return;
    setError(null);
    setBusy({ stage: "Preparando audio", fraction: null });
    abort.current = new AbortController();
    try {
      const lines = await generateCaptions(clip, {
        language: language || null,
        model,
        signal: abort.current.signal,
        onProgress: (stage, fraction) => setBusy({ stage, fraction }),
      });
      if (!lines.length) setError("No se detectó voz en este clip.");
      else {
        addSubtitles(lines);
        onDone(lines.length);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  if (!sources.length) return <p className="muted small">Añade un video o audio con voz para generar subtítulos.</p>;

  return (
    <div className="gen">
      <label className="stack">
        <span>Clip con voz</span>
        <select value={source} onChange={(e) => setSource(e.target.value)} disabled={!!busy}>
          {sources.map((c) => (
            <option key={c.id} value={c.id}>
              {formatEditable(c.start)} · {kinds.get(c.assetId)?.name}
            </option>
          ))}
        </select>
      </label>
      <div className="inline">
        <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!busy} aria-label="Idioma">
          {LANGUAGES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        {busy ? (
          <button onClick={() => abort.current?.abort()}>Cancelar</button>
        ) : (
          <button className="primary" onClick={run} disabled={!clip}>
            <Icon name="sparkles" /> Generar
          </button>
        )}
      </div>
      {busy && (
        <div className={`progress slim ${busy.fraction == null ? "indeterminate" : ""}`} role="progressbar" aria-valuenow={busy.fraction == null ? undefined : Math.round(busy.fraction * 100)}>
          <div style={{ width: busy.fraction == null ? undefined : `${Math.max(3, busy.fraction * 100)}%` }} />
          <span>{busy.stage}</span>
        </div>
      )}
      {error && <p className="error small">{error}</p>}
      <details>
        <summary>Modelo</summary>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!!busy}>
          {CAPTION_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <p className="muted small">Se ejecuta en tu equipo; la primera vez descarga el modelo. Revisa el texto generado.</p>
      </details>
    </div>
  );
}

function Style({ lines }: { lines: TextClip[] }) {
  const updateClips = useEditor((s) => s.updateClips);
  const style = lines[0] ? subtitleStyleOf(lines[0]) : DEFAULT_SUBTITLE_STYLE;
  const ids = lines.map((l) => l.id);
  const apply = (patch: Partial<TextClip>) => updateClips(ids, patch);
  const bgOn = !/^#[0-9a-f]{6}00$/i.test(style.background);
  const seg = <T extends number>(value: T, options: [T, string][], pick: (v: T) => void) => (
    <div className="segmented">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? "on" : ""} onClick={() => pick(v)}>
          {l}
        </button>
      ))}
    </div>
  );
  return (
    <div className="gen">
      <div className="stack">
        <span>Tamaño</span>
        {seg(style.fontSize, [[40, "S"], [56, "M"], [76, "L"]], (fontSize) => apply({ fontSize }))}
      </div>
      <div className="stack">
        <span>Posición</span>
        {seg(style.y, [[-0.72, "Arriba"], [0, "Centro"], [0.72, "Abajo"]], (y) => apply({ y, x: 0 }))}
      </div>
      <div className="stack">
        <span>Color</span>
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} className={`swatch ${style.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => apply({ color: c })} aria-label={`Color ${c}`} />
          ))}
        </div>
      </div>
      <button className={`toggle ${bgOn ? "on" : ""}`} role="switch" aria-checked={bgOn} onClick={() => apply({ background: bgOn ? "#00000000" : "#000000aa" })}>
        <span>Fondo</span>
        <span className="knob" />
      </button>
      <button className={`toggle ${style.bold ? "on" : ""}`} role="switch" aria-checked={style.bold} onClick={() => apply({ bold: !style.bold })}>
        <span>Negrita</span>
        <span className="knob" />
      </button>
    </div>
  );
}

export function Subtitles() {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const selected = useEditor((s) => s.selected);
  const lines = subtitleClips(project);
  const s = useEditor.getState;
  const [focusId, setFocusId] = useState<string | null>(null);
  const [open, setOpen] = useState<"generate" | "style" | null>(lines.length ? null : "generate");
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const activeId = lines.find((l) => time >= l.start && time < clipEnd(l))?.id;

  // Mantiene visible la línea que se está reproduciendo.
  useEffect(() => {
    if (!activeId || !s().playing) return;
    list.current?.querySelector(`[data-id="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, s]);

  const add = () => {
    const t = s().time;
    const covering = lines.find((l) => t >= l.start && t < clipEnd(l));
    const start = covering ? clipEnd(covering) : t;
    const next = lines.find((l) => l.start > start + 0.05);
    const end = next && next.start - start >= 0.5 ? Math.min(start + 2, next.start) : start + 2;
    const [id] = s().addSubtitles([{ start, end, text: "" }]);
    s().select([id]);
    setFocusId(id);
  };

  const setTiming = (l: TextClip, start: number, end: number): boolean => {
    if (!(start >= 0) || !(end - start >= MIN_LINE)) return false;
    s().updateClip(l.id, { start, duration: end - start });
    return true;
  };

  const seek = (l: TextClip) => {
    s().setPlaying(false);
    s().setTime(l.start);
    s().select([l.id]);
  };

  const exportSrt = async () => {
    const srt = toSrt(lines.map((l) => ({ start: l.start, end: clipEnd(l), text: l.text })));
    const name = `${project.name.replace(/[\\/:*?"<>|]+/g, "_") || "subtitulos"}.srt`;
    try {
      await saveFile(new Blob([srt], { type: "application/x-subrip" }), name, { description: "Subtítulos SRT", mime: "application/x-subrip", extension: ".srt" });
      s().setStatus(`Exportado ${name}`);
    } catch {
      // Cancelado por el usuario.
    }
  };

  const importFile = async (file: File) => {
    const { lines: parsed, skipped } = parseSubtitles(await file.text());
    if (!parsed.length) {
      s().setStatus("El archivo no contiene subtítulos válidos");
      return;
    }
    if (lines.length && !confirm(`¿Reemplazar los ${lines.length} subtítulos actuales por los ${parsed.length} del archivo?`)) return;
    s().addSubtitles(parsed, { replace: true });
    s().setStatus(`${parsed.length} subtítulos importados${skipped ? ` · ${skipped} bloque(s) ignorado(s)` : ""}`);
  };

  return (
    <div className="subs">
      <div className="subs-actions">
        <button className="primary" onClick={add} title="Añadir un subtítulo en la posición del cabezal">
          <Icon name="plus" /> Añadir
        </button>
        <button className={open === "generate" ? "on" : ""} onClick={() => setOpen(open === "generate" ? null : "generate")}>
          <Icon name="sparkles" /> Auto
        </button>
        <button className={open === "style" ? "on" : ""} onClick={() => setOpen(open === "style" ? null : "style")} disabled={!lines.length}>
          <Icon name="type" /> Estilo
        </button>
        <details className="menu">
          <summary className="tool" aria-label="Archivo SRT" title="Importar o exportar SRT">
            <Icon name="more" />
          </summary>
          <div className="menu-pop down">
            <button onClick={() => fileInput.current?.click()}>
              <Icon name="upload" /> Importar .srt / .vtt
            </button>
            <button onClick={() => void exportSrt()} disabled={!lines.length}>
              <Icon name="download" /> Exportar .srt
            </button>
          </div>
        </details>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".srt,.vtt,text/vtt,application/x-subrip"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importFile(f);
          }}
        />
      </div>

      {open === "generate" && <Generate onDone={(n) => (setOpen(null), s().setStatus(`${n} subtítulos generados`))} />}
      {open === "style" && <Style lines={lines} />}

      {lines.length === 0 ? (
        <p className="muted small subs-empty">
          Sin subtítulos. Mueve el cabezal al momento deseado y pulsa <b>Añadir</b>, o genéralos con <b>Auto</b>.
        </p>
      ) : (
        <div className="subs-list" ref={list}>
          {lines.map((l, i) => (
            <div
              key={l.id}
              data-id={l.id}
              className={`sub-row ${l.id === activeId ? "active" : ""} ${selected.includes(l.id) ? "selected" : ""}`}
            >
              <div className="sub-head">
                <button className="sub-index" onClick={() => seek(l)} title="Ir a este subtítulo">
                  {i + 1}
                </button>
                <TimeField value={l.start} label="Inicio" onCommit={(v) => setTiming(l, v, clipEnd(l))} />
                <button className="ghost mini" onClick={() => setTiming(l, s().time, clipEnd(l))} title="Inicio en el cabezal" aria-label="Inicio en el cabezal">
                  <Icon name="start" size={12} />
                </button>
                <span className="muted">→</span>
                <TimeField value={clipEnd(l)} label="Fin" onCommit={(v) => setTiming(l, l.start, v)} />
                <button className="ghost mini" onClick={() => setTiming(l, l.start, s().time)} title="Fin en el cabezal" aria-label="Fin en el cabezal">
                  <Icon name="end" size={12} />
                </button>
                <span className="grow" />
                <button
                  className="ghost mini"
                  onClick={() => {
                    s().select([l.id]);
                    s().deleteSelected();
                  }}
                  title="Eliminar subtítulo"
                  aria-label="Eliminar subtítulo"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <textarea
                rows={1}
                value={l.text}
                placeholder="Escribe el subtítulo…"
                autoFocus={l.id === focusId}
                onFocus={() => {
                  s().select([l.id]);
                  if (!s().playing) s().setTime(l.start);
                }}
                onChange={(e) => s().updateClip(l.id, { text: e.target.value })}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { CAPTION_MODELS, generateCaptions } from "../ai/captions";
import { useEditor } from "../store";
import type { MediaClip, TextClip } from "../types";
import { COMPACT_QUERY, useMediaQuery, useUi } from "../ui";
import { Icon } from "./Icon";

function Slider(props: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange(v: number): void }) {
  const begin = useEditor((s) => s.beginGesture);
  const end = useEditor((s) => s.endGesture);
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onPointerDown={begin}
        onPointerUp={end}
        onPointerCancel={end}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output>
        {Number(props.value.toFixed(2))}
        {props.unit}
      </output>
    </label>
  );
}

function Segmented<T extends string | number>(props: { options: { value: T; label: string }[]; value: T | null; onPick(v: T): void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={String(o.value)} className={props.value === o.value ? "on" : ""} onClick={() => props.onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange(v: boolean): void }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span>{label}</span>
      <span className="knob" />
    </button>
  );
}

const FILTERS = [
  { name: "Original", brightness: 1, contrast: 1, saturation: 1 },
  { name: "Claro", brightness: 1.2, contrast: 1.05, saturation: 1.1 },
  { name: "Vivo", brightness: 1.05, contrast: 1.15, saturation: 1.6 },
  { name: "Suave", brightness: 1.08, contrast: 0.88, saturation: 0.85 },
  { name: "Contraste", brightness: 0.85, contrast: 1.35, saturation: 1.1 },
  { name: "B/N", brightness: 1, contrast: 1.15, saturation: 0 },
];

const FADE = 0.6;

function DeleteButton({ id }: { id: string }) {
  return (
    <button
      className="danger wide"
      onClick={() => {
        useEditor.getState().select([id]);
        useEditor.getState().deleteSelected();
        useUi.getState().setSheet(null);
      }}
    >
      <Icon name="trash" /> Eliminar clip
    </button>
  );
}

const LANGUAGES: [string, string][] = [
  ["spanish", "Español"],
  ["english", "Inglés"],
  ["portuguese", "Portugués"],
  ["french", "Francés"],
  ["german", "Alemán"],
  ["italian", "Italiano"],
  ["", "Detectar automáticamente"],
];

function Captions({ clip }: { clip: MediaClip }) {
  const addTextClips = useEditor((s) => s.addTextClips);
  const [language, setLanguage] = useState("spanish");
  const [model, setModel] = useState(CAPTION_MODELS[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = async () => {
    setError(null);
    setDone(false);
    try {
      const clips = await generateCaptions(clip, {
        language: language || null,
        model,
        onProgress: (stage, f) => setBusy(f == null ? stage : `${stage} ${Math.round(f * 100)}%`),
      });
      if (!clips.length) setError("No se detectó voz en este clip.");
      else {
        addTextClips(clips, "Subtítulos");
        setDone(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="group">
      <h4>Subtítulos automáticos</h4>
      <div className="inline">
        <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!busy} aria-label="Idioma">
          {LANGUAGES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <button onClick={run} disabled={!!busy}>
          <Icon name="sparkles" /> {busy ? "…" : "Generar"}
        </button>
      </div>
      {busy && <p className="muted small">{busy}</p>}
      {done && <p className="ok small">Subtítulos añadidos a la línea de tiempo.</p>}
      {error && <p className="error small">{error}</p>}
      <details>
        <summary>Modelo</summary>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!!busy}>
          {CAPTION_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <p className="muted small">Se ejecuta en tu equipo. La primera vez descarga el modelo.</p>
      </details>
    </section>
  );
}

function MediaInspector({ clip }: { clip: MediaClip }) {
  const update = useEditor((s) => s.updateClip);
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === clip.assetId));
  const u = (patch: Partial<MediaClip>) => update(clip.id, patch);
  const visual = asset?.kind !== "audio";
  const audible = asset?.kind !== "image";
  const maxDuration = asset && asset.kind !== "image" ? (asset.duration - clip.inPoint) / clip.speed : 3600;
  const setSpeed = (speed: number) => {
    const max = asset && asset.kind !== "image" ? (asset.duration - clip.inPoint) / speed : Infinity;
    u({ speed, duration: Math.min((clip.duration * clip.speed) / speed, max) });
  };
  const filter = FILTERS.find((f) => f.brightness === clip.brightness && f.contrast === clip.contrast && f.saturation === clip.saturation);

  return (
    <>
      <h3 title={asset?.name}>
        <Icon name={asset?.kind === "audio" ? "music" : asset?.kind === "image" ? "image" : "film"} /> {asset?.name ?? "Clip"}
      </h3>

      {visual && (
        <section className="group">
          <h4>Filtro</h4>
          <div className="filters">
            {FILTERS.map((f) => (
              <button
                key={f.name}
                className={`filter ${filter?.name === f.name ? "on" : ""}`}
                onClick={() => u({ brightness: f.brightness, contrast: f.contrast, saturation: f.saturation })}
              >
                <span
                  className="fthumb"
                  style={{
                    backgroundImage: asset?.thumbnail ? `url(${asset.thumbnail})` : undefined,
                    filter: `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation})`,
                  }}
                />
                {f.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {asset?.kind !== "image" && (
        <section className="group">
          <h4>Velocidad</h4>
          <Segmented
            value={[0.5, 1, 1.5, 2].includes(clip.speed) ? clip.speed : null}
            onPick={setSpeed}
            options={[
              { value: 0.5, label: "0.5×" },
              { value: 1, label: "1×" },
              { value: 1.5, label: "1.5×" },
              { value: 2, label: "2×" },
            ]}
          />
        </section>
      )}

      {audible && (
        <section className="group">
          <h4>Audio</h4>
          <div className="inline">
            <button className="ghost square" onClick={() => u({ volume: clip.volume === 0 ? 1 : 0 })} aria-label={clip.volume === 0 ? "Activar sonido" : "Silenciar"}>
              <Icon name={clip.volume === 0 ? "mute" : "volume"} />
            </button>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={clip.volume}
              onPointerDown={() => useEditor.getState().beginGesture()}
              onPointerUp={() => useEditor.getState().endGesture()}
              onChange={(e) => u({ volume: Number(e.target.value) })}
              aria-label="Volumen"
            />
            <output className="muted small">{Math.round(clip.volume * 100)}%</output>
          </div>
          <Toggle on={clip.voiceClean} label="Mejorar voz" onChange={(v) => u({ voiceClean: v })} />
        </section>
      )}

      <section className="group">
        <h4>Transiciones</h4>
        <Toggle on={clip.fadeIn > 0} label="Fundido de entrada" onChange={(v) => u({ fadeIn: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        <Toggle on={clip.fadeOut > 0} label="Fundido de salida" onChange={(v) => u({ fadeOut: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
      </section>

      {visual && (
        <section className="group">
          <h4>Encuadre</h4>
          <div className="inline">
            <button onClick={() => u({ rotation: (clip.rotation + 90) % 360 })} title="Girar 90°">
              <Icon name="rotate" /> Girar
            </button>
            <button className="square" onClick={() => u({ scale: Math.max(0.2, clip.scale / 1.15) })} aria-label="Alejar">
              <Icon name="zoomOut" />
            </button>
            <button className="square" onClick={() => u({ scale: Math.min(4, clip.scale * 1.15) })} aria-label="Acercar">
              <Icon name="zoomIn" />
            </button>
          </div>
        </section>
      )}

      {audible && <Captions clip={clip} />}

      <details className="group">
        <summary>Avanzado</summary>
        <Slider label="Duración" value={clip.duration} min={0.1} max={Math.max(0.1, maxDuration)} step={0.05} unit="s" onChange={(v) => u({ duration: v })} />
        {asset?.kind !== "image" && <Slider label="Velocidad" value={clip.speed} min={0.25} max={4} step={0.05} unit="×" onChange={setSpeed} />}
        <Slider label="Entrada" value={clip.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeIn: v })} />
        <Slider label="Salida" value={clip.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeOut: v })} />
        {visual && (
          <>
            <Slider label="Escala" value={clip.scale} min={0.1} max={4} step={0.01} unit="×" onChange={(v) => u({ scale: v })} />
            <Slider label="Posición X" value={clip.x} min={-2} max={2} step={0.01} onChange={(v) => u({ x: v })} />
            <Slider label="Posición Y" value={clip.y} min={-2} max={2} step={0.01} onChange={(v) => u({ y: v })} />
            <Slider label="Rotación" value={clip.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => u({ rotation: v })} />
            <Slider label="Opacidad" value={clip.opacity} min={0} max={1} step={0.01} onChange={(v) => u({ opacity: v })} />
            <Slider label="Brillo" value={clip.brightness} min={0} max={2} step={0.01} onChange={(v) => u({ brightness: v })} />
            <Slider label="Contraste" value={clip.contrast} min={0} max={2} step={0.01} onChange={(v) => u({ contrast: v })} />
            <Slider label="Saturación" value={clip.saturation} min={0} max={3} step={0.01} onChange={(v) => u({ saturation: v })} />
            <button onClick={() => u({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, contrast: 1, saturation: 1 })}>
              Restablecer imagen
            </button>
          </>
        )}
      </details>

      <DeleteButton id={clip.id} />
    </>
  );
}

const TEXT_COLORS = ["#ffffff", "#111111", "#facc15", "#f87171", "#60a5fa", "#4ade80", "#f472b6", "#fb923c"];

function TextInspector({ clip }: { clip: TextClip }) {
  const update = useEditor((s) => s.updateClip);
  const u = (patch: Partial<TextClip>) => update(clip.id, patch);
  const bgOn = !/^#[0-9a-f]{6}00$/i.test(clip.background);
  return (
    <>
      <h3>
        <Icon name="type" /> Texto
      </h3>
      <section className="group">
        <textarea value={clip.text} rows={2} onChange={(e) => u({ text: e.target.value })} autoFocus={clip.text === "Escribe aquí"} aria-label="Texto" />
      </section>
      <section className="group">
        <h4>Tamaño</h4>
        <Segmented
          value={clip.fontSize}
          onPick={(fontSize) => u({ fontSize })}
          options={[
            { value: 48, label: "S" },
            { value: 80, label: "M" },
            { value: 130, label: "L" },
          ]}
        />
      </section>
      <section className="group">
        <h4>Color</h4>
        <div className="swatches">
          {TEXT_COLORS.map((c) => (
            <button key={c} className={`swatch ${clip.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => u({ color: c })} aria-label={`Color ${c}`} />
          ))}
        </div>
        <Toggle on={bgOn} label="Fondo" onChange={(v) => u({ background: v ? "#000000aa" : "#00000000" })} />
        <Toggle on={clip.bold} label="Negrita" onChange={(bold) => u({ bold })} />
      </section>
      <section className="group">
        <h4>Posición</h4>
        <Segmented
          value={clip.y}
          onPick={(y) => u({ y, x: 0 })}
          options={[
            { value: -0.7, label: "Arriba" },
            { value: 0, label: "Centro" },
            { value: 0.7, label: "Abajo" },
          ]}
        />
      </section>
      <section className="group">
        <h4>Transiciones</h4>
        <Toggle on={clip.fadeIn > 0} label="Fundido de entrada" onChange={(v) => u({ fadeIn: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        <Toggle on={clip.fadeOut > 0} label="Fundido de salida" onChange={(v) => u({ fadeOut: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        <Slider label="Duración" value={clip.duration} min={0.5} max={60} step={0.5} unit="s" onChange={(v) => u({ duration: v })} />
      </section>
      <details className="group">
        <summary>Avanzado</summary>
        <Slider label="Tamaño" value={clip.fontSize} min={12} max={300} step={1} unit="px" onChange={(v) => u({ fontSize: v })} />
        <label className="field">
          <span>Color</span>
          <input type="color" value={clip.color} onChange={(e) => u({ color: e.target.value })} />
        </label>
        {bgOn && (
          <label className="field">
            <span>Fondo</span>
            <input type="color" value={clip.background.slice(0, 7)} onChange={(e) => u({ background: `${e.target.value}aa` })} />
          </label>
        )}
        <Slider label="Posición X" value={clip.x} min={-1} max={1} step={0.01} onChange={(v) => u({ x: v })} />
        <Slider label="Posición Y" value={clip.y} min={-1} max={1} step={0.01} onChange={(v) => u({ y: v })} />
      </details>
      <DeleteButton id={clip.id} />
    </>
  );
}

export function Inspector() {
  const selected = useEditor((s) => s.selected);
  const clip = useEditor((s) => s.project.clips.find((c) => c.id === s.selected[0]));
  const addText = useEditor((s) => s.addText);
  const compact = useMediaQuery(COMPACT_QUERY);
  return (
    <aside className="inspector">
      {!compact && <h2 className="panel-title">Editar</h2>}
      {!clip && (
        <div className="empty">
          <p className="muted">Selecciona un clip en la línea de tiempo para editarlo.</p>
          <button onClick={() => addText()}>
            <Icon name="type" /> Añadir texto
          </button>
        </div>
      )}
      {clip && selected.length > 1 && <p className="muted small">{selected.length} clips seleccionados · se muestra el primero</p>}
      {clip?.type === "media" && <MediaInspector clip={clip} />}
      {clip?.type === "text" && <TextInspector clip={clip} />}
    </aside>
  );
}

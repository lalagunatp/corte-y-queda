import { useState } from "react";
import { CAPTION_MODELS, generateCaptions } from "../ai/captions";
import { useEditor } from "../store";
import type { MediaClip, TextClip } from "../types";
import { COMPACT_QUERY, useMediaQuery, useUi } from "../ui";

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

function Choices<T extends string | number>(props: { options: { value: T; icon: string; label: string }[]; value: T | null; onPick(v: T): void }) {
  return (
    <div className="choices">
      {props.options.map((o) => (
        <button key={String(o.value)} className={`choice ${props.value === o.value ? "on" : ""}`} onClick={() => props.onPick(o.value)}>
          <span className="ico">{o.icon}</span>
          <b>{o.label}</b>
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange(v: boolean): void }) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on}>
      <span className="knob" />
      {label}
    </button>
  );
}

const FILTERS = [
  { name: "Normal", brightness: 1, contrast: 1, saturation: 1 },
  { name: "Brillante", brightness: 1.2, contrast: 1.05, saturation: 1.1 },
  { name: "Vivo", brightness: 1.05, contrast: 1.15, saturation: 1.6 },
  { name: "Suave", brightness: 1.08, contrast: 0.88, saturation: 0.85 },
  { name: "Dramático", brightness: 0.85, contrast: 1.35, saturation: 1.1 },
  { name: "Blanco y negro", brightness: 1, contrast: 1.15, saturation: 0 },
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
      🗑️ Borrar este trozo
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
  ["", "Otro (lo detecta solo)"],
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
      if (!clips.length) setError("No se escuchó a nadie hablando en este trozo.");
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
      <h4>✨ Subtítulos automáticos</h4>
      <p className="hint">Escribe solo lo que se dice en el video. La primera vez tarda un poco más.</p>
      <label className="stack">
        <span>¿En qué idioma hablan?</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!busy}>
          {LANGUAGES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </label>
      <button className="primary big wide" onClick={run} disabled={!!busy}>
        {busy ? `⏳ ${busy}` : "✨ Crear subtítulos"}
      </button>
      {done && <p className="ok">✅ ¡Listo! Revisa los textos en la línea de tiempo.</p>}
      {error && <p className="error">{error}</p>}
      <details>
        <summary>Más opciones</summary>
        <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!!busy}>
          {CAPTION_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
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
        {asset?.kind === "audio" ? "🎵" : asset?.kind === "image" ? "🖼️" : "🎬"} {asset?.name ?? "Trozo"}
      </h3>

      {visual && (
        <section className="group">
          <h4>🎨 Filtro</h4>
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
          <h4>⏩ Velocidad</h4>
          <Choices
            value={[0.5, 1, 2].includes(clip.speed) ? clip.speed : null}
            onPick={setSpeed}
            options={[
              { value: 0.5, icon: "🐢", label: "Lento" },
              { value: 1, icon: "🚶", label: "Normal" },
              { value: 2, icon: "🐇", label: "Rápido" },
            ]}
          />
        </section>
      )}

      {audible && (
        <section className="group">
          <h4>🔊 Sonido</h4>
          <div className="row">
            <button className={`icon-btn ${clip.volume === 0 ? "on" : ""}`} onClick={() => u({ volume: clip.volume === 0 ? 1 : 0 })}>
              {clip.volume === 0 ? "🔇 Sin sonido" : "🔈 Silenciar"}
            </button>
          </div>
          <Slider label="Volumen" value={clip.volume} min={0} max={2} step={0.05} unit="×" onChange={(v) => u({ volume: v })} />
          <Toggle on={clip.voiceClean} label="🎙️ Mejorar la voz (menos ruido)" onChange={(v) => u({ voiceClean: v })} />
        </section>
      )}

      <section className="group">
        <h4>✨ Efectos</h4>
        <Toggle on={clip.fadeIn > 0} label="🌅 Aparecer suave" onChange={(v) => u({ fadeIn: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        <Toggle on={clip.fadeOut > 0} label="🌇 Desaparecer suave" onChange={(v) => u({ fadeOut: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        {visual && (
          <div className="row">
            <button onClick={() => u({ rotation: (clip.rotation + 90) % 360 })}>🔄 Girar</button>
            <button onClick={() => u({ scale: Math.min(4, clip.scale * 1.15) })}>🔍 Acercar</button>
            <button onClick={() => u({ scale: Math.max(0.2, clip.scale / 1.15) })}>🔎 Alejar</button>
          </div>
        )}
      </section>

      {audible && <Captions clip={clip} />}

      <details className="group">
        <summary>🛠️ Más opciones</summary>
        <Slider label="Duración" value={clip.duration} min={0.1} max={Math.max(0.1, maxDuration)} step={0.05} unit="s" onChange={(v) => u({ duration: v })} />
        {asset?.kind !== "image" && <Slider label="Velocidad" value={clip.speed} min={0.25} max={4} step={0.05} unit="×" onChange={setSpeed} />}
        <Slider label="Aparecer" value={clip.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeIn: v })} />
        <Slider label="Desaparecer" value={clip.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeOut: v })} />
        {visual && (
          <>
            <Slider label="Tamaño" value={clip.scale} min={0.1} max={4} step={0.01} unit="×" onChange={(v) => u({ scale: v })} />
            <Slider label="Mover ↔" value={clip.x} min={-2} max={2} step={0.01} onChange={(v) => u({ x: v })} />
            <Slider label="Mover ↕" value={clip.y} min={-2} max={2} step={0.01} onChange={(v) => u({ y: v })} />
            <Slider label="Girar" value={clip.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => u({ rotation: v })} />
            <Slider label="Transparencia" value={clip.opacity} min={0} max={1} step={0.01} onChange={(v) => u({ opacity: v })} />
            <Slider label="Brillo" value={clip.brightness} min={0} max={2} step={0.01} onChange={(v) => u({ brightness: v })} />
            <Slider label="Contraste" value={clip.contrast} min={0} max={2} step={0.01} onChange={(v) => u({ contrast: v })} />
            <Slider label="Color" value={clip.saturation} min={0} max={3} step={0.01} onChange={(v) => u({ saturation: v })} />
            <button onClick={() => u({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, contrast: 1, saturation: 1 })}>
              ↺ Dejar la imagen como estaba
            </button>
          </>
        )}
      </details>

      <DeleteButton id={clip.id} />
    </>
  );
}

const TEXT_COLORS = ["#ffffff", "#000000", "#facc15", "#f87171", "#60a5fa", "#4ade80", "#f472b6", "#fb923c"];

function TextInspector({ clip }: { clip: TextClip }) {
  const update = useEditor((s) => s.updateClip);
  const u = (patch: Partial<TextClip>) => update(clip.id, patch);
  const bgOn = !/^#[0-9a-f]{6}00$/i.test(clip.background);
  return (
    <>
      <h3>🔤 Texto</h3>
      <section className="group">
        <label className="stack">
          <span>Escribe tu texto</span>
          <textarea value={clip.text} rows={2} onChange={(e) => u({ text: e.target.value })} autoFocus={clip.text === "Escribe aquí"} />
        </label>
      </section>
      <section className="group">
        <h4>📏 Tamaño</h4>
        <Choices
          value={clip.fontSize}
          onPick={(fontSize) => u({ fontSize })}
          options={[
            { value: 48, icon: "a", label: "Pequeño" },
            { value: 80, icon: "A", label: "Mediano" },
            { value: 130, icon: "𝐀", label: "Grande" },
          ]}
        />
      </section>
      <section className="group">
        <h4>🎨 Color</h4>
        <div className="swatches">
          {TEXT_COLORS.map((c) => (
            <button key={c} className={`swatch ${clip.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => u({ color: c })} aria-label={`Color ${c}`} />
          ))}
        </div>
        <Toggle on={bgOn} label="⬛ Con fondo" onChange={(v) => u({ background: v ? "#000000aa" : "#00000000" })} />
        <Toggle on={clip.bold} label="𝐁 Letra gruesa" onChange={(bold) => u({ bold })} />
      </section>
      <section className="group">
        <h4>📍 ¿Dónde va?</h4>
        <Choices
          value={clip.y}
          onPick={(y) => u({ y, x: 0 })}
          options={[
            { value: -0.7, icon: "⬆️", label: "Arriba" },
            { value: 0, icon: "⏺️", label: "Centro" },
            { value: 0.7, icon: "⬇️", label: "Abajo" },
          ]}
        />
      </section>
      <section className="group">
        <h4>✨ Efectos</h4>
        <Toggle on={clip.fadeIn > 0} label="🌅 Aparecer suave" onChange={(v) => u({ fadeIn: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        <Toggle on={clip.fadeOut > 0} label="🌇 Desaparecer suave" onChange={(v) => u({ fadeOut: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        <Slider label="Dura" value={clip.duration} min={0.5} max={60} step={0.5} unit="s" onChange={(v) => u({ duration: v })} />
      </section>
      <details className="group">
        <summary>🛠️ Más opciones</summary>
        <Slider label="Tamaño" value={clip.fontSize} min={12} max={300} step={1} unit="px" onChange={(v) => u({ fontSize: v })} />
        <label className="field">
          <span>Otro color</span>
          <input type="color" value={clip.color} onChange={(e) => u({ color: e.target.value })} />
        </label>
        {bgOn && (
          <label className="field">
            <span>Color del fondo</span>
            <input type="color" value={clip.background.slice(0, 7)} onChange={(e) => u({ background: `${e.target.value}aa` })} />
          </label>
        )}
        <Slider label="Mover ↔" value={clip.x} min={-1} max={1} step={0.01} onChange={(v) => u({ x: v })} />
        <Slider label="Mover ↕" value={clip.y} min={-1} max={1} step={0.01} onChange={(v) => u({ y: v })} />
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
      {!compact && <h2 className="panel-title">🎨 Editar</h2>}
      {!clip && (
        <div className="empty">
          <div className="big-ico">👆</div>
          <p>
            <b>Toca un trozo</b> en la línea de tiempo de abajo para cambiarlo.
          </p>
          <button className="big wide" onClick={() => addText()}>🔤 Añadir un texto</button>
          <p className="hint">Truco: para pasar suave de un trozo a otro, activa «Desaparecer suave» en uno y «Aparecer suave» en el siguiente.</p>
        </div>
      )}
      {clip && selected.length > 1 && <p className="hint">Elegiste {selected.length} trozos; aquí ves el primero.</p>}
      {clip?.type === "media" && <MediaInspector clip={clip} />}
      {clip?.type === "text" && <TextInspector clip={clip} />}
    </aside>
  );
}

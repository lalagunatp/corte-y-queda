import { useState } from "react";
import { CAPTION_MODELS, generateCaptions } from "../ai/captions";
import { useEditor } from "../store";
import type { MediaClip, TextClip } from "../types";

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
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <input
        className="num"
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={Number(props.value.toFixed(3))}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.unit && <em>{props.unit}</em>}
    </label>
  );
}

const LANGUAGES: [string, string][] = [
  ["", "Detectar idioma"],
  ["spanish", "Español"],
  ["english", "Inglés"],
  ["portuguese", "Portugués"],
  ["french", "Francés"],
  ["german", "Alemán"],
  ["italian", "Italiano"],
];

function Captions({ clip }: { clip: MediaClip }) {
  const addTextClips = useEditor((s) => s.addTextClips);
  const [language, setLanguage] = useState("spanish");
  const [model, setModel] = useState(CAPTION_MODELS[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    try {
      const clips = await generateCaptions(clip, {
        language: language || null,
        model,
        onProgress: (stage, f) => setBusy(f == null ? stage : `${stage} ${Math.round(f * 100)}%`),
      });
      if (!clips.length) setError("No se detectó voz en este clip.");
      else addTextClips(clips, "Subtítulos");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="group">
      <h4>Subtítulos automáticos (IA local)</h4>
      <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={!!busy}>
        {LANGUAGES.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!!busy}>
        {CAPTION_MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
      <button className="primary wide" onClick={run} disabled={!!busy}>
        {busy ?? "Generar subtítulos"}
      </button>
      {error && <p className="error">{error}</p>}
      <p className="hint">Whisper corre en tu equipo. La primera vez descarga el modelo; tu audio no se sube.</p>
    </div>
  );
}

function MediaInspector({ clip }: { clip: MediaClip }) {
  const update = useEditor((s) => s.updateClip);
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === clip.assetId));
  const u = (patch: Partial<MediaClip>) => update(clip.id, patch);
  const visual = asset?.kind !== "audio";
  const audible = asset?.kind !== "image";
  const maxDuration = asset && asset.kind !== "image" ? (asset.duration - clip.inPoint) / clip.speed : 3600;
  return (
    <>
      <h3 title={asset?.name}>{asset?.name ?? "Clip"}</h3>
      <div className="group">
        <h4>Tiempo</h4>
        <Slider label="Duración" value={clip.duration} min={0.1} max={Math.max(0.1, maxDuration)} step={0.01} unit="s" onChange={(v) => u({ duration: v })} />
        {asset?.kind !== "image" && (
          <Slider
            label="Velocidad"
            value={clip.speed}
            min={0.25}
            max={4}
            step={0.05}
            unit="×"
            onChange={(speed) => {
              const max = asset ? (asset.duration - clip.inPoint) / speed : clip.duration;
              u({ speed, duration: Math.min((clip.duration * clip.speed) / speed, max) });
            }}
          />
        )}
        <Slider label="Fundido entrada" value={clip.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeIn: v })} />
        <Slider label="Fundido salida" value={clip.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeOut: v })} />
      </div>
      {visual && (
        <div className="group">
          <h4>Imagen</h4>
          <Slider label="Escala" value={clip.scale} min={0.1} max={4} step={0.01} unit="×" onChange={(v) => u({ scale: v })} />
          <Slider label="Posición X" value={clip.x} min={-2} max={2} step={0.01} onChange={(v) => u({ x: v })} />
          <Slider label="Posición Y" value={clip.y} min={-2} max={2} step={0.01} onChange={(v) => u({ y: v })} />
          <Slider label="Rotación" value={clip.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => u({ rotation: v })} />
          <Slider label="Opacidad" value={clip.opacity} min={0} max={1} step={0.01} onChange={(v) => u({ opacity: v })} />
          <Slider label="Brillo" value={clip.brightness} min={0} max={2} step={0.01} onChange={(v) => u({ brightness: v })} />
          <Slider label="Contraste" value={clip.contrast} min={0} max={2} step={0.01} onChange={(v) => u({ contrast: v })} />
          <Slider label="Saturación" value={clip.saturation} min={0} max={3} step={0.01} onChange={(v) => u({ saturation: v })} />
          <button onClick={() => u({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, contrast: 1, saturation: 1 })}>Restablecer imagen</button>
        </div>
      )}
      {audible && (
        <div className="group">
          <h4>Audio</h4>
          <Slider label="Volumen" value={clip.volume} min={0} max={2} step={0.01} unit="×" onChange={(v) => u({ volume: v })} />
          <label className="check">
            <input type="checkbox" checked={clip.voiceClean} onChange={(e) => u({ voiceClean: e.target.checked })} />
            Limpiar voz (reduce zumbidos y ruido grave, nivela el volumen)
          </label>
        </div>
      )}
      {audible && <Captions clip={clip} />}
    </>
  );
}

function TextInspector({ clip }: { clip: TextClip }) {
  const update = useEditor((s) => s.updateClip);
  const u = (patch: Partial<TextClip>) => update(clip.id, patch);
  const bgOn = !/^#[0-9a-f]{6}00$/i.test(clip.background);
  return (
    <>
      <h3>Texto</h3>
      <div className="group">
        <textarea value={clip.text} rows={3} onChange={(e) => u({ text: e.target.value })} />
        <Slider label="Tamaño" value={clip.fontSize} min={12} max={300} step={1} unit="px" onChange={(v) => u({ fontSize: v })} />
        <label className="field">
          <span>Color</span>
          <input type="color" value={clip.color} onChange={(e) => u({ color: e.target.value })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={clip.bold} onChange={(e) => u({ bold: e.target.checked })} /> Negrita
        </label>
        <label className="check">
          <input type="checkbox" checked={bgOn} onChange={(e) => u({ background: e.target.checked ? "#000000aa" : "#00000000" })} /> Fondo
        </label>
        {bgOn && (
          <label className="field">
            <span>Color de fondo</span>
            <input type="color" value={clip.background.slice(0, 7)} onChange={(e) => u({ background: `${e.target.value}aa` })} />
          </label>
        )}
        <Slider label="Posición X" value={clip.x} min={-1} max={1} step={0.01} onChange={(v) => u({ x: v })} />
        <Slider label="Posición Y" value={clip.y} min={-1} max={1} step={0.01} onChange={(v) => u({ y: v })} />
        <Slider label="Duración" value={clip.duration} min={0.1} max={600} step={0.05} unit="s" onChange={(v) => u({ duration: v })} />
        <Slider label="Fundido entrada" value={clip.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeIn: v })} />
        <Slider label="Fundido salida" value={clip.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeOut: v })} />
      </div>
    </>
  );
}

export function Inspector() {
  const selected = useEditor((s) => s.selected);
  const clip = useEditor((s) => s.project.clips.find((c) => c.id === s.selected[0]));
  const addText = useEditor((s) => s.addText);
  return (
    <aside className="inspector">
      {!clip && (
        <div className="empty">
          <p>Selecciona un clip para editar sus propiedades.</p>
          <button className="wide" onClick={() => addText()}>+ Añadir texto</button>
          <p className="hint">
            Transición: superpón dos clips en la misma pista y dales fundido de salida y de entrada.
          </p>
        </div>
      )}
      {clip && selected.length > 1 && <p className="hint">{selected.length} clips seleccionados; se muestra el primero.</p>}
      {clip?.type === "media" && <MediaInspector clip={clip} />}
      {clip?.type === "text" && <TextInspector clip={clip} />}
    </aside>
  );
}

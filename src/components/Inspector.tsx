import { useEditor } from "../store";
import type { MediaClip, TextClip } from "../types";
import { useUi } from "../ui";
import { Icon } from "./Icon";
import { Segmented, Slider, Toggle } from "./controls";
import { TextStyleEditor, sampleOf } from "./TextStyleEditor";

const FILTERS = [
  { name: "Original", brightness: 1, contrast: 1, saturation: 1 },
  { name: "Claro", brightness: 1.2, contrast: 1.05, saturation: 1.1 },
  { name: "Vivo", brightness: 1.05, contrast: 1.15, saturation: 1.6 },
  { name: "Suave", brightness: 1.08, contrast: 0.88, saturation: 0.85 },
  { name: "Contraste", brightness: 0.85, contrast: 1.35, saturation: 1.1 },
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
      <Icon name="trash" /> Borrar este clip
    </button>
  );
}

function Captions({ clip }: { clip: MediaClip }) {
  const open = useUi((s) => s.openSubtitles);
  return (
    <section className="group">
      <h4>Subtítulos</h4>
      <button onClick={() => open(clip.id)} title="La app escucha lo que se dice y lo escribe sola">
        <Icon name="sparkles" /> Crear subtítulos de este clip
      </button>
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
              { value: 0.5, label: "Lenta" },
              { value: 1, label: "Normal" },
              { value: 1.5, label: "Rápida" },
              { value: 2, label: "Doble" },
            ]}
          />
        </section>
      )}

      {audible && (
        <section className="group">
          <h4>Sonido</h4>
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
          <Toggle on={clip.voiceClean} label="Mejorar la voz (menos ruido)" onChange={(v) => u({ voiceClean: v })} />
        </section>
      )}

      <section className="group">
        <h4>Aparecer y desaparecer</h4>
        <Toggle on={clip.fadeIn > 0} label="Aparecer poco a poco" onChange={(v) => u({ fadeIn: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        <Toggle on={clip.fadeOut > 0} label="Desaparecer poco a poco" onChange={(v) => u({ fadeOut: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
      </section>

      {visual && (
        <section className="group">
          <h4>Girar y hacer zoom</h4>
          <div className="inline">
            <button onClick={() => u({ rotation: (clip.rotation + 90) % 360 })} title="Girar un cuarto de vuelta">
              <Icon name="rotate" /> Girar
            </button>
            <button className="square" onClick={() => u({ scale: Math.max(0.2, clip.scale / 1.15) })} aria-label="Alejar" title="Ver la imagen más pequeña">
              <Icon name="zoomOut" />
            </button>
            <button className="square" onClick={() => u({ scale: Math.min(4, clip.scale * 1.15) })} aria-label="Acercar" title="Ver la imagen más grande">
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
        <Slider label="Aparecer" value={clip.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeIn: v })} />
        <Slider label="Desaparecer" value={clip.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.05} unit="s" onChange={(v) => u({ fadeOut: v })} />
        {visual && (
          <>
            <Slider label="Tamaño" value={clip.scale} min={0.1} max={4} step={0.01} unit="×" onChange={(v) => u({ scale: v })} />
            <Slider label="Horizontal" value={clip.x} min={-2} max={2} step={0.01} onChange={(v) => u({ x: v })} />
            <Slider label="Vertical" value={clip.y} min={-2} max={2} step={0.01} onChange={(v) => u({ y: v })} />
            <Slider label="Giro" value={clip.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => u({ rotation: v })} />
            <Slider label="Opacidad" value={clip.opacity} min={0} max={1} step={0.01} onChange={(v) => u({ opacity: v })} />
            <Slider label="Brillo" value={clip.brightness} min={0} max={2} step={0.01} onChange={(v) => u({ brightness: v })} />
            <Slider label="Contraste" value={clip.contrast} min={0} max={2} step={0.01} onChange={(v) => u({ contrast: v })} />
            <Slider label="Saturación" value={clip.saturation} min={0} max={3} step={0.01} onChange={(v) => u({ saturation: v })} />
            <button onClick={() => u({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1, contrast: 1, saturation: 1 })}>
              Dejar la imagen como al principio
            </button>
          </>
        )}
      </details>

      <DeleteButton id={clip.id} />
    </>
  );
}

function TextInspector({ clip }: { clip: TextClip }) {
  const update = useEditor((s) => s.updateClip);
  const u = (patch: Partial<TextClip>) => update(clip.id, patch);
  const isSubtitle = useEditor((s) => s.project.tracks.find((t) => t.id === clip.trackId)?.role === "subtitles");
  const openSubtitles = useUi((s) => s.openSubtitles);
  return (
    <>
      <h3>
        <Icon name="type" /> {isSubtitle ? "Subtítulo" : "Texto"}
      </h3>
      {isSubtitle && (
        <button onClick={() => openSubtitles()}>
          <Icon name="sliders" /> Editar todos los subtítulos
        </button>
      )}
      <section className="group">
        <textarea value={clip.text} rows={2} onChange={(e) => u({ text: e.target.value })} autoFocus={clip.text === "Escribe aquí"} aria-label="Texto" placeholder="Escribe tu texto" />
      </section>
      <section className="group">
        <h4>Tamaño</h4>
        <Segmented
          value={clip.fontSize}
          onPick={(fontSize) => u({ fontSize })}
          options={[
            { value: 48, label: "Chico" },
            { value: 80, label: "Mediano" },
            { value: 130, label: "Grande" },
            { value: 200, label: "Enorme" },
          ]}
        />
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
      <TextStyleEditor value={clip} onChange={u} sample={sampleOf(clip.text)} />
      <section className="group">
        <h4>Aparecer y desaparecer</h4>
        <Toggle on={clip.fadeIn > 0} label="Aparecer poco a poco" onChange={(v) => u({ fadeIn: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        <Toggle on={clip.fadeOut > 0} label="Desaparecer poco a poco" onChange={(v) => u({ fadeOut: v ? Math.min(FADE, clip.duration / 2) : 0 })} />
        <Slider label="Duración" value={clip.duration} min={0.5} max={60} step={0.5} unit="s" onChange={(v) => u({ duration: v })} />
      </section>
      <details className="group">
        <summary>Avanzado</summary>
        <Slider label="Tamaño" value={clip.fontSize} min={12} max={300} step={1} unit="px" onChange={(v) => u({ fontSize: v })} />
        <Slider label="Horizontal" value={clip.x} min={-1} max={1} step={0.01} onChange={(v) => u({ x: v })} />
        <Slider label="Vertical" value={clip.y} min={-1} max={1} step={0.01} onChange={(v) => u({ y: v })} />
      </details>
      <DeleteButton id={clip.id} />
    </>
  );
}

export function Inspector() {
  const selected = useEditor((s) => s.selected);
  const clip = useEditor((s) => s.project.clips.find((c) => c.id === s.selected[0]));
  const addText = useEditor((s) => s.addText);
  return (
    <>
      {!clip && (
        <div className="empty">
          <p className="hint">
            <Icon name="help" size={16} /> Toca un clip en la línea de tiempo (abajo) para cambiarlo: filtros, velocidad, sonido y más.
          </p>
          <button className="primary wide" onClick={() => addText()}>
            <Icon name="type" /> Añadir texto
          </button>
        </div>
      )}
      {clip && selected.length > 1 && <p className="muted small">{selected.length} clips elegidos · se muestra el primero</p>}
      {clip?.type === "media" && <MediaInspector clip={clip} />}
      {clip?.type === "text" && <TextInspector clip={clip} />}
    </>
  );
}

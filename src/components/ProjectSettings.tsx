import { forgetAsset } from "../media";
import { useEditor } from "../store";
import { ASPECTS } from "../types";

const SHAPES: Record<string, { icon: string; name: string; hint: string }> = {
  "16:9": { icon: "▭", name: "Horizontal", hint: "YouTube, televisión" },
  "9:16": { icon: "▯", name: "Vertical", hint: "TikTok, Reels, Shorts" },
  "1:1": { icon: "□", name: "Cuadrado", hint: "Publicaciones" },
  "4:5": { icon: "▮", name: "Retrato", hint: "Instagram" },
};

const BACKGROUNDS = ["#000000", "#ffffff", "#1e3a8a", "#065f46", "#7c2d12", "#6b21a8"];

export function ProjectSettings({ onClose }: { onClose(): void }) {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ajustes">
        <h2>⚙️ Ajustes del proyecto</h2>

        <label className="stack">
          <span>Nombre del video</span>
          <input value={project.name} onChange={(e) => edit(() => ({ name: e.target.value }))} />
        </label>

        <div className="stack">
          <span>Forma del video</span>
          <div className="choices four">
            {ASPECTS.map((a) => {
              const info = SHAPES[a.label];
              const on = a.width === project.width && a.height === project.height;
              return (
                <button key={a.label} className={`choice ${on ? "on" : ""}`} onClick={() => edit(() => ({ width: a.width, height: a.height }))}>
                  <span className="ico">{info.icon}</span>
                  <b>{info.name}</b>
                  <small>{info.hint}</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="stack">
          <span>Color de fondo</span>
          <div className="swatches">
            {BACKGROUNDS.map((c) => (
              <button
                key={c}
                className={`swatch ${project.background === c ? "on" : ""}`}
                style={{ background: c }}
                onClick={() => edit(() => ({ background: c }))}
                aria-label={`Fondo ${c}`}
              />
            ))}
            <input type="color" value={project.background} onChange={(e) => edit(() => ({ background: e.target.value }))} aria-label="Otro color" />
          </div>
        </div>

        <details>
          <summary>Más opciones</summary>
          <label className="stack">
            <span>Imágenes por segundo</span>
            <select value={project.fps} onChange={(e) => edit(() => ({ fps: Number(e.target.value) }))}>
              {[24, 25, 30, 50, 60].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <button
            className="danger wide"
            onClick={() => {
              if (!confirm("¿Empezar un video nuevo? Se borrará el video actual y sus archivos de este equipo.")) return;
              project.assets.forEach((a) => forgetAsset(a.id));
              useEditor.getState().resetProject();
              onClose();
            }}
          >
            🆕 Empezar un video nuevo
          </button>
        </details>

        <div className="row-end">
          <button className="primary big" onClick={onClose}>Listo</button>
        </div>
      </div>
    </div>
  );
}

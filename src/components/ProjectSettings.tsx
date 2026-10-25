import { useEditor } from "../store";
import { ASPECTS } from "../types";
import { Icon } from "./Icon";

const SHAPES: Record<string, { name: string; hint: string }> = {
  "16:9": { name: "Horizontal", hint: "YouTube" },
  "9:16": { name: "Vertical", hint: "TikTok · Reels" },
  "1:1": { name: "Cuadrado", hint: "Feed" },
  "4:5": { name: "Retrato", hint: "Instagram" },
};

const BACKGROUNDS = ["#000000", "#ffffff", "#1f2937", "#1e3a8a", "#065f46", "#7c2d12"];

export function ProjectSettings({ onClose }: { onClose(): void }) {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ajustes del proyecto">
        <div className="modal-head">
          <h2>Proyecto</h2>
          <button className="ghost" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>

        <label className="stack">
          <span>Nombre</span>
          <input value={project.name} onChange={(e) => edit(() => ({ name: e.target.value }))} />
        </label>

        <div className="stack">
          <span>Formato</span>
          <div className="choices four">
            {ASPECTS.map((a) => {
              const info = SHAPES[a.label];
              const on = a.width === project.width && a.height === project.height;
              const max = 22;
              const k = max / Math.max(a.width, a.height);
              return (
                <button key={a.label} className={`choice ${on ? "on" : ""}`} onClick={() => edit(() => ({ width: a.width, height: a.height }))}>
                  <span className="shape" style={{ width: a.width * k, height: a.height * k }} />
                  <b>{info.name}</b>
                  <small>{a.label} · {info.hint}</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="stack">
          <span>Fondo</span>
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
          <summary>Avanzado</summary>
          <label className="stack">
            <span>Fotogramas por segundo</span>
            <select value={project.fps} onChange={(e) => edit(() => ({ fps: Number(e.target.value) }))}>
              {[24, 25, 30, 50, 60].map((f) => (
                <option key={f} value={f}>{f} fps</option>
              ))}
            </select>
          </label>
        </details>
        <p className="muted small">Para crear otro proyecto, vuelve a «Proyectos» (arriba a la izquierda). Este se guarda solo.</p>
      </div>
    </div>
  );
}

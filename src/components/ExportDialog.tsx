import { useRef, useState } from "react";
import { exportMp4 } from "../engine/exporter";
import { saveFile } from "../platform";
import { useEditor } from "../store";

const SIZES = [
  { short: 720, icon: "👍", name: "Buena", hint: "Rápido, pesa poco" },
  { short: 1080, icon: "⭐", name: "Muy buena", hint: "La recomendada" },
  { short: 2160, icon: "💎", name: "Máxima (4K)", hint: "Tarda más" },
];
const QUALITY = [
  { label: "Normal", bitsPerPixel: 0.07 },
  { label: "Alta", bitsPerPixel: 0.12 },
  { label: "Máxima", bitsPerPixel: 0.2 },
];

// Mismo redondeo a número par que aplica el codificador.
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function ExportDialog({ onClose }: { onClose(): void }) {
  const project = useEditor((s) => s.project);
  const [short, setShort] = useState(1080);
  const [fps, setFps] = useState(project.fps);
  const [quality, setQuality] = useState(1);
  const [progress, setProgress] = useState<{ f: number; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const shortSide = Math.min(project.width, project.height);
  const outH = even((short / shortSide) * project.height);
  const outW = even((project.width / project.height) * outH);
  const bitrate = Math.round(outW * outH * fps * QUALITY[quality].bitsPerPixel);

  const run = async () => {
    setError(null);
    abort.current = new AbortController();
    useEditor.getState().setPlaying(false);
    try {
      const blob = await exportMp4(project, {
        height: outH,
        fps,
        bitrate,
        signal: abort.current.signal,
        onProgress: (f, stage) => setProgress({ f, stage }),
      });
      const name = `${project.name.replace(/[\\/:*?"<>|]+/g, "_") || "video"}.mp4`;
      await saveFile(blob, name);
      setSaved(`${name} · ${(blob.size / 1e6).toFixed(1)} MB`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  if (saved) {
    return (
      <div className="modal-back" onClick={onClose}>
        <div className="modal guide" onClick={(e) => e.stopPropagation()}>
          <div className="guide-icon">🎉</div>
          <h2>¡Tu video está guardado!</h2>
          <p>{saved}</p>
          <p className="hint">Búscalo en tu carpeta de Descargas (o donde elegiste guardarlo).</p>
          <div className="row-end">
            <button className="primary big" onClick={onClose}>¡Genial!</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-back">
      <div className="modal" role="dialog" aria-label="Guardar video">
        <h2>💾 Guardar tu video</h2>
        <p className="hint">Se guarda como MP4 en tu equipo. Sin marcas de agua y gratis.</p>

        <div className="stack">
          <span>¿Qué calidad quieres?</span>
          <div className="choices">
            {SIZES.map((s) => (
              <button key={s.short} className={`choice ${short === s.short ? "on" : ""}`} onClick={() => setShort(s.short)} disabled={!!progress}>
                <span className="ico">{s.icon}</span>
                <b>{s.name}</b>
                <small>{s.hint}</small>
              </button>
            ))}
          </div>
        </div>

        <details>
          <summary>Más opciones</summary>
          <label className="stack">
            <span>Imágenes por segundo</span>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={!!progress}>
              {[24, 25, 30, 50, 60].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="stack">
            <span>Nitidez</span>
            <select value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={!!progress}>
              {QUALITY.map((q, i) => (
                <option key={q.label} value={i}>{q.label}</option>
              ))}
            </select>
          </label>
          <p className="hint">
            {outW}×{outH} · {(bitrate / 1e6).toFixed(1)} Mbps
          </p>
        </details>

        {progress && (
          <div className="progress">
            <div style={{ width: `${progress.f * 100}%` }} />
            <span>⏳ {progress.stage} · {Math.round(progress.f * 100)}%</span>
          </div>
        )}
        {error && <p className="error">😕 {error}</p>}
        <div className="row-end">
          {progress ? (
            <button className="big" onClick={() => abort.current?.abort()}>Cancelar</button>
          ) : (
            <>
              <button className="big" onClick={onClose}>Volver</button>
              <button className="primary big" onClick={run}>💾 Guardar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

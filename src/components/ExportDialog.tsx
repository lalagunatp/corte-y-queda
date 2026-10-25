import { useRef, useState } from "react";
import { exportMp4 } from "../engine/exporter";
import { saveFile } from "../platform";
import { useEditor } from "../store";
import { Icon } from "./Icon";

const SIZES = [
  { short: 720, name: "720p", hint: "Ligero" },
  { short: 1080, name: "1080p", hint: "Recomendado" },
  { short: 2160, name: "4K", hint: "Máxima" },
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

  return (
    <div className="modal-back" onClick={progress ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Exportar">
        <div className="modal-head">
          <h2>{saved ? "Video exportado" : "Exportar"}</h2>
          {!progress && (
            <button className="ghost" onClick={onClose} aria-label="Cerrar">
              <Icon name="close" />
            </button>
          )}
        </div>

        {saved ? (
          <>
            <p className="done">
              <Icon name="check" /> {saved}
            </p>
            <div className="row-end">
              <button className="primary" onClick={onClose}>Cerrar</button>
            </div>
          </>
        ) : (
          <>
            <div className="segmented">
              {SIZES.map((s) => (
                <button key={s.short} className={short === s.short ? "on" : ""} onClick={() => setShort(s.short)} disabled={!!progress}>
                  <b>{s.name}</b>
                  <small>{s.hint}</small>
                </button>
              ))}
            </div>
            <p className="muted small">
              MP4 · {outW}×{outH} · {fps} fps · sin marca de agua
            </p>

            <details>
              <summary>Avanzado</summary>
              <label className="stack">
                <span>Fotogramas por segundo</span>
                <select value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={!!progress}>
                  {[24, 25, 30, 50, 60].map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="stack">
                <span>Calidad · {(bitrate / 1e6).toFixed(1)} Mbps</span>
                <select value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={!!progress}>
                  {QUALITY.map((q, i) => (
                    <option key={q.label} value={i}>{q.label}</option>
                  ))}
                </select>
              </label>
            </details>

            {progress && (
              <div className="progress" aria-label={progress.stage}>
                <div style={{ width: `${progress.f * 100}%` }} />
                <span>{progress.stage} · {Math.round(progress.f * 100)}%</span>
              </div>
            )}
            {error && <p className="error">{error}</p>}
            <div className="row-end">
              {progress ? (
                <button onClick={() => abort.current?.abort()}>Cancelar</button>
              ) : (
                <button className="primary" onClick={run}>
                  <Icon name="export" /> Exportar
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

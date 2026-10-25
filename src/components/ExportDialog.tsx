import { useRef, useState } from "react";
import { exportMp4 } from "../engine/exporter";
import { saveFile } from "../platform";
import { useEditor } from "../store";

const RESOLUTIONS = [480, 720, 1080, 1440, 2160];
const QUALITY = [
  { label: "Normal", bitsPerPixel: 0.07 },
  { label: "Alta", bitsPerPixel: 0.12 },
  { label: "Máxima", bitsPerPixel: 0.2 },
];

export function ExportDialog({ onClose }: { onClose(): void }) {
  const project = useEditor((s) => s.project);
  const [height, setHeight] = useState(Math.min(1080, project.height));
  const [fps, setFps] = useState(project.fps);
  const [quality, setQuality] = useState(1);
  const [progress, setProgress] = useState<{ f: number; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const shortSide = Math.min(project.width, project.height);
  // Mismo redondeo a número par que aplica el codificador.
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const outH = even((height / shortSide) * project.height);
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
      useEditor.getState().setStatus(`Exportado: ${name} (${(blob.size / 1e6).toFixed(1)} MB)`);
      onClose();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  return (
    <div className="modal-back">
      <div className="modal">
        <h2>Exportar vídeo</h2>
        <p className="hint">MP4 (H.264 + AAC). Se procesa en tu equipo, sin marca de agua ni límites.</p>
        <label className="field">
          <span>Resolución</span>
          <select value={height} onChange={(e) => setHeight(Number(e.target.value))} disabled={!!progress}>
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>{r === 2160 ? "4K" : `${r}p`}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Fotogramas/s</span>
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))} disabled={!!progress}>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Calidad</span>
          <select value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={!!progress}>
            {QUALITY.map((q, i) => (
              <option key={q.label} value={i}>{q.label}</option>
            ))}
          </select>
        </label>
        <p className="hint">
          Salida: {outW}×{outH} · {(bitrate / 1e6).toFixed(1)} Mbps
        </p>
        {progress && (
          <div className="progress">
            <div style={{ width: `${progress.f * 100}%` }} />
            <span>{progress.stage} · {Math.round(progress.f * 100)}%</span>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row-end">
          {progress ? (
            <button onClick={() => abort.current?.abort()}>Cancelar</button>
          ) : (
            <>
              <button onClick={onClose}>Cerrar</button>
              <button className="primary" onClick={run}>Exportar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

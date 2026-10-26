import { useEffect, useRef, useState } from "react";
import { type ExportCodec, type ExportQuality, exportMp4, supportsHevc } from "../engine/exporter";
import { saveFile } from "../platform";
import { useEditor } from "../store";
import type { Project } from "../types";
import { Icon } from "./Icon";

const SIZES = [
  { short: 720, name: "720p", hint: "Ligero" },
  { short: 1080, name: "1080p", hint: "Recomendado" },
  { short: 2160, name: "4K", hint: "Máxima" },
];
const QUALITY: { value: ExportQuality; label: string }[] = [
  { value: "normal", label: "Normal (más ligero)" },
  { value: "alta", label: "Alta (recomendada)" },
  { value: "maxima", label: "Máxima (más pesado)" },
];

// Mismo redondeo a número par que aplica el codificador.
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Lado corto de salida a partir del cual los videos e imágenes del proyecto se ampliarían:
 * exportar por encima solo infla el archivo sin ganar nitidez. Null si no hay medios visuales.
 */
function nativeShortSide(p: Project): number | null {
  const shortSide = Math.min(p.width, p.height);
  let best: number | null = null;
  for (const c of p.clips) {
    if (c.type !== "media") continue;
    const a = p.assets.find((x) => x.id === c.assetId);
    if (!a || a.kind === "audio" || !a.width || !a.height) continue;
    const fit = Math.min(p.width / a.width, p.height / a.height) * c.scale;
    best = Math.max(best ?? 0, shortSide / fit);
  }
  return best;
}

export function ExportDialog({ onClose }: { onClose(): void }) {
  const project = useEditor((s) => s.project);
  const native = nativeShortSide(project);
  // Por defecto, la mayor resolución que no amplía los videos (como mucho 1080p).
  const [short, setShort] = useState(() => [...SIZES].reverse().find((s) => s.short <= 1080 && (!native || s.short <= native * 1.05))?.short ?? 720);
  const [fps, setFps] = useState(project.fps);
  const [quality, setQuality] = useState<ExportQuality>("alta");
  const [progress, setProgress] = useState<{ f: number; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const shortSide = Math.min(project.width, project.height);
  const outH = even((short / shortSide) * project.height);
  const outW = even((project.width / project.height) * outH);
  const upscales = native != null && short > native * 1.05;

  // HEVC solo se ofrece si este equipo lo codifica; si no, se exporta en H.264.
  const [hevc, setHevc] = useState<boolean | null>(null);
  const [codec, setCodec] = useState<ExportCodec>("hevc");
  useEffect(() => {
    let live = true;
    supportsHevc(outW, outH, fps).then((ok) => live && setHevc(ok));
    return () => {
      live = false;
    };
  }, [outW, outH, fps]);
  const chosen: ExportCodec = hevc ? codec : "avc";

  const run = async () => {
    setError(null);
    abort.current = new AbortController();
    useEditor.getState().setPlaying(false);
    const t0 = performance.now();
    try {
      const { blob } = await exportMp4(project, {
        height: outH,
        fps,
        quality,
        codec: chosen,
        signal: abort.current.signal,
        onProgress: (f, stage) => setProgress({ f, stage }),
      });
      const name = `${project.name.replace(/[\\/:*?"<>|]+/g, "_") || "video"}.mp4`;
      await saveFile(blob, name);
      setSaved(`${name} · ${(blob.size / 1e6).toFixed(1)} MB · ${Math.round((performance.now() - t0) / 1000)} s`);
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
              MP4 {chosen === "hevc" ? "HEVC" : "H.264"} · {outW}×{outH} · {fps} fps · sin marca de agua
            </p>
            {hevc && (
              <div className="segmented">
                <button className={codec === "hevc" ? "on" : ""} onClick={() => setCodec("hevc")} disabled={!!progress}>
                  <b>Ligero</b>
                  <small>Mitad de peso</small>
                </button>
                <button className={codec === "avc" ? "on" : ""} onClick={() => setCodec("avc")} disabled={!!progress}>
                  <b>Compatible</b>
                  <small>Equipos antiguos</small>
                </button>
              </div>
            )}
            {upscales && (
              <p className="small" style={{ color: "#e8b04a", margin: 0 }}>
                Tus videos son más pequeños que esta resolución: el archivo pesará más sin verse mejor.
              </p>
            )}

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
                <span>Calidad</span>
                <select value={quality} onChange={(e) => setQuality(e.target.value as ExportQuality)} disabled={!!progress}>
                  {QUALITY.map((q) => (
                    <option key={q.value} value={q.value}>{q.label}</option>
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

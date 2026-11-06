import { useEffect, useRef, useState } from "react";
import { type ExportCodec, type ExportQuality, exportMp4, supportsHevc } from "../engine/exporter";
import { saveFile } from "../platform";
import { useEditor } from "../store";
import type { Project } from "../types";
import { Icon } from "./Icon";

const SIZES = [
  { short: 720, name: "Pequeño", hint: "720p · pesa poco" },
  { short: 1080, name: "Recomendado", hint: "1080p · HD" },
  { short: 2160, name: "Máximo", hint: "4K · pesa mucho" },
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

  // H.264 por defecto: se abre en cualquier reproductor. HEVC (si este equipo lo codifica) es opcional,
  // porque sin la extensión de Microsoft el Reproductor de Windows no lo muestra.
  const [hevc, setHevc] = useState<boolean | null>(null);
  const [codec, setCodec] = useState<ExportCodec>("avc");
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
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Exportar video">
        <div className="modal-head">
          <h2>{saved ? "¡Tu video está listo!" : "Exportar video"}</h2>
          {!progress && (
            <button className="ghost" onClick={onClose} aria-label="Cerrar">
              <Icon name="close" />
            </button>
          )}
        </div>

        {saved ? (
          <>
            <p className="done">
              <Icon name="check" /> Se guardó en tu equipo. Ya puedes verlo o compartirlo.
            </p>
            <p className="muted small">{saved}</p>
            <div className="row-end">
              <button className="primary" onClick={onClose}>Cerrar</button>
            </div>
          </>
        ) : (
          <>
            <p className="lead-muted">Tu video se guardará como un archivo que puedes ver y compartir. Sin marca de agua.</p>
            <span className="muted small">Calidad de imagen</span>
            <div className="segmented">
              {SIZES.map((s) => (
                <button key={s.short} className={short === s.short ? "on" : ""} onClick={() => setShort(s.short)} disabled={!!progress}>
                  <b>{s.name}</b>
                  <small>{s.hint}</small>
                </button>
              ))}
            </div>
            {upscales && (
              <p className="small warn">
                Tus videos son más pequeños que esta calidad: el archivo pesará más sin verse mejor.
              </p>
            )}

            <details>
              <summary>Avanzado</summary>
              <p className="muted small">
                MP4 {chosen === "hevc" ? "HEVC" : "H.264"} · {outW}×{outH} · {fps} fps
              </p>
              {hevc && (
                <div className="stack">
                  <span>Formato del archivo</span>
                  <div className="segmented">
                    <button className={codec === "avc" ? "on" : ""} onClick={() => setCodec("avc")} disabled={!!progress}>
                      <b>Compatible</b>
                      <small>Se ve en todos lados</small>
                    </button>
                    <button className={codec === "hevc" ? "on" : ""} onClick={() => setCodec("hevc")} disabled={!!progress}>
                      <b>Ligero</b>
                      <small>Mitad de peso</small>
                    </button>
                  </div>
                </div>
              )}
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
            {chosen === "hevc" && (
              <p className="small warn">
                Elegiste el formato Ligero (HEVC): algunos reproductores, como el de Windows sin la extensión HEVC, no muestran la imagen. Si vas a compartirlo, usa Compatible.
              </p>
            )}

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
                <button className="primary big" onClick={run}>
                  <Icon name="export" /> Guardar video
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

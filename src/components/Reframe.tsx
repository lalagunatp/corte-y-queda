import { useEffect, useRef, useState } from "react";
import { useEditor } from "../store";
import type { MediaAsset, MediaClip } from "../types";
import { Icon } from "./Icon";

/** Si el video tiene otra forma que el proyecto (p. ej. horizontal en un proyecto vertical). */
export function needsReframe(asset: MediaAsset | undefined, project: { width: number; height: number }): boolean {
  if (!asset || asset.kind !== "video" || !asset.width || !asset.height) return false;
  const a = asset.width / asset.height;
  const b = project.width / project.height;
  return Math.abs(a - b) / b > 0.15;
}

/** Reencuadre automático: la imagen llena el cuadro y la cámara sigue a la persona. */
export function ReframeSection({ clip }: { clip: MediaClip }) {
  const [busy, setBusy] = useState<{ fraction: number; stage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const update = useEditor((s) => s.updateClip);

  useEffect(() => () => abort.current?.abort(), [clip.id]);

  const analyze = async () => {
    setError(null);
    abort.current = new AbortController();
    const started = performance.now();
    try {
      // MediaPipe solo se carga si se usa esta función.
      const { analyzeReframe } = await import("../ai/reframe");
      const reframe = await analyzeReframe(clip, { signal: abort.current.signal, onProgress: (fraction, stage) => setBusy({ fraction, stage }) });
      update(clip.id, { reframe, x: 0, y: 0 });
      useEditor.getState().setStatus(`Encuadre listo en ${Math.round((performance.now() - started) / 1000)} s. Si no te gusta, usa Deshacer.`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  return (
    <section className="group">
      <h4>Encuadre automático</h4>
      {busy ? (
        <>
          <div className="progress" aria-label={busy.stage}>
            <div style={{ width: `${busy.fraction * 100}%` }} />
            <span>
              {busy.stage} · {Math.round(busy.fraction * 100)}%
            </span>
          </div>
          <button onClick={() => abort.current?.abort()}>Cancelar</button>
        </>
      ) : clip.reframe ? (
        <>
          <p className="muted small">
            <Icon name="check" size={14} /> La imagen sigue a la persona. Para corregirlo, usa «Horizontal» y «Vertical» en Avanzado.
          </p>
          <div className="inline">
            <button onClick={() => void analyze()}>
              <Icon name="sparkles" /> Volver a analizar
            </button>
            <button onClick={() => update(clip.id, { reframe: undefined, x: 0, y: 0 })}>Quitar</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">El video no tiene la forma del proyecto. La app puede llenar el cuadro y seguir a la persona para que no se corte.</p>
          <button onClick={() => void analyze()}>
            <Icon name="sparkles" /> Seguir a la persona
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

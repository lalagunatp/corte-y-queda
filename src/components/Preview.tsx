import { useEffect, useRef, useState } from "react";
import { PreviewEngine } from "../engine/preview";
import { selectDuration, useEditor } from "../store";
import { formatTime } from "../util";
import { COMPACT_QUERY, useUi } from "../ui";
import { Icon } from "./Icon";
import { importIntoProject } from "./MediaBin";

export const engineRef: { current: PreviewEngine | null } = { current: null };

export function Preview() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const duration = useEditor(selectDuration);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setTime = useEditor((s) => s.setTime);

  useEffect(() => {
    const engine = new PreviewEngine();
    engineRef.current = engine;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const s = useEditor.getState();
      const dt = (now - last) / 1000;
      last = now;
      let t = s.time;
      if (s.playing) {
        const end = selectDuration(s);
        t = s.time + dt;
        if (t >= end) {
          t = end;
          s.setPlaying(false);
        }
        s.setTime(t);
      }
      const ctx = canvas.current?.getContext("2d");
      if (ctx) engine.render(ctx, s.project, t, s.playing, s.playing ? [] : s.selected);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const toggle = () => {
    engineRef.current?.resumeAudio();
    if (!playing && time >= duration) setTime(0);
    setPlaying(!playing);
  };

  const empty = project.clips.length === 0;

  // La vista previa se ajusta entera al hueco disponible (contener), sea horizontal o vertical.
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ w: number; h: number } | null>(null);
  // Vista ampliada: ocupa toda la ventana para ver textos y subtítulos con detalle.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const availW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const availH = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const k = Math.min(availW / project.width, availH / project.height);
      setFit(k > 0 ? { w: Math.floor(project.width * k), h: Math.floor(project.height * k) } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  /** Tocar un texto lo abre para editarlo; tocar en otro sitio reproduce o pausa. */
  const onStageClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * project.width;
    const y = ((e.clientY - rect.top) / rect.height) * project.height;
    const id = playing ? null : engineRef.current?.textAt(x, y);
    if (!id) return toggle();
    const s = useEditor.getState();
    s.select([id]);
    const clip = s.project.clips.find((c) => c.id === id);
    const isSubtitle = s.project.tracks.find((t) => t.id === clip?.trackId)?.role === "subtitles";
    if (isSubtitle) useUi.getState().editSubtitle(id);
    else if (window.matchMedia(COMPACT_QUERY).matches) useUi.getState().setSheet("edit");
  };

  return (
    <section className={`preview ${expanded ? "expanded" : ""}`}>
      <div className="stage" ref={stage}>
        <canvas
          ref={canvas}
          width={project.width}
          height={project.height}
          style={fit ? { width: fit.w, height: fit.h } : { visibility: "hidden" }}
          onClick={empty ? undefined : onStageClick}
        />
        {empty && (
          <div className="welcome">
            <p className="muted">Importa videos, imágenes o audio para empezar</p>
            <button className="primary" onClick={() => picker.current?.click()}>
              <Icon name="upload" /> Importar archivos
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              accept="video/*,image/*,audio/*"
              onChange={(e) => {
                const files = e.target.files ? [...e.target.files] : [];
                e.target.value = "";
                // Al empezar, todo lo que se elige va directo al video, en orden.
                void importIntoProject(files, { placeInVideo: true });
              }}
            />
          </div>
        )}
      </div>
      <div className="transport">
        <button className="ghost" onClick={() => setTime(0)} title="Ir al inicio (Inicio)" aria-label="Ir al inicio">
          <Icon name="start" size={16} />
        </button>
        <button className="ghost" onClick={() => setTime(time - 1)} title="Atrás 1 s (←)" aria-label="Atrás">
          <Icon name="back" size={16} />
        </button>
        <button className="play" onClick={toggle} disabled={empty} title="Reproducir / pausar (Espacio)" aria-label={playing ? "Pausar" : "Reproducir"}>
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <button className="ghost" onClick={() => setTime(time + 1)} title="Adelante 1 s (→)" aria-label="Adelante">
          <Icon name="forward" size={16} />
        </button>
        <button className="ghost" onClick={() => setTime(duration)} title="Ir al final (Fin)" aria-label="Ir al final">
          <Icon name="end" size={16} />
        </button>
        <button
          className="ghost expand"
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "Volver (Esc)" : "Ampliar la vista previa"}
          aria-label={expanded ? "Volver" : "Ampliar"}
          disabled={empty}
        >
          <Icon name={expanded ? "minimize" : "maximize"} size={16} />
        </button>
        <span className="timecode">
          {formatTime(time, project.fps).slice(0, 5)} / {formatTime(duration, project.fps).slice(0, 5)}
        </span>
      </div>
    </section>
  );
}

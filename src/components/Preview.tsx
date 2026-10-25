import { useEffect, useRef } from "react";
import { PreviewEngine } from "../engine/preview";
import { selectDuration, useEditor } from "../store";
import { formatTime } from "../util";
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
      if (ctx) engine.render(ctx, s.project, t, s.playing);
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

  return (
    <section className="preview">
      <div className="stage">
        <canvas
          ref={canvas}
          width={project.width}
          height={project.height}
          style={{ aspectRatio: `${project.width} / ${project.height}` }}
          onClick={empty ? undefined : toggle}
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
        <span className="timecode">
          {formatTime(time, project.fps).slice(0, 5)} / {formatTime(duration, project.fps).slice(0, 5)}
        </span>
      </div>
    </section>
  );
}

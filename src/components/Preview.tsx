import { useEffect, useRef } from "react";
import { PreviewEngine } from "../engine/preview";
import { selectDuration, useEditor } from "../store";
import { formatTime } from "../util";
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
            <div className="big-ico">🎬</div>
            <h2>¡Hola! Vamos a hacer un video</h2>
            <p>Empieza trayendo tus videos, fotos o música.</p>
            <button className="primary big" onClick={() => picker.current?.click()}>
              📁 Añadir videos y fotos
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
        <button onClick={() => setTime(0)} title="Ir al principio (Inicio)" aria-label="Ir al principio">⏮️</button>
        <button onClick={() => setTime(time - 1)} title="Atrás 1 segundo (←)" aria-label="Atrás">⏪</button>
        <button className="play" onClick={toggle} disabled={empty} title="Ver / pausar (Espacio)" aria-label={playing ? "Pausar" : "Ver"}>
          {playing ? "⏸️" : "▶️"}
        </button>
        <button onClick={() => setTime(time + 1)} title="Adelante 1 segundo (→)" aria-label="Adelante">⏩</button>
        <button onClick={() => setTime(duration)} title="Ir al final (Fin)" aria-label="Ir al final">⏭️</button>
        <span className="timecode">
          {formatTime(time, project.fps).slice(0, 5)} / {formatTime(duration, project.fps).slice(0, 5)}
        </span>
      </div>
    </section>
  );
}

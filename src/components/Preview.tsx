import { useEffect, useRef } from "react";
import { PreviewEngine } from "../engine/preview";
import { selectDuration, useEditor } from "../store";
import { formatTime } from "../util";

export const engineRef: { current: PreviewEngine | null } = { current: null };

export function Preview() {
  const canvas = useRef<HTMLCanvasElement>(null);
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

  return (
    <section className="preview">
      <div className="stage">
        <canvas
          ref={canvas}
          width={project.width}
          height={project.height}
          style={{ aspectRatio: `${project.width} / ${project.height}` }}
          onClick={toggle}
        />
      </div>
      <div className="transport">
        <button onClick={() => setTime(0)} title="Ir al inicio (Inicio)">⏮</button>
        <button onClick={() => setTime(time - 1 / project.fps)} title="Fotograma anterior (←)">◀︎</button>
        <button className="play" onClick={toggle} title="Reproducir / pausa (Espacio)">{playing ? "❚❚" : "▶"}</button>
        <button onClick={() => setTime(time + 1 / project.fps)} title="Fotograma siguiente (→)">▶︎</button>
        <button onClick={() => setTime(duration)} title="Ir al final (Fin)">⏭</button>
        <span className="timecode">
          {formatTime(time, project.fps)} / {formatTime(duration, project.fps)}
        </span>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { decodedAudio } from "../media";
import { selectDuration, useEditor } from "../store";
import type { Clip, MediaClip, Track } from "../types";
import { clipEnd, formatTime } from "../util";
import { useUi } from "../ui";
import { Icon, type IconName } from "./Icon";
import { ASSET_DRAG_TYPE } from "./MediaBin";

const TOUCH = window.matchMedia("(pointer: coarse)").matches;
// Filas más altas en pantallas táctiles para que se puedan tocar con el dedo.
const ROW_HEIGHT: Record<Track["kind"], number> = TOUCH ? { video: 72, audio: 56, text: 48 } : { video: 60, audio: 46, text: 36 };
const TRACK_ICON: Record<Track["kind"], IconName> = { video: "film", audio: "music", text: "type" };
const SNAP_PX = 8;

type DragMode = "move" | "trim-l" | "trim-r";

function Waveform({ clip, width, height }: { clip: MediaClip; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    void decodedAudio(clip.assetId).then((buf) => {
      const cv = ref.current;
      if (!buf || !cv || cancelled) return;
      const w = Math.min(4000, Math.max(1, Math.round(width)));
      cv.width = w;
      cv.height = height;
      const ctx = cv.getContext("2d")!;
      const data = buf.getChannelData(0);
      const from = clip.inPoint * buf.sampleRate;
      const span = (clip.duration * clip.speed * buf.sampleRate) / w;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (let x = 0; x < w; x++) {
        let peak = 0;
        const s = Math.floor(from + x * span);
        const step = Math.max(1, Math.floor(span / 32));
        for (let i = s; i < s + span && i < data.length; i += step) peak = Math.max(peak, Math.abs(data[i]));
        const h = Math.max(1, peak * height * clip.volume);
        ctx.fillRect(x, (height - h) / 2, 1, h);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clip.assetId, clip.inPoint, clip.duration, clip.speed, clip.volume, width, height]);
  return <canvas ref={ref} className="wave" style={{ width, height }} />;
}

function trackAccepts(track: Track, clip: Clip, assetKind: string | undefined): boolean {
  if (clip.type === "text") return track.kind === "text";
  return assetKind === "audio" ? track.kind === "audio" : track.kind === "video";
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.zoom);
  const time = useEditor((s) => s.time);
  const selected = useEditor((s) => s.selected);
  const duration = useEditor(selectDuration);
  const s = useEditor.getState;
  const [snapping, setSnapping] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const assets = new Map(project.assets.map((a) => [a.id, a]));

  const width = Math.max(duration + 30, 60) * zoom;

  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    return (clientX - el.getBoundingClientRect().left + el.scrollLeft - 0) / zoom;
  };

  // Mantiene el cabezal visible durante la reproducción.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !useEditor.getState().playing) return;
    const x = time * zoom;
    if (x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 80;
  }, [time, zoom]);

  const scrub = (e: React.PointerEvent) => {
    s().setPlaying(false);
    s().setTime(timeAt(e.clientX));
    const move = (ev: PointerEvent) => s().setTime(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startDrag = (e: React.PointerEvent, clip: Clip, mode: DragMode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const st = s();
    let sel = st.selected;
    if (e.shiftKey || e.ctrlKey) sel = sel.includes(clip.id) ? sel.filter((id) => id !== clip.id) : [...sel, clip.id];
    else if (!sel.includes(clip.id)) sel = [clip.id];
    st.select(sel);
    if (st.project.tracks.find((t) => t.id === clip.trackId)?.role !== "subtitles") useUi.getState().setSide("edit");
    const moving = mode === "move" ? sel : [clip.id];
    const originals = new Map(st.project.clips.filter((c) => moving.includes(c.id)).map((c) => [c.id, c]));
    const others = st.project.clips.filter((c) => !moving.includes(c.id));
    const snapPoints = [st.time, 0, ...others.flatMap((c) => [c.start, clipEnd(c)])];
    const x0 = e.clientX;
    let began = false;

    const snap = (t: number) => {
      if (!snapping) return { t, d: Infinity };
      let best = { t, d: SNAP_PX / zoom };
      for (const p of snapPoints) {
        const d = Math.abs(p - t);
        if (d < best.d) best = { t: p, d };
      }
      return best;
    };

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / zoom;
      if (!began) {
        if (Math.abs(ev.clientX - x0) < 3) return;
        began = true;
        s().beginGesture();
      }
      const anchor = originals.get(clip.id)!;
      let targetTrack: string | null = null;
      if (mode === "move" && moving.length === 1) {
        const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-track-id]");
        const track = s().project.tracks.find((t) => t.id === row?.dataset.trackId);
        const assetKind = anchor.type === "media" ? assets.get(anchor.assetId)?.kind : undefined;
        if (track && trackAccepts(track, anchor, assetKind)) targetTrack = track.id;
      }
      let shift = dx;
      if (mode === "move") {
        const a = snap(anchor.start + dx);
        const b = snap(clipEnd(anchor) + dx);
        shift = a.d <= b.d ? a.t - anchor.start : b.t - clipEnd(anchor);
        const minStart = Math.min(...[...originals.values()].map((c) => c.start));
        shift = Math.max(shift, -minStart);
      }
      s().edit((p) => ({
        clips: p.clips.map((c) => {
          const o = originals.get(c.id);
          if (!o) return c;
          if (mode === "move") return { ...o, start: o.start + shift, trackId: targetTrack ?? o.trackId };
          const asset = o.type === "media" ? assets.get(o.assetId) : undefined;
          const bounded = asset && asset.kind !== "image";
          if (mode === "trim-r") {
            const max = bounded && o.type === "media" ? (asset!.duration - o.inPoint) / o.speed : Infinity;
            const end = Math.min(Math.max(snap(clipEnd(o) + dx).t, o.start + 0.1), o.start + max);
            return { ...o, duration: end - o.start };
          }
          const minStart = bounded && o.type === "media" ? o.start - o.inPoint / o.speed : 0;
          const start = Math.min(Math.max(snap(o.start + dx).t, minStart, 0), clipEnd(o) - 0.1);
          const next = { ...o, start, duration: clipEnd(o) - start };
          if (next.type === "media" && o.type === "media") next.inPoint = o.inPoint + (start - o.start) * o.speed;
          return next;
        }),
      }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (began) s().endGesture();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onDropAsset = (e: React.DragEvent, track: Track) => {
    const id = e.dataTransfer.getData(ASSET_DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    s().addClipFromAsset(id, { trackId: track.id, start: Math.max(0, timeAt(e.clientX)) });
  };

  const tickStep = zoom > 120 ? 1 : zoom > 40 ? 2 : zoom > 15 ? 5 : 10;
  const ticks = Array.from({ length: Math.ceil(width / zoom / tickStep) + 1 }, (_, i) => i * tickStep);

  return (
    <section className="timeline">
      <div className="tl-toolbar">
        <button className="tool" onClick={() => s().splitAtPlayhead()} disabled={!project.clips.length} title="Dividir en el cabezal (S)">
          <Icon name="scissors" />
          <span>Dividir</span>
        </button>
        <button className="tool" onClick={() => s().deleteSelected()} disabled={!selected.length} title="Eliminar (Supr)">
          <Icon name="trash" />
          <span>Eliminar</span>
        </button>
        <button className="tool" onClick={() => s().duplicateSelected()} disabled={!selected.length} title="Duplicar (Ctrl+D)">
          <Icon name="copy" />
          <span>Duplicar</span>
        </button>
        <span className="grow" />
        <button className="tool" onClick={() => s().setZoom(zoom / 1.4)} title="Alejar (-)" aria-label="Alejar">
          <Icon name="zoomOut" />
        </button>
        <button className="tool" onClick={() => s().setZoom(zoom * 1.4)} title="Acercar (+)" aria-label="Acercar">
          <Icon name="zoomIn" />
        </button>
        <details className="menu">
          <summary className="tool" title="Más opciones" aria-label="Más opciones">
            <Icon name="more" />
          </summary>
          <div className="menu-pop">
            <button onClick={() => s().addTrack("video")}>
              <Icon name="film" /> Nueva pista de video
            </button>
            <button onClick={() => s().addTrack("audio")}>
              <Icon name="music" /> Nueva pista de audio
            </button>
            <button onClick={() => s().addTrack("text")}>
              <Icon name="type" /> Nueva pista de texto
            </button>
            <label className="check">
              <input type="checkbox" checked={snapping} onChange={(e) => setSnapping(e.target.checked)} /> Ajuste magnético
            </label>
          </div>
        </details>
      </div>
      <div className="tl-body">
        <div className="tl-heads">
          <div className="ruler-pad" />
          {project.tracks.map((t) => (
            <div key={t.id} className={`tl-head ${t.kind}`} style={{ height: ROW_HEIGHT[t.kind] }}>
              <span className="tico" title={t.name}>
                <Icon name={TRACK_ICON[t.kind]} size={15} />
              </span>
              <span className="tname">{t.name}</span>
              {t.kind !== "audio" && (
                <button className={`eye ${t.hidden ? "off" : ""}`} onClick={() => s().updateTrack(t.id, { hidden: !t.hidden })} title={t.hidden ? "Mostrar pista" : "Ocultar pista"}>
                  <Icon name={t.hidden ? "eyeOff" : "eye"} size={15} />
                </button>
              )}
              {t.kind !== "text" && (
                <button className={t.muted ? "off" : ""} onClick={() => s().updateTrack(t.id, { muted: !t.muted })} title={t.muted ? "Activar sonido" : "Silenciar pista"}>
                  <Icon name={t.muted ? "mute" : "volume"} size={15} />
                </button>
              )}
              <button
                className="trash"
                onClick={() => {
                  const n = project.clips.filter((c) => c.trackId === t.id).length;
                  if (n === 0 || confirm(`¿Eliminar la pista «${t.name}» y sus ${n} clip(s)?`)) s().removeTrack(t.id);
                }}
                title="Eliminar pista"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>
        {/* Un toque en un hueco quita la selección y lleva la línea verde ahí; arrastrar desplaza la vista. */}
        <div
          className="tl-scroll"
          ref={scroller}
          onClick={(e) => {
            if ((e.target as Element).closest(".clip")) return;
            s().select([]);
            s().setPlaying(false);
            s().setTime(timeAt(e.clientX));
          }}
        >
          {!project.clips.length && (
            <div className="tl-empty">La línea de tiempo está vacía</div>
          )}
          <div style={{ width, position: "relative" }}>
            <div className="ruler" onPointerDown={(e) => { e.stopPropagation(); scrub(e); }}>
              {ticks.map((t) => (
                <span key={t} className="tick" style={{ left: t * zoom }}>
                  {formatTime(t, project.fps).slice(0, 5)}
                </span>
              ))}
            </div>
            {project.tracks.map((t) => (
              <div
                key={t.id}
                className={`tl-row ${t.kind}`}
                data-track-id={t.id}
                style={{ height: ROW_HEIGHT[t.kind] }}
                onDragOver={(e) => e.dataTransfer.types.includes(ASSET_DRAG_TYPE) && e.preventDefault()}
                onDrop={(e) => onDropAsset(e, t)}
              >
                {project.clips
                  .filter((c) => c.trackId === t.id)
                  .map((c) => {
                    const asset = c.type === "media" ? assets.get(c.assetId) : undefined;
                    const w = c.duration * zoom;
                    return (
                      <div
                        key={c.id}
                        className={`clip ${c.type === "text" ? "text" : asset?.kind} ${selected.includes(c.id) ? "selected" : ""}`}
                        style={{
                          left: c.start * zoom,
                          width: w,
                          backgroundImage: asset?.thumbnail ? `url(${asset.thumbnail})` : undefined,
                        }}
                        onPointerDown={(e) => startDrag(e, c, "move")}
                        onDoubleClick={() => useUi.getState().setSheet("edit")}
                        title={c.type === "text" ? c.text : asset?.name}
                      >
                        {c.type === "media" && asset?.kind !== "image" && t.kind === "audio" && (
                          <Waveform clip={c} width={w} height={ROW_HEIGHT[t.kind] - 4} />
                        )}
                        <span className="clabel">
                          {c.type === "text" ? c.text : asset?.name}
                          {c.type === "media" && c.speed !== 1 ? ` · ${c.speed}×` : ""}
                        </span>
                        {c.fadeIn > 0 && <span className="fade in" style={{ width: c.fadeIn * zoom }} />}
                        {c.fadeOut > 0 && <span className="fade out" style={{ width: c.fadeOut * zoom }} />}
                        <span className="handle l" onPointerDown={(e) => startDrag(e, c, "trim-l")} />
                        <span className="handle r" onPointerDown={(e) => startDrag(e, c, "trim-r")} />
                      </div>
                    );
                  })}
              </div>
            ))}
            <div className="playhead" style={{ left: time * zoom }} />
          </div>
        </div>
      </div>
    </section>
  );
}

import { create } from "zustand";
import { keptRanges } from "./ai/speechCuts";
import { DEFAULT_TEXT_STYLE, normalizeText, pickStyle } from "./text";
import type { Clip, MediaAsset, MediaClip, Narration, Project, SubtitleLine, TextClip, TextStyle, Track, TrackKind } from "./types";
import { clipEnd, projectDuration, uid } from "./util";

type Snapshot = Pick<Project, "tracks" | "clips" | "width" | "height" | "fps" | "background" | "name">;

const HISTORY_LIMIT = 200;

export type SubtitleStyle = TextStyle & Pick<TextClip, "y">;

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  ...DEFAULT_TEXT_STYLE,
  fontSize: 56,
  background: "#000000aa",
  shadowColor: "#00000000",
  y: 0.72,
};

export const subtitleStyleOf = (c: TextClip): SubtitleStyle => ({ ...pickStyle(c), y: c.y });

/** Clips de la pista de subtítulos, ordenados por inicio. */
export function subtitleClips(p: Project): TextClip[] {
  const track = p.tracks.find((t) => t.role === "subtitles");
  if (!track) return [];
  return p.clips.filter((c): c is TextClip => c.type === "text" && c.trackId === track.id).sort((a, b) => a.start - b.start);
}

/** Clips de la pista de narración, ordenados por inicio. */
export function narrationClips(p: Project): MediaClip[] {
  const track = p.tracks.find((t) => t.role === "narration");
  if (!track) return [];
  return p.clips.filter((c): c is MediaClip => c.type === "media" && c.trackId === track.id && !!c.narration).sort((a, b) => a.start - b.start);
}

export function newProject(opts: { name?: string; width?: number; height?: number } = {}): Project {
  return {
    id: uid("project"),
    name: opts.name ?? "Sin título",
    width: opts.width ?? 1920,
    height: opts.height ?? 1080,
    fps: 30,
    background: "#000000",
    tracks: [
      { id: uid("track"), kind: "text", name: "Texto", muted: false, hidden: false },
      { id: uid("track"), kind: "video", name: "Vídeo 1", muted: false, hidden: false },
      { id: uid("track"), kind: "audio", name: "Audio 1", muted: false, hidden: false },
    ],
    clips: [],
    assets: [],
  };
}

const narrationClipBase: Omit<MediaClip, "id" | "trackId" | "assetId" | "start" | "duration"> = {
  type: "media",
  inPoint: 0,
  speed: 1,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  voiceClean: false,
};

const snapshot = (p: Project): Snapshot => ({
  tracks: p.tracks,
  clips: p.clips,
  width: p.width,
  height: p.height,
  fps: p.fps,
  background: p.background,
  name: p.name,
});

interface EditorState {
  project: Project;
  time: number;
  playing: boolean;
  /** Píxeles por segundo en la línea de tiempo. */
  zoom: number;
  selected: string[];
  past: Snapshot[];
  future: Snapshot[];
  /** Instantánea tomada al empezar un gesto (arrastre); se confirma con endGesture. */
  gesture: Snapshot | null;
  status: string | null;

  setStatus(s: string | null): void;
  loadProject(p: Project): void;
  setTime(t: number): void;
  setPlaying(p: boolean): void;
  setZoom(z: number): void;
  select(ids: string[]): void;

  /** Aplica un cambio con entrada en el historial (si no hay un gesto en curso). */
  edit(fn: (p: Project) => Partial<Project>): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;

  addAssets(a: MediaAsset[]): void;
  removeAssetFromProject(id: string): void;
  /** Con audioOnly (o al soltarlo en una fila de sonido) un video se pone solo como sonido. */
  addClipFromAsset(assetId: string, at?: { trackId?: string; start?: number; audioOnly?: boolean }): void;
  /** Pasa un clip de video a una fila de sonido (solo se oye) o lo devuelve a una de video. */
  setAudioOnly(clipId: string, on: boolean): void;
  addText(text?: string): void;
  /** Añade líneas a la pista de subtítulos (la crea si falta); con replace sustituye las existentes. */
  addSubtitles(lines: SubtitleLine[], opts?: { replace?: boolean }): string[];
  /** Pone audios de narración en su pista (la crea si falta) y devuelve los ids de los clips. */
  addNarration(items: { start: number; asset: MediaAsset; narration: Narration }[]): string[];
  /** Cambia el audio de una narración ya puesta (otra voz, otro texto) sin moverla. */
  replaceNarration(clipId: string, asset: MediaAsset, narration: Narration): void;
  updateClips(ids: string[], patch: Partial<Omit<TextClip, "type">>): void;
  updateClip(id: string, patch: Partial<Omit<MediaClip, "type">> | Partial<Omit<TextClip, "type">>): void;
  deleteSelected(): void;
  duplicateSelected(): void;
  splitAtPlayhead(): void;
  /**
   * Quita tramos de un clip (segundos desde su inicio) y junta lo que queda. Todo lo posterior en
   * las demás pistas se adelanta lo mismo; los textos y subtítulos de dentro siguen a su frase.
   */
  removeRanges(clipId: string, ranges: { start: number; end: number }[]): void;
  /**
   * Cambia el texto de los subtítulos (en su orden) por su traducción. Con `keepOriginal`, una copia
   * de los originales queda en una fila de texto oculta. Una línea que quedó vacía se une a la
   * anterior para no dejar un subtítulo en blanco.
   */
  translateSubtitles(texts: string[], opts: { from: string; to: string; toName: string; fromName: string; keepOriginal: boolean }): void;
  addTrack(kind: TrackKind): void;
  updateTrack(id: string, patch: Partial<Track>): void;
  removeTrack(id: string): void;
}

export const useEditor = create<EditorState>((set, get) => ({
  project: newProject(),
  time: 0,
  playing: false,
  zoom: 60,
  selected: [],
  past: [],
  future: [],
  gesture: null,
  status: null,

  setStatus: (status) => set({ status }),
  loadProject: (project) =>
    set({
      project: { ...project, clips: project.clips.map((c) => (c.type === "text" ? normalizeText(c) : c)) },
      past: [],
      future: [],
      selected: [],
      time: 0,
      playing: false,
    }),
  setTime: (t) => set({ time: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (z) => set({ zoom: Math.min(400, Math.max(8, z)) }),
  select: (selected) => set({ selected }),

  edit: (fn) =>
    set((s) => {
      const changes = fn(s.project);
      const project = { ...s.project, ...changes };
      if (s.gesture) return { project };
      return {
        project,
        past: [...s.past, snapshot(s.project)].slice(-HISTORY_LIMIT),
        future: [],
      };
    }),
  beginGesture: () => set((s) => ({ gesture: snapshot(s.project) })),
  endGesture: () =>
    set((s) => {
      if (!s.gesture) return {};
      const changed = s.gesture.clips !== s.project.clips || s.gesture.tracks !== s.project.tracks;
      return {
        gesture: null,
        past: changed ? [...s.past, s.gesture].slice(-HISTORY_LIMIT) : s.past,
        future: changed ? [] : s.future,
      };
    }),
  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return {};
      return {
        project: { ...s.project, ...prev },
        past: s.past.slice(0, -1),
        future: [snapshot(s.project), ...s.future],
        selected: [],
      };
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return {};
      return {
        project: { ...s.project, ...next },
        past: [...s.past, snapshot(s.project)],
        future: s.future.slice(1),
        selected: [],
      };
    }),

  addAssets: (assets) => set((s) => ({ project: { ...s.project, assets: [...s.project.assets, ...assets] } })),
  removeAssetFromProject: (id) =>
    set((s) => ({
      project: {
        ...s.project,
        assets: s.project.assets.filter((a) => a.id !== id),
        clips: s.project.clips.filter((c) => c.type !== "media" || c.assetId !== id),
      },
      // El archivo se borra del disco: el historial no puede devolver clips que lo usen.
      past: [],
      future: [],
      selected: [],
    })),

  addClipFromAsset: (assetId, at) => {
    const { project, time } = get();
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset) return;
    const dropTrack = project.tracks.find((t) => t.id === at?.trackId);
    const audioOnly = asset.kind === "video" && (at?.audioOnly || dropTrack?.kind === "audio");
    const kind: TrackKind = asset.kind === "audio" || audioOnly ? "audio" : "video";
    let track =
      (dropTrack?.kind === kind ? dropTrack : undefined) ??
      // Un video «solo audio» no va a la fila de la narración.
      project.tracks.find((t) => t.kind === kind && !(audioOnly && t.role));
    const extraTracks: Track[] = [];
    if (!track) {
      track = { id: uid("track"), kind, name: kind === "audio" ? "Audio 1" : "Vídeo 1", muted: false, hidden: false };
      extraTracks.push(track);
    }
    const trackId = track.id;
    const trackEnd = project.clips.filter((c) => c.trackId === trackId).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const start = at?.start ?? (project.clips.some((c) => c.trackId === trackId) ? trackEnd : time);
    const clip: MediaClip = {
      id: uid("clip"),
      type: "media",
      assetId,
      trackId,
      start,
      duration: asset.kind === "image" ? 5 : asset.duration,
      inPoint: 0,
      speed: 1,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
      brightness: 1,
      contrast: 1,
      saturation: 1,
      voiceClean: false,
    };
    get().edit((p) => ({ tracks: [...p.tracks, ...extraTracks], clips: [...p.clips, clip] }));
    set({ selected: [clip.id] });
  },

  setAudioOnly: (clipId, on) => {
    const { project } = get();
    const clip = project.clips.find((c): c is MediaClip => c.id === clipId && c.type === "media");
    if (!clip) return;
    const kind: TrackKind = on ? "audio" : "video";
    // Busca una fila de ese tipo libre en el tramo del clip; si no hay, crea una.
    const free = (t: Track) =>
      !project.clips.some((c) => c.trackId === t.id && c.id !== clipId && c.start < clipEnd(clip) && clipEnd(c) > clip.start);
    let track = project.tracks.find((t) => t.kind === kind && !t.role && free(t));
    const extra: Track[] = [];
    if (!track) {
      const n = project.tracks.filter((t) => t.kind === kind).length + 1;
      track = { id: uid("track"), kind, name: on ? `Audio ${n}` : `Vídeo ${n}`, muted: false, hidden: false };
      extra.push(track);
    }
    const trackId = track.id;
    get().edit((p) => ({
      // Igual que addTrack: las filas de sonido van abajo y las de video arriba.
      tracks: on ? [...p.tracks, ...extra] : [...extra, ...p.tracks],
      clips: p.clips.map((c) => (c.id === clipId ? { ...c, trackId } : c)),
    }));
  },

  addText: (text = "Escribe aquí") => {
    const { project, time } = get();
    let track = project.tracks.find((t) => t.kind === "text" && t.role !== "subtitles");
    const extra: Track[] = [];
    if (!track) {
      track = { id: uid("track"), kind: "text", name: "Texto", muted: false, hidden: false };
      extra.push(track);
    }
    const clip: TextClip = {
      id: uid("clip"),
      type: "text",
      trackId: track.id,
      start: time,
      duration: 3,
      fadeIn: 0,
      fadeOut: 0,
      ...DEFAULT_TEXT_STYLE,
      text,
      x: 0,
      y: 0,
    };
    get().edit((p) => ({ tracks: [...extra, ...p.tracks], clips: [...p.clips, clip] }));
    set({ selected: [clip.id] });
  },

  addSubtitles: (lines, opts = {}) => {
    const { project } = get();
    const existing = project.tracks.find((t) => t.role === "subtitles");
    const track: Track = existing ?? { id: uid("track"), kind: "text", name: "Subtítulos", muted: false, hidden: false, role: "subtitles" };
    const current = project.clips.filter((c): c is TextClip => c.type === "text" && c.trackId === track.id);
    // Las líneas nuevas heredan el estilo de los subtítulos que ya existen.
    const style = current[0] ? subtitleStyleOf(current[0]) : DEFAULT_SUBTITLE_STYLE;
    const created: TextClip[] = lines.map((l) => ({
      ...style,
      id: uid("clip"),
      type: "text",
      trackId: track.id,
      start: l.start,
      duration: Math.max(0.2, l.end - l.start),
      fadeIn: 0,
      fadeOut: 0,
      text: l.text,
      x: 0,
    }));
    const removed = new Set(opts.replace ? current.map((c) => c.id) : []);
    get().edit((p) => ({
      tracks: existing ? p.tracks : [track, ...p.tracks],
      clips: [...p.clips.filter((c) => !removed.has(c.id)), ...created],
    }));
    return created.map((c) => c.id);
  },

  addNarration: (items) => {
    const { project } = get();
    const existing = project.tracks.find((t) => t.role === "narration");
    const track: Track = existing ?? { id: uid("track"), kind: "audio", name: "Narración", muted: false, hidden: false, role: "narration" };
    const created: MediaClip[] = items.map(({ start, asset, narration }) => ({
      ...narrationClipBase,
      id: uid("clip"),
      trackId: track.id,
      assetId: asset.id,
      start,
      duration: asset.duration,
      narration,
    }));
    set((s) => ({ project: { ...s.project, assets: [...s.project.assets, ...items.map((i) => i.asset)] } }));
    get().edit((p) => ({ tracks: existing ? p.tracks : [...p.tracks, track], clips: [...p.clips, ...created] }));
    return created.map((c) => c.id);
  },

  replaceNarration: (clipId, asset, narration) => {
    set((s) => ({ project: { ...s.project, assets: [...s.project.assets, asset] } }));
    get().updateClip(clipId, { assetId: asset.id, duration: asset.duration, inPoint: 0, speed: 1, narration });
  },

  updateClip: (id, patch) =>
    get().edit((p) => ({ clips: p.clips.map((c) => (c.id === id ? ({ ...c, ...patch } as Clip) : c)) })),

  updateClips: (ids, patch) => {
    const set = new Set(ids);
    get().edit((p) => ({ clips: p.clips.map((c) => (set.has(c.id) ? ({ ...c, ...patch } as Clip) : c)) }));
  },

  deleteSelected: () => {
    const sel = new Set(get().selected);
    if (!sel.size) return;
    get().edit((p) => ({ clips: p.clips.filter((c) => !sel.has(c.id)) }));
    set({ selected: [] });
  },

  duplicateSelected: () => {
    const { selected, project } = get();
    const copies = project.clips
      .filter((c) => selected.includes(c.id))
      .map((c) => ({ ...c, id: uid("clip"), start: clipEnd(c) }));
    if (!copies.length) return;
    get().edit((p) => ({ clips: [...p.clips, ...copies] }));
    set({ selected: copies.map((c) => c.id) });
  },

  splitAtPlayhead: () => {
    const { time, selected, project } = get();
    const eps = 1 / project.fps;
    const under = project.clips.filter((c) => time > c.start + eps && time < clipEnd(c) - eps);
    const selectedUnder = under.filter((c) => selected.includes(c.id));
    const targets = selectedUnder.length ? selectedUnder : under;
    if (!targets.length) return;
    const ids = new Set(targets.map((c) => c.id));
    const created: Clip[] = [];
    get().edit((p) => ({
      clips: p.clips.flatMap((c) => {
        if (!ids.has(c.id)) return [c];
        const left = time - c.start;
        const a = { ...c, duration: left, fadeOut: 0 } as Clip;
        const b = { ...c, id: uid("clip"), start: time, duration: c.duration - left, fadeIn: 0 } as Clip;
        if (b.type === "media" && c.type === "media") b.inPoint = c.inPoint + left * c.speed;
        created.push(b);
        return [a, b];
      }),
    }));
    set({ selected: created.map((c) => c.id) });
  },

  removeRanges: (clipId, ranges) => {
    const target = get().project.clips.find((c): c is MediaClip => c.id === clipId && c.type === "media");
    if (!target || !ranges.length) return;
    const kept = keptRanges(ranges, target.duration);
    const removed = (local: number) =>
      ranges.reduce((sum, r) => sum + Math.max(0, Math.min(r.end, local) - Math.max(0, r.start)), 0);
    const total = removed(target.duration);
    // Tiempo del proyecto antes del recorte → después; lo que cae en un tramo quitado va a su inicio.
    const map = (t: number) => (t <= target.start ? t : t >= clipEnd(target) ? t - total : t - removed(t - target.start));
    const pieces: MediaClip[] = [];
    let at = target.start;
    kept.forEach(([a, b], i) => {
      pieces.push({
        ...target,
        id: i === 0 ? target.id : uid("clip"),
        start: at,
        duration: b - a,
        inPoint: target.inPoint + a * target.speed,
        fadeIn: i === 0 ? target.fadeIn : 0,
        fadeOut: i === kept.length - 1 ? target.fadeOut : 0,
      });
      at += b - a;
    });
    get().edit((p) => ({
      clips: p.clips.flatMap((c): Clip[] => {
        if (c.id === target.id) return pieces;
        if (c.type === "text") {
          const start = map(c.start);
          const end = map(clipEnd(c));
          // Un texto que caía entero en un tramo quitado desaparece con él.
          return end - start < 0.15 ? [] : [{ ...c, start, duration: end - start }];
        }
        return c.start >= target.start ? [{ ...c, start: map(c.start) }] : [c];
      }),
    }));
    set({ selected: pieces.map((c) => c.id) });
  },

  translateSubtitles: (texts, opts) => {
    const project = get().project;
    const track = project.tracks.find((t) => t.role === "subtitles");
    const lines = subtitleClips(project);
    if (!track || lines.length !== texts.length) return;
    const backup: Track | null = opts.keepOriginal
      ? { id: uid("track"), kind: "text", name: `Subtítulos originales · ${opts.fromName}`, muted: false, hidden: true, lang: opts.from }
      : null;
    const copies: TextClip[] = backup ? lines.map((l) => ({ ...l, id: uid("clip"), trackId: backup.id })) : [];
    const updated = new Map<string, TextClip | null>();
    let previous: TextClip | null = null;
    lines.forEach((l, i) => {
      const text = texts[i].trim();
      if (!text && previous) {
        // Sin texto propio: la línea anterior se alarga hasta donde terminaba esta.
        previous.duration = clipEnd(l) - previous.start;
        updated.set(l.id, null);
        return;
      }
      previous = { ...l, text: text || l.text };
      updated.set(l.id, previous);
    });
    get().edit((p) => {
      const at = p.tracks.findIndex((t) => t.id === track.id);
      const tracks = p.tracks.map((t) => (t.id === track.id ? { ...t, name: `Subtítulos · ${opts.toName}`, lang: opts.to } : t));
      if (backup) tracks.splice(at + 1, 0, backup);
      return {
        tracks,
        clips: [
          ...p.clips.flatMap((c) => {
            if (!updated.has(c.id)) return [c];
            const next = updated.get(c.id);
            return next ? [next] : [];
          }),
          ...copies,
        ],
      };
    });
  },

  addTrack: (kind) => {
    const n = get().project.tracks.filter((t) => t.kind === kind).length + 1;
    const name = kind === "video" ? `Vídeo ${n}` : kind === "audio" ? `Audio ${n}` : `Texto ${n}`;
    const track: Track = { id: uid("track"), kind, name, muted: false, hidden: false };
    // Las pistas de vídeo y texto nuevas van arriba (se dibujan encima); las de audio, abajo.
    get().edit((p) => ({ tracks: kind === "audio" ? [...p.tracks, track] : [track, ...p.tracks] }));
  },
  updateTrack: (id, patch) => get().edit((p) => ({ tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTrack: (id) =>
    get().edit((p) => ({ tracks: p.tracks.filter((t) => t.id !== id), clips: p.clips.filter((c) => c.trackId !== id) })),
}));

export const selectDuration = (s: EditorState) => projectDuration(s.project);

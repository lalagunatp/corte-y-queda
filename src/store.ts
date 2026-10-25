import { create } from "zustand";
import type { Clip, MediaAsset, MediaClip, Project, TextClip, Track, TrackKind } from "./types";
import { clipEnd, projectDuration, uid } from "./util";

type Snapshot = Pick<Project, "tracks" | "clips" | "width" | "height" | "fps" | "background" | "name">;

const HISTORY_LIMIT = 200;

export function newProject(): Project {
  return {
    id: uid("project"),
    name: "Sin título",
    width: 1920,
    height: 1080,
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
  resetProject(): void;
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
  addClipFromAsset(assetId: string, at?: { trackId?: string; start?: number }): void;
  addText(text?: string): void;
  addTextClips(clips: Omit<TextClip, "id" | "trackId">[], trackName: string): void;
  updateClip(id: string, patch: Partial<Omit<MediaClip, "type">> | Partial<Omit<TextClip, "type">>): void;
  deleteSelected(): void;
  duplicateSelected(): void;
  splitAtPlayhead(): void;
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
  loadProject: (project) => set({ project, past: [], future: [], selected: [], time: 0, playing: false }),
  resetProject: () => set({ project: newProject(), past: [], future: [], selected: [], time: 0, playing: false }),
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
    const kind: TrackKind = asset.kind === "audio" ? "audio" : "video";
    let track = project.tracks.find((t) => t.id === at?.trackId && t.kind === kind) ?? project.tracks.find((t) => t.kind === kind);
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

  addText: (text = "Escribe aquí") => {
    const { project, time } = get();
    let track = project.tracks.find((t) => t.kind === "text");
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
      text,
      fontSize: 72,
      color: "#ffffff",
      background: "#00000000",
      bold: true,
      x: 0,
      y: 0,
    };
    get().edit((p) => ({ tracks: [...extra, ...p.tracks], clips: [...p.clips, clip] }));
    set({ selected: [clip.id] });
  },

  addTextClips: (clips, trackName) => {
    const track: Track = { id: uid("track"), kind: "text", name: trackName, muted: false, hidden: false };
    const created: TextClip[] = clips.map((c) => ({ ...c, id: uid("clip"), trackId: track.id }));
    get().edit((p) => ({ tracks: [track, ...p.tracks], clips: [...p.clips, ...created] }));
  },

  updateClip: (id, patch) =>
    get().edit((p) => ({ clips: p.clips.map((c) => (c.id === id ? ({ ...c, ...patch } as Clip) : c)) })),

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

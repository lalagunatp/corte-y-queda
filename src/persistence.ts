import { get, set } from "idb-keyval";
import { restoreAssets } from "./media";
import { useEditor } from "./store";
import type { Project } from "./types";

const PROJECT_KEY = "project:current";

/** Recupera el último proyecto guardado en este equipo, si existe. */
export async function restoreLastProject(): Promise<{ missing: number } | null> {
  const saved = await get<Project>(PROJECT_KEY);
  if (!saved) return null;
  const missing = await restoreAssets(saved.assets);
  const lost = new Set(missing);
  // Proyectos anteriores a la pista de subtítulos dedicada: la primera pista "Subtítulos" pasa a serlo.
  const legacy = !saved.tracks.some((t) => t.role === "subtitles") && saved.tracks.find((t) => t.kind === "text" && t.name === "Subtítulos");
  useEditor.getState().loadProject({
    ...saved,
    tracks: legacy ? saved.tracks.map((t) => (t === legacy ? { ...t, role: "subtitles" as const } : t)) : saved.tracks,
    assets: saved.assets.filter((a) => !lost.has(a.id)),
    clips: saved.clips.filter((c) => c.type !== "media" || !lost.has(c.assetId)),
  });
  return { missing: missing.length };
}

/** Autoguardado local con retardo: el proyecto nunca se sube a ningún servidor. */
export function startAutosave(): () => void {
  let timer: number | undefined;
  return useEditor.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void set(PROJECT_KEY, s.project), 600);
  });
}

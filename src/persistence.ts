import { del, get, set } from "idb-keyval";
import { create } from "zustand";
import { copyAssetFile, deleteAssetFile, restoreAssets, unloadAllAssets } from "./media";
import { newProject, useEditor } from "./store";
import type { Project } from "./types";
import { projectDuration, uid } from "./util";

/**
 * Dueño del almacenamiento de proyectos en este equipo (IndexedDB). Cada proyecto es dueño de
 * sus archivos: duplicar los copia y eliminar un proyecto borra solo los suyos.
 */
export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
  thumbnail: string | null;
  width: number;
  height: number;
  duration: number;
}

const INDEX_KEY = "projects:index";
const LAST_KEY = "projects:last";
const LEGACY_KEY = "project:current";
const projectKey = (id: string) => `project:${id}`;

export type SaveState = "saved" | "pending" | "saving" | "error";

/** Estado visible del guardado del proyecto abierto. */
export const useSave = create<{ state: SaveState; at: number | null }>(() => ({ state: "saved", at: null }));

function metaOf(p: Project): ProjectMeta {
  const visual = p.clips
    .filter((c) => c.type === "media")
    .map((c) => p.assets.find((a) => c.type === "media" && a.id === c.assetId))
    .find((a) => a?.thumbnail);
  return {
    id: p.id,
    name: p.name,
    updatedAt: Date.now(),
    thumbnail: visual?.thumbnail ?? p.assets.find((a) => a.thumbnail)?.thumbnail ?? null,
    width: p.width,
    height: p.height,
    duration: projectDuration(p),
  };
}

async function readIndex(): Promise<ProjectMeta[]> {
  return (await get<ProjectMeta[]>(INDEX_KEY)) ?? [];
}

async function writeProject(p: Project) {
  await set(projectKey(p.id), p);
  const index = await readIndex();
  await set(INDEX_KEY, [metaOf(p), ...index.filter((m) => m.id !== p.id)]);
}

/** Pasa el proyecto único de versiones anteriores a la lista de proyectos. */
async function migrateLegacy() {
  const legacy = await get<Project>(LEGACY_KEY);
  if (!legacy) return;
  const index = await readIndex();
  if (!index.some((m) => m.id === legacy.id)) await writeProject(legacy);
  await del(LEGACY_KEY);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  await migrateLegacy();
  return (await readIndex()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function lastProjectId(): Promise<string | null> {
  return (await get<string>(LAST_KEY)) ?? null;
}

/** Abre un proyecto: libera el anterior, carga sus archivos y lo pone en el editor. */
export async function openProject(id: string): Promise<{ missing: number }> {
  const saved = await get<Project>(projectKey(id));
  if (!saved) throw new Error("No se encontró el proyecto");
  unloadAllAssets();
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
  useSave.setState({ state: "saved", at: null });
  await set(LAST_KEY, id);
  return { missing: missing.length };
}

export async function createProject(opts: { name: string; width: number; height: number }): Promise<string> {
  const p = newProject(opts);
  await writeProject(p);
  return p.id;
}

export async function renameProject(id: string, name: string) {
  const p = await get<Project>(projectKey(id));
  if (p) await writeProject({ ...p, name });
}

export async function duplicateProject(id: string): Promise<string> {
  const p = await get<Project>(projectKey(id));
  if (!p) throw new Error("No se encontró el proyecto");
  const ids = new Map(p.assets.map((a) => [a.id, uid("asset")]));
  for (const [from, to] of ids) await copyAssetFile(from, to);
  const copy: Project = {
    ...p,
    id: uid("project"),
    name: `${p.name} (copia)`,
    assets: p.assets.map((a) => ({ ...a, id: ids.get(a.id)! })),
    clips: p.clips.map((c) => (c.type === "media" ? { ...c, assetId: ids.get(c.assetId) ?? c.assetId } : c)),
  };
  await writeProject(copy);
  return copy.id;
}

export async function deleteProject(id: string) {
  const p = await get<Project>(projectKey(id));
  for (const a of p?.assets ?? []) await deleteAssetFile(a.id);
  await del(projectKey(id));
  await set(INDEX_KEY, (await readIndex()).filter((m) => m.id !== id));
  if ((await lastProjectId()) === id) await del(LAST_KEY);
}

/** Borra el archivo de un recurso que se quitó del proyecto abierto. */
export const deleteProjectAsset = deleteAssetFile;

let timer: number | undefined;

/** Guarda ya el proyecto abierto (botón Guardar y salida a la lista de proyectos). */
export async function saveNow(): Promise<void> {
  window.clearTimeout(timer);
  useSave.setState({ state: "saving" });
  try {
    await writeProject(useEditor.getState().project);
    useSave.setState({ state: "saved", at: Date.now() });
  } catch {
    useSave.setState({ state: "error" });
  }
}

/** Autoguardado local con retardo: el proyecto nunca se sube a ningún servidor. */
export function startAutosave(): () => void {
  const unsub = useEditor.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    useSave.setState({ state: "pending" });
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void saveNow(), 800);
  });
  return () => {
    unsub();
    window.clearTimeout(timer);
  };
}

/** Cierra el proyecto abierto tras guardarlo y libera sus archivos de la memoria. */
export async function closeProject() {
  await saveNow();
  unloadAllAssets();
}

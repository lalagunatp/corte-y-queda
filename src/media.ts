import { del, get, set } from "idb-keyval";
import type { MediaAsset, MediaKind } from "./types";
import { uid } from "./util";

/**
 * Dueño único de los archivos fuente: guarda los Blob en IndexedDB (nunca salen del equipo),
 * crea las URL de objeto y cachea el audio decodificado.
 */
const urls = new Map<string, string>();
const blobs = new Map<string, Blob>();
const audioCache = new Map<string, Promise<AudioBuffer | null>>();

const blobKey = (id: string) => `asset:${id}`;

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "webm", "mkv", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"].includes(ext)) return "image";
  return null;
}

function register(id: string, blob: Blob): string {
  blobs.set(id, blob);
  let url = urls.get(id);
  if (!url) {
    url = URL.createObjectURL(blob);
    urls.set(id, url);
  }
  return url;
}

export const assetUrl = (id: string) => urls.get(id) ?? null;
export const assetBlob = (id: string) => blobs.get(id) ?? null;

function waitFor(el: HTMLMediaElement | HTMLImageElement, ok: string): Promise<void> {
  return new Promise((resolve, reject) => {
    el.addEventListener(ok, () => resolve(), { once: true });
    el.addEventListener("error", () => reject(new Error("No se pudo leer el archivo")), { once: true });
  });
}

function thumbnailFrom(source: CanvasImageSource, w: number, h: number): string {
  const c = document.createElement("canvas");
  const scale = 160 / Math.max(w, h, 1);
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

async function probe(id: string, file: File, kind: MediaKind): Promise<MediaAsset> {
  const url = register(id, file);
  const base: MediaAsset = { id, name: file.name, kind, duration: 0, width: 0, height: 0, thumbnail: null };
  if (kind === "image") {
    const img = new Image();
    img.src = url;
    await waitFor(img, "load");
    return { ...base, width: img.naturalWidth, height: img.naturalHeight, thumbnail: thumbnailFrom(img, img.naturalWidth, img.naturalHeight) };
  }
  const el = document.createElement(kind === "video" ? "video" : "audio");
  el.preload = "auto";
  el.muted = true;
  el.src = url;
  await waitFor(el, "loadedmetadata");
  const asset = { ...base, duration: el.duration };
  if (el instanceof HTMLVideoElement) {
    asset.width = el.videoWidth;
    asset.height = el.videoHeight;
    el.currentTime = Math.min(0.5, el.duration / 2);
    await waitFor(el, "seeked");
    asset.thumbnail = thumbnailFrom(el, el.videoWidth, el.videoHeight);
  }
  el.removeAttribute("src");
  el.load();
  return asset;
}

export async function importFiles(files: Iterable<File>): Promise<{ assets: MediaAsset[]; rejected: string[] }> {
  const assets: MediaAsset[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind) {
      rejected.push(file.name);
      continue;
    }
    const id = uid("asset");
    try {
      assets.push(await probe(id, file, kind));
      await set(blobKey(id), file);
    } catch {
      rejected.push(file.name);
      void deleteAssetFile(id);
    }
  }
  return { assets, rejected };
}

/** Restaura las URL de los recursos guardados; devuelve los ids cuyo archivo ya no existe. */
export async function restoreAssets(assets: MediaAsset[]): Promise<string[]> {
  const missing: string[] = [];
  for (const a of assets) {
    const blob = await get<Blob>(blobKey(a.id));
    if (blob) register(a.id, blob);
    else missing.push(a.id);
  }
  return missing;
}

/** Libera la memoria de un recurso (URL, archivo y audio decodificado) sin tocar lo guardado. */
export function unloadAsset(id: string) {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  blobs.delete(id);
  audioCache.delete(id);
}

/** Libera todos los recursos cargados, al cerrar un proyecto. */
export function unloadAllAssets() {
  for (const id of [...urls.keys()]) unloadAsset(id);
}

/** Borra el archivo guardado. Quien llama debe comprobar antes que ningún proyecto lo usa. */
export async function deleteAssetFile(id: string) {
  unloadAsset(id);
  await del(blobKey(id));
}

/** Copia el archivo guardado de un recurso con un id nuevo (para duplicar proyectos). */
export async function copyAssetFile(from: string, to: string): Promise<boolean> {
  const blob = await get<Blob>(blobKey(from));
  if (!blob) return false;
  await set(blobKey(to), blob);
  return true;
}

let decodeCtx: OfflineAudioContext | null = null;

/** Audio decodificado a 48 kHz; null cuando el archivo no tiene pista de audio legible. */
export function decodedAudio(id: string): Promise<AudioBuffer | null> {
  let p = audioCache.get(id);
  if (!p) {
    p = (async () => {
      const blob = blobs.get(id);
      if (!blob) return null;
      decodeCtx ??= new OfflineAudioContext(2, 1, 48000);
      try {
        return await decodeCtx.decodeAudioData(await blob.arrayBuffer());
      } catch {
        return null;
      }
    })();
    audioCache.set(id, p);
  }
  return p;
}

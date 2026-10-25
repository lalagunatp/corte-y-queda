import { useEffect, useState } from "react";
import { importIntoProject } from "./components/MediaBin";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isTauri = "__TAURI_INTERNALS__" in window;

/** Registra el service worker (solo en la web publicada) y abre los archivos con los que se lanza la app. */
export function setupPwa() {
  if (import.meta.env.PROD && !isTauri && "serviceWorker" in navigator) {
    void navigator.serviceWorker.register("./sw.js");
  }
  const launchQueue = (window as Window & { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
  launchQueue?.setConsumer(async ({ files }) => {
    if (files.length) void importIntoProject(await Promise.all(files.map((f) => f.getFile())));
  });
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  listeners.forEach((l) => l());
});

/** Devuelve una función para instalar la app, o null si el navegador no lo ofrece ahora. */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (!deferred) return null;
  return async () => {
    const ev = deferred!;
    deferred = null;
    await ev.prompt();
    await ev.userChoice;
    listeners.forEach((l) => l());
  };
}

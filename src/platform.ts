const isTauri = "__TAURI_INTERNALS__" in window;

/** Abre una URL externa: en el escritorio con el navegador del sistema, en la web en otra pestaña. */
export async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Guarda un archivo con el diálogo nativo cuando existe; si no, como descarga. */
export async function saveFile(blob: Blob, suggestedName: string): Promise<void> {
  const picker = (window as Window & {
    showSaveFilePicker?: (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle>;
  }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: [{ description: "Vídeo MP4", accept: { "video/mp4": [".mp4"] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // Si el diálogo no está disponible en este contexto, se usa la descarga normal.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

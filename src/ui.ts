import { useEffect, useState } from "react";
import { create } from "zustand";

/** Ancho a partir del cual se usa el diseño de escritorio con tres columnas. */
export const COMPACT_QUERY = "(max-width: 1023px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export type Sheet = "media" | "edit" | "subtitles" | null;
export type LeftPanel = "media" | "subtitles";

const compact = () => window.matchMedia(COMPACT_QUERY).matches;

interface UiState {
  /** Panel abierto en lugar de la línea de tiempo en pantallas pequeñas. */
  sheet: Sheet;
  /** Pestaña de la columna izquierda en pantallas grandes. */
  left: LeftPanel;
  /** Clip elegido como fuente para generar subtítulos. */
  subtitleSource: string | null;
  /** Subtítulo que la lista debe mostrar y resaltar (cambia en cada petición). */
  focusSubtitle: { id: string; at: number } | null;
  exporting: boolean;
  help: boolean;
  setSheet(s: Sheet): void;
  setLeft(p: LeftPanel): void;
  /** Abre el panel Subtítulos (pestaña izquierda u hoja según el tamaño de pantalla). */
  openSubtitles(sourceClipId?: string): void;
  /** Abre el panel donde se edita ese subtítulo y lo resalta en la lista. */
  editSubtitle(id: string): void;
  setExporting(v: boolean): void;
  setHelp(v: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  sheet: null,
  left: "media",
  subtitleSource: null,
  focusSubtitle: null,
  exporting: false,
  help: false,
  setSheet: (sheet) => set({ sheet }),
  setLeft: (left) => set({ left }),
  openSubtitles: (sourceClipId) =>
    set({
      left: "subtitles",
      sheet: compact() ? "subtitles" : null,
      ...(sourceClipId ? { subtitleSource: sourceClipId } : {}),
    }),
  editSubtitle: (id) => set({ left: "subtitles", sheet: compact() ? "subtitles" : null, focusSubtitle: { id, at: Date.now() } }),
  setExporting: (exporting) => set({ exporting }),
  setHelp: (help) => set({ help }),
}));

const SEEN_KEY = "corte-y-queda:guide-seen";

export function guideSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markGuideSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Sin almacenamiento la guía simplemente vuelve a aparecer.
  }
}

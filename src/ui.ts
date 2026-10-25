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
export type SidePanel = "edit" | "subtitles";

interface UiState {
  /** Panel abierto como hoja inferior en pantallas pequeñas. */
  sheet: Sheet;
  /** Pestaña de la columna derecha en pantallas grandes. */
  side: SidePanel;
  /** Clip elegido como fuente para generar subtítulos. */
  subtitleSource: string | null;
  exporting: boolean;
  help: boolean;
  setSheet(s: Sheet): void;
  setSide(p: SidePanel): void;
  /** Abre el panel Subtítulos (como pestaña u hoja según el tamaño de pantalla). */
  openSubtitles(sourceClipId?: string): void;
  setExporting(v: boolean): void;
  setHelp(v: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  sheet: null,
  side: "edit",
  subtitleSource: null,
  exporting: false,
  help: false,
  setSheet: (sheet) => set({ sheet }),
  setSide: (side) => set({ side }),
  openSubtitles: (sourceClipId) =>
    set({
      side: "subtitles",
      sheet: window.matchMedia(COMPACT_QUERY).matches ? "subtitles" : null,
      ...(sourceClipId ? { subtitleSource: sourceClipId } : {}),
    }),
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

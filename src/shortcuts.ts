import { engineRef } from "./components/Preview";
import { saveNow } from "./persistence";
import { selectDuration, useEditor } from "./store";

/** Atajos al estilo de los editores profesionales (J/K/L, S para dividir, etc.). */
export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    // Ctrl+S guarda incluso mientras se escribe en un campo (evita el "Guardar página" del navegador).
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void saveNow().then(() => useEditor.getState().setStatus("Proyecto guardado"));
      return;
    }
    const target = e.target;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) return;
    const s = useEditor.getState();
    const frame = 1 / s.project.fps;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const handled = () => e.preventDefault();

    if (ctrl && key === "z" && !e.shiftKey) return handled(), s.undo();
    if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) return handled(), s.redo();
    if (ctrl && key === "d") return handled(), s.duplicateSelected();
    if (ctrl && key === "a") return handled(), s.select(s.project.clips.map((c) => c.id));
    if (ctrl) return;

    switch (key) {
      case " ":
      case "k":
        handled();
        engineRef.current?.resumeAudio();
        if (key === "k") s.setPlaying(false);
        else s.setPlaying(!s.playing);
        break;
      case "l":
        engineRef.current?.resumeAudio();
        s.setPlaying(true);
        break;
      case "j":
        s.setPlaying(false);
        s.setTime(s.time - 5);
        break;
      case "s":
        handled();
        s.splitAtPlayhead();
        break;
      case "delete":
      case "backspace":
        handled();
        s.deleteSelected();
        break;
      case "arrowleft":
        handled();
        s.setTime(s.time - (e.shiftKey ? 1 : frame));
        break;
      case "arrowright":
        handled();
        s.setTime(s.time + (e.shiftKey ? 1 : frame));
        break;
      case "home":
        s.setTime(0);
        break;
      case "end":
        s.setTime(selectDuration(s));
        break;
      case "+":
      case "=":
        s.setZoom(s.zoom * 1.25);
        break;
      case "-":
        s.setZoom(s.zoom / 1.25);
        break;
      case "t":
        s.addText();
        break;
      case "escape":
        s.select([]);
        break;
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}

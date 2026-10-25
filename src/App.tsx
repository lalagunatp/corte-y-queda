import { useEffect, useState } from "react";
import { ExportDialog } from "./components/ExportDialog";
import { Inspector } from "./components/Inspector";
import { MediaBin, importIntoProject } from "./components/MediaBin";
import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { forgetAsset } from "./media";
import { restoreLastProject, startAutosave } from "./persistence";
import { installShortcuts } from "./shortcuts";
import { useEditor } from "./store";
import { ASPECTS } from "./types";

export function App() {
  const project = useEditor((s) => s.project);
  const status = useEditor((s) => s.status);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const s = useEditor.getState;
  const [exporting, setExporting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stopAutosave = () => {};
    let cancelled = false;
    void restoreLastProject().then((r) => {
      if (cancelled) return;
      if (r?.missing) s().setStatus(`${r.missing} archivo(s) del proyecto anterior ya no están disponibles.`);
      stopAutosave = startAutosave();
      setReady(true);
    });
    const stopKeys = installShortcuts();
    return () => {
      cancelled = true;
      stopAutosave();
      stopKeys();
    };
  }, [s]);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => s().setStatus(null), 5000);
    return () => clearTimeout(t);
  }, [status, s]);

  const aspect = ASPECTS.find((a) => a.width === project.width && a.height === project.height)?.label ?? "custom";

  if (!ready) return <div className="loading">Cargando…</div>;

  return (
    <div
      className="app"
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void importIntoProject(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <strong className="logo">Montaje</strong>
        <input
          className="pname"
          value={project.name}
          onChange={(e) => s().edit(() => ({ name: e.target.value }))}
          aria-label="Nombre del proyecto"
        />
        <select
          value={aspect}
          onChange={(e) => {
            const a = ASPECTS.find((x) => x.label === e.target.value);
            if (a) s().edit(() => ({ width: a.width, height: a.height }));
          }}
          title="Formato"
        >
          {ASPECTS.map((a) => (
            <option key={a.label} value={a.label}>{a.label}</option>
          ))}
          {aspect === "custom" && <option value="custom">{project.width}×{project.height}</option>}
        </select>
        <select value={project.fps} onChange={(e) => s().edit(() => ({ fps: Number(e.target.value) }))} title="Fotogramas por segundo">
          {[24, 25, 30, 50, 60].map((f) => (
            <option key={f} value={f}>{f} fps</option>
          ))}
        </select>
        <input type="color" value={project.background} onChange={(e) => s().edit(() => ({ background: e.target.value }))} title="Color de fondo" />
        <button onClick={() => s().undo()} disabled={!canUndo} title="Deshacer (Ctrl+Z)">↶</button>
        <button onClick={() => s().redo()} disabled={!canRedo} title="Rehacer (Ctrl+Y)">↷</button>
        <button
          onClick={() => {
            if (!confirm("¿Empezar un proyecto nuevo? El actual y sus medios se borrarán de este equipo.")) return;
            project.assets.forEach((a) => forgetAsset(a.id));
            s().resetProject();
          }}
        >
          Nuevo
        </button>
        <span className="grow">{status && <span className="status">{status}</span>}</span>
        <span className="badge" title="Todo se procesa y guarda en este equipo">🔒 Local · sin cuenta</span>
        <button className="primary" onClick={() => setExporting(true)} disabled={!project.clips.length}>
          Exportar
        </button>
      </header>
      <main className="workspace">
        <MediaBin />
        <Preview />
        <Inspector />
      </main>
      <Timeline />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}

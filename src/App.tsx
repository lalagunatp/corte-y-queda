import { useEffect, useState } from "react";
import { ExportDialog } from "./components/ExportDialog";
import { Guide } from "./components/Guide";
import { Inspector } from "./components/Inspector";
import { MediaBin, importIntoProject } from "./components/MediaBin";
import { Preview } from "./components/Preview";
import { ProjectSettings } from "./components/ProjectSettings";
import { Timeline } from "./components/Timeline";
import { restoreLastProject, startAutosave } from "./persistence";
import { useInstallPrompt } from "./pwa";
import { installShortcuts } from "./shortcuts";
import { useEditor } from "./store";
import { COMPACT_QUERY, guideSeen, useMediaQuery, useUi } from "./ui";

function Sheet({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet-head">
          <strong>{title}</strong>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function App() {
  const status = useEditor((s) => s.status);
  const hasClips = useEditor((s) => s.project.clips.length > 0);
  const hasSelection = useEditor((s) => s.selected.length > 0);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const s = useEditor.getState;
  const { sheet, setSheet, exporting, setExporting, help, setHelp } = useUi();
  const compact = useMediaQuery(COMPACT_QUERY);
  const [settings, setSettings] = useState(false);
  const [ready, setReady] = useState(false);
  const install = useInstallPrompt();

  useEffect(() => {
    let stopAutosave = () => {};
    let cancelled = false;
    void restoreLastProject().then((r) => {
      if (cancelled) return;
      if (r?.missing) s().setStatus(`${r.missing} archivo(s) del proyecto anterior ya no están disponibles.`);
      stopAutosave = startAutosave();
      setReady(true);
      if (!guideSeen()) useUi.getState().setHelp(true);
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
    const t = setTimeout(() => s().setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status, s]);

  // Al pasar a pantalla grande los paneles vuelven a las columnas.
  useEffect(() => {
    if (!compact) setSheet(null);
  }, [compact, setSheet]);

  if (!ready) return <div className="loading">Cargando…</div>;

  const save = (
    <button className="primary big" onClick={() => setExporting(true)} disabled={!hasClips}>
      💾 Guardar video
    </button>
  );

  return (
    <div
      className={`app ${compact ? "compact" : ""}`}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void importIntoProject(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <strong className="logo">✂️ Corte y Queda</strong>
        <button className="icon-btn" onClick={() => s().undo()} disabled={!canUndo} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
          ↩️<span className="lbl">Deshacer</span>
        </button>
        <button className="icon-btn" onClick={() => s().redo()} disabled={!canRedo} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
          ↪️<span className="lbl">Rehacer</span>
        </button>
        <span className="grow">{status && <span className="status">{status}</span>}</span>
        {install && (
          <button className="icon-btn" onClick={() => void install()} title="Instalar como aplicación">
            ⬇️<span className="lbl">Instalar</span>
          </button>
        )}
        <button className="icon-btn" onClick={() => setSettings(true)} title="Ajustes del proyecto" aria-label="Ajustes">
          ⚙️<span className="lbl">Ajustes</span>
        </button>
        <button className="icon-btn" onClick={() => setHelp(true)} title="Ayuda" aria-label="Ayuda">
          ❓<span className="lbl">Ayuda</span>
        </button>
        {!compact && save}
      </header>

      <main className="workspace">
        {!compact && <MediaBin />}
        <Preview />
        {!compact && <Inspector />}
      </main>

      <Timeline />

      {compact && (
        <nav className="bottomnav">
          <button className={sheet === "media" ? "on" : ""} onClick={() => setSheet(sheet === "media" ? null : "media")}>
            <span className="ico">📁</span>Mis archivos
          </button>
          <button className={sheet === "edit" ? "on" : ""} onClick={() => setSheet(sheet === "edit" ? null : "edit")}>
            <span className="ico">🎨</span>Editar{hasSelection && <span className="dot" />}
          </button>
          <button
            onClick={() => {
              s().addText();
              setSheet("edit");
            }}
          >
            <span className="ico">🔤</span>Texto
          </button>
          <button className="save" onClick={() => setExporting(true)} disabled={!hasClips}>
            <span className="ico">💾</span>Guardar
          </button>
        </nav>
      )}

      {compact && sheet === "media" && (
        <Sheet title="📁 Mis archivos" onClose={() => setSheet(null)}>
          <MediaBin />
        </Sheet>
      )}
      {compact && sheet === "edit" && (
        <Sheet title="🎨 Editar" onClose={() => setSheet(null)}>
          <Inspector />
        </Sheet>
      )}
      {settings && <ProjectSettings onClose={() => setSettings(false)} />}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {help && <Guide onClose={() => setHelp(false)} />}
    </div>
  );
}

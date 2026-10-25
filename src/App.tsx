import { useEffect, useState } from "react";
import { ExportDialog } from "./components/ExportDialog";
import { Guide } from "./components/Guide";
import { Icon } from "./components/Icon";
import { Inspector } from "./components/Inspector";
import { MediaBin, importIntoProject } from "./components/MediaBin";
import { Preview } from "./components/Preview";
import { ProjectSettings } from "./components/ProjectSettings";
import { Subtitles } from "./components/Subtitles";
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
          <span className="grabber" />
          <strong>{title}</strong>
          <button className="ghost" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
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
  const projectName = useEditor((s) => s.project.name);
  const s = useEditor.getState;
  const { sheet, setSheet, side, setSide, exporting, setExporting, help, setHelp } = useUi();
  const compact = useMediaQuery(COMPACT_QUERY);
  const [settings, setSettings] = useState(false);
  const [ready, setReady] = useState(false);
  const install = useInstallPrompt();

  useEffect(() => {
    let stopAutosave = () => {};
    let cancelled = false;
    void restoreLastProject().then((r) => {
      if (cancelled) return;
      if (r?.missing) s().setStatus(`Faltan ${r.missing} archivo(s) del proyecto anterior`);
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
    const t = setTimeout(() => s().setStatus(null), 3500);
    return () => clearTimeout(t);
  }, [status, s]);

  // Al pasar a pantalla grande los paneles vuelven a las columnas.
  useEffect(() => {
    if (!compact) setSheet(null);
  }, [compact, setSheet]);

  if (!ready) return <div className="loading" />;

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
        <span className="brand">Corte y Queda</span>
        <span className="sep" />
        <button className="ghost project" onClick={() => setSettings(true)} title="Ajustes del proyecto">
          {projectName}
        </button>
        <span className="grow" />
        {status && <span className="status">{status}</span>}
        <button className="ghost" onClick={() => s().undo()} disabled={!canUndo} title="Deshacer (Ctrl+Z)" aria-label="Deshacer">
          <Icon name="undo" />
        </button>
        <button className="ghost" onClick={() => s().redo()} disabled={!canRedo} title="Rehacer (Ctrl+Y)" aria-label="Rehacer">
          <Icon name="redo" />
        </button>
        {install && (
          <button className="ghost" onClick={() => void install()} title="Instalar aplicación" aria-label="Instalar">
            <Icon name="download" />
          </button>
        )}
        <button className="ghost" onClick={() => setSettings(true)} title="Ajustes" aria-label="Ajustes">
          <Icon name="settings" />
        </button>
        <button className="ghost" onClick={() => setHelp(true)} title="Ayuda" aria-label="Ayuda">
          <Icon name="help" />
        </button>
        {!compact && (
          <button className="primary" onClick={() => setExporting(true)} disabled={!hasClips}>
            <Icon name="export" /> Exportar
          </button>
        )}
      </header>

      <main className="workspace">
        {!compact && <MediaBin />}
        <Preview />
        {!compact && (
          <aside className="inspector">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={side === "edit"} className={side === "edit" ? "on" : ""} onClick={() => setSide("edit")}>
                Editar
              </button>
              <button role="tab" aria-selected={side === "subtitles"} className={side === "subtitles" ? "on" : ""} onClick={() => setSide("subtitles")}>
                Subtítulos
              </button>
            </div>
            {side === "edit" ? <Inspector /> : <Subtitles />}
          </aside>
        )}
      </main>

      <Timeline />

      {compact && (
        <nav className="bottomnav">
          <button className={sheet === "media" ? "on" : ""} onClick={() => setSheet(sheet === "media" ? null : "media")}>
            <Icon name="media" size={22} />
            Medios
          </button>
          <button className={sheet === "edit" ? "on" : ""} onClick={() => setSheet(sheet === "edit" ? null : "edit")}>
            <Icon name="sliders" size={22} />
            Editar{hasSelection && <span className="dot" />}
          </button>
          <button className={sheet === "subtitles" ? "on" : ""} onClick={() => setSheet(sheet === "subtitles" ? null : "subtitles")}>
            <Icon name="captions" size={22} />
            Subtítulos
          </button>
          <button
            onClick={() => {
              s().addText();
              setSheet("edit");
            }}
          >
            <Icon name="type" size={22} />
            Texto
          </button>
          <button className="accent" onClick={() => setExporting(true)} disabled={!hasClips}>
            <Icon name="export" size={22} />
            Exportar
          </button>
        </nav>
      )}

      {compact && sheet === "media" && (
        <Sheet title="Medios" onClose={() => setSheet(null)}>
          <MediaBin />
        </Sheet>
      )}
      {compact && sheet === "edit" && (
        <Sheet title="Editar" onClose={() => setSheet(null)}>
          <div className="inspector">
            <Inspector />
          </div>
        </Sheet>
      )}
      {compact && sheet === "subtitles" && (
        <Sheet title="Subtítulos" onClose={() => setSheet(null)}>
          <div className="inspector">
            <Subtitles />
          </div>
        </Sheet>
      )}
      {settings && <ProjectSettings onClose={() => setSettings(false)} />}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {help && <Guide onClose={() => setHelp(false)} />}
    </div>
  );
}

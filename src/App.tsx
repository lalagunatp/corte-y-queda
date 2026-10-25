import { useEffect, useState } from "react";
import { ExportDialog } from "./components/ExportDialog";
import { Guide } from "./components/Guide";
import { Home } from "./components/Home";
import { Icon } from "./components/Icon";
import { Inspector } from "./components/Inspector";
import { MediaBin, importIntoProject } from "./components/MediaBin";
import { Preview } from "./components/Preview";
import { ProjectSettings } from "./components/ProjectSettings";
import { Subtitles } from "./components/Subtitles";
import { Timeline } from "./components/Timeline";
import { closeProject, openProject, saveNow, startAutosave, useSave } from "./persistence";
import { useInstallPrompt } from "./pwa";
import { installShortcuts } from "./shortcuts";
import { useEditor } from "./store";
import { COMPACT_QUERY, guideSeen, useMediaQuery, useUi } from "./ui";

/** Panel acoplado bajo la vista previa en pantallas pequeñas (ocupa el sitio de la línea de tiempo). */
function Dock({ title, onClose, children }: { title: string; onClose(): void; children: React.ReactNode }) {
  return (
    <section className="dock" aria-label={title}>
      <div className="dock-head">
        <strong>{title}</strong>
        <button className="ghost" onClick={onClose} aria-label="Cerrar">
          <Icon name="close" />
        </button>
      </div>
      <div className="dock-body">{children}</div>
    </section>
  );
}

/** Indicador siempre visible de si el proyecto está guardado en el equipo. */
function SaveIndicator({ compact }: { compact: boolean }) {
  const { state } = useSave();
  const label = state === "saved" ? "Guardado" : state === "error" ? "No se pudo guardar" : "Guardando…";
  return (
    <span className={`save-state ${state}`} title={state === "saved" ? "Todos los cambios están guardados en este equipo" : label} aria-live="polite">
      <Icon name={state === "saved" ? "check" : state === "error" ? "close" : "save"} size={14} />
      {!compact && label}
    </span>
  );
}

/** Abre la lista de proyectos o el editor. Se arranca en "Mis proyectos". */
export function App() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const open = async (id: string) => {
    setLoading(true);
    try {
      const r = await openProject(id);
      if (r.missing) useEditor.getState().setStatus(`Faltan ${r.missing} archivo(s) de este proyecto`);
      setOpenId(id);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading" />;
  if (!openId) return <Home onOpen={(id) => void open(id)} />;
  return (
    <Editor
      key={openId}
      onHome={async () => {
        await closeProject();
        setOpenId(null);
      }}
    />
  );
}

function Editor({ onHome }: { onHome(): Promise<void> }) {
  const status = useEditor((s) => s.status);
  const hasClips = useEditor((s) => s.project.clips.length > 0);
  const hasSelection = useEditor((s) => s.selected.length > 0);
  const projectName = useEditor((s) => s.project.name);
  const s = useEditor.getState;
  const { sheet, setSheet, left, setLeft, exporting, setExporting, help, setHelp } = useUi();
  const compact = useMediaQuery(COMPACT_QUERY);
  const [settings, setSettings] = useState(false);
  const install = useInstallPrompt();

  useEffect(() => {
    // El autoguardado empieza después de abrir, para no contar la carga como un cambio.
    const stopAutosave = startAutosave();
    const stopKeys = installShortcuts();
    if (!guideSeen()) useUi.getState().setHelp(true);
    // Guardar también si se cierra la pestaña o la ventana justo después de un cambio.
    const flush = () => void saveNow();
    window.addEventListener("pagehide", flush);
    return () => {
      stopAutosave();
      stopKeys();
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => s().setStatus(null), 3500);
    return () => clearTimeout(t);
  }, [status, s]);

  // Al pasar a pantalla grande los paneles vuelven a las columnas.
  useEffect(() => {
    if (!compact) setSheet(null);
  }, [compact, setSheet]);

  return (
    <div
      className={`app ${compact ? "compact" : ""} ${compact && sheet ? "docked" : ""}`}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        void importIntoProject(e.dataTransfer.files);
      }}
    >
      <header className="topbar">
        <button className="ghost back" onClick={() => void onHome()} title="Volver a Mis proyectos (se guarda antes)">
          <Icon name="back-arrow" />
          {!compact && "Proyectos"}
        </button>
        <span className="sep" />
        <button className="ghost project" onClick={() => setSettings(true)} title="Nombre y ajustes del proyecto">
          {projectName}
        </button>
        <SaveIndicator compact={compact} />
        <span className="grow" />
        {status && <span className="status">{status}</span>}
        {!compact && (
          <button className="ghost" onClick={() => void saveNow().then(() => s().setStatus("Proyecto guardado"))} title="Guardar ahora (Ctrl+S)">
            <Icon name="save" /> Guardar
          </button>
        )}
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

      <main className={`workspace ${left === "subtitles" ? "wide-left" : ""}`}>
        {!compact && (
          <aside className="leftcol">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={left === "media"} className={left === "media" ? "on" : ""} onClick={() => setLeft("media")}>
                Medios
              </button>
              <button role="tab" aria-selected={left === "subtitles"} className={left === "subtitles" ? "on" : ""} onClick={() => setLeft("subtitles")}>
                Subtítulos
              </button>
            </div>
            <div className="leftcol-body">{left === "media" ? <MediaBin /> : <Subtitles />}</div>
          </aside>
        )}
        <Preview />
        {!compact && (
          <aside className="inspector">
            <h2 className="panel-title">Editar</h2>
            <Inspector />
          </aside>
        )}
      </main>

      {/* En pantallas pequeñas el panel abierto ocupa el sitio de la línea de tiempo: la vista previa sigue visible. */}
      {compact && sheet ? (
        <Dock title={sheet === "media" ? "Medios" : sheet === "edit" ? "Editar" : "Subtítulos"} onClose={() => setSheet(null)}>
          {sheet === "media" && <MediaBin />}
          {sheet === "edit" && (
            <div className="inspector">
              <Inspector />
            </div>
          )}
          {sheet === "subtitles" && (
            <div className="inspector">
              <Subtitles />
            </div>
          )}
        </Dock>
      ) : (
        <Timeline />
      )}

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

      {settings && <ProjectSettings onClose={() => setSettings(false)} />}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {help && <Guide onClose={() => setHelp(false)} />}
    </div>
  );
}

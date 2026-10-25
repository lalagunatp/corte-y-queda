import { useEffect, useState } from "react";
import { type ProjectMeta, createProject, deleteProject, duplicateProject, listProjects, renameProject } from "../persistence";
import { useInstallPrompt } from "../pwa";
import { ASPECTS } from "../types";
import { formatTime } from "../util";
import { Icon } from "./Icon";

const SHAPES: Record<string, { name: string; hint: string }> = {
  "16:9": { name: "Horizontal", hint: "YouTube" },
  "9:16": { name: "Vertical", hint: "TikTok · Reels · Shorts" },
  "1:1": { name: "Cuadrado", hint: "Publicaciones" },
  "4:5": { name: "Retrato", hint: "Instagram" },
};

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(t).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

function NewProject({ onCancel, onCreate }: { onCancel(): void; onCreate(name: string, w: number, h: number): void }) {
  const [name, setName] = useState("Mi video");
  const [shape, setShape] = useState("16:9");
  const a = ASPECTS.find((x) => x.label === shape)!;
  return (
    <div className="modal-back" onClick={onCancel}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(name.trim() || "Mi video", a.width, a.height);
        }}
        aria-label="Nuevo proyecto"
      >
        <div className="modal-head">
          <h2>Nuevo proyecto</h2>
          <button type="button" className="ghost" onClick={onCancel} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>
        <label className="stack">
          <span>Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onFocus={(e) => e.target.select()} />
        </label>
        <div className="stack">
          <span>Formato (se puede cambiar después)</span>
          <div className="choices four">
            {ASPECTS.map((x) => {
              const k = 22 / Math.max(x.width, x.height);
              return (
                <button type="button" key={x.label} className={`choice ${shape === x.label ? "on" : ""}`} onClick={() => setShape(x.label)}>
                  <span className="shape" style={{ width: x.width * k, height: x.height * k }} />
                  <b>{SHAPES[x.label].name}</b>
                  <small>{SHAPES[x.label].hint}</small>
                </button>
              );
            })}
          </div>
        </div>
        <div className="row-end">
          <button type="submit" className="primary big">
            Crear proyecto
          </button>
        </div>
      </form>
    </div>
  );
}

function ProjectCard({ p, onOpen, onChanged }: { p: ProjectMeta; onOpen(): void; onChanged(): void }) {
  const [menu, setMenu] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setMenu(false);
    await fn();
    onChanged();
  };
  return (
    <div className="project">
      <button className="project-open" onClick={onOpen} title={`Abrir «${p.name}»`}>
        <span className="project-thumb" style={{ aspectRatio: "16 / 10" }}>
          {p.thumbnail ? (
            <img src={p.thumbnail} alt="" />
          ) : (
            <Icon name="film" size={26} />
          )}
          {p.duration > 0 && <span className="dur">{formatTime(p.duration).slice(0, 5)}</span>}
        </span>
        <span className="project-name">{p.name}</span>
        <span className="project-date">{ago(p.updatedAt)}</span>
      </button>
      <button className="ghost square project-menu-btn" onClick={() => setMenu(!menu)} aria-label={`Opciones de ${p.name}`}>
        <Icon name="more" />
      </button>
      {menu && (
        <div className="project-menu" onMouseLeave={() => setMenu(false)}>
          <button onClick={onOpen}>
            <Icon name="film" /> Abrir
          </button>
          <button
            onClick={() => {
              const name = prompt("Nuevo nombre del proyecto", p.name);
              if (name?.trim()) void run(() => renameProject(p.id, name.trim()));
              else setMenu(false);
            }}
          >
            <Icon name="type" /> Cambiar nombre
          </button>
          <button onClick={() => void run(() => duplicateProject(p.id))}>
            <Icon name="copy" /> Duplicar
          </button>
          <button
            className="danger-text"
            onClick={() => {
              if (confirm(`¿Eliminar «${p.name}»? Se borrarán el proyecto y sus archivos de este equipo. No se puede deshacer.`)) void run(() => deleteProject(p.id));
              else setMenu(false);
            }}
          >
            <Icon name="trash" /> Eliminar
          </button>
        </div>
      )}
    </div>
  );
}

export function Home({ onOpen }: { onOpen(id: string): void }) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [creating, setCreating] = useState(false);
  const install = useInstallPrompt();
  const refresh = () => void listProjects().then(setProjects);
  useEffect(refresh, []);

  return (
    <div className="home">
      <header className="topbar">
        <span className="brand">Corte y Queda</span>
        <span className="grow" />
        {install && (
          <button className="ghost" onClick={() => void install()}>
            <Icon name="download" /> Instalar app
          </button>
        )}
      </header>
      <main className="home-body">
        <h1>Mis proyectos</h1>
        <div className="projects">
          <button className="project-new" onClick={() => setCreating(true)}>
            <span className="plus">
              <Icon name="plus" size={28} />
            </span>
            <b>Nuevo proyecto</b>
            <small>Elige el formato y empieza</small>
          </button>
          {projects?.map((p) => (
            <ProjectCard key={p.id} p={p} onOpen={() => onOpen(p.id)} onChanged={refresh} />
          ))}
        </div>
        {projects && projects.length === 0 && <p className="muted center">Aún no tienes proyectos. Crea el primero.</p>}
        <p className="muted small center">Los proyectos se guardan en este equipo y en este navegador; no se suben a internet.</p>
      </main>
      {creating && (
        <NewProject
          onCancel={() => setCreating(false)}
          onCreate={(name, w, h) => {
            setCreating(false);
            void createProject({ name, width: w, height: h }).then(onOpen);
          }}
        />
      )}
    </div>
  );
}

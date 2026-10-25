import { useRef, useState } from "react";
import { deleteAssetFile, importFiles } from "../media";
import { useEditor } from "../store";
import { useUi } from "../ui";
import { formatTime } from "../util";
import { FreeMusic } from "./FreeMusic";
import { Icon } from "./Icon";

export const ASSET_DRAG_TYPE = "application/x-corte-y-queda-asset";

/** Importa archivos; con placeInVideo además los pone en la línea de tiempo, en orden. */
export async function importIntoProject(files: Iterable<File>, opts: { placeInVideo?: boolean } = {}) {
  const s = useEditor.getState();
  s.setStatus("Importando…");
  const { assets, rejected } = await importFiles(files);
  s.addAssets(assets);
  if (opts.placeInVideo) {
    for (const a of assets) s.addClipFromAsset(a.id);
    s.select([]);
  }
  const ready = opts.placeInVideo ? "Añadido a la línea de tiempo" : `${assets.length} ${assets.length === 1 ? "archivo importado" : "archivos importados"}`;
  s.setStatus(rejected.length ? `No se pudo abrir: ${rejected.join(", ")}` : ready);
  return assets;
}

const KIND_ICON = { video: "film", audio: "music", image: "image" } as const;

export function MediaBin() {
  const assets = useEditor((s) => s.project.assets);
  const addClip = useEditor((s) => s.addClipFromAsset);
  const removeAsset = useEditor((s) => s.removeAssetFromProject);
  const visual = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [freeMusic, setFreeMusic] = useState(false);

  const add = (id: string) => {
    addClip(id);
    useEditor.getState().setStatus("Añadido a la línea de tiempo");
    useUi.getState().setSheet(null);
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void importIntoProject(e.target.files);
    e.target.value = "";
  };

  const visuals = assets.filter((a) => a.kind !== "audio");
  const sounds = assets.filter((a) => a.kind === "audio");

  const grid = (list: typeof assets) => (
    <div className="assets">
      {list.map((a) => (
        <div key={a.id} className="asset">
          <button
            className="asset-main"
            draggable
            onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id)}
            onClick={() => add(a.id)}
            title={`Añadir «${a.name}» a la línea de tiempo`}
          >
            <div className="thumb">
              {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <Icon name={KIND_ICON[a.kind]} size={22} />}
              {a.kind !== "image" && <span className="dur">{formatTime(a.duration).slice(0, 5)}</span>}
              <span className="add-badge">
                <Icon name="plus" size={14} />
              </span>
            </div>
            <div className="name">{a.name}</div>
          </button>
          <button
            className="asset-remove"
            aria-label={`Quitar ${a.name}`}
            title="Quitar del proyecto"
            onClick={() => {
              if (confirm(`¿Quitar «${a.name}» del proyecto? También se quitará de la línea de tiempo.`)) {
                removeAsset(a.id);
                void deleteAssetFile(a.id);
              }
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div
      className={`bin ${over ? "over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void importIntoProject(e.dataTransfer.files);
      }}
    >
      <input ref={visual} type="file" multiple hidden accept="video/*,image/*" onChange={onFiles} />
      <input ref={audio} type="file" multiple hidden accept="audio/*" onChange={onFiles} />

      <section className="bin-section">
        <div className="section-head">
          <button className="primary" onClick={() => visual.current?.click()}>
            <Icon name="upload" /> Importar
          </button>
        </div>
        {visuals.length ? grid(visuals) : <p className="muted small">Videos e imágenes. También puedes arrastrarlos aquí.</p>}
      </section>

      <section className="bin-section">
        <div className="section-head">
          <h2 className="panel-title">Música</h2>
        </div>
        <div className="split">
          <button onClick={() => audio.current?.click()}>
            <Icon name="upload" /> Del equipo
          </button>
          <button onClick={() => setFreeMusic(true)}>
            <Icon name="music" /> Música libre
          </button>
        </div>
        {sounds.length > 0 && grid(sounds)}
      </section>

      <p className="muted small">Los archivos se quedan en este equipo.</p>

      {freeMusic && (
        <FreeMusic
          onClose={() => setFreeMusic(false)}
          onImport={() => {
            setFreeMusic(false);
            audio.current?.click();
          }}
        />
      )}
    </div>
  );
}

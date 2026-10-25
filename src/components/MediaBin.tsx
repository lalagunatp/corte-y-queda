import { useRef, useState } from "react";
import { forgetAsset, importFiles } from "../media";
import { useEditor } from "../store";
import { COMPACT_QUERY, useMediaQuery, useUi } from "../ui";
import { formatTime } from "../util";

export const ASSET_DRAG_TYPE = "application/x-corte-y-queda-asset";

/** Importa archivos; con placeInVideo además los pone en la línea de tiempo, en orden. */
export async function importIntoProject(files: Iterable<File>, opts: { placeInVideo?: boolean } = {}) {
  const s = useEditor.getState();
  s.setStatus("Cargando archivos…");
  const { assets, rejected } = await importFiles(files);
  s.addAssets(assets);
  if (opts.placeInVideo) {
    for (const a of assets) s.addClipFromAsset(a.id);
    s.select([]);
  }
  const ready = opts.placeInVideo
    ? "✅ ¡Listo! Ya están en tu video."
    : assets.length === 1
      ? "✅ Archivo listo. Tócalo para ponerlo en tu video."
      : `✅ ${assets.length} archivos listos. Tócalos para ponerlos en tu video.`;
  s.setStatus(rejected.length ? `No se pudo abrir: ${rejected.join(", ")}` : ready);
  return assets;
}

const KIND_ICON = { video: "🎬", audio: "🎵", image: "🖼️" } as const;

export function MediaBin() {
  const assets = useEditor((s) => s.project.assets);
  const addClip = useEditor((s) => s.addClipFromAsset);
  const removeAsset = useEditor((s) => s.removeAssetFromProject);
  const visual = useRef<HTMLInputElement>(null);
  const music = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const compact = useMediaQuery(COMPACT_QUERY);

  const add = (id: string, name: string) => {
    addClip(id);
    useEditor.getState().setStatus(`➕ «${name}» añadido al final`);
    useUi.getState().setSheet(null);
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void importIntoProject(e.target.files);
    e.target.value = "";
  };

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
      {!compact && <h2 className="panel-title">📁 Mis archivos</h2>}
      <div className="bin-actions">
        <button className="primary big wide" onClick={() => visual.current?.click()}>
          🎬 Añadir videos y fotos
        </button>
        <button className="big wide" onClick={() => music.current?.click()}>
          🎵 Añadir música o sonidos
        </button>
      </div>
      <input ref={visual} type="file" multiple hidden accept="video/*,image/*" onChange={onFiles} />
      <input ref={music} type="file" multiple hidden accept="audio/*" onChange={onFiles} />

      {assets.length === 0 ? (
        <p className="hint center">También puedes arrastrar archivos aquí. Se quedan en tu equipo: no se suben a internet.</p>
      ) : (
        <p className="hint">Toca un archivo para ponerlo en tu video.</p>
      )}

      <div className="assets">
        {assets.map((a) => (
          <div key={a.id} className="asset">
            <button
              className="asset-main"
              draggable
              onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id)}
              onClick={() => add(a.id, a.name)}
              title={`Poner «${a.name}» en el video`}
            >
              <div className="thumb">
                {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <span className="icon">{KIND_ICON[a.kind]}</span>}
                {a.kind !== "image" && <span className="dur">{formatTime(a.duration).slice(0, 5)}</span>}
                <span className="add-badge">➕</span>
              </div>
              <div className="name">
                {KIND_ICON[a.kind]} {a.name}
              </div>
            </button>
            <button
              className="asset-remove"
              aria-label={`Quitar ${a.name}`}
              title="Quitar este archivo"
              onClick={() => {
                if (confirm(`¿Quitar «${a.name}»? También se quitará de tu video.`)) {
                  removeAsset(a.id);
                  forgetAsset(a.id);
                }
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

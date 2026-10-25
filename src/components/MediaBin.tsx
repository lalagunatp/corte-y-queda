import { useRef, useState } from "react";
import { forgetAsset, importFiles } from "../media";
import { useEditor } from "../store";
import { formatTime } from "../util";

export const ASSET_DRAG_TYPE = "application/x-corte-y-queda-asset";

export async function importIntoProject(files: Iterable<File>) {
  const s = useEditor.getState();
  s.setStatus("Importando…");
  const { assets, rejected } = await importFiles(files);
  s.addAssets(assets);
  s.setStatus(rejected.length ? `No se pudieron importar: ${rejected.join(", ")}` : `${assets.length} archivo(s) importado(s)`);
  return assets;
}

export function MediaBin() {
  const assets = useEditor((s) => s.project.assets);
  const addClip = useEditor((s) => s.addClipFromAsset);
  const removeAsset = useEditor((s) => s.removeAssetFromProject);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

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
      <button className="primary wide" onClick={() => input.current?.click()}>
        + Importar medios
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept="video/*,audio/*,image/*"
        onChange={(e) => {
          if (e.target.files) void importIntoProject(e.target.files);
          e.target.value = "";
        }}
      />
      {assets.length === 0 && <p className="hint">Arrastra vídeos, audios o imágenes aquí. Se quedan en tu equipo: nada se sube.</p>}
      <div className="assets">
        {assets.map((a) => (
          <div
            key={a.id}
            className="asset"
            draggable
            onDragStart={(e) => e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id)}
            onDoubleClick={() => addClip(a.id)}
            title={`${a.name}\nDoble clic o arrastra a la línea de tiempo`}
          >
            <div className="thumb">
              {a.thumbnail ? <img src={a.thumbnail} alt="" /> : <span className="icon">♪</span>}
              {a.kind !== "image" && <span className="dur">{formatTime(a.duration)}</span>}
            </div>
            <div className="name">{a.name}</div>
            <div className="asset-actions">
              <button onClick={() => addClip(a.id)} title="Añadir en la línea de tiempo">+</button>
              <button
                onClick={() => {
                  if (confirm(`¿Quitar "${a.name}" y sus clips del proyecto? Esto no se puede deshacer.`)) {
                    removeAsset(a.id);
                    forgetAsset(a.id);
                  }
                }}
                title="Quitar del proyecto"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

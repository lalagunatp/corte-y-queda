import { openExternal } from "../platform";
import { Icon } from "./Icon";

/** Bibliotecas de música sin coste. Las condiciones pueden cambiar: se recuerda revisarlas en cada pista. */
const SOURCES = [
  { name: "Pixabay Music", url: "https://pixabay.com/music/", license: "Licencia de Pixabay · sin atribución obligatoria" },
  { name: "Mixkit", url: "https://mixkit.co/free-stock-music/", license: "Licencia de Mixkit · uso gratuito" },
  { name: "YouTube Audio Library", url: "https://www.youtube.com/audiolibrary", license: "Algunas pistas piden atribución" },
  { name: "Free Music Archive", url: "https://freemusicarchive.org/", license: "Creative Commons · varía por pista" },
  { name: "Incompetech", url: "https://incompetech.com/music/royalty-free/music.html", license: "CC BY · requiere atribución" },
  { name: "ccMixter", url: "https://ccmixter.org/", license: "Creative Commons · suele requerir atribución" },
  { name: "Uppbeat", url: "https://uppbeat.io/", license: "Plan gratuito con límite mensual" },
];

export function FreeMusic({ onClose, onImport }: { onClose(): void; onImport(): void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Música libre">
        <div className="modal-head">
          <h2>Música libre</h2>
          <button className="ghost" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>
        <p className="muted">Descarga una pista desde uno de estos sitios y luego impórtala.</p>
        <ul className="sources">
          {SOURCES.map((s) => (
            <li key={s.name}>
              <button className="source" onClick={() => void openExternal(s.url)}>
                <span>
                  <b>{s.name}</b>
                  <small>{s.license}</small>
                </span>
                <Icon name="external" size={16} />
              </button>
            </li>
          ))}
        </ul>
        <details>
          <summary>Sobre las licencias</summary>
          <ul className="notes">
            <li><b>CC0 / dominio público:</b> uso libre, sin atribución.</li>
            <li><b>CC BY:</b> indica autor y licencia en la descripción del video.</li>
            <li><b>NC:</b> no apta para videos comerciales o monetizados.</li>
            <li><b>ND:</b> no permite editar la pista; mejor evitarla.</li>
            <li>Confirma las condiciones en la página de cada pista y guarda el enlace por si una plataforma reclama derechos.</li>
          </ul>
        </details>
        <div className="row-end">
          <button className="primary" onClick={onImport}>
            <Icon name="upload" /> Importar pista descargada
          </button>
        </div>
      </div>
    </div>
  );
}

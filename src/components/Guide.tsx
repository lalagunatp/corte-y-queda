import { useState } from "react";
import { markGuideSeen } from "../ui";
import { Icon, type IconName } from "./Icon";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "upload", title: "1. Añade tus archivos", text: "Toca «Importar» para elegir videos, fotos o música. Aparecen abajo, en la línea de tiempo, uno detrás de otro." },
  { icon: "scissors", title: "2. Ordena y corta", text: "Arrastra un clip para moverlo. Tira de sus bordes para acortarlo. Pon la línea verde donde quieras y toca «Cortar» para partirlo en dos." },
  { icon: "sliders", title: "3. Dale tu estilo", text: "Toca un clip y abre «Editar»: filtros, velocidad, volumen, quitar ruido y recortar pausas de la voz. Si te equivocas, toca «Deshacer»." },
  { icon: "captions", title: "4. Textos y subtítulos", text: "Con «Texto» escribes encima del video. En «Subtítulos» la app puede escribir sola lo que se dice." },
  { icon: "mic", title: "5. Ponle voz", text: "En «Narrar» una voz lee tus subtítulos o lo que escribas. Puedes darle otra voz a cada frase, como si hablaran varias personas." },
  { icon: "export", title: "6. Guarda tu video", text: "Toca «Exportar» y tu video se guarda como un archivo que puedes compartir. Sin marca de agua y sin subir nada a internet." },
];

/** El tutorial completo (public/tutorial.html), dentro de la app para que funcione también sin conexión. */
function Tutorial({ onBack }: { onBack(): void }) {
  return (
    <div className="modal-back" onClick={onBack}>
      <div className="modal tutorial" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Tutorial completo">
        <div className="modal-head">
          <button className="ghost" onClick={onBack}>
            <Icon name="back-arrow" /> Volver a la guía
          </button>
        </div>
        <iframe src={`${import.meta.env.BASE_URL}tutorial.html`} title="Tutorial de Corte y Queda" />
      </div>
    </div>
  );
}

export function Guide({ onClose }: { onClose(): void }) {
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const step = STEPS[i];
  const close = () => {
    markGuideSeen();
    onClose();
  };
  if (full) return <Tutorial onBack={() => setFull(false)} />;
  return (
    <div className="modal-back" onClick={close}>
      <div className="modal guide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cómo funciona">
        <div className="guide-icon">
          <Icon name={step.icon} size={28} />
        </div>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        <div className="dots">
          {STEPS.map((_, n) => (
            <button key={n} className={n === i ? "on" : ""} onClick={() => setI(n)} aria-label={`Paso ${n + 1}`} />
          ))}
        </div>
        <button className="ghost" onClick={() => setFull(true)}>
          <Icon name="help" size={16} /> Ver el tutorial completo
        </button>
        <div className="row-end">
          {i > 0 ? (
            <button className="ghost" onClick={() => setI(i - 1)}>Atrás</button>
          ) : (
            <button className="ghost" onClick={close}>Saltar</button>
          )}
          {i < STEPS.length - 1 ? (
            <button className="primary" onClick={() => setI(i + 1)}>Siguiente</button>
          ) : (
            <button className="primary" onClick={close}>¡A editar!</button>
          )}
        </div>
      </div>
    </div>
  );
}

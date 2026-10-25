import { useState } from "react";
import { markGuideSeen } from "../ui";
import { Icon, type IconName } from "./Icon";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "media", title: "Importa", text: "Añade videos, imágenes y música desde Medios. Toca un archivo para llevarlo a la línea de tiempo." },
  { icon: "scissors", title: "Edita", text: "Arrastra los clips para ordenarlos, tira de sus bordes para recortarlos y usa Cortar para dividirlos." },
  { icon: "sliders", title: "Ajusta", text: "Selecciona un clip y abre Editar: filtros, velocidad, volumen, textos y subtítulos automáticos." },
  { icon: "export", title: "Exporta", text: "Genera un MP4 sin marca de agua. Todo se procesa y se guarda en tu equipo." },
];

export function Guide({ onClose }: { onClose(): void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const close = () => {
    markGuideSeen();
    onClose();
  };
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
        <div className="row-end">
          <button className="ghost" onClick={close}>Omitir</button>
          {i < STEPS.length - 1 ? (
            <button className="primary" onClick={() => setI(i + 1)}>Siguiente</button>
          ) : (
            <button className="primary" onClick={close}>Empezar</button>
          )}
        </div>
      </div>
    </div>
  );
}

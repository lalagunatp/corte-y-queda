import { useState } from "react";
import { markGuideSeen } from "../ui";

const STEPS = [
  {
    icon: "📁",
    title: "1. Trae tus videos y fotos",
    text: "Toca «Mis archivos» y luego «Añadir videos y fotos». Toca un archivo para ponerlo en tu video.",
  },
  {
    icon: "✂️",
    title: "2. Ordénalos abajo",
    text: "Abajo está la línea de tiempo. Arrastra los trozos para moverlos. Usa ✂️ Cortar para partir y 🗑️ Borrar para quitar.",
  },
  {
    icon: "🎨",
    title: "3. Ponle tu estilo",
    text: "Toca un trozo y luego «Editar»: filtros, velocidad 🐢🐇, música, textos y subtítulos automáticos ✨.",
  },
  {
    icon: "💾",
    title: "4. Guarda tu video",
    text: "Cuando te guste, toca 💾 Guardar video. Todo se queda en tu equipo: no hace falta cuenta.",
  },
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
      <div className="modal guide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Cómo se usa">
        <div className="guide-icon">{step.icon}</div>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        <div className="dots">
          {STEPS.map((_, n) => (
            <button key={n} className={n === i ? "on" : ""} onClick={() => setI(n)} aria-label={`Paso ${n + 1}`} />
          ))}
        </div>
        <div className="row-end">
          {i > 0 && <button className="big" onClick={() => setI(i - 1)}>Atrás</button>}
          {i < STEPS.length - 1 ? (
            <button className="primary big" onClick={() => setI(i + 1)}>Siguiente</button>
          ) : (
            <button className="primary big" onClick={close}>¡A crear! 🚀</button>
          )}
        </div>
      </div>
    </div>
  );
}

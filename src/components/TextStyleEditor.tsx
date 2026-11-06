import { useEffect, useRef } from "react";
import { drawText } from "../engine/compositor";
import { DEFAULT_TEXT_STYLE, applyCase, cssFont, FONTS, TEXT_PRESETS, WEIGHT_LABELS, alphaOf, fontDef, isClear, nearestWeight, presetPatch, withAlpha } from "../text";
import type { TextClip, TextStyle } from "../types";
import { Segmented, Slider, Toggle } from "./controls";

const PALETTE = ["#ffffff", "#111111", "#9ca3af", "#facc15", "#fb923c", "#f87171", "#e11d48", "#f472b6", "#a78bfa", "#60a5fa", "#22d3ee", "#4ade80"];

const CATEGORIES = [...new Set(FONTS.map((f) => f.category))];

/** Primera palabra del texto para las miniaturas (corta, para que quepa). */
export const sampleOf = (text: string) => {
  const word = text.trim().split(/\s+/)[0] ?? "";
  return word && word.length <= 9 ? word : "Texto";
};

const percent = (v: number) => `${Math.round(v * 100)}`;

/** Miniatura dibujada con el mismo código que el video, así se ve exactamente igual. */
function StylePreview({ style, sample }: { style: TextStyle; sample: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Las fuentes anchas se achican para que la palabra entera quepa en la miniatura.
      ctx.font = cssFont({ ...style, fontSize: 34 });
      const wide = ctx.measureText(applyCase(sample, style.textCase)).width * (1 + style.letterSpacing * 1.5);
      const clip: TextClip = {
        ...style,
        fontSize: Math.min(34, (34 * canvas.width * 0.82) / Math.max(1, wide)),
        rotation: 0,
        opacity: 1,
        id: "preview",
        type: "text",
        trackId: "",
        start: 0,
        duration: 1,
        fadeIn: 0,
        fadeOut: 0,
        text: sample,
        x: 0,
        y: 0,
      };
      drawText(ctx, canvas, clip, 0.5);
    };
    draw();
    // Las fuentes llegan de a poco; se redibuja cuando termina de cargar alguna.
    document.fonts?.addEventListener("loadingdone", draw);
    return () => document.fonts?.removeEventListener("loadingdone", draw);
  }, [style, sample]);
  return <canvas ref={ref} width={220} height={96} className="style-thumb" />;
}

function ColorRow({ value, onPick, label }: { value: string; onPick(c: string): void; label: string }) {
  const hex = value.slice(0, 7).toLowerCase();
  return (
    <div className="swatches">
      {PALETTE.map((c) => (
        <button key={c} className={`swatch ${hex === c ? "on" : ""}`} style={{ background: c }} onClick={() => onPick(c)} aria-label={`${label} ${c}`} />
      ))}
      <input type="color" value={hex} onChange={(e) => onPick(e.target.value)} aria-label={`${label}: otro color`} title="Otro color" />
    </div>
  );
}

const SHADOWS: { label: string; patch(s: TextStyle): Partial<TextStyle> }[] = [
  { label: "Ninguna", patch: () => ({ shadowColor: "#00000000" }) },
  { label: "Suave", patch: () => ({ shadowColor: "#00000099", shadowBlur: 0.12, shadowX: 0, shadowY: 0 }) },
  { label: "Dura", patch: () => ({ shadowColor: "#000000ff", shadowBlur: 0, shadowX: 0.05, shadowY: 0.05 }) },
  { label: "Brillo", patch: (s) => ({ shadowColor: withAlpha(s.color, 1), shadowBlur: 0.35, shadowX: 0, shadowY: 0 }) },
];

function shadowKind(s: TextStyle): number | null {
  const i = SHADOWS.findIndex((o) => {
    const p = o.patch(s);
    return (Object.keys(p) as (keyof TextStyle)[]).every((k) => k === "shadowColor" ? (isClear(s.shadowColor) && isClear(p.shadowColor!)) || s.shadowColor === p.shadowColor : s[k] === p[k]);
  });
  return i < 0 ? null : i;
}

/**
 * Todas las opciones de tipografía de un texto o de los subtítulos. El tamaño y la posición
 * los pone cada panel, porque los atajos son distintos.
 */
export function TextStyleEditor({ value, onChange, sample = "Texto" }: { value: TextStyle; onChange(patch: Partial<TextStyle>): void; sample?: string }) {
  const font = fontDef(value.font);
  const bgOn = !isClear(value.background);
  const shadowOn = !isClear(value.shadowColor);
  const preset = TEXT_PRESETS.findIndex((p) => {
    const patch = presetPatch(p.style);
    return (Object.keys(patch) as (keyof TextStyle)[]).every((k) => patch[k] === value[k]);
  });
  return (
    <>
      <section className="group">
        <h4>Estilos rápidos</h4>
        <div className="style-presets">
          {TEXT_PRESETS.map((p, i) => (
            <button key={p.name} className={`style-preset ${preset === i ? "on" : ""}`} onClick={() => onChange(presetPatch(p.style))}>
              <StylePreview style={{ ...DEFAULT_TEXT_STYLE, ...presetPatch(p.style) }} sample={sample} />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="group">
        <h4>Fuente</h4>
        <div className="font-list">
          {CATEGORIES.map((cat) => (
            <div key={cat} className="font-cat">
              <small>{cat}</small>
              {FONTS.filter((f) => f.category === cat).map((f) => (
                <button
                  key={f.id}
                  className={`font-option ${f.id === value.font ? "on" : ""}`}
                  style={{ fontFamily: `${f.family}, sans-serif` }}
                  onClick={() => onChange({ font: f.id, weight: nearestWeight(f, value.weight) })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        {font.weights.length > 1 && (
          <Segmented
            value={nearestWeight(font, value.weight)}
            onPick={(weight) => onChange({ weight })}
            options={font.weights.map((w) => ({ value: w, label: WEIGHT_LABELS[w] ?? String(w) }))}
          />
        )}
        <Segmented
          value={value.textCase}
          onPick={(textCase) => onChange({ textCase })}
          options={[
            { value: "none", label: "Aa" },
            { value: "upper", label: "AA" },
            { value: "lower", label: "aa" },
            { value: "title", label: "Título" },
          ]}
        />
        <Segmented
          value={value.decoration}
          onPick={(decoration) => onChange({ decoration })}
          options={[
            { value: "none", label: "Normal" },
            { value: "underline", label: "Subrayado" },
            { value: "strike", label: "Tachado" },
          ]}
        />
        <Toggle on={value.italic} label="Cursiva" onChange={(italic) => onChange({ italic })} />
      </section>

      <section className="group">
        <h4>Alineación</h4>
        <Segmented
          value={value.align}
          onPick={(align) => onChange({ align })}
          options={[
            { value: "left", label: "Izquierda" },
            { value: "center", label: "Centro" },
            { value: "right", label: "Derecha" },
          ]}
        />
      </section>

      <section className="group">
        <h4>Color</h4>
        <ColorRow value={value.color} label="Color" onPick={(color) => onChange({ color })} />
        <Toggle on={value.gradient != null} label="Degradado" onChange={(v) => onChange({ gradient: v ? "#f43f5e" : null })} />
        {value.gradient != null && <ColorRow value={value.gradient} label="Color final" onPick={(gradient) => onChange({ gradient })} />}
      </section>

      <section className="group">
        <Toggle on={value.strokeWidth > 0} label="Contorno" onChange={(v) => onChange({ strokeWidth: v ? 0.06 : 0 })} />
        {value.strokeWidth > 0 && (
          <>
            <ColorRow value={value.strokeColor} label="Contorno" onPick={(strokeColor) => onChange({ strokeColor })} />
            <Slider label="Grosor" value={value.strokeWidth} min={0.01} max={0.25} step={0.005} format={percent} unit="%" onChange={(strokeWidth) => onChange({ strokeWidth })} />
          </>
        )}
      </section>

      <section className="group">
        <h4>Sombra</h4>
        <Segmented value={shadowKind(value)} onPick={(i) => onChange(SHADOWS[i].patch(value))} options={SHADOWS.map((o, i) => ({ value: i, label: o.label }))} />
        {shadowOn && (
          <details>
            <summary>Ajustar sombra</summary>
            <ColorRow value={value.shadowColor} label="Sombra" onPick={(c) => onChange({ shadowColor: withAlpha(c, alphaOf(value.shadowColor)) })} />
            <Slider label="Opacidad" value={alphaOf(value.shadowColor)} min={0.05} max={1} step={0.01} format={percent} unit="%" onChange={(a) => onChange({ shadowColor: withAlpha(value.shadowColor, a) })} />
            <Slider label="Desenfoque" value={value.shadowBlur} min={0} max={0.6} step={0.01} format={percent} unit="%" onChange={(shadowBlur) => onChange({ shadowBlur })} />
            <Slider label="Horizontal" value={value.shadowX} min={-0.2} max={0.2} step={0.005} format={percent} unit="%" onChange={(shadowX) => onChange({ shadowX })} />
            <Slider label="Vertical" value={value.shadowY} min={-0.2} max={0.2} step={0.005} format={percent} unit="%" onChange={(shadowY) => onChange({ shadowY })} />
          </details>
        )}
      </section>

      <section className="group">
        <Toggle on={bgOn} label="Fondo" onChange={(v) => onChange({ background: v ? "#000000aa" : "#00000000" })} />
        {bgOn && (
          <>
            <ColorRow value={value.background} label="Fondo" onPick={(c) => onChange({ background: withAlpha(c, alphaOf(value.background)) })} />
            <Slider label="Opacidad" value={alphaOf(value.background)} min={0.05} max={1} step={0.01} format={percent} unit="%" onChange={(a) => onChange({ background: withAlpha(value.background, a) })} />
            <Segmented
              value={value.bgShape}
              onPick={(bgShape) => onChange({ bgShape })}
              options={[
                { value: "block", label: "Un bloque" },
                { value: "lines", label: "Por renglón" },
              ]}
            />
            <Slider label="Redondeo" value={value.bgRadius} min={0} max={1} step={0.01} format={percent} unit="%" onChange={(bgRadius) => onChange({ bgRadius })} />
            <Slider label="Relleno" value={value.bgPadding} min={0} max={1} step={0.01} format={percent} unit="%" onChange={(bgPadding) => onChange({ bgPadding })} />
          </>
        )}
      </section>

      <details className="group">
        <summary>Espaciado y giro</summary>
        <Slider label="Letras" value={value.letterSpacing} min={-0.1} max={0.5} step={0.005} format={percent} unit="%" onChange={(letterSpacing) => onChange({ letterSpacing })} />
        <Slider label="Renglones" value={value.lineHeight} min={0.8} max={2.5} step={0.05} unit="×" onChange={(lineHeight) => onChange({ lineHeight })} />
        <Slider label="Opacidad" value={value.opacity} min={0.05} max={1} step={0.01} format={percent} unit="%" onChange={(opacity) => onChange({ opacity })} />
        <Slider label="Giro" value={value.rotation} min={-180} max={180} step={1} unit="°" onChange={(rotation) => onChange({ rotation })} />
      </details>
    </>
  );
}

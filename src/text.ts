// Tipografías incluidas en la app (funcionan sin conexión y se ven igual en todos los equipos).
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/900.css";
import "@fontsource-variable/rubik";
import "@fontsource-variable/oswald";
import "@fontsource/bebas-neue";
import "@fontsource/anton";
import "@fontsource/archivo-black";
import "@fontsource/bangers";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/lora";
import "@fontsource-variable/roboto-slab";
import "@fontsource-variable/cinzel";
import "@fontsource/lobster";
import "@fontsource/pacifico";
import "@fontsource-variable/dancing-script";
import "@fontsource-variable/caveat";
import "@fontsource/permanent-marker";
import "@fontsource-variable/roboto-mono";
import "@fontsource/press-start-2p";
import "@fontsource/righteous";
import type { TextClip, TextStyle } from "./types";

export interface FontDef {
  id: string;
  label: string;
  family: string;
  category: "Modernas" | "Impacto" | "Clásicas" | "Manuscritas" | "Especiales";
  /** Grosores que la fuente trae de verdad (los demás el navegador los inventa y se ven mal). */
  weights: number[];
}

export const FONTS: FontDef[] = [
  { id: "system", label: "Sistema", family: '"Segoe UI", system-ui, sans-serif', category: "Modernas", weights: [400, 500, 700] },
  { id: "inter", label: "Inter", family: '"Inter Variable"', category: "Modernas", weights: [300, 400, 500, 700, 900] },
  { id: "montserrat", label: "Montserrat", family: '"Montserrat Variable"', category: "Modernas", weights: [300, 400, 500, 700, 900] },
  { id: "poppins", label: "Poppins", family: "Poppins", category: "Modernas", weights: [400, 700, 900] },
  { id: "rubik", label: "Rubik", family: '"Rubik Variable"', category: "Modernas", weights: [300, 400, 500, 700, 900] },
  { id: "oswald", label: "Oswald", family: '"Oswald Variable"', category: "Impacto", weights: [300, 400, 500, 700] },
  { id: "bebas", label: "Bebas Neue", family: '"Bebas Neue"', category: "Impacto", weights: [400] },
  { id: "anton", label: "Anton", family: "Anton", category: "Impacto", weights: [400] },
  { id: "archivo-black", label: "Archivo Black", family: '"Archivo Black"', category: "Impacto", weights: [400] },
  { id: "bangers", label: "Bangers", family: "Bangers", category: "Impacto", weights: [400] },
  { id: "playfair", label: "Playfair", family: '"Playfair Display Variable"', category: "Clásicas", weights: [400, 700, 900] },
  { id: "lora", label: "Lora", family: '"Lora Variable"', category: "Clásicas", weights: [400, 500, 700] },
  { id: "roboto-slab", label: "Roboto Slab", family: '"Roboto Slab Variable"', category: "Clásicas", weights: [300, 400, 500, 700, 900] },
  { id: "cinzel", label: "Cinzel", family: '"Cinzel Variable"', category: "Clásicas", weights: [400, 700, 900] },
  { id: "lobster", label: "Lobster", family: "Lobster", category: "Manuscritas", weights: [400] },
  { id: "pacifico", label: "Pacifico", family: "Pacifico", category: "Manuscritas", weights: [400] },
  { id: "dancing", label: "Dancing Script", family: '"Dancing Script Variable"', category: "Manuscritas", weights: [400, 700] },
  { id: "caveat", label: "Caveat", family: '"Caveat Variable"', category: "Manuscritas", weights: [400, 700] },
  { id: "marker", label: "Marcador", family: '"Permanent Marker"', category: "Manuscritas", weights: [400] },
  { id: "righteous", label: "Righteous", family: "Righteous", category: "Especiales", weights: [400] },
  { id: "mono", label: "Roboto Mono", family: '"Roboto Mono Variable"', category: "Especiales", weights: [300, 400, 700] },
  { id: "pixel", label: "Pixel", family: '"Press Start 2P"', category: "Especiales", weights: [400] },
];

export const WEIGHT_LABELS: Record<number, string> = { 300: "Fina", 400: "Normal", 500: "Media", 700: "Negrita", 900: "Gruesa" };

export const fontDef = (id: string): FontDef => FONTS.find((f) => f.id === id) ?? FONTS[0];

/** Grosor disponible en la fuente más cercano al pedido. */
export const nearestWeight = (font: FontDef, w: number) =>
  font.weights.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), font.weights[0]);

/** Cadena `font` del canvas para un estilo. */
export function cssFont(s: Pick<TextStyle, "font" | "weight" | "italic" | "fontSize">): string {
  const f = fontDef(s.font);
  return `${s.italic ? "italic " : ""}${nearestWeight(f, s.weight)} ${s.fontSize}px ${f.family}, sans-serif`;
}

export const isClear = (color: string) => /^#[0-9a-f]{6}00$/i.test(color);

/** Color #rrggbb con opacidad 0..1 → #rrggbbaa. */
export const withAlpha = (hex: string, a: number) =>
  `${hex.slice(0, 7)}${Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, "0")}`;

export const alphaOf = (hex: string) => (hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1);

export const TEXT_STYLE_KEYS = [
  "font",
  "fontSize",
  "weight",
  "italic",
  "decoration",
  "textCase",
  "align",
  "letterSpacing",
  "lineHeight",
  "color",
  "gradient",
  "strokeColor",
  "strokeWidth",
  "shadowColor",
  "shadowBlur",
  "shadowX",
  "shadowY",
  "background",
  "bgShape",
  "bgPadding",
  "bgRadius",
  "opacity",
  "rotation",
] as const satisfies readonly (keyof TextStyle)[];

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: "system",
  fontSize: 72,
  weight: 700,
  italic: false,
  decoration: "none",
  textCase: "none",
  align: "center",
  letterSpacing: 0,
  lineHeight: 1.2,
  color: "#ffffff",
  gradient: null,
  strokeColor: "#000000",
  strokeWidth: 0,
  shadowColor: "#00000099",
  shadowBlur: 0.12,
  shadowX: 0,
  shadowY: 0,
  background: "#00000000",
  bgShape: "block",
  bgPadding: 0.3,
  bgRadius: 0,
  opacity: 1,
  rotation: 0,
};

export function pickStyle(c: TextStyle): TextStyle {
  const out = {} as Record<string, unknown>;
  for (const k of TEXT_STYLE_KEYS) out[k] = c[k];
  return out as unknown as TextStyle;
}

/**
 * Completa un texto guardado con una versión anterior (solo tenía tamaño, color, fondo y negrita).
 * Antes la sombra suave se ponía sola cuando no había fondo; se conserva ese aspecto.
 */
export function normalizeText(c: TextClip & { bold?: boolean }): TextClip {
  if (c.font !== undefined) return c;
  const { bold, ...rest } = c;
  const hasBg = !isClear(c.background);
  return {
    ...DEFAULT_TEXT_STYLE,
    ...rest,
    weight: bold === false ? 500 : 700,
    shadowColor: hasBg ? "#00000000" : DEFAULT_TEXT_STYLE.shadowColor,
  };
}

export function applyCase(text: string, c: TextStyle["textCase"]): string {
  if (c === "upper") return text.toLocaleUpperCase("es");
  if (c === "lower") return text.toLocaleLowerCase("es");
  if (c === "title") return text.toLocaleLowerCase("es").replace(/(^|[\s¿¡"(])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase("es"));
  return text;
}

/** Estilos rápidos: cambian el aspecto, pero no el tamaño ni la posición. */
export const TEXT_PRESETS: { name: string; style: Partial<TextStyle> }[] = [
  { name: "Clásico", style: { font: "system", weight: 700, color: "#ffffff", strokeWidth: 0, shadowColor: "#00000099", shadowBlur: 0.12, shadowX: 0, shadowY: 0, background: "#00000000" } },
  { name: "Redes", style: { font: "montserrat", weight: 900, textCase: "upper", color: "#ffffff", strokeColor: "#000000", strokeWidth: 0.08, shadowColor: "#00000000", background: "#00000000" } },
  { name: "Resaltado", style: { font: "poppins", weight: 700, color: "#111111", strokeWidth: 0, shadowColor: "#00000000", background: "#ffffffff", bgShape: "lines", bgPadding: 0.3, bgRadius: 0.35 } },
  { name: "Caja", style: { font: "inter", weight: 500, color: "#ffffff", strokeWidth: 0, shadowColor: "#00000000", background: "#000000aa", bgShape: "block", bgPadding: 0.35, bgRadius: 0.2 } },
  { name: "Amarillo", style: { font: "anton", weight: 400, textCase: "upper", color: "#facc15", strokeColor: "#000000", strokeWidth: 0.07, shadowColor: "#000000aa", shadowBlur: 0, shadowX: 0.04, shadowY: 0.05, background: "#00000000" } },
  { name: "Neón", style: { font: "righteous", weight: 400, color: "#ffffff", strokeColor: "#ec4899", strokeWidth: 0.03, shadowColor: "#ec4899ff", shadowBlur: 0.35, shadowX: 0, shadowY: 0, background: "#00000000" } },
  { name: "Cine", style: { font: "cinzel", weight: 700, letterSpacing: 0.12, color: "#f5f0e6", strokeWidth: 0, shadowColor: "#000000cc", shadowBlur: 0.2, shadowX: 0, shadowY: 0.03, background: "#00000000" } },
  { name: "Elegante", style: { font: "playfair", weight: 400, italic: true, color: "#ffffff", strokeWidth: 0, shadowColor: "#00000080", shadowBlur: 0.15, shadowX: 0, shadowY: 0, background: "#00000000" } },
  { name: "Cómic", style: { font: "bangers", weight: 400, letterSpacing: 0.04, color: "#ffffff", gradient: null, strokeColor: "#111111", strokeWidth: 0.09, shadowColor: "#111111ff", shadowBlur: 0, shadowX: 0.06, shadowY: 0.06, background: "#00000000" } },
  { name: "Atardecer", style: { font: "poppins", weight: 900, color: "#fde047", gradient: "#f43f5e", strokeWidth: 0, shadowColor: "#00000080", shadowBlur: 0.1, shadowX: 0, shadowY: 0.03, background: "#00000000" } },
  { name: "Manuscrito", style: { font: "caveat", weight: 700, color: "#ffffff", strokeWidth: 0, shadowColor: "#00000099", shadowBlur: 0.12, shadowX: 0, shadowY: 0, background: "#00000000" } },
  { name: "Retro", style: { font: "pixel", weight: 400, textCase: "upper", color: "#4ade80", strokeWidth: 0, shadowColor: "#000000ff", shadowBlur: 0, shadowX: 0.06, shadowY: 0.06, background: "#00000000" } },
  { name: "Etiqueta", style: { font: "bebas", weight: 400, letterSpacing: 0.05, color: "#ffffff", strokeWidth: 0, shadowColor: "#00000000", background: "#e11d48ff", bgShape: "lines", bgPadding: 0.25, bgRadius: 0 } },
  { name: "Máquina", style: { font: "mono", weight: 400, color: "#e5e7eb", strokeWidth: 0, shadowColor: "#00000000", background: "#111111dd", bgShape: "block", bgPadding: 0.4, bgRadius: 0.1 } },
];

/** Pide al navegador las fuentes que usan los textos para que el canvas pueda dibujarlas. */
export function loadFonts(texts: TextClip[]): Promise<unknown> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  const byFont = new Map<string, string>();
  for (const t of texts) {
    const key = cssFont({ ...t, fontSize: 16 });
    byFont.set(key, (byFont.get(key) ?? "") + applyCase(t.text, t.textCase));
  }
  return Promise.all([...byFont].map(([font, sample]) => document.fonts.load(font, sample || "Aa").catch(() => [])));
}

/** Lo que cambia un estilo rápido: parte del estilo base para no arrastrar restos del anterior. */
export function presetPatch(style: Partial<TextStyle>): Partial<TextStyle> {
  const { fontSize: _size, rotation: _rot, opacity: _op, ...base } = DEFAULT_TEXT_STYLE;
  return { ...base, ...style };
}

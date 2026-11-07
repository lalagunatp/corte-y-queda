export type MediaKind = "video" | "audio" | "image";

export interface MediaAsset {
  id: string;
  name: string;
  kind: MediaKind;
  /** Duración en segundos; las imágenes usan 0 (duración libre en la línea de tiempo). */
  duration: number;
  width: number;
  height: number;
  /** Miniatura en data URL (vídeo e imagen). */
  thumbnail: string | null;
  /** Audio creado por la app (narración): no se lista en Archivos y se borra cuando nada lo usa. */
  generated?: "narration";
}

export type TrackKind = "video" | "audio" | "text";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  /** Pista dedicada: la de texto de los subtítulos o la de audio de la narración. */
  role?: "subtitles" | "narration";
}

/** Una línea de subtítulo independiente del estilo, como en un archivo SRT. */
export interface SubtitleLine {
  start: number;
  end: number;
  text: string;
}

interface ClipBase {
  id: string;
  trackId: string;
  /** Posición en la línea de tiempo (s). */
  start: number;
  /** Duración en la línea de tiempo (s). */
  duration: number;
  fadeIn: number;
  fadeOut: number;
}

export interface Transform {
  /** Desplazamiento relativo al centro, en fracción del lienzo (-1..1). */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface MediaClip extends ClipBase, Transform {
  type: "media";
  assetId: string;
  /** Punto de entrada dentro del archivo fuente (s). */
  inPoint: number;
  speed: number;
  volume: number;
  brightness: number;
  contrast: number;
  saturation: number;
  /** Cadena de limpieza de voz (paso alto, paso bajo y compresor). */
  voiceClean: boolean;
  /** Si el audio es una narración: lo necesario para volver a leerla con otra voz o texto. */
  narration?: Narration;
}

export interface Narration {
  text: string;
  /** Id de la voz (ver VOICES en ai/voices.ts). */
  voice: string;
  speed: number;
  /** Subtítulo que lee, en el modo «leer los subtítulos». */
  lineId?: string;
}

export interface TextStyle {
  /** Id de la fuente (ver FONTS en text.ts). */
  font: string;
  fontSize: number;
  weight: number;
  italic: boolean;
  decoration: "none" | "underline" | "strike";
  textCase: "none" | "upper" | "lower" | "title";
  align: "left" | "center" | "right";
  /** Espacio extra entre letras, en fracción del tamaño. */
  letterSpacing: number;
  /** Alto de línea, en múltiplos del tamaño. */
  lineHeight: number;
  color: string;
  /** Segundo color para un degradado vertical; null = color liso. */
  gradient: string | null;
  strokeColor: string;
  /** Grosor del contorno en fracción del tamaño; 0 = sin contorno. */
  strokeWidth: number;
  /** #rrggbbaa; con alfa 00 no hay sombra. */
  shadowColor: string;
  /** Desenfoque y desplazamiento de la sombra, en fracción del tamaño. */
  shadowBlur: number;
  shadowX: number;
  shadowY: number;
  /** #rrggbbaa; con alfa 00 no hay fondo. */
  background: string;
  /** Un recuadro para todo el bloque o uno por renglón. */
  bgShape: "block" | "lines";
  /** Relleno del fondo en fracción del tamaño. */
  bgPadding: number;
  /** Redondeo del fondo, 0..1 (1 = píldora). */
  bgRadius: number;
  opacity: number;
  rotation: number;
}

export interface TextClip extends ClipBase, TextStyle {
  type: "text";
  text: string;
  x: number;
  y: number;
}

export type Clip = MediaClip | TextClip;

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  tracks: Track[];
  clips: Clip[];
  assets: MediaAsset[];
}

export const ASPECTS: { label: string; width: number; height: number }[] = [
  { label: "16:9", width: 1920, height: 1080 },
  { label: "9:16", width: 1080, height: 1920 },
  { label: "1:1", width: 1080, height: 1080 },
  { label: "4:5", width: 1080, height: 1350 },
];

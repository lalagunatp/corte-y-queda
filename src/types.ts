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
}

export type TrackKind = "video" | "audio" | "text";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
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
}

export interface TextClip extends ClipBase {
  type: "text";
  text: string;
  fontSize: number;
  color: string;
  background: string;
  bold: boolean;
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

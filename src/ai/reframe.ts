import { type Detection, FaceDetector, ObjectDetector } from "@mediapipe/tasks-vision";
import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from "mediabunny";
import { assetBlob } from "../media";
import { SHOT_JUMP } from "../engine/compositor";
import type { MediaClip, Reframe } from "../types";

/**
 * Reencuadre automático (como el «intelligent crop» de CapCut): detecta a la persona en el video
 * y calcula un recorrido de cámara suave que la mantiene en el centro. Todo en el equipo, con
 * MediaPipe y modelos incluidos en la app (sin descargas).
 */

/** Fotogramas analizados por segundo: suficiente para seguir a alguien y rápido de calcular. */
const SAMPLE_FPS = 4;
/** Ancho al que se reduce cada fotograma para detectar. */
const DETECT_WIDTH = 512;
/** Suavizado (media exponencial hacia delante y hacia atrás, sin retraso); menos = más tranquilo. */
const SMOOTH = 0.18;

const modelUrl = (name: string) => new URL(`models/${name}`, document.baseURI).href;

let detectors: Promise<{ face: FaceDetector; person: ObjectDetector }> | null = null;

function loadDetectors() {
  detectors ??= (async () => {
    const fileset = { wasmLoaderPath, wasmBinaryPath };
    const options = (model: string) => ({ baseOptions: { modelAssetPath: modelUrl(model), delegate: "GPU" as const }, runningMode: "VIDEO" as const });
    const [face, person] = await Promise.all([
      FaceDetector.createFromOptions(fileset, { ...options("blaze_face_short_range.tflite"), minDetectionConfidence: 0.5 }),
      ObjectDetector.createFromOptions(fileset, { ...options("efficientdet_lite0.tflite"), categoryAllowlist: ["person"], scoreThreshold: 0.4, maxResults: 5 }),
    ]);
    return { face, person };
  })();
  detectors.catch(() => (detectors = null));
  return detectors;
}

interface Subject {
  x: number;
  y: number;
  area: number;
}

/** Centro de interés de una detección, en fracción de la imagen. De una persona, la cabeza. */
function subjectOf(d: Detection, w: number, h: number, kind: "face" | "person"): Subject | null {
  const b = d.boundingBox;
  if (!b) return null;
  const x = (b.originX + b.width / 2) / w;
  const y = kind === "face" ? (b.originY + b.height / 2) / h : (b.originY + b.height * 0.25) / h;
  return { x, y, area: (b.width * b.height) / (w * h) };
}

/** La persona más grande, con preferencia por la que ya se seguía (no salta entre caras). */
function pick(found: Subject[], previous: Subject | null): Subject | null {
  let best: Subject | null = null;
  let bestScore = -Infinity;
  for (const s of found) {
    const near = previous ? 1 - Math.min(1, Math.hypot(s.x - previous.x, s.y - previous.y) * 1.5) : 1;
    const score = s.area * (0.5 + near);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/** Media exponencial hacia delante y hacia atrás: suave y sin ir por detrás del movimiento. */
function smooth(values: number[]): number[] {
  const fwd = [...values];
  for (let i = 1; i < fwd.length; i++) fwd[i] = fwd[i - 1] + SMOOTH * (fwd[i] - fwd[i - 1]);
  for (let i = fwd.length - 2; i >= 0; i--) fwd[i] = fwd[i + 1] + SMOOTH * (fwd[i] - fwd[i + 1]);
  return fwd;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Recorrido suave a partir de las detecciones; los huecos sin persona mantienen el último encuadre. */
export function buildPath(times: number[], raw: (Subject | null)[]): Reframe {
  const firstSeen = raw.find((s) => s) ?? { x: 0.5, y: 0.5, area: 0 };
  let last: Subject = firstSeen;
  const filled = raw.map((s) => (last = s ?? last));
  // Mediana de 5 muestras: quita detecciones sueltas erróneas.
  const xs = filled.map((_, i) => median(filled.slice(Math.max(0, i - 2), i + 3).map((s) => s.x)));
  const ys = filled.map((_, i) => median(filled.slice(Math.max(0, i - 2), i + 3).map((s) => s.y)));
  const points: Reframe["points"] = [];
  let from = 0;
  for (let i = 1; i <= xs.length; i++) {
    if (i < xs.length && Math.abs(xs[i] - xs[i - 1]) < SHOT_JUMP) continue;
    // Cada plano se suaviza por separado: en un corte de escena la cámara salta, no se desliza.
    const sx = smooth(xs.slice(from, i));
    const sy = smooth(ys.slice(from, i));
    for (let j = 0; j < sx.length; j++) points.push([times[from + j], round(sx[j]), round(sy[j])]);
    from = i;
  }
  return { points };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Analiza el tramo del clip y devuelve el recorrido del encuadre (en tiempo del archivo). */
export async function analyzeReframe(c: MediaClip, opts: { signal: AbortSignal; onProgress(fraction: number, stage: string): void }): Promise<Reframe> {
  opts.onProgress(0, "Preparando la detección de personas");
  const { face, person } = await loadDetectors();
  const blob = assetBlob(c.assetId);
  if (!blob) throw new Error("Falta el archivo de este clip.");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("Este clip no tiene imagen.");
    const span = c.duration * c.speed;
    const count = Math.max(2, Math.ceil(span * SAMPLE_FPS) + 1);
    const times = Array.from({ length: count }, (_, i) => c.inPoint + Math.min(span, i / SAMPLE_FPS));
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const raw: (Subject | null)[] = [];
    let previous: Subject | null = null;
    let i = 0;
    for await (const sample of new VideoSampleSink(track).samplesAtTimestamps(times)) {
      if (opts.signal.aborted) {
        sample?.close();
        throw new DOMException("Cancelado", "AbortError");
      }
      if (sample) {
        canvas.width = DETECT_WIDTH;
        canvas.height = Math.round((DETECT_WIDTH * sample.displayHeight) / sample.displayWidth);
        sample.draw(ctx, 0, 0, canvas.width, canvas.height);
        sample.close();
        const ts = Math.round(times[i] * 1000) + i;
        let found = face.detectForVideo(canvas, ts).detections.map((d) => subjectOf(d, canvas.width, canvas.height, "face"));
        // Sin cara visible (de espaldas, lejos): la persona entera.
        if (!found.some(Boolean)) found = person.detectForVideo(canvas, ts).detections.map((d) => subjectOf(d, canvas.width, canvas.height, "person"));
        const chosen = pick(found.filter((s): s is Subject => !!s), previous);
        raw.push(chosen);
        if (chosen) previous = chosen;
      } else raw.push(null);
      i++;
      if (i % 8 === 0) {
        opts.onProgress(i / count, "Buscando a la persona");
        // Deja respirar a la interfaz entre tandas.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (!raw.some(Boolean)) throw new Error("No se encontró a ninguna persona en este clip.");
    return buildPath(times.slice(0, raw.length), raw);
  } finally {
    input.dispose();
  }
}

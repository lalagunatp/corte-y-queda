import { ALL_FORMATS, BlobSource, Input, type VideoSample, VideoSampleSink } from "mediabunny";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { assetBlob, assetUrl } from "../media";
import type { MediaClip, Project } from "../types";
import { isActive, projectDuration } from "../util";
import { MIX_RATE, mixProjectAudio } from "./audioMix";
import { type FrameSource, drawFrame, sourceTime } from "./compositor";

export type ExportQuality = "normal" | "alta" | "maxima";
/** HEVC pesa la mitad con la misma calidad; H.264 se reproduce en cualquier equipo. */
export type ExportCodec = "hevc" | "avc";

export interface ExportOptions {
  /** Alto de salida; el ancho se deriva de la relación de aspecto del proyecto. */
  height: number;
  fps: number;
  quality: ExportQuality;
  codec: ExportCodec;
  signal: AbortSignal;
  onProgress(fraction: number, stage: string): void;
}

export interface ExportResult {
  blob: Blob;
  /** Cómo se codificó, para mostrarlo y para medir. */
  encoder: { codec: ExportCodec; hardware: boolean; mode: "quantizer" | "variable" };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Calidad constante (cuantizador, como el CRF de x264): cada escena recibe los bits que
 * necesita, así que lo simple pesa poco sin bajar la calidad de lo complejo; menos es más
 * calidad. Calibrado contra el exportador anterior (H.264 a 0.12 bits/píxel, ≈45.8 dB PSNR
 * sobre un video real de 2:23 en 1080p): «alta» lo iguala, y en HEVC con la mitad del peso.
 */
const QUANTIZER: Record<ExportCodec, Record<ExportQuality, number>> = {
  hevc: { normal: 23, alta: 19, maxima: 16 },
  avc: { normal: 19, alta: 15, maxima: 12 },
};

/** Si el equipo no admite calidad constante: tasa variable, en bits por píxel y fotograma. */
const BITS_PER_PIXEL: Record<ExportCodec, Record<ExportQuality, number>> = {
  hevc: { normal: 0.04, alta: 0.06, maxima: 0.09 },
  avc: { normal: 0.08, alta: 0.12, maxima: 0.18 },
};

/** Un fotograma clave cada 5 s: menos peso que cada 2 s y la misma calidad. */
const KEYFRAME_SECONDS = 5;

/** AAC a 160 kbps estéreo: indistinguible del original para voz y música. */
const AUDIO_BITRATE = 160_000;

/** Cadena de códec con un nivel que cubre la resolución y la frecuencia de cuadro. */
function codecString(codec: ExportCodec, width: number, height: number, fps: number): string {
  const rate = width * height * fps;
  if (codec === "avc") {
    // Perfil High; niveles 4.0, 4.2, 5.1 y 5.2.
    const level = rate <= 1920 * 1088 * 30 ? "28" : rate <= 1920 * 1088 * 60 ? "2a" : rate <= 4096 * 2304 * 30 ? "33" : "34";
    return `avc1.6400${level}`;
  }
  // Perfil Main; niveles 4.0, 4.1, 5.0 y 5.1.
  const level = rate <= 2048 * 1088 * 30 ? "L120" : rate <= 2048 * 1088 * 60 ? "L123" : rate <= 4096 * 2304 * 30 ? "L150" : "L153";
  return `hvc1.1.6.${level}.B0`;
}

const formatConfig = (codec: ExportCodec) => (codec === "avc" ? { avc: { format: "avc" as const } } : { hevc: { format: "hevc" as const } });

/** Elige la configuración más rápida y eficiente que el equipo admite, por orden de preferencia. */
async function chooseEncoder(codec: ExportCodec, width: number, height: number, fps: number, quality: ExportQuality) {
  const base: VideoEncoderConfig = { codec: codecString(codec, width, height, fps), width, height, framerate: fps, ...formatConfig(codec) };
  const bitrate = Math.round(width * height * fps * BITS_PER_PIXEL[codec][quality]);
  const candidates: { config: VideoEncoderConfig; hardware: boolean; mode: "quantizer" | "variable" }[] = [
    { config: { ...base, bitrateMode: "quantizer", hardwareAcceleration: "prefer-hardware" }, hardware: true, mode: "quantizer" },
    { config: { ...base, bitrateMode: "variable", bitrate, hardwareAcceleration: "prefer-hardware" }, hardware: true, mode: "variable" },
    { config: { ...base, bitrateMode: "quantizer" }, hardware: false, mode: "quantizer" },
    { config: { ...base, bitrateMode: "variable", bitrate }, hardware: false, mode: "variable" },
  ];
  for (const c of candidates) {
    const support = await VideoEncoder.isConfigSupported(c.config).catch(() => null);
    if (support?.supported) return { ...c, codec };
  }
  return null;
}

/** Si el equipo puede exportar en HEVC a este tamaño (normalmente, con codificador por hardware). */
export async function supportsHevc(width: number, height: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  return (await chooseEncoder("hevc", width, height, fps, "alta")) !== null;
}

/**
 * Lee los fotogramas de un clip de video decodificándolos de corrido (cada paquete una sola
 * vez), en lugar de saltar con el reproductor a cada instante. Medido: saltar fotograma a
 * fotograma era la mayor parte del tiempo de exportación.
 */
class ClipFrames {
  private iterator: AsyncGenerator<VideoSample | null, void, unknown>;
  private last: VideoSample | null = null;

  constructor(sink: VideoSampleSink, timestamps: number[]) {
    this.iterator = sink.samplesAtTimestamps(timestamps);
  }

  /** Fotograma del siguiente instante pedido; repite el anterior si el archivo no tiene uno. */
  async next(): Promise<VideoSample | null> {
    const r = await this.iterator.next();
    const sample = r.done ? null : r.value;
    if (sample) {
      this.last?.close();
      this.last = sample;
    }
    return this.last;
  }

  async close() {
    this.last?.close();
    this.last = null;
    await this.iterator.return(undefined);
  }
}

/** Exporta el proyecto a MP4 (H.264 + AAC) íntegramente en el equipo, sin marca de agua. */
export async function exportMp4(p: Project, opts: ExportOptions): Promise<ExportResult> {
  if (typeof VideoEncoder === "undefined") throw new Error("Este navegador no admite la exportación de video. Usa Chrome, Edge o la app de escritorio.");
  const duration = projectDuration(p);
  if (duration <= 0) throw new Error("El proyecto está vacío.");

  const height = even(opts.height);
  const width = even((p.width / p.height) * height);
  const fps = opts.fps;
  const scale = height / p.height;
  const total = Math.ceil(duration * fps);

  // Si HEVC no está disponible, H.264 con la misma calidad (solo pesa más).
  const encoder =
    (opts.codec === "hevc" ? await chooseEncoder("hevc", width, height, fps, opts.quality) : null) ??
    (await chooseEncoder("avc", width, height, fps, opts.quality));
  if (!encoder) throw new Error(`El codificador de video no admite ${width}×${height}. Prueba una resolución menor.`);
  const audioConfig: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: MIX_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE };
  const hasAudioEncoder = typeof AudioEncoder !== "undefined" && (await AudioEncoder.isConfigSupported(audioConfig)).supported;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: encoder.codec, width, height, frameRate: fps },
    ...(hasAudioEncoder ? { audio: { codec: "aac" as const, numberOfChannels: 2, sampleRate: MIX_RATE } } : {}),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let failure: unknown = null;
  const video = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  video.configure(encoder.config);

  // --- Audio ---
  if (hasAudioEncoder) {
    opts.onProgress(0, "Mezclando audio");
    const mix = await mixProjectAudio(p, duration);
    const audio = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => (failure = e),
    });
    audio.configure(audioConfig);
    const frames = 1024;
    const left = mix.getChannelData(0);
    const right = mix.getChannelData(1);
    for (let i = 0; i < mix.length; i += frames) {
      const n = Math.min(frames, mix.length - i);
      const data = new Float32Array(n * 2);
      data.set(left.subarray(i, i + n), 0);
      data.set(right.subarray(i, i + n), n);
      const ad = new AudioData({
        format: "f32-planar",
        sampleRate: MIX_RATE,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((i / MIX_RATE) * 1e6),
        data,
      });
      audio.encode(ad);
      ad.close();
    }
    await audio.flush();
    audio.close();
  }

  // --- Vídeo ---
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const assets = new Map(p.assets.map((a) => [a.id, a]));
  const inputs = new Map<string, Promise<Input>>();
  const readers = new Map<string, Promise<ClipFrames | null>>();
  const images = new Map<string, Promise<HTMLImageElement>>();

  const inputFor = (assetId: string) => {
    let i = inputs.get(assetId);
    if (!i) {
      const blob = assetBlob(assetId);
      if (!blob) throw new Error("Falta el archivo de un clip.");
      i = Promise.resolve(new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }));
      inputs.set(assetId, i);
    }
    return i;
  };

  // Cada clip pide de una vez todos sus instantes, en orden, para decodificar de corrido.
  const readerFor = (c: MediaClip) => {
    let r = readers.get(c.id);
    if (!r) {
      r = (async () => {
        const track = await (await inputFor(c.assetId)).getPrimaryVideoTrack();
        if (!track) return null;
        const assetDuration = assets.get(c.assetId)?.duration ?? Infinity;
        const timestamps: number[] = [];
        for (let i = 0; i < total; i++) {
          const t = i / fps;
          if (isActive(c, t)) timestamps.push(Math.min(sourceTime(c, t), assetDuration - 0.001));
        }
        return new ClipFrames(new VideoSampleSink(track), timestamps);
      })();
      readers.set(c.id, r);
    }
    return r;
  };

  const imageFor = (id: string) => {
    let img = images.get(id);
    if (!img) {
      img = (async () => {
        const el = new Image();
        el.src = assetUrl(id) ?? "";
        await el.decode();
        return el;
      })();
      images.set(id, img);
    }
    return img;
  };

  const keyEvery = Math.round(fps * KEYFRAME_SECONDS);
  const encodeOptions = (keyFrame: boolean): VideoEncoderEncodeOptions =>
    encoder.mode === "quantizer"
      ? ({ keyFrame, [encoder.codec]: { quantizer: QUANTIZER[encoder.codec][opts.quality] } } as VideoEncoderEncodeOptions)
      : { keyFrame };

  // Imágenes de todos los clips visibles en el fotograma i; los clips se decodifican en paralelo.
  const gather = async (i: number) => {
    const t = i / fps;
    const sources = new Map<string, FrameSource>();
    await Promise.all(
      p.clips.map(async (c) => {
        if (c.type !== "media" || !isActive(c, t)) return;
        const asset = assets.get(c.assetId);
        if (asset?.kind === "video") {
          const sample = await (await readerFor(c))?.next();
          if (sample) sources.set(c.id, sample);
        } else if (asset?.kind === "image") {
          sources.set(c.id, await imageFor(c.assetId));
        }
      }),
    );
    return sources;
  };
  // Espera a que el codificador tenga sitio con su propio evento, sin temporizadores (que Chrome
  // retrasa hasta 1 s cuando la ventana no está en primer plano).
  const room = () => new Promise<void>((r) => video.addEventListener("dequeue", () => r(), { once: true }));

  try {
    let pending = gather(0);
    for (let i = 0; i < total; i++) {
      if (opts.signal.aborted) throw new DOMException("Exportación cancelada", "AbortError");
      if (failure) throw failure;
      const t = i / fps;
      const sources = await pending;
      // El siguiente fotograma se decodifica mientras este se dibuja y se codifica.
      if (i + 1 < total) pending = gather(i + 1);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawFrame(ctx, p, t, (c) => sources.get(c.id) ?? null);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
      video.encode(frame, encodeOptions(i % keyEvery === 0));
      frame.close();
      // Mantiene el codificador ocupado sin acumular demasiados fotogramas en memoria.
      while (video.encodeQueueSize > 16) await room();
      if (i % 10 === 0) opts.onProgress(i / total, "Renderizando");
    }
    await video.flush();
    if (failure) throw failure;
  } finally {
    if (video.state !== "closed") video.close();
    for (const r of readers.values()) await (await r)?.close();
    for (const i of inputs.values()) (await i).dispose();
  }
  muxer.finalize();
  opts.onProgress(1, "Listo");
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), encoder: { codec: encoder.codec, hardware: encoder.hardware, mode: encoder.mode } };
}

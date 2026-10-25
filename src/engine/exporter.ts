import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { assetUrl } from "../media";
import type { MediaClip, Project } from "../types";
import { isActive, projectDuration } from "../util";
import { MIX_RATE, mixProjectAudio } from "./audioMix";
import { type FrameSource, drawFrame, sourceTime } from "./compositor";

export interface ExportOptions {
  /** Alto de salida; el ancho se deriva de la relación de aspecto del proyecto. */
  height: number;
  fps: number;
  /** Bits por segundo del vídeo. */
  bitrate: number;
  signal: AbortSignal;
  onProgress(fraction: number, stage: string): void;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function avcCodec(width: number, height: number): string {
  // Perfil High; el nivel debe cubrir el área de la imagen (4.0 hasta 1080p, 5.1 hasta 4K).
  return width * height > 2048 * 1088 ? "avc1.640033" : "avc1.640028";
}

function seek(el: HTMLVideoElement, t: number): Promise<void> {
  if (Math.abs(el.currentTime - t) < 0.001 && el.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    el.addEventListener("seeked", () => resolve(), { once: true });
    el.currentTime = t;
  });
}

/** Exporta el proyecto a MP4 (H.264 + AAC) íntegramente en el equipo, sin marca de agua. */
export async function exportMp4(p: Project, opts: ExportOptions): Promise<Blob> {
  if (typeof VideoEncoder === "undefined") throw new Error("Este navegador no tiene WebCodecs. Usa Chrome, Edge o la app de escritorio.");
  const duration = projectDuration(p);
  if (duration <= 0) throw new Error("El proyecto está vacío.");

  const height = even(opts.height);
  const width = even((p.width / p.height) * height);
  const fps = opts.fps;
  const scale = height / p.height;

  const videoConfig: VideoEncoderConfig = {
    codec: avcCodec(width, height),
    width,
    height,
    bitrate: opts.bitrate,
    framerate: fps,
    avc: { format: "avc" },
  };
  if (!(await VideoEncoder.isConfigSupported(videoConfig)).supported) {
    throw new Error(`El codificador H.264 no admite ${width}×${height}. Prueba una resolución menor.`);
  }
  const audioConfig: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: MIX_RATE, numberOfChannels: 2, bitrate: 192_000 };
  const hasAudioEncoder = typeof AudioEncoder !== "undefined" && (await AudioEncoder.isConfigSupported(audioConfig)).supported;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height, frameRate: fps },
    ...(hasAudioEncoder ? { audio: { codec: "aac" as const, numberOfChannels: 2, sampleRate: MIX_RATE } } : {}),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  let failure: unknown = null;
  const video = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  video.configure(videoConfig);

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
  const ctx = canvas.getContext("2d", { willReadFrequently: false })!;
  const elements = new Map<string, HTMLVideoElement>();
  const images = new Map<string, HTMLImageElement>();
  const assets = new Map(p.assets.map((a) => [a.id, a]));

  const loadVideo = async (c: MediaClip) => {
    let el = elements.get(c.id);
    if (!el) {
      el = document.createElement("video");
      el.muted = true;
      el.preload = "auto";
      el.src = assetUrl(c.assetId) ?? "";
      elements.set(c.id, el);
      await new Promise<void>((r) => el!.addEventListener("loadeddata", () => r(), { once: true }));
    }
    return el;
  };
  const loadImage = async (id: string) => {
    let img = images.get(id);
    if (!img) {
      img = new Image();
      img.src = assetUrl(id) ?? "";
      await img.decode();
      images.set(id, img);
    }
    return img;
  };

  const total = Math.ceil(duration * fps);
  const keyEvery = fps * 2;
  try {
    for (let i = 0; i < total; i++) {
      if (opts.signal.aborted) throw new DOMException("Exportación cancelada", "AbortError");
      if (failure) throw failure;
      const t = i / fps;
      const sources = new Map<string, FrameSource>();
      for (const c of p.clips) {
        if (c.type !== "media" || !isActive(c, t)) continue;
        const asset = assets.get(c.assetId);
        if (asset?.kind === "video") {
          const el = await loadVideo(c);
          await seek(el, Math.min(sourceTime(c, t), asset.duration - 0.001));
          sources.set(c.id, el);
        } else if (asset?.kind === "image") {
          sources.set(c.id, await loadImage(c.assetId));
        }
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawFrame(ctx, p, t, (c) => sources.get(c.id) ?? null);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
      video.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      // Evita acumular demasiados fotogramas pendientes en el codificador.
      while (video.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
      if (i % 5 === 0) opts.onProgress(i / total, "Renderizando vídeo");
    }
    await video.flush();
    if (failure) throw failure;
  } finally {
    if (video.state !== "closed") video.close();
    for (const el of elements.values()) {
      el.removeAttribute("src");
      el.load();
    }
  }
  muxer.finalize();
  opts.onProgress(1, "Listo");
  return new Blob([target.buffer], { type: "video/mp4" });
}

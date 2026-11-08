import { assetUrl } from "../media";
import type { MediaClip, Project } from "../types";
import { fadeFactor, isActive } from "../util";
import { type FrameSource, type Rect, drawFrame, sourceTime } from "./compositor";
import { DENOISE_RATE, WORKLET_DELAY, createDenoiseNode } from "./denoise";

interface Voice {
  el: HTMLMediaElement;
  gain: GainNode;
  /** Entrada de la cadena de limpieza; se conecta o se salta según voiceClean. */
  cleanIn: BiquadFilterNode;
  cleanOut: DynamicsCompressorNode;
  clean: boolean;
  assetId: string;
  source: MediaElementAudioSourceNode;
  /** Señal original, retrasada lo mismo que la limpia cuando se mezclan. */
  dryDelay: DelayNode;
  dry: GainNode;
  wet: GainNode;
  /** RNNoise en tiempo real; se crea la primera vez que el clip pide reducción de ruido. */
  denoiser: Promise<AudioWorkletNode> | null;
  denoiseReady: boolean;
}

/** Cadena de limpieza de voz compartida con la exportación. */
export function buildVoiceClean(ctx: BaseAudioContext): [BiquadFilterNode, DynamicsCompressorNode] {
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 90;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 9000;
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.gain.value = 3;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.15;
  hp.connect(lp).connect(presence).connect(comp);
  return [hp, comp];
}

/**
 * Motor de vista previa: un elemento multimedia por clip, sincronizado con el reloj del
 * proyecto, y el audio enrutado por Web Audio para volumen, fundidos y limpieza de voz.
 */
export class PreviewEngine {
  private voices = new Map<string, Voice>();
  private images = new Map<string, HTMLImageElement>();
  // RNNoise trabaja a 48 kHz; el navegador convierte a la frecuencia de la tarjeta de sonido.
  private audio = new AudioContext({ sampleRate: DENOISE_RATE });

  resumeAudio() {
    if (this.audio.state === "suspended") void this.audio.resume();
  }

  private voiceFor(c: MediaClip, kind: "video" | "audio"): Voice | null {
    let v = this.voices.get(c.id);
    if (v && v.assetId !== c.assetId) {
      this.drop(c.id);
      v = undefined;
    }
    if (v) return v;
    const url = assetUrl(c.assetId);
    if (!url) return null;
    const el = document.createElement(kind);
    el.preload = "auto";
    el.src = url;
    el.crossOrigin = "anonymous";
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    const source = this.audio.createMediaElementSource(el);
    const gain = this.audio.createGain();
    const [cleanIn, cleanOut] = buildVoiceClean(this.audio);
    const dryDelay = this.audio.createDelay(0.1);
    const dry = this.audio.createGain();
    const wet = this.audio.createGain();
    wet.gain.value = 0;
    source.connect(dryDelay).connect(dry).connect(gain);
    wet.connect(gain);
    gain.connect(this.audio.destination);
    v = { el, gain, cleanIn, cleanOut, clean: false, assetId: c.assetId, source, dryDelay, dry, wet, denoiser: null, denoiseReady: false };
    this.voices.set(c.id, v);
    return v;
  }

  private setClean(v: Voice, on: boolean) {
    if (v.clean === on) return;
    v.gain.disconnect();
    if (on) {
      v.gain.connect(v.cleanIn);
      v.cleanOut.connect(this.audio.destination);
    } else {
      v.cleanOut.disconnect();
      v.gain.connect(this.audio.destination);
    }
    v.clean = on;
  }

  /** Mezcla original y limpia según la intensidad; hasta que RNNoise carga, se oye el original. */
  private setDenoise(v: Voice, level: number) {
    if (level > 0 && !v.denoiser) {
      v.denoiser = createDenoiseNode(this.audio);
      v.denoiser
        .then((node) => {
          v.source.connect(node).connect(v.wet);
          v.denoiseReady = true;
        })
        .catch(() => {
          v.denoiser = null;
        });
    }
    const k = v.denoiseReady ? level : 0;
    v.wet.gain.value = k;
    v.dry.gain.value = 1 - k;
    v.dryDelay.delayTime.value = v.denoiseReady && level > 0 ? WORKLET_DELAY : 0;
  }

  private drop(id: string) {
    const v = this.voices.get(id);
    if (!v) return;
    v.el.pause();
    v.el.removeAttribute("src");
    v.el.load();
    v.gain.disconnect();
    v.cleanOut.disconnect();
    v.source.disconnect();
    void v.denoiser?.then((node) => {
      node.disconnect();
      node.port.postMessage("destroy");
    });
    this.voices.delete(id);
  }

  private image(assetId: string): HTMLImageElement | null {
    let img = this.images.get(assetId);
    if (!img) {
      const url = assetUrl(assetId);
      if (!url) return null;
      img = new Image();
      img.src = url;
      this.images.set(assetId, img);
    }
    return img;
  }

  /** Sincroniza los elementos con t y dibuja el fotograma. */
  render(ctx: CanvasRenderingContext2D, p: Project, t: number, playing: boolean, selected: string[] = []) {
    const assets = new Map(p.assets.map((a) => [a.id, a]));
    const tracks = new Map(p.tracks.map((tr) => [tr.id, tr]));
    const live = new Set<string>();

    for (const c of p.clips) {
      if (c.type !== "media") continue;
      const asset = assets.get(c.assetId);
      if (!asset || asset.kind === "image") continue;
      const track = tracks.get(c.trackId);
      const soon = t >= c.start - 1.5 && t < c.start + c.duration;
      if (!soon) continue;
      const v = this.voiceFor(c, asset.kind);
      if (!v) continue;
      live.add(c.id);
      const active = isActive(c, t);
      const target = active ? sourceTime(c, t) : c.inPoint;
      v.el.playbackRate = c.speed;
      const audible = active && !!track && !track.muted && !(track.kind === "video" && track.hidden);
      v.gain.gain.value = audible ? c.volume * fadeFactor(c, t) : 0;
      this.setClean(v, c.voiceClean);
      this.setDenoise(v, c.denoise ?? 0);
      if (playing && active) {
        if (v.el.paused) {
          v.el.currentTime = target;
          void v.el.play().catch(() => {});
        } else if (Math.abs(v.el.currentTime - target) > 0.25) {
          v.el.currentTime = target;
        }
      } else {
        if (!v.el.paused) v.el.pause();
        if (Math.abs(v.el.currentTime - target) > 0.015 && !v.el.seeking) v.el.currentTime = target;
      }
    }
    for (const id of [...this.voices.keys()]) if (!live.has(id)) this.drop(id);

    const boxes: { id: string; box: Rect }[] = [];
    drawFrame(
      ctx,
      p,
      t,
      (c): FrameSource | null => {
        const asset = assets.get(c.assetId);
        if (!asset) return null;
        if (asset.kind === "image") return this.image(c.assetId);
        const el = this.voices.get(c.id)?.el;
        return el instanceof HTMLVideoElement && el.readyState >= 2 ? el : null;
      },
      (c, box) => boxes.push({ id: c.id, box }),
    );
    this.textBoxes = boxes;

    // Marco del texto seleccionado: solo en la vista previa, nunca en la exportación.
    const scale = p.width / ctx.canvas.clientWidth || 1;
    for (const { id, box } of boxes) {
      if (!selected.includes(id)) continue;
      ctx.save();
      ctx.strokeStyle = "#3ecfb2";
      ctx.lineWidth = 2 * scale;
      ctx.setLineDash([6 * scale, 4 * scale]);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
  }

  private textBoxes: { id: string; box: Rect }[] = [];

  /** Texto visible bajo un punto del lienzo (coordenadas del proyecto); el de encima gana. */
  textAt(x: number, y: number): string | null {
    for (let i = this.textBoxes.length - 1; i >= 0; i--) {
      const { id, box } = this.textBoxes[i];
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return id;
    }
    return null;
  }

  dispose() {
    for (const id of [...this.voices.keys()]) this.drop(id);
    void this.audio.close();
  }
}

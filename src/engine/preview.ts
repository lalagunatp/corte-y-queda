import { assetUrl } from "../media";
import type { MediaClip, Project } from "../types";
import { fadeFactor, isActive } from "../util";
import { type FrameSource, drawFrame, sourceTime } from "./compositor";

interface Voice {
  el: HTMLMediaElement;
  gain: GainNode;
  /** Entrada de la cadena de limpieza; se conecta o se salta según voiceClean. */
  cleanIn: BiquadFilterNode;
  cleanOut: DynamicsCompressorNode;
  clean: boolean;
  assetId: string;
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
  private audio = new AudioContext();

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
    source.connect(gain);
    gain.connect(this.audio.destination);
    v = { el, gain, cleanIn, cleanOut, clean: false, assetId: c.assetId };
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

  private drop(id: string) {
    const v = this.voices.get(id);
    if (!v) return;
    v.el.pause();
    v.el.removeAttribute("src");
    v.el.load();
    v.gain.disconnect();
    v.cleanOut.disconnect();
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
  render(ctx: CanvasRenderingContext2D, p: Project, t: number, playing: boolean) {
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

    drawFrame(ctx, p, t, (c): FrameSource | null => {
      const asset = assets.get(c.assetId);
      if (!asset) return null;
      if (asset.kind === "image") return this.image(c.assetId);
      const el = this.voices.get(c.id)?.el;
      return el instanceof HTMLVideoElement && el.readyState >= 2 ? el : null;
    });
  }

  dispose() {
    for (const id of [...this.voices.keys()]) this.drop(id);
    void this.audio.close();
  }
}

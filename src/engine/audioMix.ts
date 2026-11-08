import { decodedAudio } from "../media";
import type { Project } from "../types";
import { denoisedAudio } from "./denoise";
import { buildVoiceClean } from "./preview";

export const MIX_RATE = 48000;

/** Mezcla todo el audio del proyecto en un buffer estéreo a 48 kHz. */
export async function mixProjectAudio(p: Project, duration: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * MIX_RATE)), MIX_RATE);
  const tracks = new Map(p.tracks.map((t) => [t.id, t]));
  const assets = new Map(p.assets.map((a) => [a.id, a]));
  for (const c of p.clips) {
    if (c.type !== "media") continue;
    const asset = assets.get(c.assetId);
    const track = tracks.get(c.trackId);
    if (!asset || asset.kind === "image" || !track || track.muted) continue;
    if (track.kind === "video" && track.hidden) continue;
    const buffer = await decodedAudio(c.assetId);
    if (!buffer) continue;

    const gain = ctx.createGain();
    // Sin ruido: la señal limpia (ya alineada) se mezcla con la original según la intensidad.
    const denoise = c.denoise ?? 0;
    const clean = denoise > 0 ? await denoisedAudio(c.assetId) : null;
    const layers: [AudioBuffer, number][] = clean ? [[clean, denoise], [buffer, 1 - denoise]] : [[buffer, 1]];
    for (const [data, level] of layers) {
      if (level <= 0) continue;
      const src = ctx.createBufferSource();
      src.buffer = data;
      src.playbackRate.value = c.speed;
      const mix = ctx.createGain();
      mix.gain.value = level;
      src.connect(mix).connect(gain);
      src.start(c.start, c.inPoint, c.duration * c.speed);
    }
    const g = gain.gain;
    const end = c.start + c.duration;
    g.setValueAtTime(c.fadeIn > 0 ? 0 : c.volume, c.start);
    if (c.fadeIn > 0) g.linearRampToValueAtTime(c.volume, c.start + c.fadeIn);
    if (c.fadeOut > 0) {
      g.setValueAtTime(c.volume, end - c.fadeOut);
      g.linearRampToValueAtTime(0, end);
    }
    if (c.voiceClean) {
      const [inNode, outNode] = buildVoiceClean(ctx);
      gain.connect(inNode);
      outNode.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }
  }
  return ctx.startRendering();
}

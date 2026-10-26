/// <reference lib="webworker" />
import { AutoModel, type AutomaticSpeechRecognitionPipeline, type PreTrainedModel, Tensor, pipeline } from "@huggingface/transformers";

/**
 * Subtítulos con reconocimiento de voz dentro del navegador (el audio nunca sale del equipo).
 *
 * Proceso (inspirado en WhisperX y en el formato por palabra de CapCut):
 * 1. Silero VAD marca dónde hay voz.
 * 2. Los tramos con voz se juntan, sin los silencios largos, en partes de ≤28 s.
 * 3. Whisper transcribe cada parte con tiempos por palabra.
 * 4. Los tiempos se devuelven al audio original, las líneas se arman con palabras completas
 *    y sus bordes se ajustan al inicio y fin reales de la voz.
 * Cada parte terminada se envía al momento para que el editor la muestre mientras reproduce.
 */
export interface CaptionRequest {
  /** Audio mono a 16 kHz del tramo del clip. */
  audio: Float32Array;
  language: string | null;
  model: string;
  /** Máximo de caracteres por línea (menor en formato vertical). */
  maxChars: number;
}

export interface CaptionLine {
  start: number;
  end: number;
  text: string;
}

export type CaptionMessage =
  | { type: "progress"; stage: string; fraction: number | null }
  /** Líneas listas de una parte; `until` es hasta qué segundo del audio ya está procesado. */
  | { type: "lines"; lines: CaptionLine[]; until: number }
  /** Descarta las líneas enviadas hasta ahora (se reintenta con otro motor). */
  | { type: "reset" }
  | { type: "done"; device: string; speech: number }
  | { type: "error"; message: string };

const RATE = 16000;
const VAD_FRAME = 512;
/** Whisper procesa ventanas de 30 s; se deja margen para el relleno entre tramos. */
const MAX_WINDOW = 24;
/** La primera parte es corta para que los primeros subtítulos (y la reproducción) lleguen antes. */
const FIRST_WINDOW = 10;
/** Silencio insertado entre tramos unidos, para que Whisper note la pausa. */
const JOIN_GAP = 0.3;
/** Margen de audio que se conserva antes y después de cada tramo con voz. */
const PAD = 0.25;
/**
 * Los tramos de voz separados por menos de esto se juntan en uno. Medido: juntar huecos de hasta
 * 1,5 s dejaba canto y habla en un mismo tramo, y Whisper se saltaba el habla tras la música.
 */
const MERGE_GAP = 0.3;
/** Distancia máxima para ajustar el borde de una línea al borde de la voz. */
const SNAP = 0.35;
/** Un borde que cae en silencio se lleva al borde de la voz si está a menos de esto. */
const SILENCE_FIX = 1.5;

const post = (m: CaptionMessage) => (self as DedicatedWorkerGlobalScope).postMessage(m);

/**
 * Variante del modelo por motor, medida con Whisper base sobre un tramo de 28 s:
 * - webgpu-f16: fp16/fp16, ~150 MB.
 * - webgpu: codificador fp32 + decodificador q4 (MatMulNBits corre en la GPU), ~205 MB.
 * - wasm: q8/q8, ~77 MB; en WebGPU esta variante era ~3 veces más lenta, por eso solo se usa en CPU.
 */
type Device = "webgpu-f16" | "webgpu" | "wasm";
const DTYPES: Record<Device, Record<string, string>> = {
  "webgpu-f16": { encoder_model: "fp16", decoder_model_merged: "fp16" },
  webgpu: { encoder_model: "fp32", decoder_model_merged: "q4" },
  wasm: { encoder_model: "q8", decoder_model_merged: "q8" },
};

// El worker vive entre usos: el modelo cargado se reutiliza y la segunda vez empieza al instante.
let asrCache: { key: string; asr: AutomaticSpeechRecognitionPipeline } | null = null;
let vadModel: PreTrainedModel | null = null;

async function bestDevice(): Promise<Device> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
  if (!adapter) return "wasm";
  return adapter.features.has("shader-f16") ? "webgpu-f16" : "webgpu";
}

function progressReporter(stage: string) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (e: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (e.status !== "progress" || !e.file || !e.total) return;
    files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
    let done = 0;
    let total = 0;
    for (const f of files.values()) {
      done += f.loaded;
      total += f.total;
    }
    // Los mismos eventos llegan al leer de la caché, así que el texto no presupone una descarga.
    if (total < 1e6) return;
    post({ type: "progress", stage: `${stage} · ${(done / 1e6).toFixed(0)} de ${(total / 1e6).toFixed(0)} MB`, fraction: done / total });
  };
}

async function loadAsr(model: string, device: Device): Promise<AutomaticSpeechRecognitionPipeline> {
  const key = `${model}|${device}`;
  if (asrCache?.key === key) return asrCache.asr;
  const asr = (await pipeline("automatic-speech-recognition", model, {
    device: device === "wasm" ? "wasm" : "webgpu",
    dtype: DTYPES[device] as never,
    progress_callback: progressReporter("Preparando el reconocimiento de voz") as never,
  })) as AutomaticSpeechRecognitionPipeline;
  asrCache = { key, asr };
  return asr;
}

/** Probabilidad de voz cada 32 ms con Silero VAD (modelo de 2 MB, en la CPU). */
async function speechProbabilities(audio: Float32Array): Promise<Float32Array> {
  vadModel ??= await AutoModel.from_pretrained("onnx-community/silero-vad", {
    config: { model_type: "custom" } as never,
    dtype: "fp32",
    device: "wasm",
  });
  const frames = Math.floor(audio.length / VAD_FRAME);
  const probs = new Float32Array(frames);
  const sr = new Tensor("int64", [BigInt(RATE)], []);
  let state = new Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  for (let i = 0; i < frames; i++) {
    const input = new Tensor("float32", audio.slice(i * VAD_FRAME, (i + 1) * VAD_FRAME), [1, VAD_FRAME]);
    const out = (await vadModel({ input, sr, state })) as { output: Tensor; stateN: Tensor };
    probs[i] = (out.output.data as Float32Array)[0];
    state = out.stateN;
    if (i % 400 === 0) post({ type: "progress", stage: "Detectando dónde se habla", fraction: i / frames });
  }
  return probs;
}

/** Tramos con voz (segundos) por histéresis: entra por encima de `enter`, sale tras 0,3 s bajo `exit`. */
function hysteresis(probs: Float32Array, enter: number, exit: number): [number, number][] {
  const step = VAD_FRAME / RATE;
  const raw: [number, number][] = [];
  let on = false;
  let start = 0;
  let below = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    if (!on && p > enter) {
      on = true;
      start = i;
      below = 0;
    } else if (on) {
      if (p < exit) {
        below++;
        if (below * step >= 0.3) {
          raw.push([start * step, (i - below + 1) * step]);
          on = false;
        }
      } else below = 0;
    }
  }
  if (on) raw.push([start * step, probs.length * step]);
  return raw.filter(([s, e]) => e - s >= 0.15);
}

/**
 * Dos lecturas de la misma detección, con funciones distintas:
 * - `voice` (umbrales estándar de Silero 0,5/0,35) marca los bordes reales para ajustar líneas.
 * - `regions` (más permisiva 0,4/0,25, con margen y sin quitar huecos cortos) decide qué audio
 *   se transcribe, para no perder voz baja. Medido: usarla para ajustar dejaba los finales ~0,4 s
 *   tarde; bajarla a 0,35/0,2 metía música de fondo y subía el total de 86 s a 107 s.
 */
function speechSegments(probs: Float32Array, duration: number): { voice: [number, number][]; regions: [number, number][] } {
  const voice = hysteresis(probs, 0.5, 0.35);
  const regions: [number, number][] = [];
  for (const [s, e] of hysteresis(probs, 0.4, 0.25)) {
    const a = Math.max(0, s - PAD);
    const b = Math.min(duration, e + PAD);
    const last = regions.at(-1);
    if (last && a - last[1] < MERGE_GAP) last[1] = b;
    else regions.push([a, b]);
  }
  return { voice, regions };
}

interface Piece {
  /** Inicio en el audio unido de la ventana. */
  joined: number;
  /** Inicio y fin en el audio original. */
  start: number;
  end: number;
  /** Audio ya transcrito que se repite solo como contexto; sus palabras se descartan. */
  context?: boolean;
}

/** Segundos de la parte anterior que se repiten al inicio de la siguiente como contexto. */
const CONTEXT = 4;

/**
 * Antepone a una parte los últimos segundos de la anterior. Medido: una parte que empezaba en
 * canto con música hacía que Whisper alucinara («J.J…») y perdiera las frases reales que
 * venían después; con habla previa como contexto se orienta como en una transcripción continua.
 */
function withContext(previous: Piece[] | undefined, pieces: Piece[]): Piece[] {
  const last = previous?.filter((p) => !p.context).at(-1);
  if (!last) return rebase(pieces);
  const ctx: Piece = { joined: 0, start: Math.max(last.start, last.end - CONTEXT), end: last.end, context: true };
  return rebase([ctx, ...pieces]);
}

/** Junta tramos con voz en ventanas de ≤28 s; un tramo más largo se parte en trozos. */
function packWindows(segments: [number, number][]): Piece[][] {
  const windows: Piece[][] = [];
  let cur: Piece[] = [];
  let len = 0;
  const flush = () => {
    if (cur.length) windows.push(cur);
    cur = [];
    len = 0;
  };
  for (const [s, e] of segments) {
    let from = s;
    while (from < e) {
      const gap = cur.length ? JOIN_GAP : 0;
      // La primera parte es corta, salvo que su primer tramo ya sea más largo (nunca se corta por eso).
      const limit = windows.length === 0 && cur.length > 0 ? FIRST_WINDOW : MAX_WINDOW;
      // Un tramo que no cabe pasa entero a la parte siguiente, para no cortar una frase.
      if (cur.length && len + gap + (e - from) > limit) {
        flush();
        continue;
      }
      // Solo un tramo continuo más largo que una parte entera se divide.
      const to = Math.min(e, from + MAX_WINDOW);
      cur.push({ joined: len + gap, start: from, end: to });
      len += gap + (to - from);
      from = to;
      if (from < e) flush();
    }
  }
  flush();
  return windows;
}

/** Nivel del relleno entre tramos (≈ −54 dB): inaudible pero distinto de cero. */
const FILL_LEVEL = 0.002;

function joinAudio(audio: Float32Array, pieces: Piece[]): Float32Array {
  const last = pieces.at(-1)!;
  const out = new Float32Array(Math.ceil((last.joined + (last.end - last.start)) * RATE));
  // El silencio digital absoluto (ceros exactos) hace que Whisper entre en un bucle de repetición
  // del que no sale (medido: >60 s sin terminar); un ruido muy bajo lo evita (19 s la misma parte).
  let seed = 12345;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (seed / 0x7fffffff - 0.5) * 2 * FILL_LEVEL;
  }
  for (const p of pieces) out.set(audio.subarray(Math.floor(p.start * RATE), Math.floor(p.end * RATE)), Math.floor(p.joined * RATE));
  return out;
}

/** Convierte un instante del audio unido al audio original (los huecos van al tramo más cercano). */
function toOriginal(t: number, pieces: Piece[]): { time: number; piece: Piece } {
  let best = pieces[0];
  for (const p of pieces) if (t >= p.joined - JOIN_GAP / 2) best = p;
  const local = Math.min(Math.max(t - best.joined, 0), best.end - best.start);
  return { time: best.start + local, piece: best };
}

interface Word {
  start: number;
  end: number;
  text: string;
  piece: Piece;
}

/**
 * Descarta líneas que Whisper inventa sobre música o ruido: casi sin letras («J .J.») o una
 * misma palabra repetida («¡Ach! ¡Ach! ¡Ach!»).
 */
function isSpoken(l: CaptionLine): boolean {
  const words = l.text.toLowerCase().match(/\p{L}+/gu) ?? [];
  // Al menos una palabra real: conserva «Sí.» o «No.», descarta letras sueltas.
  if (!words.some((w) => w.length >= 2)) return false;
  if (words.length >= 4 && new Set(words).size / words.length < 0.4) return false;
  return true;
}

/** Arma líneas con palabras completas: corta en pausas, puntuación, longitud o duración. */
function buildLines(words: Word[], maxChars: number): CaptionLine[] {
  type L = CaptionLine & { pieceEnd: Piece };
  const lines: L[] = [];
  let line: L | null = null;
  for (const w of words) {
    const breakHere =
      !line || w.start - line.end > 0.5 || w.piece !== line.pieceEnd || `${line.text} ${w.text}`.length > maxChars || w.end - line.start > 5.5;
    if (breakHere) {
      if (line) lines.push(line);
      line = { start: w.start, end: w.end, text: w.text, pieceEnd: w.piece };
    } else if (line) {
      line.end = w.end;
      line.text += ` ${w.text}`;
    }
    if (line && /[.!?…]["»”]?$/.test(w.text)) {
      lines.push(line);
      line = null;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Ajusta los bordes a la voz detectada, con duración mínima legible y sin solaparse. */
function snapLines(lines: CaptionLine[], voice: [number, number][], prevEnd: number): CaptionLine[] {
  const onsets = voice.map((v) => v[0]);
  const offsets = voice.map((v) => v[1]);
  const nearest = (t: number, list: number[]) => list.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best), Infinity);
  const inVoice = (t: number) => voice.some(([a, b]) => t >= a && t <= b);
  const out: CaptionLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Whisper tiende a dar los inicios unas décimas tarde y los finales alargados: el borde
    // real de la voz, si está cerca, es más fiable.
    const on = nearest(l.start, onsets);
    const off = nearest(l.end, offsets);
    let start = Math.abs(on - l.start) <= SNAP ? on : l.start;
    let end = Math.abs(off - l.end) <= SNAP ? off : l.end;
    // Regla de subtitulado: no empezar durante un silencio ni quedarse en pantalla en uno.
    // Medido: los finales de Whisper se alargaban ~0,5 s dentro del silencio.
    if (!inVoice(start)) {
      const next = onsets.find((x) => x > start && x - start <= SILENCE_FIX && x < end);
      if (next !== undefined) start = next;
    }
    if (!inVoice(end - 0.05)) {
      const prev = [...offsets].reverse().find((x) => x < end && end - x <= SILENCE_FIX && x > start + 0.3);
      if (prev !== undefined) end = prev;
    }
    start = Math.max(start, prevEnd);
    const next = lines[i + 1];
    if (end - start < 0.7) end = start + 0.7;
    if (next && end > next.start) end = Math.max(start + 0.3, next.start);
    if (end <= start) continue;
    out.push({ start, end, text: l.text });
    prevEnd = end;
  }
  return out;
}

/** Vuelve a colocar tramos uno tras otro desde cero, con el hueco de unión entre ellos. */
function rebase(pieces: Piece[]): Piece[] {
  let len = 0;
  return pieces.map((p, i) => {
    const joined = i ? len + JOIN_GAP : 0;
    len = joined + (p.end - p.start);
    return { ...p, joined };
  });
}

/** Salida degenerada de Whisper: muchas palabras casi todas iguales («J.J J.J J.J…»). */
function degenerate(words: Word[]): boolean {
  const tokens = words.flatMap((w) => w.text.toLowerCase().match(/\p{L}+/gu) ?? []);
  return tokens.length >= 8 && new Set(tokens).size / tokens.length < 0.35;
}

/**
 * Transcribe una parte con tiempos por palabra. Si la salida es degenerada (un trozo de música
 * arrastra a Whisper a un bucle que arruina también las frases reales de la parte), la parte se
 * divide por sus tramos y se reintenta; un tramo suelto que sigue degenerado se descarta.
 * Es la misma idea que el reintento de Whisper ante una «compression ratio» alta.
 */
async function transcribeWindow(
  asr: AutomaticSpeechRecognitionPipeline,
  req: CaptionRequest,
  pieces: Piece[],
  voice: [number, number][],
  solo = false,
): Promise<Word[]> {
  const out = await asr(joinAudio(req.audio, pieces), {
    return_timestamps: "word",
    // Sin `no_repeat_ngram_size`: medido, en vez de cortar un bucle lo convertía en variantes
    // («J.J.», «J.J», «J.J J.J»…) que ocupaban toda la parte y borraban las frases reales.
    // Tope de seguridad: 28 s de habla rápida rondan los 150 tokens.
    max_new_tokens: 224,
    ...(req.language ? { language: req.language, task: "transcribe" } : {}),
  } as never);
  const result = Array.isArray(out) ? out[0] : out;
  const words: Word[] = [];
  for (const c of (result.chunks ?? []) as { timestamp: [number, number | null]; text: string }[]) {
    const text = c.text.trim();
    // Fragmentos sin letras ni números («...», «-») no son palabras dichas.
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const a = toOriginal(c.timestamp[0], pieces);
    const b = toOriginal(c.timestamp[1] ?? c.timestamp[0] + 0.3, pieces);
    // Las palabras del contexto ya se transcribieron en la parte anterior.
    if (a.piece.context) continue;
    words.push({ start: a.time, end: Math.max(b.time, a.time + 0.05), text, piece: a.piece });
  }
  if (!degenerate(words)) {
    if (solo) return words;
    // Cobertura: un tramo con voz clara sin ninguna palabra (Whisper dio el texto por terminado
    // tras la música) se vuelve a transcribir solo.
    const voiced = (p: Piece) => voice.reduce((t, [a, b]) => t + Math.max(0, Math.min(b, p.end) - Math.max(a, p.start)), 0);
    const missing = pieces.filter((p) => !p.context && voiced(p) >= 0.8 && !words.some((w) => w.start >= p.start - 0.1 && w.start <= p.end + 0.1));
    for (const p of missing) words.push(...(await transcribeWindow(asr, req, rebase([p]), voice, true)));
    return words.sort((a, b) => a.start - b.start);
  }
  const context = pieces.filter((p) => p.context);
  const own = pieces.filter((p) => !p.context);
  let halves: [Piece[], Piece[]];
  if (own.length > 1) {
    const half = Math.ceil(own.length / 2);
    halves = [own.slice(0, half), own.slice(half)];
  } else {
    // Un tramo largo que mezcla voz y música se parte por su punto más silencioso.
    const p = own[0];
    if (!p || p.end - p.start < MIN_RETRY) return [];
    const cut = quietestPoint(req.audio, p.start + (p.end - p.start) * 0.3, p.start + (p.end - p.start) * 0.7);
    halves = [[{ ...p, end: cut }], [{ ...p, start: cut }]];
  }
  // Cada mitad conserva contexto: la primera el de la parte, la segunda el final de la primera.
  return [
    ...(await transcribeWindow(asr, req, rebase([...context, ...halves[0]]), voice, solo)),
    ...(await transcribeWindow(asr, req, withContext(halves[0], halves[1]), voice, solo)),
  ];
}

/** Por debajo de esto, un tramo que sigue saliendo degenerado se descarta (es música o ruido). */
const MIN_RETRY = 6;

/** Instante de menor energía (en ventanas de 20 ms) entre `from` y `to`, en segundos. */
function quietestPoint(audio: Float32Array, from: number, to: number): number {
  const frame = RATE / 50;
  let best = (from + to) / 2;
  let bestEnergy = Infinity;
  for (let i = Math.floor(from * RATE); i + frame <= to * RATE; i += frame) {
    let e = 0;
    for (let j = i; j < i + frame; j++) e += audio[j] * audio[j];
    if (e < bestEnergy) {
      bestEnergy = e;
      best = (i + frame / 2) / RATE;
    }
  }
  return best;
}

async function transcribe(req: CaptionRequest, device: Device): Promise<number> {
  const duration = req.audio.length / RATE;
  post({ type: "progress", stage: "Detectando dónde se habla", fraction: null });
  // El modelo de voz se carga mientras se detecta dónde se habla (en la GPU y la CPU a la vez).
  const asrReady = loadAsr(req.model, device);
  asrReady.catch(() => {});
  const { voice, regions } = speechSegments(await speechProbabilities(req.audio), duration);
  const speech = voice.reduce((t, [a, b]) => t + b - a, 0);
  if (!regions.length) return 0;

  post({ type: "progress", stage: "Preparando el reconocimiento de voz", fraction: null });
  const asr = await asrReady;
  const windows = packWindows(regions);
  let prevEnd = 0;
  let found = 0;
  for (let i = 0; i < windows.length; i++) {
    post({ type: "progress", stage: `Escuchando parte ${i + 1} de ${windows.length} · ${found} frases`, fraction: i / windows.length });
    const pieces = windows[i];
    const words = await transcribeWindow(asr, req, withContext(windows[i - 1], pieces), voice);
    const lines = snapLines(buildLines(words, req.maxChars).filter(isSpoken), voice, prevEnd);
    if (lines.length) prevEnd = lines.at(-1)!.end;
    found += lines.length;
    const until = pieces.at(-1)!.end;
    post({ type: "lines", lines, until: i === windows.length - 1 ? duration : until });
  }
  return speech;
}

self.onmessage = async (ev: MessageEvent<CaptionRequest>) => {
  const device = await bestDevice();
  try {
    const speech = await transcribe(ev.data, device);
    post({ type: "done", device, speech });
  } catch (first) {
    if (device === "wasm") {
      post({ type: "error", message: first instanceof Error ? first.message : String(first) });
      return;
    }
    // Algunas tarjetas o controladores fallan con WebGPU: se reintenta en la CPU.
    asrCache = null;
    post({ type: "reset" });
    try {
      post({ type: "progress", stage: "La aceleración gráfica falló; reintentando con el procesador", fraction: null });
      const speech = await transcribe(ev.data, "wasm");
      post({ type: "done", device: "wasm", speech });
    } catch (second) {
      post({ type: "error", message: second instanceof Error ? second.message : String(second) });
    }
  }
};

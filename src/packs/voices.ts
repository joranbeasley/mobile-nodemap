/**
 * Voices that stay the same: 🎙 Fix voices takes a finished clip's dialogue apart, finds who
 * speaks when, and changes each speaker to their character's fixed voice, keeping the timing (so
 * the lips still match). The changed voices play over the clip's music and effects.
 *
 * Steps (each a service call, here through `VoiceTools`):
 *   1. separate: the clip's sound into the voices and the rest (music, effects)
 *   2. transcribe: the voices, word by word, with who speaks (speaker 0, 1…) and when
 *   3. match: speakers to characters, from the lines quoted in the shot's description
 *   4. convert: the voices, once per speaker, into that character's voice
 * Playing, each speaker's converted track is heard during their turns only.
 */
import type { VideoEstimate } from './video-generation.js';

export interface SpokenWord {
  text: string;
  /** Seconds. */
  start: number;
  end: number;
  /** Who speaks it (as the service labels them, e.g. "speaker_0"). */
  speaker?: string;
}

/** A character's voice to change to: a ready-made voice by name, or their own recording. */
export interface TargetVoice {
  name?: string;
  sample?: string;
}

export interface VoiceTools {
  id: string;
  name: string;
  key?: { label: string; help?: string; get(): string | null | undefined; set(value: string): void };
  /** The clip's sound in two: the voices, and the rest (music, effects; one or more tracks). */
  separate(media: string, opts?: { signal?: AbortSignal; onProgress?: (status: string) => void }): Promise<{ vocals: string; background: string[] }>;
  /** Every word, with when and who. */
  transcribe(audio: string, opts?: { signal?: AbortSignal; onProgress?: (status: string) => void }): Promise<SpokenWord[]>;
  /** The whole voices track in another voice, timing kept. */
  convert(audio: string, to: TargetVoice, opts?: { signal?: AbortSignal; onProgress?: (status: string) => void }): Promise<string>;
  /** A short line read in a ready-made voice (to hear what it sounds like). */
  speak?(text: string, voice: string, opts?: { signal?: AbortSignal }): Promise<string>;
  /** About what a clip this long, with this many voices to change, will cost. */
  estimate?(seconds: number, voices: number): VideoEstimate | undefined;
}

let tools: VoiceTools | null = null;
/** The service 🎙 Fix voices uses (none: the button doesn't show). */
export function setVoiceTools(t: VoiceTools | null): void {
  tools = t;
}
export function getVoiceTools(): VoiceTools | null {
  return tools;
}

/** A shot's fixed voices: what plays instead of its clip's own sound. */
export interface VoiceTrack {
  at: number;
  /** Music and effects (played as they are). */
  background: string[];
  /** Each changed speaker: their track, and when they speak (seconds). */
  voices: { character: string; url: string; segments: [number, number][] }[];
  /** The original voices, for speakers left as they were. */
  vocals?: string;
  /** Speakers left as they were, and when they speak. */
  kept?: [number, number][];
}

export interface Speaker {
  id: string;
  /** What they say, in order. */
  text: string;
  /** Their turns: runs of words with short pauses between. */
  segments: [number, number][];
}

/** Each speaker's words and turns (a pause of more than `gap` seconds starts a new turn). */
export function speakersOf(words: SpokenWord[], gap = 0.6): Speaker[] {
  const by = new Map<string, Speaker>();
  for (const w of words) {
    const id = w.speaker ?? 'speaker';
    let s = by.get(id);
    if (!s) by.set(id, (s = { id, text: '', segments: [] }));
    s.text = s.text ? `${s.text} ${w.text}` : w.text;
    const last = s.segments.at(-1);
    if (last && w.start - last[1] <= gap) last[1] = Math.max(last[1], w.end);
    else s.segments.push([w.start, w.end]);
  }
  return [...by.values()];
}

/**
 * Lines quoted in a shot's description and who says them: the character named last before each
 * quote ("Ms Okafor smiles and says: “Lovely start…”").
 */
export function quotedLines(description: string, cast: { id: string; name: string }[]): { character?: string; text: string }[] {
  const out: { character?: string; text: string }[] = [];
  const re = /["“]([^"”]{2,})["”]/g;
  let m: RegExpExecArray | null;
  let from = 0;
  while ((m = re.exec(description))) {
    const before = description.slice(from, m.index);
    let who: string | undefined;
    let at = -1;
    for (const c of cast) {
      const i = before.lastIndexOf(c.name);
      if (i > at) ((at = i), (who = c.id));
    }
    out.push({ ...(who ? { character: who } : {}), text: m[1] });
    from = m.index + m[0].length;
  }
  return out;
}

const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 1));
const overlap = (a: string, b: string) => {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size);
};

/**
 * Which character each speaker is: the one whose quoted lines share the most words with what the
 * speaker says (half or more), else none (to be chosen). A shot with one character and one
 * speaker: that character.
 */
export function matchSpeakers(speakers: Speaker[], lines: { character?: string; text: string }[], cast: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of speakers) {
    let best = 0;
    let who = '';
    for (const l of lines) {
      if (!l.character) continue;
      const k = overlap(s.text, l.text);
      if (k > best) ((best = k), (who = l.character));
    }
    out[s.id] = best >= 0.5 ? who : '';
  }
  if (speakers.length === 1 && cast.length === 1 && !out[speakers[0].id]) out[speakers[0].id] = cast[0];
  return out;
}

/**
 * Play a shot's fixed voices with its video: the clip's own sound off, the music and effects
 * and each changed speaker (heard during their turns only) kept in step with the picture.
 * `ac`/`dest`: an audio context to play through (and a recording to send the sound to).
 * Returns a function that stops it all.
 */
export function attachVoiceTrack(video: HTMLVideoElement, track: VoiceTrack, opts: { ac?: AudioContext; dest?: AudioNode } = {}): () => void {
  video.muted = true;
  const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  const ac = opts.ac ?? (AC ? new AC() : undefined);
  const parts: { el: HTMLAudioElement; gain?: GainNode; segments?: [number, number][] }[] = [];
  const add = (url: string, segments?: [number, number][]) => {
    const el = Object.assign(document.createElement('audio'), { src: url, preload: 'auto' });
    const part: (typeof parts)[number] = { el, ...(segments ? { segments } : {}) };
    if (ac) {
      const src = ac.createMediaElementSource(el);
      const gain = ac.createGain();
      src.connect(gain);
      gain.connect(ac.destination);
      if (opts.dest) gain.connect(opts.dest);
      part.gain = gain;
      if (segments) gain.gain.value = 0;
    }
    parts.push(part);
  };
  track.background.forEach((u) => add(u));
  if (track.vocals && track.kept?.length) add(track.vocals, track.kept);
  track.voices.forEach((v) => add(v.url, v.segments));
  // Each speaker's track is heard in their turns (a little lead-in and tail).
  const level = () => {
    const t = video.currentTime;
    for (const p of parts) {
      if (!p.segments || !p.gain || !ac) continue;
      const on = p.segments.some(([a, b]) => t >= a - 0.08 && t <= b + 0.15);
      p.gain.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.03);
    }
  };
  const sync = (force = false) => {
    for (const p of parts) if (force || Math.abs(p.el.currentTime - video.currentTime) > 0.15) p.el.currentTime = video.currentTime;
  };
  const onPlay = () => {
    void ac?.resume?.();
    sync(true);
    for (const p of parts) void p.el.play()?.catch?.(() => undefined);
  };
  const onPause = () => parts.forEach((p) => p.el.pause());
  const onSeek = () => sync(true);
  let raf = 0;
  const tick = () => {
    level();
    if (!video.paused) sync();
    raf = requestAnimationFrame(tick);
  };
  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('ended', onPause);
  video.addEventListener('seeked', onSeek);
  raf = requestAnimationFrame(tick);
  if (!video.paused) onPlay();
  return () => {
    cancelAnimationFrame(raf);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('ended', onPause);
    video.removeEventListener('seeked', onSeek);
    for (const p of parts) (p.el.pause(), p.el.removeAttribute('src'));
    if (!opts.ac) void ac?.close?.();
  };
}

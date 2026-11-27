/**
 * Video generation for shots: a pluggable generator (a prompt, reference pictures and/or a first
 * frame → a clip). Several can be set at once; people pick one in the clip panel. See fal.ts for
 * an adapter.
 *
 *   setVideoGenerators([falVideoGenerator({ key: { label: 'fal key', get, set } })]);
 */

export interface VideoRequest {
  prompt: string;
  /**
   * Pictures to work from, in order (a prompt can call them @Image1, @Image2…): https URLs or
   * data: URIs. Only for generators with `maxReferences`.
   */
  references?: string[];
  /** Start exactly on this picture (a continuing shot). */
  firstFrame?: string;
  /** End on this picture, where the model can. */
  lastFrame?: string;
  /** Seconds. */
  duration?: number;
  /** '16:9', '9:16', '1:1'… */
  aspect?: string;
  /** '480p', '720p', '1080p'… */
  resolution?: string;
  model?: string;
  /** Generate sound (speech, effects) where the model can. */
  audio?: boolean;
  signal?: AbortSignal;
  /** What it's doing, e.g. "In queue (3 ahead)", "Generating…", and the percent done when the service says. */
  onProgress?: (status: string, percent?: number) => void;
  /**
   * The service accepted the job. Keep it (it holds no key): if waiting is cut short (the page
   * closes, the phone sleeps, the connection drops), `resume(job)` collects the clip later.
   */
  onSubmitted?: (job: VideoJob) => void;
}

/** A clip being made on a service: enough to collect it later. */
export interface VideoJob {
  /** The generator's id. */
  service: string;
  /** When it was sent (ms since 1970). */
  startedAt: number;
  [k: string]: unknown;
}

export interface VideoResult {
  /** URLs of the generated clips (they may expire: keep a copy). */
  videos: string[];
  /** What it cost, in the service's own words when it says (e.g. "119 credits", "$0.84"). */
  cost?: string;
}

export interface VideoEstimate {
  amount: number;
  /** 'USD', or 'credits'. */
  unit: 'USD' | 'credits';
  /** Where the figure comes from, e.g. "fal's listed price". */
  basis: string;
  /** The length it was priced for, when the model makes another than asked (e.g. Veo's 8 s with references). */
  seconds?: number;
}

export interface VideoModel {
  id: string;
  label: string;
  /** Allowed durations in seconds (inclusive). */
  minDuration?: number;
  maxDuration?: number;
  /** Only these lengths (seconds), when it doesn't take any length in the range. */
  durations?: number[];
  resolutions?: string[];
  aspects?: string[];
  /** Reference pictures it takes (0: none). */
  maxReferences?: number;
  /** Takes a first frame. */
  firstFrame?: boolean;
  /** Can generate sound. */
  audio?: boolean;
  /** One line about it: speed, cost… */
  hint?: string;
}

export interface VideoGenerator {
  id: string;
  /** Shown on buttons and in messages, e.g. "fal". */
  name: string;
  models: VideoModel[];
  defaultModel?: string;
  /** An API key the person gives once; the host decides where it is kept. */
  key?: { label: string; help?: string; get(): string | null | undefined; set(value: string): void };
  generate(req: VideoRequest): Promise<VideoResult>;
  /**
   * Wait for a job sent earlier and return its clip. Rejects with `code: 'pending'` when it is
   * still running (or the service can't be reached yet): keep the job and try again later.
   */
  resume?(job: VideoJob, opts?: { signal?: AbortSignal; onProgress?: (status: string, percent?: number) => void }): Promise<VideoResult>;
  /** What a clip with these settings will probably cost; undefined when unknown. */
  estimate?(req: { model?: string; duration?: number; resolution?: string; aspect?: string; audio?: boolean; references?: number }): VideoEstimate | undefined;
  /** What's left on the account, in the estimate's unit (undefined when it can't be read). */
  balance?(opts?: { signal?: AbortSignal }): Promise<number | undefined>;
  /** Where to see prices and make clips by hand. */
  site?: string;
}

let generators: VideoGenerator[] = [];

/** The video generators people can choose from (empty: no 🎬 Generate). */
export function setVideoGenerators(list: VideoGenerator[]): void {
  generators = [...list];
}
export const getVideoGenerators = (): VideoGenerator[] => generators;

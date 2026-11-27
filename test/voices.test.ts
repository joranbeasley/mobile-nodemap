// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
  Graph,
  NodeEditor,
  drama2Graph,
  speakersOf,
  quotedLines,
  matchSpeakers,
  falVoiceTools,
  setVoiceTools,
  setVideoGenerators,
  setGenerationLog,
  sceneSequence,
  voicePickParam,
  type VoiceTools,
  type VoiceTrack,
  type GenerationRecord,
} from '../src/index';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
afterEach(() => {
  setVoiceTools(null);
  setVideoGenerators([]);
  setGenerationLog(null);
});

const words = [
  { text: 'Lovely', start: 0.5, end: 0.8, speaker: 'speaker_0' },
  { text: 'start,', start: 0.85, end: 1.1, speaker: 'speaker_0' },
  { text: 'everyone.', start: 1.15, end: 1.6, speaker: 'speaker_0' },
  { text: 'Theo,', start: 1.9, end: 2.2, speaker: 'speaker_0' },
  { text: 'take', start: 2.25, end: 2.4, speaker: 'speaker_0' },
  { text: 'your', start: 2.45, end: 2.6, speaker: 'speaker_0' },
  { text: 'time.', start: 2.65, end: 3.0, speaker: 'speaker_0' },
  { text: 'From', start: 4.1, end: 4.3, speaker: 'speaker_1' },
  { text: 'the', start: 4.35, end: 4.45, speaker: 'speaker_1' },
  { text: 'top,', start: 4.5, end: 4.8, speaker: 'speaker_1' },
  { text: 'whenever', start: 4.85, end: 5.2, speaker: 'speaker_1' },
  { text: "you're", start: 5.25, end: 5.4, speaker: 'speaker_1' },
  { text: 'ready.', start: 5.45, end: 5.9, speaker: 'speaker_1' },
];
const description = 'Ms Okafor, stage left, smiles warmly and says: "Lovely start, everyone. Theo, take your time. You know this better than you think." The others step back and Maya calls softly: "From the top, whenever you\'re ready."';
const cast = [
  { id: 'maya', name: 'Maya' },
  { id: 'theo', name: 'Theo' },
  { id: 'okafor', name: 'Ms Okafor' },
];

describe('matching voices to characters', () => {
  it('groups words into speakers and turns, reads who says each quoted line, and matches them', () => {
    const sp = speakersOf(words);
    expect(sp.map((s) => s.id)).toEqual(['speaker_0', 'speaker_1']);
    expect(sp[0].text).toBe('Lovely start, everyone. Theo, take your time.');
    expect(sp[0].segments).toEqual([[0.5, 3.0]]); // pauses under 0.6 s keep a turn going
    const lines = quotedLines(description, cast);
    expect(lines).toEqual([
      { character: 'okafor', text: 'Lovely start, everyone. Theo, take your time. You know this better than you think.' },
      { character: 'maya', text: "From the top, whenever you're ready." },
    ]);
    expect(matchSpeakers(sp, lines, cast.map((c) => c.id))).toEqual({ speaker_0: 'okafor', speaker_1: 'maya' });
    // Nothing quoted to go by: unknown (to be chosen), except one speaker in a one-character shot.
    expect(matchSpeakers(sp, [], ['theo'])).toEqual({ speaker_0: '', speaker_1: '' });
    expect(matchSpeakers([sp[0]], [], ['theo'])).toEqual({ speaker_0: 'theo' });
  });
});

/** A stand-in for fal: queue, results by endpoint, uploads. */
function fakeFal() {
  const calls: { url: string; method: string; body?: any }[] = [];
  const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, blob: async () => new Blob(['x'], { type: 'video/mp4' }) }) as unknown as Response;
  const results: Record<string, unknown> = {
    'fal-ai/demucs': { vocals: { url: 'https://v3.fal.media/files/vocals.mp3' }, drums: { url: 'https://v3.fal.media/files/drums.mp3' }, other: { url: 'https://v3.fal.media/files/other.mp3' } },
    'fal-ai/elevenlabs/speech-to-text': { text: '', words: [{ type: 'word', text: 'Hi', start: 0, end: 0.4, speaker_id: 'speaker_0' }, { type: 'spacing', text: ' ', start: 0.4, end: 0.5 }] },
    'fal-ai/elevenlabs/voice-changer': { audio: { url: 'https://v3.fal.media/files/changed.mp3' } },
    'fal-ai/chatterbox/speech-to-speech': { audio: { url: 'https://v3.fal.media/files/cloned.wav' } },
    'fal-ai/elevenlabs/tts/multilingual-v2': { audio: { url: 'https://v3.fal.media/files/said.mp3' } },
  };
  let last = '';
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method ?? 'GET', body });
    if (url.includes('/storage/upload/initiate')) return json({ upload_url: 'https://upload.test/put', file_url: `https://v3.fal.media/files/up-${calls.length}` });
    if (url.startsWith('https://upload.test/') || url.startsWith('api/') || url.startsWith('data:')) return json({});
    if (init.method === 'POST') {
      last = url.replace('https://queue.fal.run/', '');
      return json({ request_id: 'r' });
    }
    if (url.endsWith('/status')) return json({ status: 'COMPLETED' });
    return json(results[last]);
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch, posts: () => calls.filter((c) => c.method === 'POST' && c.url.startsWith('https://queue.fal.run')) };
}

describe('fal voice tools', () => {
  it('separates with Demucs, transcribes with speakers, and changes voices (ready-made or recorded)', async () => {
    const fal = fakeFal();
    const t = falVoiceTools({ apiKey: 'k', fetch: fal.fetch, pollMs: 1 });
    const parts = await t.separate('api/clips/a.mp4');
    expect(parts).toEqual({ vocals: 'https://v3.fal.media/files/vocals.mp3', background: ['https://v3.fal.media/files/drums.mp3', 'https://v3.fal.media/files/other.mp3'] });
    expect(await t.transcribe(parts.vocals)).toEqual([{ text: 'Hi', start: 0, end: 0.4, speaker: 'speaker_0' }]);
    expect(await t.convert(parts.vocals, { name: 'George' })).toBe('https://v3.fal.media/files/changed.mp3');
    expect(await t.convert(parts.vocals, { sample: 'data:audio/mpeg;base64,QQ==' })).toBe('https://v3.fal.media/files/cloned.wav');
    const [dm, stt, vc, cb] = fal.posts();
    expect(dm.url).toBe('https://queue.fal.run/fal-ai/demucs');
    expect(dm.body).toMatchObject({ audio_url: expect.stringMatching(/^https:\/\/v3\.fal\.media\/files\/up-/), model: 'htdemucs', stems: ['vocals', 'drums', 'bass', 'other'] });
    expect(stt.body).toEqual({ audio_url: 'https://v3.fal.media/files/vocals.mp3', diarize: true, tag_audio_events: false });
    expect(vc.body).toEqual({ audio_url: 'https://v3.fal.media/files/vocals.mp3', voice: 'George', model_id: 'eleven_multilingual_sts_v2' });
    expect(cb.url).toBe('https://queue.fal.run/fal-ai/chatterbox/speech-to-speech');
    expect(cb.body).toMatchObject({ source_audio_url: 'https://v3.fal.media/files/vocals.mp3', target_voice_audio_url: expect.stringMatching(/^https:\/\/v3\.fal\.media\/files\/up-/) });
    expect(t.estimate!(60, 2)!.amount).toBe(0.67); // 0.042 + 0.03 + 0.60
    expect(await t.speak!('Hi', 'Lily')).toBe('https://v3.fal.media/files/said.mp3');
    expect(fal.posts().at(-1)).toMatchObject({ url: 'https://queue.fal.run/fal-ai/elevenlabs/tts/multilingual-v2', body: { text: 'Hi', voice: 'Lily' } });
  });
});

describe('🎙 Fix voices on a shot', () => {
  it('listens, matches speakers to characters, changes their voices and keeps the result on the shot', async () => {
    const converted: { audio: string; to: unknown }[] = [];
    const tools: VoiceTools = {
      id: 'fake',
      name: 'Fake',
      async separate() {
        return { vocals: 'https://v/vocals.mp3', background: ['https://v/music.mp3'] };
      },
      async transcribe() {
        return words;
      },
      async convert(audio, to) {
        converted.push({ audio, to });
        return `https://v/${to.name ?? 'own'}.mp3`;
      },
      estimate: (s, n) => ({ amount: 0.1 * n, unit: 'USD', basis: 'a guess' }),
    };
    setVoiceTools(tools);
    setVideoGenerators([{ id: 'fake', name: 'Fake', models: [{ id: 'm', label: 'M' }], async generate() {
      return { videos: [] };
    } }]);
    const saved: GenerationRecord[] = [];
    setGenerationLog({ save: (r) => void saved.push(r), list: async () => [] });
    const g = Graph.fromJSON(drama2Graph.examples![0].graph, drama2Graph.createRegistry());
    g.setParam('s1a', 'description', description);
    g.setParam('s1a', 'clipUrl', 'https://v/clip.mp4');
    g.setParam('s1a', 'lastFrame', 'data:image/jpeg;base64,RU5E');
    g.setParam('s1a', 'clipSeconds', 8);
    g.setParam('okafor', 'voiceName', 'Alice');
    g.setParam('maya', 'voiceSample', 'data:audio/mpeg;base64,QQ==');
    const el = document.createElement('div');
    document.body.append(el);
    const editor = new NodeEditor(el, { graph: g, registry: g.registry!, views: drama2Graph.editor!.views });
    await editor.setView('shots');
    editor.openFieldSheet('s1a', 'lastFrame', '🎬 Clip');
    await tick(360);
    const field = () => [...document.querySelectorAll<HTMLElement>('.nm-field-sheet')].pop()!.querySelector<HTMLElement>('[data-param="lastFrame"]')!;
    [...field().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '🎙 Fix voices')!.click();
    const panel = field().querySelector<HTMLElement>('.dr-voices-panel')!;
    // Theo and Jules have no fixed voice yet: said up front.
    expect(panel.textContent).toMatch(/No fixed voice yet for Theo, Jules/);
    panel.querySelector<HTMLButtonElement>('.dr-gen-go')!.click(); // 👂 Listen
    await tick(10);
    const rows = [...panel.querySelectorAll<HTMLElement>('.dr-voice')];
    expect(rows.map((r) => r.querySelector('select')!.value)).toEqual(['okafor', 'maya']);
    expect(rows[0].textContent).toContain('→ Alice (fixed voice)');
    expect(rows[1].textContent).toContain('→ their own recording');
    const go = panel.querySelector<HTMLButtonElement>('.dr-gen-go')!;
    expect(go.textContent).toBe('🎙 Change 2 voices · about $0.20');
    go.click();
    await tick();
    document.querySelector<HTMLButtonElement>('.dr-confirm .dr-gen-go')!.click();
    await tick(20);
    expect(converted).toEqual([
      { audio: 'https://v/vocals.mp3', to: { name: 'Alice' } },
      { audio: 'https://v/vocals.mp3', to: { sample: 'data:audio/mpeg;base64,QQ==' } },
    ]);
    const track = g.nodes.get('s1a')!.params.voiceTrack as VoiceTrack;
    expect(track.background).toEqual(['https://v/music.mp3']);
    expect(track.voices).toEqual([
      { character: 'okafor', segments: [[0.5, 3]], url: 'https://v/Alice.mp3' },
      { character: 'maya', segments: [[4.1, 5.9]], url: 'https://v/own.mp3' },
    ]);
    expect(saved[0]).toMatchObject({ kind: 'voices', node: 's1a', settings: { voices: 2 } });
    // The scene's preview plays them.
    expect(sceneSequence(g, g.nodes.get('sc1')!)[0].voices).toEqual(track);
    editor.closePalette();
    editor.destroy();
  });
});

describe('picking a fixed voice', () => {
  it('plays a line in it straight away, made once and replayed', async () => {
    const said: string[] = [];
    setVoiceTools({ id: 'f', name: 'F', separate: async () => ({ vocals: '', background: [] }), transcribe: async () => [], convert: async () => '', speak: async (text, voice) => (said.push(`${voice}: ${text}`), `data:audio/mpeg;base64,${btoa(voice)}`) });
    let value: unknown = '';
    const el = voicePickParam.render({ param: { name: 'voiceName', kind: 'voice-pick' }, node: { id: 'maya', type: 't', label: 'Maya', params: {} }, value, set: (v: unknown) => (value = v), key: 'k' } as never);
    document.body.append(el);
    const sel = el.querySelector('select')!;
    expect([...sel.options].map((o) => o.value)).toContain('Lily');
    sel.value = 'Lily';
    sel.dispatchEvent(new Event('change'));
    await tick();
    expect(value).toBe('Lily');
    expect(el.querySelector('audio')!.src).toBe(`data:audio/mpeg;base64,${btoa('Lily')}`);
    el.querySelector<HTMLButtonElement>('button')!.click();
    await tick();
    expect(said).toEqual(["Lily: Hi, I'm Maya. This is how I'll sound in every scene."]); // once
    el.remove();
  });
});

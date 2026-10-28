export const TRACKS = [
  { id: 'BD', name: '底鼓' },
  { id: 'SD', name: '军鼓' },
  { id: 'CH', name: '闭镲' },
  { id: 'OH', name: '开镲' },
  { id: 'CP', name: '拍手' },
  { id: 'LT', name: '低嗵鼓' },
  { id: 'RS', name: '边击' },
  { id: 'CB', name: '牛铃' },
] as const;

export type TrackId = (typeof TRACKS)[number]['id'];
export type Velocity = 0 | 1 | 2 | 3;
export const VELOCITY_GAIN = [0, 0.35, 0.75, 1] as const;
export interface Track { id: TrackId; name: string; steps: Velocity[] }
export interface Pattern { stepsPerBar: number; tracks: Track[] }
export interface TrackMix { volume: number; mute: boolean; solo: boolean; tone: number }
export type Mixer = Record<TrackId, TrackMix>;
export interface Session {
  pattern: Pattern;
  bpm: number;
  swing: number;
  master: number;
  mixer: Mixer;
}

export function createPattern(stepsPerBar = 16): Pattern {
  if (!Number.isInteger(stepsPerBar) || stepsPerBar < 2 || stepsPerBar > 128 || stepsPerBar % 2) {
    throw new Error('每小节步数必须为 2–128 之间的偶数');
  }
  return { stepsPerBar, tracks: TRACKS.map(track => ({ ...track, steps: Array<Velocity>(stepsPerBar).fill(0) })) };
}

export function setVelocity(pattern: Pattern, id: TrackId, step: number, value: Velocity): void {
  const track = pattern.tracks.find(track => track.id === id);
  if (!track || !Number.isInteger(step) || step < 0 || step >= pattern.stepsPerBar || ![0, 1, 2, 3].includes(value)) return;
  track.steps[step] = value;
}

export function toggleStep(pattern: Pattern, id: TrackId, step: number): Velocity {
  const value = pattern.tracks.find(track => track.id === id)?.steps[step] ? 0 : 2;
  setVelocity(pattern, id, step, value);
  return value;
}

export function cycleVelocity(pattern: Pattern, id: TrackId, step: number): Velocity {
  const previous = pattern.tracks.find(track => track.id === id)?.steps[step] ?? 0;
  const value = (previous === 0 ? 0 : previous === 3 ? 1 : previous + 1) as Velocity;
  setVelocity(pattern, id, step, value);
  return value;
}

export function clearPattern(pattern: Pattern): void {
  pattern.tracks.forEach(track => track.steps.fill(0));
}

export function createMixer(): Mixer {
  return Object.fromEntries(TRACKS.map(({ id }) => [id, { volume: 0.8, mute: false, solo: false, tone: 0.5 }])) as Mixer;
}

export interface Preset { id: string; name: string; genre: string; bpm: number; swing: number; pattern: Pattern }
function preset(id: string, name: string, genre: string, bpm: number, swing: number, rows: Partial<Record<TrackId, string>>): Preset {
  const pattern = createPattern();
  pattern.tracks.forEach(track => {
    track.steps = (rows[track.id] ?? '0000000000000000').split('').map(Number) as Velocity[];
  });
  return { id, name, genre, bpm, swing, pattern };
}

export const PRESETS: Preset[] = [
  preset('floor', '四拍地板', 'Four on the Floor', 120, 50, {
    BD: '3000200020002000', SD: '0000200000003000', CH: '2020202020202020', OH: '0000002000000020', CP: '0000200000002000',
  }),
  preset('boombap', '街角鼓点', 'Boom Bap', 88, 56, {
    BD: '3000002000200020', SD: '0000300000013000', CH: '2020202120202021', RS: '0000000000200000',
  }),
  preset('rock', '车库现场', 'Rock', 112, 50, {
    BD: '3000002030200000', SD: '0000300000003002', CH: '2020202020202000', OH: '0000000000000020', LT: '0000000000000002',
  }),
  preset('electro', '电气脉冲', 'Electro', 128, 50, {
    BD: '3000002000200020', SD: '0000300000003000', CH: '2021202020212020', OH: '0000002000000020', CP: '0000200000002000', LT: '0000000000020002', RS: '0020000000200000', CB: '3000002000300020',
  }),
  preset('jazz', '午夜切分', 'Swung groove', 96, 64, {
    BD: '3000000000200000', SD: '0010300101003010', CH: '2021202120212021', OH: '0000002000000020', RS: '0000000000200000', CB: '2000000000002000',
  }),
];

export function loadPreset(id: string): Preset {
  return structuredClone(PRESETS.find(item => item.id === id) ?? PRESETS[0]);
}

export function defaultSession(): Session {
  const preset = loadPreset('electro');
  return { pattern: preset.pattern, bpm: preset.bpm, swing: preset.swing, mixer: createMixer(), master: 0.75 };
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const between = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export function serialize(session: Session): string {
  return JSON.stringify({ version: 1, ...session });
}

export function deserialize(json: string | null): Session {
  try {
    const data: unknown = JSON.parse(json ?? 'null');
    if (!object(data) || data.version !== 1 || !object(data.pattern) || !object(data.mixer)) throw new Error('格式不匹配');
    const { stepsPerBar, tracks } = data.pattern;
    if (!between(stepsPerBar, 2, 128) || !Number.isInteger(stepsPerBar) || stepsPerBar % 2 || !Array.isArray(tracks) || tracks.length !== TRACKS.length) throw new Error('步数不合法');
    const pattern = createPattern(stepsPerBar);
    for (const track of pattern.tracks) {
      const saved = tracks.find((item: unknown) => object(item) && item.id === track.id);
      if (!object(saved) || !Array.isArray(saved.steps) || saved.steps.length !== stepsPerBar || !saved.steps.every((v: unknown) => between(v, 0, 3) && Number.isInteger(v))) throw new Error('力度不合法');
      track.steps = [...saved.steps] as Velocity[];
    }
    const mixer = createMixer();
    for (const { id } of TRACKS) {
      const mix = data.mixer[id];
      if (!object(mix) || !between(mix.volume, 0, 1) || !between(mix.tone, 0, 1) || typeof mix.mute !== 'boolean' || typeof mix.solo !== 'boolean') throw new Error('混音数据不合法');
      mixer[id] = { volume: mix.volume, tone: mix.tone, mute: mix.mute, solo: mix.solo };
    }
    if (!between(data.bpm, 60, 200) || !between(data.swing, 50, 75) || !between(data.master, 0, 1)) throw new Error('参数不合法');
    return { pattern, bpm: data.bpm, swing: data.swing, master: data.master, mixer };
  } catch {
    return defaultSession();
  }
}

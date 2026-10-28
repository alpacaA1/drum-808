import { describe, expect, it } from 'vitest';
import { PRESETS, clearPattern, createPattern, cycleVelocity, defaultSession, deserialize, loadPreset, serialize, setVelocity, toggleStep } from '../src/sequencer/pattern';
import { trackLevel } from '../src/audio/engine';

describe('pattern operations and future grids', () => {
  it.each([12, 16, 24])('edits and clears a %i-step pattern', steps => {
    const pattern = createPattern(steps);
    expect(pattern.tracks).toHaveLength(8);
    expect(toggleStep(pattern, 'BD', steps - 1)).toBe(2);
    expect(cycleVelocity(pattern, 'BD', steps - 1)).toBe(3);
    expect(cycleVelocity(pattern, 'BD', steps - 1)).toBe(1);
    expect(cycleVelocity(pattern, 'BD', steps - 1)).toBe(2);
    expect(toggleStep(pattern, 'BD', steps - 1)).toBe(0);
    expect(cycleVelocity(pattern, 'BD', steps - 1)).toBe(0);
    setVelocity(pattern, 'SD', 0, 1);
    setVelocity(pattern, 'SD', steps, 3);
    setVelocity(pattern, 'SD', -1, 3);
    expect(pattern.tracks[1].steps).toHaveLength(steps);
    clearPattern(pattern);
    expect(pattern.tracks.every(track => track.steps.every(value => value === 0))).toBe(true);
  });
  it('rejects invalid grids and returns independent preset copies', () => {
    for (const steps of [0, 3, NaN, 129]) expect(() => createPattern(steps)).toThrow();
    const preset = loadPreset('jazz');
    clearPattern(preset.pattern);
    expect(loadPreset('jazz').pattern.tracks[1].steps).toContain(1);
    expect(PRESETS).toHaveLength(5);
    for (const preset of PRESETS) expect(preset.pattern.tracks.every(t => t.steps.length === preset.pattern.stepsPerBar)).toBe(true);
  });
});

describe('session persistence', () => {
  it.each([12, 16, 24])('round-trips every setting with %i steps', steps => {
    const session = defaultSession();
    session.pattern = createPattern(steps);
    setVelocity(session.pattern, 'SD', steps - 1, 1);
    session.mixer.BD = { volume: 0.23, mute: true, solo: true, tone: 0.91 };
    session.bpm = 163; session.swing = 73; session.master = 0.42;
    expect(deserialize(serialize(session))).toEqual(session);
  });
  it('falls back on missing, old, corrupted, or invalid data', () => {
    const session = defaultSession();
    const invalid = [null, '', '{', 'null', '[]', '{}', serialize(session).replace('"version":1', '"version":0')];
    const edits = [
      { ...session, bpm: 201 }, { ...session, swing: 49 }, { ...session, master: -1 },
      { ...session, pattern: { ...session.pattern, stepsPerBar: 15 } },
      { ...session, pattern: { ...session.pattern, tracks: [] } },
      { ...session, mixer: {} },
    ];
    const badSteps = structuredClone(session); badSteps.pattern.tracks[0].steps[0] = 4 as never;
    const badMix = structuredClone(session); badMix.mixer.CH.volume = NaN;
    invalid.push(...edits.map(value => JSON.stringify({ version: 1, ...value })), serialize(badSteps), serialize(badMix));
    invalid.forEach(value => expect(deserialize(value)).toEqual(defaultSession()));
  });
});

describe('mixer routing', () => {
  it('mute wins over solo and unsoloed tracks are silent', () => {
    const mixer = defaultSession().mixer;
    expect(trackLevel(mixer, 'BD')).toBe(0.8);
    mixer.SD.solo = true;
    expect(trackLevel(mixer, 'BD')).toBe(0);
    expect(trackLevel(mixer, 'SD')).toBe(0.8);
    mixer.SD.mute = true;
    expect(trackLevel(mixer, 'SD')).toBe(0);
  });
});

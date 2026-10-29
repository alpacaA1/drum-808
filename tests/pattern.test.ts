import { describe, expect, it } from 'vitest';
import { PRESETS, clearPattern, createPattern, cycleVelocity, defaultSession, deserialize, isTripletGrid, loadPreset, resizePattern, serialize, setVelocity, toggleStep } from '../src/sequencer/pattern';
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
    expect(PRESETS).toHaveLength(7);
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

describe('grid resolution', () => {
  it('re-quantises hits to the nearest position on the new grid', () => {
    const pattern = createPattern(16);
    setVelocity(pattern, 'BD', 0, 3); setVelocity(pattern, 'BD', 4, 2); setVelocity(pattern, 'SD', 12, 1);
    const triplet = resizePattern(pattern, 12);
    expect(triplet.stepsPerBar).toBe(12);
    expect(triplet.tracks.find(t => t.id === 'BD')!.steps.slice(0, 4)).toEqual([3, 0, 0, 2]);
    expect(triplet.tracks.find(t => t.id === 'SD')!.steps[9]).toBe(1);
    // Beats survive a round trip through any grid.
    const back = resizePattern(resizePattern(pattern, 24), 16);
    expect(back.tracks.find(t => t.id === 'BD')!.steps).toEqual(pattern.tracks.find(t => t.id === 'BD')!.steps);
  });

  it('keeps the louder hit when two steps land on one', () => {
    // 24→12: steps 1 and 2 both round to step 1.
    const dense = createPattern(24);
    setVelocity(dense, 'CH', 1, 1); setVelocity(dense, 'CH', 2, 3);
    expect(resizePattern(dense, 12).tracks.find(t => t.id === 'CH')!.steps[1]).toBe(3);
  });

  it('ships triplet presets that load on a 12-step grid and survive serialisation', () => {
    for (const id of ['jazzride', 'shuffle']) {
      const preset = loadPreset(id);
      expect(preset.pattern.stepsPerBar).toBe(12);
      expect(isTripletGrid(preset.pattern.stepsPerBar)).toBe(true);
      expect(preset.pattern.tracks.every(t => t.steps.length === 12)).toBe(true);
      const session = { ...defaultSession(), pattern: preset.pattern, bpm: preset.bpm, swing: preset.swing };
      expect(deserialize(serialize(session)).pattern).toEqual(preset.pattern);
    }
    expect(isTripletGrid(16)).toBe(false);
    expect(isTripletGrid(24)).toBe(true);
  });
});

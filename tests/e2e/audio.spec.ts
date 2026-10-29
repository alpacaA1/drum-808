import { expect, test } from '@playwright/test';

test('real OfflineAudioContext renders all voices, velocities and master ceiling', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const voicesUrl = '/src/audio/voices.ts';
    const engineUrl = '/src/audio/engine.ts';
    const patternUrl = '/src/sequencer/pattern.ts';
    const clockUrl = '/src/sequencer/clock.ts';
    const { VOICES } = await import(voicesUrl) as typeof import('../../src/audio/voices');
    const { createMasterChain, AudioEngine } = await import(engineUrl) as typeof import('../../src/audio/engine');
    const { TRACKS, createMixer, loadPreset } = await import(patternUrl) as typeof import('../../src/sequencer/pattern');
    const { stepOffset } = await import(clockUrl) as typeof import('../../src/sequencer/clock');
    function analyze(buffer: AudioBuffer) {
      const data = buffer.getChannelData(0);
      let peak = 0;
      let finite = true;
      for (const value of data) { peak = Math.max(peak, Math.abs(value)); if (!Number.isFinite(value)) finite = false; }
      return { peak, finite };
    }
    const voices = [];
    for (const { id } of TRACKS) {
      const peaks = [];
      for (const velocity of [0, 0.35, 1]) {
        const ctx = new OfflineAudioContext(1, 48000, 48000);
        VOICES[id](ctx, ctx.destination, 0.01, velocity);
        peaks.push(analyze(await ctx.startRendering()));
      }
      voices.push({ id, silent: peaks[0], ghost: peaks[1], accent: peaks[2] });
    }
    const preset = loadPreset('electro');
    async function renderBar(dense: boolean) {
      const ctx = new OfflineAudioContext(1, 48000 * 4, 48000);
      const master = createMasterChain(ctx, ctx.destination, 1);
      for (let step = 0; step < preset.pattern.stepsPerBar; step++) {
        const time = 0.01 + stepOffset(step, { bpm: preset.bpm, swing: preset.swing, stepsPerBar: preset.pattern.stepsPerBar });
        for (const track of preset.pattern.tracks) {
          if (dense || track.steps[step]) VOICES[track.id](ctx, master.input, time, 1);
        }
      }
      return analyze(await ctx.startRendering());
    }
    const fullBar = await renderBar(false);
    // Also stress beyond the preset: every voice on every step, all accents.
    const denseBar = await renderBar(true);
    // The engine uses exactly the same voices and chain offline; exercise choke through it.
    async function renderHat(choke?: 'CH' | 'OH', order: 'in-order' | 'choke-first' | 'same-onset' | 'same-onset-choke-first' = 'in-order') {
      const offline = new OfflineAudioContext(1, 48000, 48000);
      const engine = new AudioEngine(createMixer(), 1);
      engine.context = offline as unknown as AudioContext;
      // unlock initializes only realtime contexts; use its private wiring at runtime for offline inspection.
      const internal = engine as unknown as { master: ReturnType<typeof createMasterChain>; newBus: () => void };
      internal.master = createMasterChain(offline, offline.destination, 1);
      internal.newBus();
      if (order === 'choke-first' && choke) {
        // Live play: the closed hat was scheduled by the clock before the open hat was played by hand.
        engine.trigger(choke, 0.09, 3);
        engine.trigger('OH', 0.01, 3);
      } else if (order === 'same-onset-choke-first' && choke) {
        engine.trigger(choke, 0.09, 3);
        engine.trigger('OH', 0.09, 3);
      } else if (order === 'same-onset' && choke) {
        engine.trigger('OH', 0.09, 3);
        engine.trigger(choke, 0.09, 3);
      } else {
        engine.trigger('OH', 0.01, 3);
        if (choke) engine.trigger(choke, 0.09, 3);
      }
      const buffer = await offline.startRendering();
      const data = buffer.getChannelData(0);
      let energy = 0;
      for (let sample = 0.25 * 48000; sample < 0.45 * 48000; sample++) energy += data[sample] ** 2;
      return energy;
    }
    const hatTail = await renderHat();
    const chokedTail = await renderHat('CH');
    const chokedOutOfOrderTail = await renderHat('CH', 'choke-first');
    const sameOnsetTail = await renderHat('CH', 'same-onset');
    const sameOnsetChokeFirstTail = await renderHat('CH', 'same-onset-choke-first');
    // Two open hats at one onset must not cut each other.
    const twoOpenHatsTail = await renderHat('OH', 'same-onset');
    return { voices, fullBar, denseBar, hatTail, chokedTail, chokedOutOfOrderTail, sameOnsetTail, sameOnsetChokeFirstTail, twoOpenHatsTail };
  });
  console.log('Offline audio peaks:', JSON.stringify(results, null, 2));
  for (const voice of results.voices) {
    expect(voice.accent.finite, voice.id).toBe(true);
    expect(voice.ghost.finite, voice.id).toBe(true);
    expect(voice.accent.peak, voice.id).toBeGreaterThan(0.05);
    expect(voice.ghost.peak, voice.id).toBeLessThan(voice.accent.peak);
    expect(voice.silent.peak, voice.id).toBe(0);
  }
  expect(results.fullBar.finite).toBe(true);
  expect(results.fullBar.peak).toBeLessThanOrEqual(1);
  expect(results.fullBar.peak).toBeGreaterThan(0.05);
  expect(results.denseBar.finite).toBe(true);
  expect(results.denseBar.peak).toBeLessThanOrEqual(1);
  expect(results.chokedTail).toBeLessThan(results.hatTail * 0.01);
  expect(results.chokedOutOfOrderTail).toBeLessThan(results.hatTail * 0.01);
  expect(results.sameOnsetTail).toBeLessThan(results.hatTail * 0.01);
  expect(results.sameOnsetChokeFirstTail).toBeLessThan(results.hatTail * 0.01);
  expect(results.twoOpenHatsTail).toBeGreaterThan(results.hatTail * 0.5);
});

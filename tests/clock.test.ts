import { describe, expect, it, vi } from 'vitest';
import { SequencerClock, startTicker, stepDuration, stepOffset, type StepEvent, type Timing } from '../src/sequencer/clock';

describe('swing math', () => {
  it('delays odd steps only and preserves even step onsets', () => {
    const straight: Timing = { bpm: 120, swing: 50, stepsPerBar: 16 };
    const swung = { ...straight, swing: 75 };
    expect(stepOffset(1, straight)).toBeCloseTo(0.125);
    expect(stepOffset(1, swung)).toBeCloseTo(0.1875);
    for (let step = 0; step < straight.stepsPerBar; step += 2) expect(stepOffset(step, swung)).toBeCloseTo(stepOffset(step, straight));
  });
  it.each([12, 16, 24])('keeps the bar length invariant with %i steps', stepsPerBar => {
    for (const bpm of [60, 97, 200]) for (const swing of [50, 56, 64, 75]) {
      const timing = { bpm, swing, stepsPerBar };
      let total = 0;
      for (let step = 0; step < stepsPerBar; step++) total += stepDuration(step, timing);
      expect(total).toBeCloseTo(240 / bpm, 10);
      expect(stepOffset(stepsPerBar, timing)).toBeCloseTo(total, 10);
    }
  });
});

describe('audio clock with a fake currentTime', () => {
  it.each([12, 16, 24])('schedules every step once over hundreds of ticks (%i steps)', stepsPerBar => {
    let now = 0;
    const timing = { bpm: 120, swing: 64, stepsPerBar };
    const events: StepEvent[] = [];
    const clock = new SequencerClock(() => now, () => timing, event => events.push(event));
    clock.start();
    for (let tick = 1; tick <= 1000; tick++) { now = tick * 0.025; clock.tick(); }
    events.forEach((event, index) => {
      expect(event.stepIndex).toBe(index % stepsPerBar);
      expect(event.audioTime).toBeCloseTo(0.025 + Math.floor(index / stepsPerBar) * 2 + stepOffset(index % stepsPerBar, timing), 8);
    });
    expect(new Set(events.map(event => event.audioTime)).size).toBe(events.length);
  });
  it('changes BPM during playback with no duplicate or skipped step', () => {
    let now = 0;
    let changeIndex = 0;
    const timing = { bpm: 120, swing: 50, stepsPerBar: 16 };
    const events: StepEvent[] = [];
    const clock = new SequencerClock(() => now, () => timing, event => events.push(event));
    clock.start();
    for (let tick = 1; tick <= 100; tick++) {
      now = tick * 0.025;
      if (tick === 30) { changeIndex = events.length; timing.bpm = 180; }
      clock.tick();
    }
    events.forEach((event, index) => {
      expect(event.stepIndex).toBe(index % 16);
      if (index) expect(event.audioTime).toBeGreaterThan(events[index - 1].audioTime);
    });
    expect(events[changeIndex].audioTime - events[changeIndex - 1].audioTime).toBeCloseTo(60 / 180 / 4);
    expect(events.at(-1)!.audioTime - events.at(-2)!.audioTime).toBeCloseTo(60 / 180 / 4);
  });
  it('skips late notes after a long stall, stops and restarts at zero', () => {
    let now = 0;
    const events: StepEvent[] = [];
    const timing = { bpm: 120, swing: 75, stepsPerBar: 16 };
    const clock = new SequencerClock(() => now, () => timing, event => events.push(event));
    clock.start();
    now = 3600;
    const before = events.length;
    clock.tick();
    const afterStall = events.slice(before);
    expect(afterStall.length).toBeLessThanOrEqual(2);
    afterStall.forEach(event => expect(event.audioTime).toBeGreaterThanOrEqual(now));
    clock.stop();
    const stopped = events.length;
    now += 10; clock.tick();
    expect(events).toHaveLength(stopped);
    clock.start();
    expect(events[stopped]).toEqual({ stepIndex: 0, audioTime: now + 0.025 });
  });
  it('falls back to timeout when Worker construction is unavailable', () => {
    vi.useFakeTimers();
    const tick = vi.fn();
    const stop = startTicker(tick);
    vi.advanceTimersByTime(100);
    expect(tick).toHaveBeenCalledTimes(5);
    stop(); vi.advanceTimersByTime(100);
    expect(tick).toHaveBeenCalledTimes(5);
    vi.useRealTimers();
  });
});

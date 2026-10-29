import { describe, expect, it, vi } from 'vitest';
import { SequencerClock, nearestStep, startTicker, stepDuration, stepOffset, type StepEvent, type Timing } from '../src/sequencer/clock';

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
    // Serials keep counting over the skipped steps, so a pending skip for a skipped step can expire.
    expect(afterStall[0].serial).toBeGreaterThan(events[before - 1].serial + 1000);
    clock.stop();
    const stopped = events.length;
    now += 10; clock.tick();
    expect(events).toHaveLength(stopped);
    clock.start();
    expect(events[stopped]).toEqual({ stepIndex: 0, audioTime: now + 0.025, serial: 0 });
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

describe('live-hit quantisation', () => {
  const slow = { bpm: 60, swing: 50, stepsPerBar: 12 };
  it('considers the clock\'s next step even when it is beyond the lookahead window', () => {
    // Step 1 is at 0.025 + 1/3 s; a hit at 0.2 s is closer to it than to step 0.
    const next = { stepIndex: 1, audioTime: 0.025 + 1 / 3, serial: 1 };
    expect(nearestStep([{ stepIndex: 0, audioTime: 0.025, serial: 0 }], next, 0.2)).toMatchObject({ stepIndex: 1, serial: 1, scheduled: false });
  });
  it('wraps to the next bar', () => {
    const last = { stepIndex: 11, audioTime: 0.025 + 11 / 3, serial: 11 };
    const next = { stepIndex: 0, audioTime: 4.025, serial: 12 };
    expect(nearestStep([last], next, 3.88)).toMatchObject({ stepIndex: 0, serial: 12, scheduled: false });
  });
  it('keeps an already scheduled step when it is closer, honouring swing', () => {
    const swung = { bpm: 120, swing: 75, stepsPerBar: 16 };
    const events = [{ stepIndex: 0, audioTime: 1, serial: 0 }, { stepIndex: 1, audioTime: 1 + stepDuration(0, swung), serial: 1 }];
    expect(nearestStep(events, undefined, 1.02)).toMatchObject({ stepIndex: 0, scheduled: true });
    expect(nearestStep([], undefined, 1)).toBeUndefined();
  });
  it('peekNext predicts exactly what the clock schedules next, including a BPM change before the tick', () => {
    let now = 0;
    const timing = { ...slow };
    const events: StepEvent[] = [];
    const clock = new SequencerClock(() => now, () => timing, event => events.push(event));
    expect(clock.peekNext()).toBeUndefined();
    clock.start();
    now = 0.24; clock.tick();
    timing.bpm = 200; // changed between ticks: the clock clamps the retimed boundary to now + 5 ms
    const predicted = clock.peekNext()!;
    expect(predicted.audioTime).toBeCloseTo(0.245);
    clock.tick(); // same instant → identical result
    expect(events.find(event => event.serial === predicted.serial)).toEqual(predicted);
    // And a slow-down keeps the same serial for the same step, only later.
    timing.bpm = 80;
    const slower = clock.peekNext()!;
    now = slower.audioTime - 0.05; clock.tick();
    expect(events.find(event => event.serial === slower.serial)!.audioTime).toBeCloseTo(slower.audioTime);
  });
  it('peekNext applies the stall fast-forward exactly like tick', () => {
    let now = 0;
    const timing = { ...slow };
    const events: StepEvent[] = [];
    const clock = new SequencerClock(() => now, () => timing, event => events.push(event));
    clock.start();
    now = 1.0; // the timer stalled; steps 1 and 2 are already in the past
    const predicted = clock.peekNext()!;
    clock.tick();
    expect(events.find(event => event.serial === predicted.serial)).toEqual(predicted);
    expect(predicted.audioTime).toBeGreaterThanOrEqual(now);
  });
});

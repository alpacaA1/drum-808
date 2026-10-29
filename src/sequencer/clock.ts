export interface Timing { bpm: number; swing: number; stepsPerBar: number }
/** serial counts every step since start (skipped steps included), so one step keeps its identity across retiming. */
export interface StepEvent { stepIndex: number; audioTime: number; serial: number }

/** Swing redistributes each pair; two steps always occupy the same duration. */
export function stepDuration(stepIndex: number, { bpm, swing, stepsPerBar }: Timing): number {
  const straight = (60 / bpm) * (4 / stepsPerBar);
  const ratio = swing / 100;
  return straight * 2 * (stepIndex % 2 === 0 ? ratio : 1 - ratio);
}

export function stepOffset(stepIndex: number, timing: Timing): number {
  const straight = (60 / timing.bpm) * (4 / timing.stepsPerBar);
  return Math.floor(stepIndex / 2) * straight * 2 + (stepIndex % 2 ? straight * 2 * timing.swing / 100 : 0);
}

export class SequencerClock {
  private nextTime = 0;
  private nextStep = 0;
  private nextSerial = 0;
  private active = false;
  private previous?: StepEvent;
  private timingSnapshot?: Timing;
  readonly lookahead = 0.11;

  constructor(
    private now: () => number,
    private timing: () => Timing,
    private schedule: (event: StepEvent) => void,
  ) {}

  start(): void {
    this.nextStep = 0;
    this.nextSerial = 0;
    this.previous = undefined;
    this.timingSnapshot = undefined;
    this.nextTime = this.now() + 0.025;
    this.active = true;
    this.tick();
  }

  stop(): void { this.active = false; }

  tick(): void {
    if (!this.active) return;
    const now = this.now();
    const timing = this.timing();
    const next = this.resolve(now, timing);
    this.nextTime = next.time; this.nextStep = next.step; this.nextSerial = next.serial; this.previous = next.previous;
    this.timingSnapshot = { ...timing };
    while (this.nextTime < now + this.lookahead) {
      this.schedule({ stepIndex: this.nextStep, audioTime: this.nextTime, serial: this.nextSerial });
      this.advance(timing);
    }
  }

  /** The next step the clock will schedule: the same retiming and fast-forward rules tick() applies. */
  peekNext(): StepEvent | undefined {
    if (!this.active) return undefined;
    const next = this.resolve(this.now(), this.timing());
    return { stepIndex: next.step, audioTime: next.time, serial: next.serial };
  }

  /** Pure: where the next boundary lands at `now`, without mutating the clock. */
  private resolve(now: number, timing: Timing): { time: number; step: number; serial: number; previous?: StepEvent } {
    let time = this.nextTime, step = this.nextStep, serial = this.nextSerial, previous = this.previous;
    if (previous && this.timingSnapshot && (timing.bpm !== this.timingSnapshot.bpm || timing.swing !== this.timingSnapshot.swing)) {
      // Retiming starts at the next unscheduled boundary. Already-submitted notes stay fixed.
      // If the new duration has already elapsed, retain the step and play it just ahead.
      time = Math.max(now + 0.005, previous.audioTime + stepDuration(previous.stepIndex, timing));
    }
    // Fast-forward whole bars first, then remaining missed steps. Never burst late notes.
    if (time < now) {
      const barDuration = 240 / timing.bpm;
      const missedBars = Math.floor((now - time) / barDuration);
      time += missedBars * barDuration;
      serial += missedBars * timing.stepsPerBar;
      while (time < now) {
        previous = { stepIndex: step, audioTime: time, serial };
        time += stepDuration(step, timing);
        step = (step + 1) % timing.stepsPerBar;
        serial++;
      }
    }
    return { time, step, serial, previous };
  }

  private advance(timing: Timing): void {
    this.previous = { stepIndex: this.nextStep, audioTime: this.nextTime, serial: this.nextSerial };
    this.nextSerial++;
    this.nextTime += stepDuration(this.nextStep, timing);
    this.nextStep = (this.nextStep + 1) % timing.stepsPerBar;
  }
}

/** A worker wakes the scheduler; neither timer determines actual note onset. */
export function startTicker(tick: () => void): () => void {
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const fallback = () => {
    if (stopped) return;
    tick();
    timer = setTimeout(fallback, 25);
  };
  const startFallback = () => {
    worker?.terminate();
    worker = undefined;
    if (timer === undefined && !stopped) fallback();
  };
  try {
    const url = URL.createObjectURL(new Blob([
      'function pulse(){postMessage(0);setTimeout(pulse,25)}pulse();',
    ], { type: 'text/javascript' }));
    try { worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
    worker.onmessage = tick;
    worker.onerror = (event) => { event.preventDefault(); startFallback(); };
  } catch { startFallback(); }
  return () => { stopped = true; worker?.terminate(); clearTimeout(timer); };
}

/**
 * Quantise a live hit to the closest step. Candidates are the recently scheduled steps plus the clock's
 * next unscheduled step (only that one can be closer than the last scheduled step); it wraps across bars.
 */
export function nearestStep(scheduled: StepEvent[], next: StepEvent | undefined, time: number): (StepEvent & { scheduled: boolean }) | undefined {
  let best: (StepEvent & { scheduled: boolean }) | undefined;
  const candidates = [...scheduled.map(event => ({ ...event, scheduled: true })), ...(next ? [{ ...next, scheduled: false }] : [])];
  for (const event of candidates) if (!best || Math.abs(event.audioTime - time) < Math.abs(best.audioTime - time)) best = event;
  return best;
}

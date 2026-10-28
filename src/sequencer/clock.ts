export interface Timing { bpm: number; swing: number; stepsPerBar: number }
export interface StepEvent { stepIndex: number; audioTime: number }

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
    if (this.previous && this.timingSnapshot && (timing.bpm !== this.timingSnapshot.bpm || timing.swing !== this.timingSnapshot.swing)) {
      // Retiming starts at the next unscheduled boundary. Already-submitted notes stay fixed.
      // If the new duration has already elapsed, retain the step and play it just ahead.
      this.nextTime = Math.max(now + 0.005, this.previous.audioTime + stepDuration(this.previous.stepIndex, timing));
    }
    this.timingSnapshot = { ...timing };
    // Fast-forward whole bars first, then remaining missed steps. Never burst late notes.
    if (this.nextTime < now) {
      const barDuration = 240 / timing.bpm;
      const missedBars = Math.floor((now - this.nextTime) / barDuration);
      this.nextTime += missedBars * barDuration;
      while (this.nextTime < now) this.advance(timing);
    }
    while (this.nextTime < now + this.lookahead) {
      this.schedule({ stepIndex: this.nextStep, audioTime: this.nextTime });
      this.advance(timing);
    }
  }

  private advance(timing: Timing): void {
    this.previous = { stepIndex: this.nextStep, audioTime: this.nextTime };
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

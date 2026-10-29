import { TRACKS, VELOCITY_GAIN, type Mixer, type TrackId, type Velocity } from '../sequencer/pattern';
import { VOICES } from './voices';

export interface MasterChain { input: GainNode; compressor: DynamicsCompressorNode; ceiling: WaveShaperNode }

export function createMasterChain(ctx: BaseAudioContext, destination: AudioNode, volume = 0.75): MasterChain {
  const input = ctx.createGain();
  input.gain.value = volume * 0.65;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -10;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.001;
  compressor.release.value = 0.08;
  // Compressor attack is finite. A final soft ceiling also bounds initial transients.
  const ceiling = ctx.createWaveShaper();
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) curve[i] = 0.98 * Math.tanh(((i / (curve.length - 1)) * 2 - 1) / 0.98);
  ceiling.curve = curve;
  input.connect(compressor); compressor.connect(ceiling); ceiling.connect(destination);
  return { input, compressor, ceiling };
}

export function trackLevel(mixer: Mixer, id: TrackId): number {
  const anySolo = TRACKS.some(track => mixer[track.id].solo);
  const mix = mixer[id];
  return mix.mute || (anySolo && !mix.solo) ? 0 : mix.volume;
}

/** Firefox lacks cancelAndHoldAtTime; fall back to pinning the current value. */
function holdAt(param: AudioParam, time: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') { param.cancelAndHoldAtTime(time); return; }
  const value = param.value;
  param.cancelScheduledValues(time);
  param.setValueAtTime(value, time);
}

interface HatGate { gain: GainNode; start: number; end: number; cut?: number }
export class AudioEngine {
  context?: AudioContext;
  private master?: MasterChain;
  private tracks = new Map<TrackId, GainNode>();
  private bus?: GainNode;
  private hats: HatGate[] = [];
  /** Onset times of every CH/OH hit; live play can insert an OH before hats that are already scheduled. */
  private hatOnsets: { time: number; closed: boolean }[] = [];

  constructor(private mixer: Mixer, private volume: number) {}

  /** Called directly from a pointer/keyboard gesture, before any await. */
  async unlock(): Promise<void> {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = createMasterChain(this.context, this.context.destination, this.volume);
      this.newBus();
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  get currentTime(): number { return this.context?.currentTime ?? 0; }

  private newBus(): void {
    const ctx = this.context!;
    this.bus = ctx.createGain();
    this.bus.connect(this.master!.input);
    this.tracks.clear();
    for (const { id } of TRACKS) {
      const gain = ctx.createGain();
      gain.gain.value = trackLevel(this.mixer, id);
      gain.connect(this.bus);
      this.tracks.set(id, gain);
    }
  }

  updateMixer(mixer: Mixer, volume: number): void {
    this.mixer = mixer; this.volume = volume;
    const ctx = this.context;
    if (!ctx) return;
    for (const { id } of TRACKS) {
      const param = this.tracks.get(id)!.gain;
      holdAt(param, ctx.currentTime);
      param.linearRampToValueAtTime(trackLevel(mixer, id), ctx.currentTime + 0.008);
    }
    const master = this.master!.input.gain;
    holdAt(master, ctx.currentTime);
    master.linearRampToValueAtTime(volume * 0.65, ctx.currentTime + 0.008);
  }

  trigger(id: TrackId, time: number, level: Velocity): void {
    if (!level || !this.context) return;
    const ctx = this.context;
    const tone = this.mixer[id].tone;
    const dest = this.tracks.get(id)!;
    if (id === 'CH' || id === 'OH') {
      this.chokeHats(time);
      this.hatOnsets = this.hatOnsets.filter(onset => onset.time > ctx.currentTime - 0.05);
    }
    if (id === 'OH') {
      const gain = ctx.createGain(); gain.connect(dest);
      const decay = 0.15 + tone * 0.85;
      const hat: HatGate = { gain, start: time, end: time + decay + 0.02 };
      this.hats.push(hat);
      // A hat that is already scheduled later still chokes this one, whatever order the calls came in.
      // At the same onset only a closed hat wins (as in the sequencer's CH-after-OH order); two open hats both ring.
      const next = Math.min(...this.hatOnsets.filter(onset => onset.time > time || (onset.closed && onset.time === time)).map(onset => onset.time));
      if (next < hat.end) this.cutHat(hat, next);
      VOICES.OH(ctx, gain, time, VELOCITY_GAIN[level], { decay, onEnded: () => {
        gain.disconnect(); this.hats = this.hats.filter(item => item !== hat);
      } });
    } else {
      VOICES[id](ctx, dest, time, VELOCITY_GAIN[level], { tone, decay: 0.2 + tone * 0.65 });
    }
    if (id === 'CH' || id === 'OH') this.hatOnsets.push({ time, closed: id === 'CH' });
  }

  /** Metronome blip on the transport bus, so Stop fades it with the notes. Downbeat is higher. */
  click(time: number, downbeat: boolean): void {
    if (!this.context || !this.bus) return;
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = downbeat ? 1760 : 1320;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(downbeat ? 0.3 : 0.18, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    osc.connect(gain); gain.connect(this.bus);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(time); osc.stop(time + 0.045);
  }

  private chokeHats(time: number): void {
    for (const hat of this.hats) {
      if (hat.start > time || hat.end <= time || (hat.cut !== undefined && hat.cut <= time)) continue;
      this.cutHat(hat, time);
    }
  }

  /** Cuts may arrive out of order; an earlier cut replaces any later one already automated. */
  private cutHat(hat: HatGate, time: number): void {
    hat.cut = time;
    hat.gain.gain.cancelScheduledValues(time);
    hat.gain.gain.setValueAtTime(1, time);
    hat.gain.gain.linearRampToValueAtTime(0.00001, time + 0.008);
  }

  /** Retire the complete old bus, including already-scheduled lookahead notes. */
  stop(): void {
    if (!this.context || !this.bus) return;
    const bus = this.bus;
    const tracks = [...this.tracks.values()];
    const now = this.currentTime;
    holdAt(bus.gain, now);
    bus.gain.linearRampToValueAtTime(0.00001, now + 0.008);
    this.chokeHats(now);
    this.hatOnsets = [];
    setTimeout(() => { tracks.forEach(track => track.disconnect()); bus.disconnect(); }, 1300);
    this.newBus();
  }
}

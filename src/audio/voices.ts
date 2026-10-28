import type { TrackId } from '../sequencer/pattern';

export interface VoiceParams { decay?: number; tone?: number; onEnded?: () => void }
export type Voice = (ctx: BaseAudioContext, dest: AudioNode, time: number, velocity: number, params?: VoiceParams) => void;
const FLOOR = 0.00001;

/** All sources stop at an absolute audio time. The final source releases the graph. */
function finish(sources: AudioScheduledSourceNode[], nodes: AudioNode[], end: number, onEnded?: () => void): void {
  let remaining = sources.length;
  sources.forEach(source => {
    source.onended = () => {
      source.disconnect();
      if (--remaining === 0) { nodes.forEach(node => node.disconnect()); onEnded?.(); }
    };
    source.stop(end);
  });
}

function envelope(ctx: BaseAudioContext, dest: AudioNode, time: number, peak: number, decay: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(FLOOR, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(FLOOR, peak), time + 0.002);
  gain.gain.exponentialRampToValueAtTime(FLOOR, time + decay);
  gain.connect(dest);
  return gain;
}

function oscillator(ctx: BaseAudioContext, dest: AudioNode, type: OscillatorType, frequency: number, time: number): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, time);
  osc.connect(dest);
  osc.start(time);
  return osc;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext, dest: AudioNode, time: number): AudioBufferSourceNode {
  let buffer = noiseBuffers.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 808;
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      data[i] = (seed >>> 0) / 2147483648 - 1;
    }
    noiseBuffers.set(ctx, buffer);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(dest);
  source.start(time);
  return source;
}

export const bassDrum: Voice = (ctx, dest, time, velocity, params = {}) => {
  if (velocity <= 0) return;
  const decay = (params.decay ?? 0.48) * (0.85 + velocity * 0.15);
  const amp = envelope(ctx, dest, time, velocity * 0.95, decay);
  const osc = oscillator(ctx, amp, 'sine', 145 + velocity * 35, time);
  osc.frequency.exponentialRampToValueAtTime(48, time + 0.045);
  osc.frequency.exponentialRampToValueAtTime(43, time + decay);
  finish([osc], [amp], time + decay + 0.02, params.onEnded);
};

export const snareDrum: Voice = (ctx, dest, time, velocity, params = {}) => {
  if (velocity <= 0) return;
  const tone = params.tone ?? 0.5;
  const decay = 0.16 + velocity * 0.065;
  const noiseAmp = envelope(ctx, dest, time, velocity * (0.65 + tone * 0.3), decay);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass'; filter.frequency.value = 1100 + tone * 2400 + velocity * 400;
  filter.connect(noiseAmp);
  const source = noise(ctx, filter, time);
  const body = envelope(ctx, dest, time, velocity * (0.35 - tone * 0.12), 0.11);
  const low = oscillator(ctx, body, 'triangle', 180, time);
  const high = oscillator(ctx, body, 'sine', 330, time);
  finish([source, low, high], [noiseAmp, filter, body], time + decay + 0.02, params.onEnded);
};

function hat(ctx: BaseAudioContext, dest: AudioNode, time: number, velocity: number, decay: number, params: VoiceParams): void {
  if (velocity <= 0) return;
  const amp = envelope(ctx, dest, time, velocity * 0.3, decay);
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass'; highpass.frequency.value = 6800; highpass.Q.value = 0.7;
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass'; bandpass.frequency.value = 9200; bandpass.Q.value = 0.8;
  bandpass.connect(highpass); highpass.connect(amp);
  const oscillators = [205.3, 304.4, 369.6, 522.7, 540, 800].map(freq => oscillator(ctx, bandpass, 'square', freq, time));
  finish(oscillators, [amp, highpass, bandpass], time + decay + 0.02, params.onEnded);
}
export const closedHat: Voice = (ctx, dest, time, velocity, params = {}) => hat(ctx, dest, time, velocity, 0.055, params);
export const openHat: Voice = (ctx, dest, time, velocity, params = {}) => hat(ctx, dest, time, velocity, params.decay ?? 0.5, params);

export const clap: Voice = (ctx, dest, time, velocity, params = {}) => {
  if (velocity <= 0) return;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(FLOOR, time);
  for (const offset of [0, 0.012, 0.025]) {
    amp.gain.setValueAtTime(FLOOR, time + offset);
    amp.gain.exponentialRampToValueAtTime(velocity * 0.95, time + offset + 0.001);
    amp.gain.exponentialRampToValueAtTime(FLOOR, time + offset + 0.01);
  }
  amp.gain.setValueAtTime(velocity * 0.45, time + 0.038);
  amp.gain.exponentialRampToValueAtTime(FLOOR, time + 0.24);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.value = 1400; filter.Q.value = 0.8;
  filter.connect(amp); amp.connect(dest);
  finish([noise(ctx, filter, time)], [filter, amp], time + 0.26, params.onEnded);
};

export const lowTom: Voice = (ctx, dest, time, velocity, params = {}) => {
  if (velocity <= 0) return;
  const amp = envelope(ctx, dest, time, velocity * 0.85, 0.32);
  const osc = oscillator(ctx, amp, 'sine', 155, time);
  osc.frequency.exponentialRampToValueAtTime(82, time + 0.045);
  const attack = envelope(ctx, dest, time, velocity * 0.12, 0.025);
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 850;
  filter.connect(attack);
  finish([osc, noise(ctx, filter, time)], [amp, attack, filter], time + 0.34, params.onEnded);
};

export const rimshot: Voice = (ctx, dest, time, velocity, params = {}) => {
  if (velocity <= 0) return;
  const amp = envelope(ctx, dest, time, velocity * 0.6, 0.055);
  const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1800; filter.Q.value = 1.2;
  filter.connect(amp);
  const a = oscillator(ctx, filter, 'triangle', 480, time);
  const b = oscillator(ctx, filter, 'square', 1760, time);
  finish([a, b], [amp, filter], time + 0.075, params.onEnded);
};

export const cowbell: Voice = (ctx, dest, time, velocity, params = {}) => {
  if (velocity <= 0) return;
  const amp = envelope(ctx, dest, time, velocity * 0.45, 0.24);
  const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1000; filter.Q.value = 0.75;
  filter.connect(amp);
  const a = oscillator(ctx, filter, 'square', 540, time);
  const b = oscillator(ctx, filter, 'square', 803, time);
  finish([a, b], [amp, filter], time + 0.26, params.onEnded);
};

export const VOICES: Record<TrackId, Voice> = {
  BD: bassDrum, SD: snareDrum, CH: closedHat, OH: openHat, CP: clap, LT: lowTom, RS: rimshot, CB: cowbell,
};

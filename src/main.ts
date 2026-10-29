import './style.css';
import { AudioEngine } from './audio/engine';
import { SequencerClock, nearestStep, startTicker, type StepEvent, type Timing } from './sequencer/clock';
import { clearPattern, cycleVelocity, defaultSession, deserialize, isTripletGrid, loadPreset, resizePattern, serialize, setVelocity, toggleStep, type TrackId, type Velocity } from './sequencer/pattern';
import { Panel } from './ui/panel';

const STORAGE_KEY = 'drum808.session.v1';
let state = defaultSession();
try { state = deserialize(localStorage.getItem(STORAGE_KEY)); } catch { /* Storage can be disabled. */ }
const engine = new AudioEngine(state.mixer, state.master);
let playing = false;
let starting = false;
let transportGeneration = 0;
let stopTicker: (() => void) | undefined;
let visualQueue: StepEvent[] = [];
let frame = 0;
let metronome = false;
let recording = false;
/** Recently scheduled steps, used to quantise live key presses while recording. */
let recent: StepEvent[] = [];
/** A live hit written into a step that is not scheduled yet already sounded; skip that step (by clock serial) once. */
let skipOnce = new Map<TrackId, number>();
// Triplet grids already carry the swing feel, so swing is bypassed there.
const timing = (): Timing => ({ bpm: state.bpm, swing: isTripletGrid(state.pattern.stepsPerBar) ? 50 : state.swing, stepsPerBar: state.pattern.stepsPerBar });
const clock = new SequencerClock(
  () => engine.currentTime,
  timing,
  event => {
    // CH is processed after OH at a shared onset, so a simultaneous closed hat wins.
    const tracks = [...state.pattern.tracks].sort((a, b) => Number(a.id === 'CH') - Number(b.id === 'CH'));
    for (const track of tracks) {
      const skip = skipOnce.get(track.id);
      if (skip !== undefined && event.serial >= skip) {
        // Past the target (e.g. the clock fast-forwarded over it): forget it.
        skipOnce.delete(track.id);
        if (event.serial === skip) continue;
      }
      engine.trigger(track.id, event.audioTime, track.steps[event.stepIndex]);
    }
    const beat = state.pattern.stepsPerBar / 4;
    if (metronome && event.stepIndex % beat === 0) engine.click(event.audioTime, event.stepIndex === 0);
    visualQueue.push(event);
    recent.push(event);
    if (recent.length > state.pattern.stepsPerBar) recent.shift();
  },
);

function persist(): void {
  try { localStorage.setItem(STORAGE_KEY, serialize(state)); panel.setStorageStatus(true); }
  catch { panel.setStorageStatus(false); }
}

function refresh(custom = true): void {
  panel.refresh(state);
  if (custom) panel.setPreset('custom');
  engine.updateMixer(state.mixer, state.master);
  persist();
}

async function unlock(): Promise<boolean> {
  try {
    await engine.unlock();
    panel.setAudioStatus(engine.context?.state === 'running');
    if (engine.context) engine.context.onstatechange = () => panel.setAudioStatus(engine.context?.state === 'running');
    return engine.context?.state === 'running';
  } catch { panel.setAudioStatus(false, true); return false; }
}

function followAudio(): void {
  if (!playing) return;
  let latest: StepEvent | undefined;
  while (visualQueue.length && visualQueue[0].audioTime <= engine.currentTime) latest = visualQueue.shift();
  if (latest) panel.setPlayhead(latest.stepIndex);
  frame = requestAnimationFrame(followAudio);
}

function stop(): void {
  transportGeneration++;
  starting = false; playing = false;
  clock.stop(); stopTicker?.(); stopTicker = undefined;
  cancelAnimationFrame(frame); visualQueue = []; recent = []; skipOnce = new Map();
  engine.stop(); panel.setPlaying(false); panel.setPlayhead(-1);
}

async function transport(): Promise<void> {
  if (playing || starting) { stop(); return; }
  starting = true;
  const generation = ++transportGeneration;
  const ready = await unlock();
  if (generation !== transportGeneration) return;
  starting = false;
  if (!ready) return;
  playing = true; panel.setPlaying(true);
  clock.start(); stopTicker = startTicker(() => clock.tick());
  followAudio();
}

const panel = new Panel(document.querySelector<HTMLElement>('#app')!, state, {
  transport: () => { void transport(); },
  audition: id => {
    const shouldAudition = !playing;
    void unlock().then(ready => { if (ready && shouldAudition && !playing) engine.trigger(id, engine.currentTime + 0.005, 2); });
  },
  edit: (id, step, mode, value) => {
    const level = mode === 'cycle' ? cycleVelocity(state.pattern, id, step) : mode === 'toggle' ? toggleStep(state.pattern, id, step) : value!;
    if (mode === 'paint') setVelocity(state.pattern, id, step, level);
    skipOnce.delete(id); // a manual edit supersedes a pending live-hit skip
    refresh();
    // unlock() starts synchronously in this gesture; audition only while stopped.
    const shouldAudition = !playing;
    void unlock().then(ready => { if (ready && shouldAudition && !playing && level) engine.trigger(id, engine.currentTime + 0.005, level); });
    return level;
  },
  timing: (key, value) => { state[key] = value; refresh(false); },
  mix: (id, key, value) => {
    if (key === 'mute' || key === 'solo') state.mixer[id][key] = Boolean(value);
    else state.mixer[id][key] = Number(value);
    refresh(false);
  },
  master: value => { state.master = value; refresh(false); },
  preset: id => {
    const preset = loadPreset(id);
    regrid(preset.pattern.stepsPerBar, () => { state = { ...state, pattern: preset.pattern, bpm: preset.bpm, swing: preset.swing }; });
    skipOnce.clear();
    refresh(false); panel.setPreset(id);
  },
  clear: () => { clearPattern(state.pattern); skipOnce.clear(); refresh(); },
  grid: steps => {
    if (steps === state.pattern.stepsPerBar) return;
    regrid(steps, () => { state = { ...state, pattern: resizePattern(state.pattern, steps) }; });
    refresh();
  },
  play: (id, accent) => {
    const level: Velocity = accent ? 3 : 2;
    void unlock().then(ready => { if (ready) engine.trigger(id, engine.currentTime + 0.005, level); });
    if (!recording || !playing || !engine.context) return;
    const nearest = nearestStep(recent, clock.peekNext(), heardTime(engine.context));
    if (!nearest) return;
    if (!nearest.scheduled) skipOnce.set(id, nearest.serial);
    setVelocity(state.pattern, id, nearest.stepIndex, level);
    refresh();
  },
  perform: (key, on) => { if (key === 'metronome') metronome = on; else recording = on; },
});

/** Players hit along with what they hear: map "now" to the audio time currently leaving the speakers. */
function heardTime(ctx: AudioContext): number {
  const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : undefined;
  if (stamp?.contextTime && stamp.performanceTime) return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000;
  return ctx.currentTime - (ctx.baseLatency || 0) - (ctx.outputLatency || 0);
}

/** A grid change mid-playback restarts the transport so the clock never sees a stale step index. */
function regrid(steps: number, apply: () => void): void {
  const restart = (playing || starting) && steps !== state.pattern.stepsPerBar;
  if (restart) stop();
  apply();
  if (restart) void transport();
}
// Persisted edits may no longer match a named preset.
panel.setPreset('custom');
try { if (!localStorage.getItem(STORAGE_KEY)) panel.setPreset('electro'); } catch { panel.setStorageStatus(false); }
window.addEventListener('pagehide', () => { stop(); persist(); });

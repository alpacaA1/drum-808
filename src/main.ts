import './style.css';
import { AudioEngine } from './audio/engine';
import { SequencerClock, startTicker, type StepEvent } from './sequencer/clock';
import { clearPattern, cycleVelocity, defaultSession, deserialize, loadPreset, serialize, setVelocity, toggleStep } from './sequencer/pattern';
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
const clock = new SequencerClock(
  () => engine.currentTime,
  () => ({ bpm: state.bpm, swing: state.swing, stepsPerBar: state.pattern.stepsPerBar }),
  event => {
    // CH is processed after OH at a shared onset, so a simultaneous closed hat wins.
    const tracks = [...state.pattern.tracks].sort((a, b) => Number(a.id === 'CH') - Number(b.id === 'CH'));
    for (const track of tracks) engine.trigger(track.id, event.audioTime, track.steps[event.stepIndex]);
    visualQueue.push(event);
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
  cancelAnimationFrame(frame); visualQueue = [];
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
    if (state.pattern.stepsPerBar !== preset.pattern.stepsPerBar && playing) stop();
    state = { ...state, pattern: preset.pattern, bpm: preset.bpm, swing: preset.swing };
    refresh(false); panel.setPreset(id);
  },
  clear: () => { clearPattern(state.pattern); refresh(); },
});
// Persisted edits may no longer match a named preset.
panel.setPreset('custom');
try { if (!localStorage.getItem(STORAGE_KEY)) panel.setPreset('electro'); } catch { panel.setStorageStatus(false); }
window.addEventListener('pagehide', () => { stop(); persist(); });

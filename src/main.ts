import './style.css';
import { AudioEngine } from './audio/engine';
import { SequencerClock, nearestStep, startTicker, type StepEvent, type Timing } from './sequencer/clock';
import { clearPattern, cycleVelocity, defaultSession, deserialize, isTripletGrid, loadPreset, resizePattern, serialize, setVelocity, toggleStep, type TrackId, type Velocity } from './sequencer/pattern';
import { Panel } from './ui/panel';
import { CURRENT_KEY, addRhythm, downloadName, exportLibrary, exportRhythm, importRhythms, readCurrent, readLibrary, rhythmHash, toRhythm, uniqueName, writeLibrary, type SavedRhythm } from './sequencer/library';
import { LibraryPanel } from './ui/library';

const STORAGE_KEY = 'drum808.session.v1';
let state = defaultSession();
try { state = deserialize(localStorage.getItem(STORAGE_KEY)); } catch { /* Storage can be disabled. */ }
let libraryRead;
try { libraryRead = readLibrary(localStorage); }
catch { libraryRead = { items: [] as SavedRhythm[], writable: false, error: '浏览器无法读取节奏库，请导出文件保留当前内容' }; }
let library = libraryRead.items;
let current = readCurrent(null, state, library);
try { current = readCurrent(localStorage.getItem(CURRENT_KEY), state, library); } catch { /* Keep the working session in memory. */ }
let selectedPreset = 'custom';
const dirty = (): boolean => rhythmHash(state) !== current.savedHash;
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

function persist(): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(state));
    localStorage.setItem(CURRENT_KEY, JSON.stringify(current));
    panel.setStorageStatus(true);
    return true;
  } catch {
    panel.setStorageStatus(false);
    libraryPanel.message('浏览器无法保存，当前内容保留在本页，请导出文件备份', true);
    return false;
  }
}

function refresh(custom = true): boolean {
  panel.refresh(state);
  if (custom) setPreset('custom');
  libraryPanel.update(library, current.id, dirty());
  engine.updateMixer(state.mixer, state.master);
  return persist();
}

function setPreset(id: string): void { selectedPreset = id; panel.setPreset(id); }

function protect(action: () => void): void {
  if (!dirty()) { libraryPanel.closeConfirm(); libraryPanel.closeName(); action(); return; }
  libraryPanel.confirm(
    () => libraryPanel.openName(name => {
      if (saveAs(name)) { libraryPanel.closeConfirm(); action(); }
    }),
    () => { libraryPanel.closeConfirm(); libraryPanel.closeName(); action(); },
    () => { libraryPanel.closeConfirm(); libraryPanel.closeName(); panel.focusPreset(); },
  );
}

function storeLibrary(): boolean {
  try { return writeLibrary(localStorage, library); } catch { return false; }
}

function saveAs(name: string): boolean {
  try {
    const item = addRhythm(library, name, state);
    library = [...library, item];
    current = { id: item.id, savedHash: rhythmHash(item.rhythm) };
    const saved = storeLibrary();
    const sessionSaved = refresh(false);
    libraryPanel.closeName();
    if (!saved || sessionSaved) libraryPanel.message(saved ? `已保存「${item.name}」` : '浏览器无法保存节奏库，当前内容保留在本页，请导出文件备份', !saved);
    return saved && sessionSaved;
  } catch (error) { libraryPanel.message((error as Error).message, true); return false; }
}

function download(content: string, name: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    panel.setPreset(selectedPreset);
    protect(() => {
      const preset = loadPreset(id);
      regrid(preset.pattern.stepsPerBar, () => { state = { ...state, pattern: preset.pattern, bpm: preset.bpm, swing: preset.swing }; });
      skipOnce.clear();
      current = { id: null, savedHash: rhythmHash(state) };
      refresh(false); setPreset(id);
    });
  },
  clear: () => protect(() => { clearPattern(state.pattern); skipOnce.clear(); refresh(); }),
  grid: steps => {
    if (steps === state.pattern.stepsPerBar) return;
    protect(() => {
      regrid(steps, () => { state = { ...state, pattern: resizePattern(state.pattern, steps) }; });
      skipOnce.clear();
      refresh();
    });
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

const libraryPanel = new LibraryPanel(document.querySelector<HTMLElement>('#rhythm-library')!, {
  save: () => {
    const item = library.find(item => item.id === current.id);
    if (!item) { libraryPanel.closeConfirm(); libraryPanel.openName(saveAs); return; }
    library = library.map(saved => saved.id === item.id ? { ...saved, updatedAt: Date.now(), rhythm: toRhythm(state) } : saved);
    current.savedHash = rhythmHash(state);
    const saved = storeLibrary();
    const sessionSaved = refresh(false);
    if (!saved || sessionSaved) libraryPanel.message(saved ? `已保存「${item.name}」` : '浏览器无法保存节奏库，当前内容保留在本页，请导出文件备份', !saved);
  },
  saveAs: () => { libraryPanel.closeConfirm(); libraryPanel.openName(saveAs); },
  load: id => protect(() => {
    const item = library.find(item => item.id === id);
    if (!item) return;
    regrid(item.rhythm.pattern.stepsPerBar, () => { state = { ...toRhythm(item.rhythm), master: state.master }; });
    skipOnce.clear(); recent = [];
    current = { id: item.id, savedHash: rhythmHash(item.rhythm) };
    if (refresh()) libraryPanel.message(`已载入「${item.name}」`);
  }),
  rename: (id, name) => {
    try {
      const renamed = uniqueName(name, library.filter(item => item.id !== id));
      library = library.map(item => item.id === id ? { ...item, name: renamed, updatedAt: Date.now() } : item);
      const saved = storeLibrary();
      libraryPanel.update(library, current.id, dirty());
      libraryPanel.message(saved ? `已改名为「${renamed}」` : '浏览器无法保存改名，当前内容保留在本页，请导出文件备份', !saved);
    } catch (error) { libraryPanel.message((error as Error).message, true); }
  },
  delete: id => {
    library = library.filter(item => item.id !== id);
    if (current.id === id) current.id = null;
    const saved = storeLibrary();
    const sessionSaved = refresh(false);
    if (!saved || sessionSaved) libraryPanel.message(saved ? '已删除节奏' : '浏览器无法保存删除结果，当前内容保留在本页', !saved);
  },
  export: id => {
    const item = library.find(item => item.id === id);
    if (item) download(exportRhythm(item), downloadName(item.name));
  },
  exportAll: () => { download(exportLibrary(library), downloadName(null)); },
  import: files => { void (async () => {
    let added = 0, skipped = 0, full = 0;
    const reports: string[] = [];
    for (const file of files) {
      try {
        const result = importRhythms(await file.text(), file.name, library);
        library = result.items;
        added += result.added; skipped += result.skipped; full += result.full;
        reports.push(`${file.name}：已导入 ${result.added} 段，跳过 ${result.skipped} 个无效项目`);
      } catch { skipped++; reports.push(`${file.name}：读取失败`); }
    }
    const saved = !added || storeLibrary();
    libraryPanel.update(library, current.id, dirty());
    const report = `已导入 ${added} 段，跳过 ${skipped} 个无效文件或节奏`;
    libraryPanel.message(`${report}${full ? `；节奏库最多 200 段，另有 ${full} 段未导入` : ''}${saved ? '' : '；浏览器无法保存，请导出文件备份'}${files.length > 1 ? `\n${reports.join('\n')}` : ''}`, !saved || full > 0);
  })(); },
});
libraryPanel.update(library, current.id, dirty());
if (libraryRead.error) libraryPanel.message(libraryRead.error, true);

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
setPreset('custom');
try { if (!localStorage.getItem(STORAGE_KEY)) setPreset('electro'); } catch { panel.setStorageStatus(false); }
window.addEventListener('pagehide', () => { stop(); persist(); });

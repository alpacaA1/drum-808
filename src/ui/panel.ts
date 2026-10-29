import { GRIDS, PRESETS, TRACKS, defaultSession, isTripletGrid, type Session, type TrackId, type Velocity } from '../sequencer/pattern';
import { Knob, type KnobOptions } from './knob';

/** Swing ratio 50% (straight) … 75% ↔ swing amount 0 … 100%; 66.7% ratio (triplet) is amount 66.7%. */
export const swingAmount = (ratio: number): number => Math.round((ratio - 50) * 4);
export const swingRatio = (amount: number): number => 50 + amount / 4;

export interface PanelActions {
  transport: () => void;
  audition: (id: TrackId) => void;
  edit: (id: TrackId, step: number, mode: 'toggle' | 'cycle' | 'paint', value?: Velocity) => Velocity;
  timing: (key: 'bpm' | 'swing', value: number) => void;
  mix: (id: TrackId, key: 'mute' | 'solo' | 'volume' | 'tone', value: boolean | number) => void;
  master: (value: number) => void;
  preset: (id: string) => void;
  clear: () => void;
  grid: (stepsPerBar: number) => void;
  play: (id: TrackId, accent: boolean) => void;
  perform: (key: 'metronome' | 'record', on: boolean) => void;
}

/** Home-row keys play the tracks in order: A=BD … K=CB. */
export const PLAY_KEYS: Record<string, TrackId> = { KeyA: 'BD', KeyS: 'SD', KeyD: 'CH', KeyF: 'OH', KeyG: 'CP', KeyH: 'LT', KeyJ: 'RS', KeyK: 'CB' };

const velocityNames = ['关闭', '弱音', '普通', '重音'];
const toneNames: Partial<Record<TrackId, string>> = { BD: '衰减', SD: '响弦', OH: '衰减' };

export class Panel {
  private cells = new Map<string, HTMLButtonElement>();
  private playhead = -1;
  private selectedTrack: TrackId = 'BD';
  private knobs = new Map<string, Knob>();

  constructor(private root: HTMLElement, private state: Session, private actions: PanelActions) {
    root.innerHTML = `
      <a class="skip-link" href="#sequencer">跳到步进音序器</a>
      <main class="studio">
        <section class="machine" aria-label="Drum 808 鼓机">
          <header class="top-bar" aria-label="播放控制">
            <div class="brand"><h1>Drum <span>808</span></h1><p>浏览器里的节奏机</p></div>
            <div class="transport-group"><button id="transport" class="transport" aria-label="播放" aria-pressed="false"><i class="transport-light" aria-hidden="true"></i><span id="transport-icon">▶</span><span id="transport-label">播放</span><kbd>空格</kbd></button></div>
            <div class="timing-control tempo rotary-control"><div id="bpm"></div><div class="control-readout"><label class="section-label" for="bpm-number">BPM</label><input id="bpm-number" type="number" min="60" max="200" step="1" aria-label="BPM 数值"></div></div>
            <div class="timing-control swing rotary-control"><div id="swing"></div><div class="control-readout"><span class="section-label">Swing</span><div><output id="swing-value"></output><span class="readout-unit">%</span></div></div></div>
            <div class="master-control rotary-control"><div id="master"></div><div class="control-readout"><span class="section-label">主音量</span><output id="master-value"></output></div></div>
          </header>
          <div class="workspace">
            <section id="sequencer" class="sequencer grid-card" aria-label="步进音序器" tabindex="-1">
              <div class="grid-title"><h2 class="section-label">步进音序器</h2><div class="grid-resolution" role="radiogroup" aria-label="网格">${GRIDS.map(grid => `<button data-grid="${grid.steps}" role="radio" aria-checked="false" title="${grid.name}">${grid.label}<span>${grid.name}</span></button>`).join('')}</div><span class="pattern-meta" id="pattern-meta"></span></div>
              <div class="grid-scroll" tabindex="0" aria-label="鼓机网格，可左右滚动"><div class="step-grid" role="group" aria-label="八轨节奏网格"></div></div>
              <footer class="panel-footer"><div class="audio-status" id="audio-status"><i></i><span id="audio-hint">点击播放或步进键启用声音</span></div><span class="scroll-hint">左右滑动查看步进 →</span></footer>
            </section>
            <aside class="side-panel" aria-label="节奏与声部设置">
              <section class="side-section preset-picker" aria-label="节奏预设"><label class="section-label" for="preset">节奏预设</label><select id="preset"><option value="custom" disabled>自定义节奏</option>${PRESETS.map(p => `<option value="${p.id}">${p.name} · ${p.genre}</option>`).join('')}</select><button id="clear" class="text-button">清空节奏 <span aria-hidden="true">↺</span></button></section>
              <section class="side-section rhythm-library" id="rhythm-library" aria-label="我的节奏"></section>
              <section class="side-section selected-track" id="selected-track" aria-label="所选声部" data-track="BD"><h2 class="section-label">声部</h2><div class="selected-track-heading"><i class="track-dot"></i><span id="selected-track-id"></span><h3 id="selected-track-name"></h3></div><div class="track-knobs"><div class="mixer-control rotary-control"><div id="track-volume"></div><div class="control-readout"><span>音量</span><output id="track-volume-value"></output></div></div><div class="mixer-control rotary-control" id="tone-control"><div id="track-tone"></div><div class="control-readout"><span id="track-tone-label"></span><output id="track-tone-value"></output></div></div></div></section>
              <section class="side-section perform" aria-label="演奏"><h2 class="section-label">演奏</h2><div class="perform-toggles"><button id="metronome" class="toggle-key" aria-pressed="false"><i class="toggle-led" aria-hidden="true"></i>节拍器</button><button id="record" class="toggle-key record" aria-pressed="false"><i class="toggle-led" aria-hidden="true"></i>录制</button></div><div class="key-map">${Object.entries(PLAY_KEYS).map(([code, id]) => `<span data-key-track="${id}"><kbd>${code.slice(3)}</kbd>${id}</span>`).join('')}</div><p class="perform-hint">按键实时演奏，<kbd>Shift</kbd> 为重音；播放中打开录制，按键会写入最近的步进</p></section>
              <section class="side-section"><h2 class="section-label">力度</h2><div class="velocity-legend"><span><i class="legend-key ghost-key"></i>弱音</span><span><i class="legend-key normal-key"></i>普通</span><span><i class="legend-key accent-key"></i>重音</span></div></section>
              <section class="side-section shortcuts"><h2 class="section-label">操作</h2><dl><div><dt><kbd>点击</kbd> / <kbd>拖动</kbd></dt><dd>写入步进</dd></div><div><dt><kbd>右键</kbd> / <kbd>⌥ 点击</kbd></dt><dd>切换力度</dd></div><div><dt><kbd>长按</kbd></dt><dd>触屏切换力度</dd></div><div><dt><kbd>声部名称</kbd></dt><dd>选择并试听</dd></div><div><dt><kbd>A</kbd>–<kbd>K</kbd></dt><dd>演奏声部</dd></div></dl></section>
              <div class="save-status" id="save-status" role="status">已自动保存</div>
            </aside>
          </div>
        </section>
      </main>`;
    this.renderGrid();
    this.createKnobs();
    this.bindControls();
    this.bindEditing();
    this.refresh(state);
    this.element<HTMLSelectElement>('#preset').value = 'electro';
  }

  private element<T extends HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }

  private createKnobs(): void {
    const defaults = defaultSession();
    const add = (id: string, min: number, max: number, value: number, defaultValue: number, label: string, valueText: (value: number) => string, onChange: (value: number) => void, mark?: KnobOptions['mark']) => {
      this.knobs.set(id, new Knob(this.element(`#${id}`), { min, max, step: 1, value, defaultValue, label, valueText, onChange, mark }));
    };
    add('bpm', 60, 200, this.state.bpm, defaults.bpm, 'BPM', value => `${value} BPM`, value => this.actions.timing('bpm', value));
    // The knob shows swing amount 0–100% so the pointer matches the number; timing keeps the 50–75% ratio.
    add('swing', 0, 100, swingAmount(this.state.swing), swingAmount(defaults.swing), 'Swing', value => value ? `${value}% 摇摆` : '直拍', value => this.actions.timing('swing', swingRatio(value)), { value: 200 / 3, label: '三连' });
    add('master', 0, 100, this.state.master * 100, defaults.master * 100, '主音量', value => `${value}% 音量`, value => this.actions.master(value / 100));
    add('track-volume', 0, 100, this.state.mixer.BD.volume * 100, defaults.mixer.BD.volume * 100, '底鼓音量', value => `${value}% 音量`, value => this.actions.mix(this.selectedTrack, 'volume', value / 100));
    add('track-tone', 0, 100, this.state.mixer.BD.tone * 100, defaults.mixer.BD.tone * 100, '底鼓衰减', value => `${value}%`, value => this.actions.mix(this.selectedTrack, 'tone', value / 100));
  }

  private renderGrid(): void {
    const grid = this.element('.step-grid');
    const steps = this.state.pattern.stepsPerBar;
    grid.style.setProperty('--steps', String(steps));
    grid.style.setProperty('--tracks', String(this.state.pattern.tracks.length));
    let html = '<div class="playhead-column" hidden aria-hidden="true"></div><div class="led-heading sticky-track" aria-hidden="true"></div>';
    for (let step = 0; step < steps; step++) html += `<div class="transport-led" data-led-step="${step}" aria-hidden="true"><i></i></div>`;
    html += '<div class="track-heading sticky-track"><span>声部</span><span class="mix-heading">M / S</span></div>';
    for (let step = 0; step < steps; step++) {
      html += `<div class="step-heading group-${Math.floor(step * 4 / steps)}" data-head="${step}"><span>${String(step + 1).padStart(2, '0')}</span><i></i></div>`;
    }
    for (const { id, name } of this.state.pattern.tracks) {
      html += `<div class="track-panel sticky-track" data-track-panel="${id}"><button class="track-select" data-select-track="${id}" title="${name}，选择并试听" aria-label="${name}，选择并试听" aria-pressed="false"><i class="track-dot"></i><span class="track-id">${id}</span><span class="track-name">${name}</span></button><button class="mix-button mute" data-id="${id}" data-mix="mute" aria-label="${name}静音" aria-pressed="false"><i class="toggle-led" aria-hidden="true"></i>M</button><button class="mix-button solo" data-id="${id}" data-mix="solo" aria-label="${name}独奏" aria-pressed="false"><i class="toggle-led" aria-hidden="true"></i>S</button></div>`;
      for (let step = 0; step < steps; step++) {
        html += `<button class="step${step % (steps / 4) === 0 ? ' is-beat' : ''}" data-track="${id}" data-step="${step}" data-velocity="0" aria-pressed="false"><span class="step-led" aria-hidden="true"></span></button>`;
      }
    }
    grid.innerHTML = html;
    this.cells.clear();
    grid.querySelectorAll<HTMLButtonElement>('.step').forEach(cell => this.cells.set(`${cell.dataset.track}:${cell.dataset.step}`, cell));
  }

  private bindControls(): void {
    this.element('#transport').addEventListener('click', this.actions.transport);
    document.addEventListener('keydown', event => {
      const target = event.target as HTMLElement;
      // IME composition (e.g. pinyin) must never trigger transport or pads.
      if (event.isComposing || event.keyCode === 229 || target.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (event.code === 'Space' && !event.repeat && !target.closest('[role="slider"]')) {
        event.preventDefault(); this.actions.transport();
        return;
      }
      const id = PLAY_KEYS[event.code];
      if (id && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        this.actions.play(id, event.shiftKey);
        this.flashTrack(id);
      }
    });
    this.element<HTMLInputElement>('#bpm-number').addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      const number = Number(input.value);
      this.actions.timing('bpm', Number.isFinite(number) ? Math.min(200, Math.max(60, Math.round(number))) : this.state.bpm);
    });
    this.element<HTMLInputElement>('#bpm-number').addEventListener('input', event => {
      const value = Number((event.target as HTMLInputElement).value);
      if (value >= 60 && value <= 200) this.actions.timing('bpm', Math.round(value));
    });
    this.element<HTMLSelectElement>('#preset').addEventListener('change', event => this.actions.preset((event.target as HTMLSelectElement).value));
    this.element('#clear').addEventListener('click', this.actions.clear);
    this.element('.grid-resolution').addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-grid]');
      if (button) this.actions.grid(Number(button.dataset.grid));
    });
    for (const key of ['metronome', 'record'] as const) {
      const button = this.element(`#${key}`);
      button.addEventListener('click', () => {
        const on = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(on));
        this.actions.perform(key, on);
      });
    }
    this.element('.step-grid').addEventListener('click', event => {
      const track = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-select-track]');
      if (track) {
        this.selectedTrack = track.dataset.selectTrack as TrackId;
        this.refreshSelection();
        this.actions.audition(this.selectedTrack);
        return;
      }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-mix]');
      if (button) {
        const id = button.dataset.id as TrackId;
        const key = button.dataset.mix as 'mute' | 'solo';
        this.actions.mix(id, key, !this.state.mixer[id][key]);
      }
    });
  }

  private bindEditing(): void {
    let drag: { pointer: number; value: Velocity; visited: Set<string> } | undefined;
    let touch: { pointer: number; cell: HTMLButtonElement; x: number; y: number; cycled: boolean; moved: boolean } | undefined;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let suppressTouchMenuUntil = 0;
    const edit = (cell: HTMLButtonElement, mode: 'toggle' | 'cycle' | 'paint', value?: Velocity) => this.actions.edit(cell.dataset.track as TrackId, Number(cell.dataset.step), mode, value);
    const grid = this.element('.step-grid');
    grid.addEventListener('contextmenu', event => {
      const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.step');
      if (cell) {
        event.preventDefault();
        if (Date.now() > suppressTouchMenuUntil) edit(cell, 'cycle');
      }
    });
    grid.addEventListener('pointerdown', event => {
      const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.step');
      if (!cell || event.button !== 0) return;
      if (event.altKey) { event.preventDefault(); edit(cell, 'cycle'); return; }
      if (event.pointerType === 'touch') {
        touch = { pointer: event.pointerId, cell, x: event.clientX, y: event.clientY, cycled: false, moved: false };
        hold = setTimeout(() => {
          if (touch && !touch.moved) {
            touch.cycled = true;
            suppressTouchMenuUntil = Date.now() + 1200;
            edit(cell, 'cycle');
          }
        }, 400);
      } else {
        event.preventDefault(); cell.focus({ preventScroll: true });
        const value = edit(cell, 'toggle');
        drag = { pointer: event.pointerId, value, visited: new Set([`${cell.dataset.track}:${cell.dataset.step}`]) };
      }
    });
    window.addEventListener('pointermove', event => {
      if (touch?.pointer === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 8) {
        touch.moved = true; clearTimeout(hold);
      }
      if (!drag || drag.pointer !== event.pointerId) return;
      const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('.step');
      if (!cell) return;
      const key = `${cell.dataset.track}:${cell.dataset.step}`;
      if (!drag.visited.has(key)) { drag.visited.add(key); edit(cell, 'paint', drag.value); }
    });
    window.addEventListener('pointerup', event => {
      clearTimeout(hold);
      if (touch?.pointer === event.pointerId) {
        if (!touch.cycled && !touch.moved) edit(touch.cell, 'toggle');
        touch = undefined;
      }
      drag = undefined;
    });
    window.addEventListener('pointercancel', () => { clearTimeout(hold); drag = undefined; touch = undefined; });
    window.addEventListener('blur', () => { clearTimeout(hold); drag = undefined; touch = undefined; });
    // Pointer editing is handled above. Keyboard activation has click.detail === 0.
    grid.addEventListener('click', event => {
      const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.step');
      if (cell && event.detail === 0) edit(cell, event.altKey ? 'cycle' : 'toggle');
    });
  }

  refresh(state: Session): void {
    const changedGrid = state.pattern.stepsPerBar !== this.state.pattern.stepsPerBar;
    this.state = state;
    if (changedGrid) this.renderGrid();
    for (const track of state.pattern.tracks) track.steps.forEach((value, step) => {
      const cell = this.cells.get(`${track.id}:${step}`)!;
      cell.dataset.velocity = String(value);
      cell.setAttribute('aria-pressed', String(value > 0));
      cell.setAttribute('aria-label', `${track.name} 第 ${step + 1} 步，${velocityNames[value]}`);
    });
    this.knobs.get('bpm')!.setValue(state.bpm);
    this.element<HTMLInputElement>('#bpm-number').value = String(state.bpm);
    this.knobs.get('swing')!.setValue(swingAmount(state.swing));
    this.element('#swing-value').textContent = String(swingAmount(state.swing));
    this.knobs.get('master')!.setValue(state.master * 100);
    this.element('#master-value').textContent = `${Math.round(state.master * 100)}%`;
    const grid = GRIDS.find(item => item.steps === state.pattern.stepsPerBar);
    this.element('#pattern-meta').textContent = `${state.pattern.tracks.length} 声部 / ${state.pattern.stepsPerBar} 步${grid ? ` · ${grid.name}` : ''} / 4/4`;
    this.root.querySelectorAll<HTMLElement>('[data-grid]').forEach(button => button.setAttribute('aria-checked', String(Number(button.dataset.grid) === state.pattern.stepsPerBar)));
    // Triplet grids already place notes on the triplet; swing would distort them, so it is bypassed.
    const swingOff = isTripletGrid(state.pattern.stepsPerBar);
    this.element('.swing').classList.toggle('is-inactive', swingOff);
    this.element('.swing').title = swingOff ? '三连音网格自带摇摆，Swing 暂不生效' : '';
    for (const { id } of TRACKS) {
      for (const key of ['mute', 'solo'] as const) this.element(`button[data-id="${id}"][data-mix="${key}"]`).setAttribute('aria-pressed', String(state.mixer[id][key]));
      this.element(`[data-track-panel="${id}"]`).classList.toggle('is-muted', state.mixer[id].mute || (TRACKS.some(t => state.mixer[t.id].solo) && !state.mixer[id].solo));
    }
    this.refreshSelection();
  }

  private refreshSelection(): void {
    const id = this.selectedTrack;
    const track = this.state.pattern.tracks.find(track => track.id === id)!;
    for (const { id: trackId } of TRACKS) {
      const selected = trackId === id;
      this.element(`[data-track-panel="${trackId}"]`).classList.toggle('is-selected', selected);
      this.element(`[data-select-track="${trackId}"]`).setAttribute('aria-pressed', String(selected));
    }
    this.element('#selected-track').dataset.track = id;
    this.element('#selected-track-id').textContent = id;
    this.element('#selected-track-name').textContent = track.name;
    for (const key of ['volume', 'tone'] as const) {
      const value = Math.round(this.state.mixer[id][key] * 100);
      this.knobs.get(`track-${key}`)!.setValue(value);
      this.element(`#track-${key}-value`).textContent = `${value}%`;
    }
    this.element('#tone-control').hidden = !toneNames[id];
    this.element('#track-tone-label').textContent = toneNames[id] ?? '';
    this.knobs.get('track-volume')!.setLabel(`${track.name}音量`);
    this.knobs.get('track-tone')!.setLabel(`${track.name}${toneNames[id] ?? '音色'}`);
  }

  private flashTrack(id: TrackId): void {
    for (const element of this.root.querySelectorAll<HTMLElement>(`[data-track-panel="${id}"], [data-key-track="${id}"]`)) {
      element.classList.remove('is-hit');
      void element.offsetWidth; // restart the flash when the same key repeats quickly
      element.classList.add('is-hit');
    }
  }

  setPreset(id: string): void { this.element<HTMLSelectElement>('#preset').value = id; }
  focusPreset(): void { this.element('#preset').focus(); }
  setPlaying(playing: boolean): void {
    this.element('#transport').setAttribute('aria-pressed', String(playing));
    this.element('#transport').setAttribute('aria-label', playing ? '停止' : '播放');
    this.element('#transport-icon').textContent = playing ? '■' : '▶';
    this.element('#transport-label').textContent = playing ? '停止' : '播放';
  }
  setPlayhead(step: number): void {
    if (this.playhead === step) return;
    this.playhead = step;
    const overlay = this.element('.playhead-column');
    overlay.hidden = step < 0;
    overlay.style.gridColumn = `${step + 2} / span 1`;
    this.root.querySelectorAll<HTMLElement>('[data-head], [data-led-step], .step').forEach(element => {
      const index = Number(element.dataset.head ?? element.dataset.ledStep ?? element.dataset.step);
      element.classList.toggle(element.dataset.ledStep !== undefined ? 'is-lit' : 'is-current', index === step);
    });
  }
  setAudioStatus(running: boolean, error = false): void {
    this.element('#audio-status').classList.toggle('is-ready', running);
    this.element('#audio-hint').textContent = error ? '声音未启用，请再次点击播放' : running ? '声音已就绪' : '点击播放或步进键启用声音';
  }
  setStorageStatus(saved: boolean): void {
    this.element('#save-status').textContent = saved ? '已自动保存' : '浏览器无法保存，刷新前请保留页面';
  }
}

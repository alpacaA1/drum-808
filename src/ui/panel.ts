import { PRESETS, TRACKS, type Session, type TrackId, type Velocity } from '../sequencer/pattern';

export interface PanelActions {
  transport: () => void;
  audition: (id: TrackId) => void;
  edit: (id: TrackId, step: number, mode: 'toggle' | 'cycle' | 'paint', value?: Velocity) => Velocity;
  timing: (key: 'bpm' | 'swing', value: number) => void;
  mix: (id: TrackId, key: 'mute' | 'solo' | 'volume' | 'tone', value: boolean | number) => void;
  master: (value: number) => void;
  preset: (id: string) => void;
  clear: () => void;
}

const velocityNames = ['关闭', '弱音', '普通', '重音'];
const toneNames: Partial<Record<TrackId, string>> = { BD: '衰减', SD: '响弦', OH: '衰减' };

export class Panel {
  private cells = new Map<string, HTMLButtonElement>();
  private playhead = -1;
  private selectedTrack: TrackId = 'BD';

  constructor(private root: HTMLElement, private state: Session, private actions: PanelActions) {
    root.innerHTML = `
      <a class="skip-link" href="#sequencer">跳到步进音序器</a>
      <main class="studio">
        <section class="machine" aria-label="Drum 808 鼓机">
          <header class="top-bar" aria-label="播放控制">
            <div class="brand"><h1>Drum <span>808</span></h1><p>浏览器里的节奏机</p></div>
            <div class="transport-group"><button id="transport" class="transport" aria-label="播放" aria-pressed="false"><span id="transport-icon">▶</span><span id="transport-label">播放</span><kbd>空格</kbd></button></div>
            <div class="timing-control tempo"><div class="control-readout"><label class="section-label" for="bpm-number">BPM</label><input id="bpm-number" type="number" min="60" max="200" step="1" aria-label="BPM 数值"></div><input id="bpm" aria-label="BPM" type="range" min="60" max="200" step="1"></div>
            <div class="timing-control swing"><div class="control-readout"><label class="section-label" for="swing">Swing</label><div><output id="swing-value" for="swing"></output><span class="readout-unit">%</span></div></div><input id="swing" aria-label="Swing" type="range" min="50" max="75" step="1"></div>
            <div class="master-control"><div class="control-readout"><label class="section-label" for="master">主音量</label><output id="master-value" for="master"></output></div><input id="master" aria-label="主音量" type="range" min="0" max="100" step="1"></div>
          </header>
          <div class="workspace">
            <section id="sequencer" class="sequencer grid-card" aria-label="步进音序器" tabindex="-1">
              <div class="grid-title"><h2 class="section-label">步进音序器</h2><span class="pattern-meta" id="pattern-meta"></span></div>
              <div class="grid-scroll" tabindex="0" aria-label="鼓机网格，可左右滚动"><div class="step-grid" role="group" aria-label="八轨节奏网格"></div></div>
              <footer class="panel-footer"><div class="audio-status" id="audio-status"><i></i><span id="audio-hint">点击播放或步进键启用声音</span></div><span class="scroll-hint">左右滑动查看步进 →</span></footer>
            </section>
            <aside class="side-panel" aria-label="节奏与声部设置">
              <section class="side-section preset-picker" aria-label="节奏预设"><label class="section-label" for="preset">节奏预设</label><select id="preset"><option value="custom" disabled>自定义节奏</option>${PRESETS.map(p => `<option value="${p.id}">${p.name} · ${p.genre}</option>`).join('')}</select><button id="clear" class="text-button">清空节奏 <span aria-hidden="true">↺</span></button></section>
              <section class="side-section selected-track" id="selected-track" aria-label="所选声部" data-track="BD"><h2 class="section-label">声部</h2><div class="selected-track-heading"><i class="track-dot"></i><span id="selected-track-id"></span><h3 id="selected-track-name"></h3></div><div class="mixer-control"><label for="track-volume">音量</label><output id="track-volume-value" for="track-volume"></output><input id="track-volume" type="range" min="0" max="100" data-mix="volume"></div><div class="mixer-control" id="tone-control"><label id="track-tone-label" for="track-tone"></label><output id="track-tone-value" for="track-tone"></output><input id="track-tone" type="range" min="0" max="100" data-mix="tone"></div></section>
              <section class="side-section"><h2 class="section-label">力度</h2><div class="velocity-legend"><span><i class="legend-key ghost-key"></i>弱音</span><span><i class="legend-key normal-key"></i>普通</span><span><i class="legend-key accent-key"></i>重音</span></div></section>
              <section class="side-section shortcuts"><h2 class="section-label">操作</h2><dl><div><dt><kbd>点击</kbd> / <kbd>拖动</kbd></dt><dd>写入步进</dd></div><div><dt><kbd>右键</kbd> / <kbd>⌥ 点击</kbd></dt><dd>切换力度</dd></div><div><dt><kbd>长按</kbd></dt><dd>触屏切换力度</dd></div><div><dt><kbd>声部名称</kbd></dt><dd>选择并试听</dd></div></dl></section>
              <div class="save-status" id="save-status" role="status">已自动保存</div>
            </aside>
          </div>
        </section>
      </main>`;
    this.renderGrid();
    this.bindControls();
    this.bindEditing();
    this.refresh(state);
    this.element<HTMLSelectElement>('#preset').value = 'electro';
  }

  private element<T extends HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }

  private renderGrid(): void {
    const grid = this.element('.step-grid');
    const steps = this.state.pattern.stepsPerBar;
    grid.style.setProperty('--steps', String(steps));
    grid.style.setProperty('--tracks', String(this.state.pattern.tracks.length));
    let html = '<div class="playhead-column" hidden aria-hidden="true"></div><div class="track-heading sticky-track"><span>声部</span><span>M / S</span></div>';
    for (let step = 0; step < steps; step++) {
      html += `<div class="step-heading group-${Math.floor(step * 4 / steps)}" data-head="${step}"><span>${String(step + 1).padStart(2, '0')}</span><i></i></div>`;
    }
    for (const { id, name } of this.state.pattern.tracks) {
      html += `<div class="track-panel sticky-track" data-track-panel="${id}"><button class="track-select" data-select-track="${id}" aria-label="${name}，选择并试听" aria-pressed="false"><i class="track-dot"></i><span class="track-id">${id}</span><span class="track-name">${name}</span></button><button class="mix-button mute" data-id="${id}" data-mix="mute" aria-label="${name}静音" aria-pressed="false">M</button><button class="mix-button solo" data-id="${id}" data-mix="solo" aria-label="${name}独奏" aria-pressed="false">S</button></div>`;
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
      if (event.code === 'Space' && !event.repeat && !target.closest('input, select, textarea, [contenteditable="true"]')) {
        event.preventDefault(); this.actions.transport();
      }
    });
    for (const key of ['bpm', 'swing'] as const) {
      this.element<HTMLInputElement>(`#${key}`).addEventListener('input', event => this.actions.timing(key, Number((event.target as HTMLInputElement).value)));
    }
    this.element<HTMLInputElement>('#bpm-number').addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      const number = Number(input.value);
      this.actions.timing('bpm', Number.isFinite(number) ? Math.min(200, Math.max(60, Math.round(number))) : this.state.bpm);
    });
    this.element<HTMLInputElement>('#bpm-number').addEventListener('input', event => {
      const value = Number((event.target as HTMLInputElement).value);
      if (value >= 60 && value <= 200) this.actions.timing('bpm', Math.round(value));
    });
    this.element<HTMLInputElement>('#master').addEventListener('input', event => this.actions.master(Number((event.target as HTMLInputElement).value) / 100));
    this.element<HTMLSelectElement>('#preset').addEventListener('change', event => this.actions.preset((event.target as HTMLSelectElement).value));
    this.element('#clear').addEventListener('click', this.actions.clear);
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
    this.element('#selected-track').addEventListener('input', event => {
      const input = event.target as HTMLInputElement;
      if (input.matches('input[data-mix]')) this.actions.mix(this.selectedTrack, input.dataset.mix as 'volume' | 'tone', Number(input.value) / 100);
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
    this.element<HTMLInputElement>('#bpm').value = String(state.bpm);
    this.element<HTMLInputElement>('#bpm-number').value = String(state.bpm);
    this.element<HTMLInputElement>('#swing').value = String(state.swing);
    this.element('#swing-value').textContent = String(state.swing);
    this.element<HTMLInputElement>('#master').value = String(Math.round(state.master * 100));
    this.element('#master-value').textContent = `${Math.round(state.master * 100)}%`;
    this.element('#pattern-meta').textContent = `${state.pattern.tracks.length} 声部 / ${state.pattern.stepsPerBar} 步 / 4/4`;
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
      this.element<HTMLInputElement>(`#track-${key}`).value = String(value);
      this.element(`#track-${key}-value`).textContent = `${value}%`;
    }
    this.element('#tone-control').hidden = !toneNames[id];
    this.element('#track-tone-label').textContent = toneNames[id] ?? '';
    this.element('#track-volume').setAttribute('aria-label', `${track.name}音量`);
    this.element('#track-tone').setAttribute('aria-label', `${track.name}${toneNames[id] ?? '音色'}`);
  }

  setPreset(id: string): void { this.element<HTMLSelectElement>('#preset').value = id; }
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
    this.root.querySelectorAll<HTMLElement>('[data-head], .step').forEach(element => {
      const index = Number(element.dataset.head ?? element.dataset.step);
      element.classList.toggle('is-current', index === step);
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

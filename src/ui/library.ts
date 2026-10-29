import type { SavedRhythm } from '../sequencer/library';

export interface LibraryActions {
  save: () => void;
  saveAs: () => void;
  load: (id: string) => void;
  rename: (id: string, name: string) => void;
  delete: (id: string) => void;
  export: (id: string) => void;
  exportAll: () => void;
  import: (files: File[]) => void;
}

/** Library-only DOM: all user-controlled names are assigned as text or input values. */
export class LibraryPanel {
  private list: HTMLElement;
  private editor: HTMLElement;
  private confirmation: HTMLElement;
  private status: HTMLElement;
  private currentName: HTMLElement;
  private dirtyBadge: HTMLElement;
  private items: readonly SavedRhythm[] | undefined;
  private cancelName?: () => void;

  constructor(private root: HTMLElement, private actions: LibraryActions) {
    root.innerHTML = `
      <h2 class="section-label">我的节奏</h2>
      <div class="rhythm-current"><span id="rhythm-current-name">未命名</span><span class="dirty-badge" hidden>已修改</span></div>
      <div class="library-toolbar"><button class="text-button" data-library="save">保存</button><button class="text-button" data-library="save-as">另存为…</button><button class="text-button" data-library="import">导入</button><button class="text-button" data-library="export-all">导出全部</button></div>
      <input id="rhythm-import" type="file" accept=".json,application/json" multiple hidden aria-label="导入节奏文件">
      <div class="library-name-editor" hidden></div>
      <div class="dirty-confirm" role="group" aria-label="未保存的节奏" hidden></div>
      <ul class="rhythm-list" aria-label="已保存的节奏"></ul>
      <p class="library-status" role="status" aria-live="polite"></p>`;
    this.list = root.querySelector('.rhythm-list')!;
    this.editor = root.querySelector('.library-name-editor')!;
    this.confirmation = root.querySelector('.dirty-confirm')!;
    this.status = root.querySelector('.library-status')!;
    this.currentName = root.querySelector('#rhythm-current-name')!;
    this.dirtyBadge = root.querySelector('.dirty-badge')!;
    const file = root.querySelector<HTMLInputElement>('#rhythm-import')!;
    root.querySelector('[data-library="save"]')!.addEventListener('click', actions.save);
    root.querySelector('[data-library="save-as"]')!.addEventListener('click', actions.saveAs);
    root.querySelector('[data-library="import"]')!.addEventListener('click', () => file.click());
    root.querySelector('[data-library="export-all"]')!.addEventListener('click', actions.exportAll);
    file.addEventListener('change', () => {
      const files = Array.from(file.files ?? []);
      file.value = '';
      if (files.length) actions.import(files);
    });
  }

  private button(text: string, action: () => void, label?: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'text-button'; button.textContent = text;
    if (label) button.setAttribute('aria-label', label);
    button.addEventListener('click', action);
    return button;
  }

  update(items: readonly SavedRhythm[], id: string | null, dirty: boolean): void {
    this.currentName.textContent = items.find(item => item.id === id)?.name ?? '未命名';
    this.dirtyBadge.hidden = !dirty;
    if (items !== this.items) {
      const focusedRow = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-rhythm-id]')?.dataset.rhythmId;
      this.items = items;
      this.list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('li'); empty.className = 'library-empty'; empty.textContent = '还没有保存的节奏';
        this.list.append(empty);
      }
      for (const item of [...items].sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)) {
        const row = document.createElement('li'); row.dataset.rhythmId = item.id;
        const load = this.button(item.name, () => this.actions.load(item.id)); load.className = 'rhythm-load';
        const meta = document.createElement('span'); meta.className = 'rhythm-meta'; meta.textContent = `${item.rhythm.pattern.stepsPerBar} 步 · ${item.rhythm.bpm} BPM`;
        const tools = document.createElement('div'); tools.className = 'rhythm-item-actions';
        const inline = document.createElement('div'); inline.className = 'rhythm-item-editor'; inline.hidden = true;
        tools.append(
          this.button('导出', () => this.actions.export(item.id), `导出「${item.name}」`),
          this.button('改名', () => {
            inline.hidden = false;
            this.nameForm(inline, '节奏新名称', item.name, name => { this.actions.rename(item.id, name); }, () => { inline.hidden = true; tools.querySelectorAll<HTMLButtonElement>('button')[1].focus(); });
          }, `改名「${item.name}」`),
          this.button('删除', () => {
            inline.hidden = false; inline.replaceChildren();
            const text = document.createElement('p'); text.textContent = '确定删除？';
            const remove = this.button('删除', () => this.actions.delete(item.id));
            inline.append(text, remove, this.button('取消', () => { inline.hidden = true; tools.querySelectorAll<HTMLButtonElement>('button')[2].focus(); }));
            remove.focus();
          }, `删除「${item.name}」`),
        );
        row.append(load, meta, tools, inline); this.list.append(row);
      }
      if (focusedRow) {
        const row = Array.from(this.list.children).find(row => (row as HTMLElement).dataset.rhythmId === focusedRow);
        (row?.querySelector<HTMLButtonElement>('.rhythm-load') ?? this.root.querySelector<HTMLButtonElement>('[data-library="save"]'))!.focus();
      }
    }
    this.list.querySelectorAll<HTMLElement>('[data-rhythm-id]').forEach(row => {
      const selected = row.dataset.rhythmId === id;
      row.classList.toggle('is-loaded', selected);
      row.querySelector('button')!.setAttribute('aria-current', String(selected));
    });
  }

  private nameForm(host: HTMLElement, label: string, value: string, submit: (name: string) => void, cancel: () => void): void {
    host.replaceChildren();
    const form = document.createElement('form'); form.className = 'rhythm-name-form';
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = 40; input.value = value;
    input.placeholder = '留空自动命名'; input.setAttribute('aria-label', label);
    const confirm = this.button('确定', () => {}); confirm.type = 'submit';
    form.append(input, confirm, this.button('取消', cancel));
    form.addEventListener('submit', event => { event.preventDefault(); submit(input.value); });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    host.append(form); input.focus(); input.select();
  }

  openName(submit: (name: string) => void, cancel: () => void = () => {}): void {
    this.editor.hidden = false;
    this.cancelName = cancel;
    this.nameForm(this.editor, '节奏名称', '', submit, () => {
      this.editor.hidden = true; this.cancelName = undefined; cancel();
      this.root.querySelector<HTMLButtonElement>('[data-library="save-as"]')!.focus();
    });
  }

  closeName(): void { this.editor.hidden = true; this.editor.replaceChildren(); this.cancelName = undefined; }

  confirm(save: () => void, proceed: () => void, cancel: () => void): void {
    this.cancelName?.(); this.closeName();
    this.confirmation.hidden = false; this.confirmation.replaceChildren();
    const text = document.createElement('p'); text.textContent = '当前节奏还没保存';
    const saveButton = this.button('先保存', save);
    this.confirmation.append(text, saveButton, this.button('不保存，继续', proceed), this.button('取消', cancel));
    saveButton.focus();
  }

  closeConfirm(): void { this.confirmation.hidden = true; this.confirmation.replaceChildren(); }
  message(text: string, error = false): void { this.status.textContent = text; this.status.classList.toggle('is-error', error); }
}

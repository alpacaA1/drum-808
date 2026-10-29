import { TRACKS, validateSession, type Session } from './pattern';

export type Rhythm = Omit<Session, 'master'>;
export interface SavedRhythm { id: string; name: string; createdAt: number; updatedAt: number; rhythm: Rhythm }
export interface CurrentRhythm { id: string | null; savedHash: string }
export interface LibraryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const LIBRARY_KEY = 'drum808.library.v1';
export const CURRENT_KEY = 'drum808.current.v1';
export const MAX_ITEMS = 200;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= 40;

/** Canonical order and independent copies, including when the source is a Session with master. */
export function toRhythm(source: Rhythm): Rhythm {
  return {
    pattern: { stepsPerBar: source.pattern.stepsPerBar, tracks: TRACKS.map(({ id, name }) => ({ id, name, steps: [...source.pattern.tracks.find(track => track.id === id)!.steps] })) },
    bpm: source.bpm,
    swing: source.swing,
    mixer: Object.fromEntries(TRACKS.map(({ id }) => {
      const mix = source.mixer[id];
      return [id, { volume: mix.volume, tone: mix.tone, mute: mix.mute, solo: mix.solo }];
    })) as Session['mixer'],
  };
}

export const rhythmHash = (rhythm: Rhythm): string => JSON.stringify(toRhythm(rhythm));

export function validateRhythm(value: unknown): Rhythm | null {
  if (!object(value)) return null;
  const session = validateSession({ ...value, version: 1, master: 0.75 });
  return session ? toRhythm(session) : null;
}

export function uniqueName(input: string, items: readonly Pick<SavedRhythm, 'name'>[]): string {
  let base = input.trim();
  if (Array.from(base).length > 40) throw new Error('名称最多 40 个字');
  const names = new Set(items.map(item => item.name));
  if (!base) {
    let index = 1;
    while (names.has(`我的节奏 ${index}`)) index++;
    base = `我的节奏 ${index}`;
  }
  let name = base;
  for (let index = 2; names.has(name); index++) {
    const suffix = ` (${index})`;
    name = Array.from(base).slice(0, 40 - suffix.length).join('') + suffix;
  }
  return name;
}

export function addRhythm(items: readonly SavedRhythm[], name: string, rhythm: Rhythm, now = Date.now()): SavedRhythm {
  if (items.length >= MAX_ITEMS) throw new Error('节奏库最多保存 200 段，请先导出备份并删除部分节奏');
  return { id: crypto.randomUUID(), name: uniqueName(name, items), createdAt: now, updatedAt: now, rhythm: toRhythm(rhythm) };
}

export interface LibraryRead { items: SavedRhythm[]; writable: boolean; error?: string }

export function readLibrary(storage: LibraryStorage, now = Date.now()): LibraryRead {
  try {
    const raw = storage.getItem(LIBRARY_KEY);
    if (raw === null) return { items: [], writable: true };
    let data: unknown;
    try {
      data = JSON.parse(raw);
      if (!object(data) || data.version !== 1 || !Array.isArray(data.items)) throw new Error('格式不匹配');
    } catch {
      // A failed backup must prevent all subsequent writes to the original key.
      let key = `drum808.library.corrupt.${now}`;
      while (storage.getItem(key) !== null) key += '.1';
      storage.setItem(key, raw);
      return { items: [], writable: true, error: '节奏库数据损坏，原始内容已备份' };
    }
    const items: SavedRhythm[] = [];
    const ids = new Set<string>();
    for (const item of (data as { items: unknown[] }).items) {
      if (!object(item) || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id) || !validName(item.name) || !timestamp(item.createdAt) || !timestamp(item.updatedAt)) continue;
      const rhythm = validateRhythm(item.rhythm);
      if (!rhythm || items.length >= MAX_ITEMS) continue;
      ids.add(item.id);
      items.push({ id: item.id, name: uniqueName(item.name, items), createdAt: item.createdAt, updatedAt: item.updatedAt, rhythm });
    }
    return { items, writable: true };
  } catch {
    return { items: [], writable: false, error: '浏览器无法读取或备份节奏库，请导出文件保留当前内容' };
  }
}

/** Recheck storage on every write: a failed read or safety copy must never overwrite it. */
export function writeLibrary(storage: LibraryStorage, items: readonly SavedRhythm[]): boolean {
  try {
    if (!readLibrary(storage).writable) return false;
    storage.setItem(LIBRARY_KEY, JSON.stringify({ version: 1, items }));
    return true;
  } catch { return false; }
}

export function readCurrent(raw: string | null, fallback: Rhythm, items: readonly SavedRhythm[]): CurrentRhythm {
  try {
    const data: unknown = JSON.parse(raw ?? 'null');
    if (object(data) && (data.id === null || (typeof data.id === 'string' && items.some(item => item.id === data.id))) && typeof data.savedHash === 'string') {
      const baseline = validateRhythm(JSON.parse(data.savedHash));
      if (baseline) return { id: data.id, savedHash: rhythmHash(baseline) };
    }
  } catch { /* Legacy sessions start clean without changing their contents. */ }
  return { id: null, savedHash: rhythmHash(fallback) };
}

export function exportRhythm(item: SavedRhythm): string {
  return JSON.stringify({ type: 'drum808-rhythm', version: 1, name: item.name, rhythm: toRhythm(item.rhythm) }, null, 2);
}

export function exportLibrary(items: readonly SavedRhythm[]): string {
  return JSON.stringify({ type: 'drum808-library', version: 1, items: items.map(({ name, createdAt, updatedAt, rhythm }) => ({ name, createdAt, updatedAt, rhythm: toRhythm(rhythm) })) }, null, 2);
}

export interface ImportResult { items: SavedRhythm[]; added: number; skipped: number; full: number }

export function importRhythms(json: string, filename: string, existing: readonly SavedRhythm[], now = Date.now()): ImportResult {
  const result: ImportResult = { items: [...existing], added: 0, skipped: 0, full: 0 };
  let data: unknown;
  try { data = JSON.parse(json); } catch { result.skipped++; return result; }
  if (!object(data) || data.version !== 1) { result.skipped++; return result; }
  const append = (name: unknown, rhythm: Rhythm | null, createdAt: unknown = now, updatedAt: unknown = now) => {
    if (typeof name !== 'string' || Array.from(name.trim()).length > 40 || !rhythm || !timestamp(createdAt) || !timestamp(updatedAt)) { result.skipped++; return; }
    if (result.items.length >= MAX_ITEMS) { result.full++; return; }
    const item = addRhythm(result.items, name, rhythm, now);
    result.items.push({ ...item, createdAt, updatedAt });
    result.added++;
  };
  if (data.type === 'drum808-rhythm') append(data.name, validateRhythm(data.rhythm));
  else if (data.type === 'drum808-library' && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (!object(item)) { result.skipped++; continue; }
      append(item.name, validateRhythm(item.rhythm), item.createdAt ?? NaN, item.updatedAt ?? NaN);
    }
  } else if (data.type === undefined) {
    const session = validateSession(data);
    append(Array.from(filename.replace(/\.[^.]*$/, '')).slice(0, 40).join(''), session ? toRhythm(session) : null);
  } else result.skipped++;
  return result;
}

export function downloadName(name: string | null, date = new Date()): string {
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return name === null ? `drum808-library-${day}.json` : `drum808-${name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').trim() || '我的节奏'}-${day}.json`;
}

import { describe, expect, it } from 'vitest';
import { defaultSession, serialize, type Session } from '../src/sequencer/pattern';
import { CURRENT_KEY, LIBRARY_KEY, MAX_ITEMS, addRhythm, downloadName, exportLibrary, exportRhythm, importRhythms, readCurrent, readLibrary, rhythmHash, toRhythm, uniqueName, writeLibrary, type LibraryStorage } from '../src/sequencer/library';

function memory(): LibraryStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
}
const saved = () => addRhythm([], '测试节奏', defaultSession(), 1000);

describe('library validation and safety', () => {
  it('drops invalid items independently and validates all rhythm fields with the session validator', () => {
    const item = saved();
    const invalid = [
      { ...item, id: '' }, { ...item, id: 'bad-date', createdAt: 'yesterday' },
      { ...item, id: 'bad-name', name: 'a'.repeat(41) },
      ...[
        { ...item.rhythm, bpm: 201 }, { ...item.rhythm, swing: NaN },
        { ...item.rhythm, pattern: { ...item.rhythm.pattern, stepsPerBar: 15 } },
        { ...item.rhythm, pattern: { ...item.rhythm.pattern, tracks: [] } },
        { ...item.rhythm, mixer: {} },
        { ...item.rhythm, mixer: { ...item.rhythm.mixer, CH: { ...item.rhythm.mixer.CH, tone: 2 } } },
      ].map((rhythm, index) => ({ ...item, id: `invalid-${index}`, rhythm })),
    ];
    const badStep = structuredClone(item); badStep.id = 'bad-step'; badStep.rhythm.pattern.tracks[0].steps[0] = 4 as never;
    const storage = memory();
    storage.setItem(LIBRARY_KEY, JSON.stringify({ version: 1, items: [null, ...invalid, badStep, item, { ...item, id: 'valid-2', name: '第二段' }] }));
    expect(readLibrary(storage).items).toEqual([item, { ...item, id: 'valid-2', name: '第二段' }]);
  });

  it('copies the exact corrupt string before any replacement and never overwrites a failed backup', () => {
    const storage = memory();
    storage.setItem(LIBRARY_KEY, '{broken');
    expect(readLibrary(storage, 1234)).toMatchObject({ items: [], writable: true });
    expect(storage.getItem('drum808.library.corrupt.1234')).toBe('{broken');
    expect(storage.getItem(LIBRARY_KEY)).toBe('{broken');
    expect(writeLibrary(storage, [saved()])).toBe(true);
    expect(readLibrary(storage).items).toHaveLength(1);

    storage.setItem(LIBRARY_KEY, '{still-broken');
    const failingBackup: LibraryStorage = { getItem: storage.getItem, setItem: (key, value) => {
      if (key.startsWith('drum808.library.corrupt.')) throw new Error('full');
      storage.setItem(key, value);
    } };
    expect(readLibrary(failingBackup).writable).toBe(false);
    expect(writeLibrary(failingBackup, [saved()])).toBe(false);
    expect(storage.getItem(LIBRARY_KEY)).toBe('{still-broken');
  });

  it('fails closed on unavailable reads and catches quota failures without throwing', () => {
    const unreadable: LibraryStorage = { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('must not write'); } };
    expect(readLibrary(unreadable)).toMatchObject({ items: [], writable: false });
    expect(writeLibrary(unreadable, [saved()])).toBe(false);
    expect(writeLibrary({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, [saved()])).toBe(false);
  });
});

describe('names, limits and hashes', () => {
  it('trims, defaults, de-duplicates and keeps suffixed names within 40 characters', () => {
    expect(uniqueName('  测试节奏  ', [])).toBe('测试节奏');
    expect(uniqueName(' ', [])).toBe('我的节奏 1');
    expect(uniqueName('', [{ name: '我的节奏 1' }])).toBe('我的节奏 2');
    expect(uniqueName('测试节奏', [{ name: '测试节奏' }, { name: '测试节奏 (2)' }])).toBe('测试节奏 (3)');
    expect(uniqueName('长'.repeat(40), [{ name: '长'.repeat(40) }])).toBe('长'.repeat(36) + ' (2)');
    expect(() => uniqueName('a'.repeat(41), [])).toThrow('40');
  });

  it('refuses adding beyond 200 without mutating existing items, including imports', () => {
    const item = saved();
    const items = Array.from({ length: MAX_ITEMS }, (_, index) => ({ ...item, id: String(index), name: `节奏 ${index}` }));
    expect(() => addRhythm(items, '多余', item.rhythm)).toThrow('200');
    expect(importRhythms(exportRhythm(item), 'test.json', items)).toMatchObject({ added: 0, skipped: 0, full: 1, items });
    expect(items).toHaveLength(200);
  });

  it('hashes independently of object key/track order and excludes master, but includes every rhythm setting', () => {
    const session = defaultSession();
    const reordered = {
      mixer: Object.fromEntries(Object.entries(session.mixer).reverse().map(([id, mix]) => [id, { solo: mix.solo, mute: mix.mute, tone: mix.tone, volume: mix.volume }])),
      swing: session.swing, bpm: session.bpm, master: 0.1,
      pattern: { tracks: [...session.pattern.tracks].reverse(), stepsPerBar: session.pattern.stepsPerBar },
    } as Session;
    expect(rhythmHash(reordered)).toBe(rhythmHash(session));
    expect(toRhythm(session)).not.toHaveProperty('master');
    const variations = [
      (copy: Session) => { copy.bpm++; }, (copy: Session) => { copy.swing++; },
      (copy: Session) => { copy.pattern.tracks[0].steps[0] = 1; },
      (copy: Session) => { copy.mixer.CH.volume = 0.3; }, (copy: Session) => { copy.mixer.SD.tone = 0.2; },
      (copy: Session) => { copy.mixer.BD.mute = true; }, (copy: Session) => { copy.mixer.OH.solo = true; },
    ];
    for (const mutate of variations) { const copy = structuredClone(session); mutate(copy); expect(rhythmHash(copy)).not.toBe(rhythmHash(session)); }
    const rhythm = toRhythm(session); rhythm.pattern.tracks[0].steps[0] = 0;
    expect(session.pattern.tracks[0].steps[0]).toBe(3);
  });

  it('reads legacy and saved current baselines, retaining dirty comparison across reloads', () => {
    const session = defaultSession(), item = saved();
    expect(CURRENT_KEY).toBe('drum808.current.v1');
    expect(readCurrent(null, session, [item])).toEqual({ id: null, savedHash: rhythmHash(session) });
    const current = { id: item.id, savedHash: rhythmHash(item.rhythm) };
    session.bpm++;
    expect(readCurrent(JSON.stringify(current), session, [item])).toEqual(current);
    expect(readCurrent(JSON.stringify(current), session, []).id).toBe(null);
  });
});

describe('file interchange', () => {
  it('imports single rhythm, full library and a test-authored legacy raw session', () => {
    const item = saved();
    const single = importRhythms(exportRhythm(item), 'single.json', [], 2000);
    expect(single).toMatchObject({ added: 1, skipped: 0 });
    expect(single.items[0].rhythm).toEqual(item.rhythm);
    expect(single.items[0].id).not.toBe(item.id);
    const all = importRhythms(exportLibrary([item]), 'all.json', [], 2000);
    expect(all.items[0]).toMatchObject({ name: item.name, createdAt: 1000, updatedAt: 1000, rhythm: item.rhythm });
    // A raw-session fixture generated here; never read the user's backup.
    const fixture = defaultSession(); fixture.bpm = 169; fixture.swing = 71; fixture.master = 0.2;
    const legacy = importRhythms(serialize(fixture), '旧版备份.json', [], 2000);
    expect(legacy.items[0]).toMatchObject({ name: '旧版备份', rhythm: toRhythm(fixture) });
    expect(legacy.items[0].rhythm).not.toHaveProperty('master');
  });

  it('preserves export→import equality and timestamps; duplicate imports add independent copies', () => {
    const item = saved();
    const once = importRhythms(exportLibrary([item]), 'all.json', []);
    expect(JSON.parse(exportLibrary(once.items))).toEqual(JSON.parse(exportLibrary([item])));
    const twice = importRhythms(exportRhythm(item), 'single.json', once.items);
    expect(twice.items.map(item => item.name)).toEqual(['测试节奏', '测试节奏 (2)']);
    expect(new Set(twice.items.map(item => item.id)).size).toBe(2);
    expect(once.items).toHaveLength(1);
  });

  it('skips malformed files/entries without changing the existing library', () => {
    const item = saved();
    for (const invalid of ['{', 'null', '[]', '{}', '{"type":"drum808-rhythm","version":2}', JSON.stringify({ type: 'drum808-library', version: 1, items: {} })]) {
      expect(importRhythms(invalid, 'bad.json', [item])).toMatchObject({ items: [item], added: 0, skipped: 1 });
    }
    const data = JSON.parse(exportLibrary([item]));
    data.items.push(null, { ...data.items[0], rhythm: { ...item.rhythm, bpm: 0 } });
    expect(importRhythms(JSON.stringify(data), 'mixed.json', [item])).toMatchObject({ added: 1, skipped: 2 });
  });

  it('uses dated filenames, preserves CJK and removes unsafe filename characters', () => {
    const date = new Date(2026, 9, 29);
    expect(downloadName('我的/节奏\\:*?"<>|', date)).toBe('drum808-我的节奏-20261029.json');
    expect(downloadName(null, date)).toBe('drum808-library-20261029.json');
  });
});

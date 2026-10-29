import { expect, test, type Page } from '@playwright/test';
import { defaultSession, serialize } from '../../src/sequencer/pattern';
import { toRhythm } from '../../src/sequencer/library';
import { setKnob } from './controls';

const artifacts = '.codex-runs/20261029-135010-save-library/artifacts-1';
// This browser-focused project has no @types/node dependency; describe only the built-in I/O used here.
const fileSystemModule = 'node:fs/promises';
const { readFile, writeFile } = await import(fileSystemModule) as {
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
};
async function jsonFile(name: string, content: string): Promise<string> {
  const path = `${artifacts}/${name}`;
  await writeFile(path, content);
  return path;
}
const section = (page: Page) => page.getByRole('region', { name: '我的节奏', exact: true });
const cell = (page: Page) => page.locator('.step[data-track="BD"][data-step="1"]');
const working = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('drum808.session.v1')!));
const library = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('drum808.library.v1')!).items);
async function saveAs(page: Page, name: string) {
  await section(page).getByRole('button', { name: '另存为…', exact: true }).click();
  await expect(page.getByLabel('节奏名称', { exact: true })).toBeFocused();
  await page.getByLabel('节奏名称', { exact: true }).fill(name);
  await page.getByLabel('节奏名称', { exact: true }).press('Enter');
  await expect(section(page).getByRole('button', { name, exact: true })).toBeVisible();
}

test('save, reload, overwrite, dirty preset protection, exact restore, rename, download/import and delete', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await cell(page).click();
  await page.getByLabel('BPM 数值').fill('154');
  await setKnob(page, 'Swing', 64);
  await setKnob(page, '底鼓音量', 67);
  await setKnob(page, '底鼓衰减', 81);
  await page.getByLabel('军鼓静音').click();
  await saveAs(page, '测试节奏');
  await expect(section(page).getByRole('status')).toHaveText('已保存「测试节奏」');
  await expect(page.locator('.dirty-badge')).toBeHidden();
  await page.reload();
  await expect(page.locator('#rhythm-current-name')).toHaveText('测试节奏');
  await expect(section(page).getByRole('button', { name: '测试节奏', exact: true })).toHaveAttribute('aria-current', 'true');
  await cell(page).click();
  await expect(page.locator('.dirty-badge')).toBeVisible();
  await section(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.dirty-badge')).toBeHidden();
  expect(await library(page)).toHaveLength(1);
  const savedState = await working(page);
  expect((await library(page))[0].rhythm).toEqual(toRhythm(savedState));

  // Global listening volume neither dirties the rhythm nor loads from a saved item.
  await setKnob(page, '主音量', 23);
  await expect(page.locator('.dirty-badge')).toBeHidden();
  await cell(page).click();
  const beforeCancel = await working(page);
  const beforePreset = await page.locator('#preset').inputValue();
  await page.locator('#preset').selectOption('jazz');
  await expect(page.getByText('当前节奏还没保存', { exact: true })).toBeVisible();
  await page.locator('.dirty-confirm').getByRole('button', { name: '取消', exact: true }).click();
  expect(await working(page)).toEqual(beforeCancel);
  await expect(page.locator('#preset')).toHaveValue(beforePreset);
  await page.locator('#preset').selectOption('jazz');
  await page.getByRole('button', { name: '不保存，继续', exact: true }).click();
  await expect(page.locator('#preset')).toHaveValue('jazz');
  await expect(page.getByLabel('BPM 数值')).toHaveValue('96');
  await section(page).getByRole('button', { name: '测试节奏', exact: true }).click();
  expect(toRhythm(await working(page))).toEqual(toRhythm(savedState));
  await expect(page.getByRole('slider', { name: '主音量', exact: true })).toHaveAttribute('aria-valuenow', '23');

  await page.getByRole('button', { name: '改名「测试节奏」', exact: true }).click();
  await expect(page.getByLabel('节奏新名称')).toBeFocused();
  await page.getByLabel('节奏新名称').fill('取消改名');
  await page.getByLabel('节奏新名称').press('Escape');
  await expect(page.locator('#rhythm-current-name')).toHaveText('测试节奏');
  await page.getByRole('button', { name: '改名「测试节奏」', exact: true }).click();
  await page.getByLabel('节奏新名称').fill('测试改名');
  await page.getByLabel('节奏新名称').press('Enter');
  await expect(page.locator('#rhythm-current-name')).toHaveText('测试改名');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出「测试改名」', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^drum808-测试改名-\d{8}\.json$/);
  const downloadPath = `${artifacts}/${download.suggestedFilename()}`;
  await download.saveAs(downloadPath);
  const exported = JSON.parse(await readFile(downloadPath, 'utf8'));
  expect(exported).toEqual({ type: 'drum808-rhythm', version: 1, name: '测试改名', rhythm: (await library(page))[0].rhythm });
  await page.locator('#rhythm-import').setInputFiles(downloadPath);
  await expect(section(page).getByRole('button', { name: '测试改名 (2)', exact: true })).toBeVisible();
  expect((await library(page))[1].rhythm).toEqual(exported.rhythm);
  await page.locator('#rhythm-import').setInputFiles(await jsonFile('旧版节奏.json', serialize(savedState)));
  await expect(section(page).getByRole('button', { name: '旧版节奏', exact: true })).toBeVisible();
  const beforeInvalid = await library(page);
  await page.locator('#rhythm-import').setInputFiles(await jsonFile('invalid.json', '{broken'));
  await expect(section(page).getByRole('status')).toContainText('已导入 0 段，跳过 1 个无效');
  expect(await library(page)).toEqual(beforeInvalid);

  await page.getByRole('button', { name: '删除「测试改名 (2)」', exact: true }).click();
  const inline = page.locator('.rhythm-item-editor').filter({ hasText: '确定删除？' });
  await inline.getByRole('button', { name: '取消', exact: true }).click();
  expect(await library(page)).toHaveLength(3);
  await page.getByRole('button', { name: '删除「测试改名 (2)」', exact: true }).click();
  await inline.getByRole('button', { name: '删除', exact: true }).click();
  expect(await library(page)).toHaveLength(2);
  await page.reload();
  await expect(section(page).getByRole('button', { name: '测试改名', exact: true })).toBeVisible();
  await expect(section(page).getByRole('button', { name: '测试改名 (2)', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('legacy session starts unnamed and clean; save-first, Escape, grid/clear/library protection and playback regrid work', async ({ page }) => {
  const fixture = defaultSession(); fixture.bpm = 143; fixture.swing = 63; fixture.master = 0.42;
  await page.addInitScript(raw => { localStorage.setItem('drum808.session.v1', raw); }, serialize(fixture));
  await page.goto('/');
  await expect(page.locator('#rhythm-current-name')).toHaveText('未命名');
  await expect(page.locator('.dirty-badge')).toBeHidden();
  await expect(page.getByLabel('BPM 数值')).toHaveValue('143');
  await expect(page.locator('.step[data-track="BD"][data-step="0"]')).toHaveAttribute('data-velocity', '3');
  expect(await working(page)).toEqual({ version: 1, ...fixture });
  await page.locator('#preset').selectOption('jazzride');
  await expect(page.locator('.dirty-confirm')).toBeHidden();
  await expect(page.locator('.step[data-track="BD"]')).toHaveCount(12);
  await saveAs(page, '三连节奏');
  await page.getByRole('radio', { name: /16/ }).click();
  await expect(page.locator('.step[data-track="BD"]')).toHaveCount(16);
  await expect(page.locator('.dirty-badge')).toBeVisible();
  const before = await working(page);
  await page.getByRole('radio', { name: /24/ }).click();
  await expect(page.locator('.dirty-confirm')).toBeVisible();
  await page.getByRole('button', { name: '先保存', exact: true }).click();
  await expect(page.getByLabel('节奏名称', { exact: true })).toBeFocused();
  // All new text inputs retain typing/Space and never play pads or transport.
  await page.getByLabel('节奏名称', { exact: true }).press('a');
  await page.getByLabel('节奏名称', { exact: true }).press('Space');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await page.getByLabel('节奏名称', { exact: true }).press('Escape');
  expect(await working(page)).toEqual(before);
  await page.locator('.dirty-confirm').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('radio', { name: /16/ })).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('button', { name: /清空节奏/ }).click();
  await page.getByRole('button', { name: '先保存', exact: true }).click();
  await page.getByLabel('节奏名称', { exact: true }).fill('清空前备份');
  await page.getByLabel('节奏名称', { exact: true }).press('Enter');
  await expect(page.locator('.step:not([data-velocity="0"])')).toHaveCount(0);
  expect((await library(page))[1].rhythm).toEqual(toRhythm(before));
  expect(await library(page)).toHaveLength(2);
  await section(page).getByRole('button', { name: '三连节奏', exact: true }).click();
  await expect(page.locator('.dirty-confirm')).toBeVisible();
  await page.getByRole('button', { name: '不保存，继续', exact: true }).click();
  await expect(page.locator('.step[data-track="BD"]')).toHaveCount(12);
  await expect(page.getByLabel('BPM 数值')).toHaveValue('132');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.locator('[data-led-step].is-lit')).toHaveCount(1);
  await section(page).getByRole('button', { name: '清空前备份', exact: true }).click();
  await expect(page.locator('.step[data-track="BD"]')).toHaveCount(16);
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(page.locator('[data-led-step].is-lit')).toHaveCount(1);
  await page.getByRole('button', { name: '停止', exact: true }).click();
});

test('storage failures preserve corrupt originals and keep in-memory rhythms exportable', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('drum808.library.v1', '{original-corrupt');
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await expect(section(page).getByRole('status')).toContainText('无法读取或备份');
  await cell(page).click();
  await saveAs(page, '内存节奏');
  await expect(section(page).getByRole('status')).toContainText('浏览器无法保存');
  expect(await page.evaluate(() => localStorage.getItem('drum808.library.v1'))).toBe('{original-corrupt');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出「内存节奏」', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(`${artifacts}/memory-rhythm.json`);
  expect(JSON.parse(await readFile(`${artifacts}/memory-rhythm.json`, 'utf8')).name).toBe('内存节奏');
});

test('a successful library write never hides a working-session storage failure or continues the pending load', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'drum808.session.v1' || key === 'drum808.current.v1') throw new DOMException('full', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.goto('/');
  await cell(page).click();
  await page.locator('#preset').selectOption('jazz');
  await page.getByRole('button', { name: '先保存', exact: true }).click();
  await page.getByLabel('节奏名称', { exact: true }).fill('部分写入备份');
  await page.getByLabel('节奏名称', { exact: true }).press('Enter');
  await expect(section(page).getByRole('status')).toContainText('浏览器无法保存');
  expect(await library(page)).toHaveLength(1);
  await expect(page.locator('#preset')).toHaveValue('custom');
  await expect(page.getByLabel('BPM 数值')).toHaveValue('128');
  await expect(page.locator('.dirty-confirm')).toBeVisible();
});

test('safe names, multi-file import, export-all, persisted dirty baseline and required responsive screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await saveAs(page, '电气练习');
  await page.locator('#preset').selectOption('jazz');
  await saveAs(page, '午夜切分');
  await page.locator('#preset').selectOption('jazzride');
  await saveAs(page, '爵士三连');
  await page.getByLabel('BPM 数值').fill('140');
  await page.reload();
  await expect(page.locator('.dirty-badge')).toBeVisible();
  await expect(page.locator('#rhythm-current-name')).toHaveText('爵士三连');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/library-desktop-1440.png` });
  await page.locator('#preset').selectOption('floor');
  await expect(page.locator('.dirty-confirm')).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/library-dirty-confirm-1440.png` });
  await page.locator('.dirty-confirm').getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await section(page).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(section(page)).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `${artifacts}/library-phone-390.png` });

  const allPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出全部', exact: true }).click();
  const all = await allPromise;
  expect(all.suggestedFilename()).toMatch(/^drum808-library-\d{8}\.json$/);
  await all.saveAs(`${artifacts}/export-library.json`);
  const data = JSON.parse(await readFile(`${artifacts}/export-library.json`, 'utf8'));
  expect(data.items).toHaveLength(3);
  await page.locator('#rhythm-import').setInputFiles([
    await jsonFile('safe.json', JSON.stringify({ type: 'drum808-rhythm', version: 1, name: '<img src=x onerror=alert(1)>', rhythm: data.items[0].rhythm })),
    await jsonFile('bad.json', '{}'),
  ]);
  await expect(section(page).getByRole('status')).toContainText('已导入 1 段，跳过 1 个无效');
  await expect(section(page).getByRole('status')).toContainText('safe.json：已导入 1 段');
  await expect(section(page).getByRole('button', { name: '<img src=x onerror=alert(1)>', exact: true })).toBeVisible();
  await expect(section(page).locator('img')).toHaveCount(0);
});

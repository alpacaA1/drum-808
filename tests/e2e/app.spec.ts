import { expect, test } from '@playwright/test';

const artifacts = '.codex-runs/20261028-144635-m1-sequencer/artifacts-2';

test('desktop editing, transport, controls, persistence and screenshots', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Drum 808' })).toBeVisible();
  await expect(page.locator('.step')).toHaveCount(128);
  await page.locator('#preset').selectOption('jazz');
  await expect(page.locator('#swing-value')).toHaveText('64');
  await expect(page.locator('.panel-footer')).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: `${artifacts}/desktop-stopped.png` });
  await page.getByRole('button', { name: /清空节奏/ }).click();
  const cell = page.locator('.step[data-track="BD"][data-step="0"]');
  await cell.click();
  await expect(cell).toHaveAttribute('data-velocity', '2');
  await cell.click({ button: 'right' });
  await expect(cell).toHaveAttribute('data-velocity', '3');
  await cell.click({ modifiers: ['Alt'] });
  await expect(cell).toHaveAttribute('data-velocity', '1');
  const row = page.locator('.step[data-track="SD"]');
  const first = await row.nth(0).boundingBox();
  const fourth = await row.nth(3).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(fourth!.x + fourth!.width / 2, fourth!.y + fourth!.height / 2, { steps: 20 });
  await page.mouse.up();
  for (let index = 0; index < 4; index++) await expect(row.nth(index)).toHaveAttribute('data-velocity', '2');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.locator('.step-heading.is-current')).toHaveCount(1);
  const initial = await page.locator('.step-heading.is-current').getAttribute('data-head');
  await page.waitForTimeout(1000);
  const later = await page.locator('.step-heading.is-current').getAttribute('data-head');
  expect(later).not.toBe(initial);
  await page.screenshot({ path: `${artifacts}/desktop-playing.png` });
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.locator('.is-current')).toHaveCount(0);
  await page.getByLabel('BPM 数值').fill('146');
  await page.getByLabel('BPM 数值').press('Tab');
  await expect(page.getByLabel('BPM', { exact: true })).toHaveValue('146');
  await page.getByLabel('Swing', { exact: true }).fill('69');
  await expect(page.locator('#swing-value')).toHaveText('69');
  await page.getByLabel('底鼓静音').click();
  await page.getByLabel('军鼓独奏').click();
  await page.getByLabel('开镲衰减').fill('73');
  await page.getByLabel('主音量', { exact: true }).fill('61');
  await page.reload();
  await expect(cell).toHaveAttribute('data-velocity', '1');
  await expect(page.getByLabel('BPM 数值')).toHaveValue('146');
  await expect(page.locator('#swing-value')).toHaveText('69');
  await expect(page.getByLabel('底鼓静音')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('军鼓独奏')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('开镲衰减')).toHaveValue('73');
  await expect(page.getByLabel('主音量', { exact: true })).toHaveValue('61');
  // Space on the page toggles; focused inputs retain their normal keyboard behavior.
  await page.locator('h1').click();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.locator('.is-current')).toHaveCount(0);
  await page.getByLabel('BPM 数值').focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('BPM 数值')).toHaveValue('147');
  expect(errors).toEqual([]);
});

test('phone keeps usable step targets and sticky track names after horizontal scroll', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('#preset').selectOption('jazz');
  const track = page.locator('[data-track-panel="BD"]');
  const initialX = (await track.boundingBox())!.x;
  const cell = page.locator('.step[data-track="BD"][data-step="1"]');
  const rect = (await cell.boundingBox())!;
  expect(rect.width).toBeGreaterThanOrEqual(32);
  expect(rect.height).toBeGreaterThanOrEqual(32);
  // A real touch long-press cycles a lit step once and suppresses the trailing click.
  const accent = page.locator('.step[data-track="BD"][data-step="0"]');
  const box = (await accent.boundingBox())!;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await page.waitForTimeout(460);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(accent).toHaveAttribute('data-velocity', '1');
  await page.locator('.grid-scroll').evaluate(element => { element.scrollLeft = 245; });
  await expect.poll(async () => (await track.boundingBox())!.x).toBe(initialX);
  expect(await page.locator('.grid-scroll').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${artifacts}/phone-scrolled.png` });
  await page.screenshot({ path: `${artifacts}/phone-full.png`, fullPage: true });
  await context.close();
});

test('corrupt and unavailable storage, Worker fallback and alternate grid still work', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seed-corrupt')) {
      localStorage.setItem('drum808.session.v1', '{broken');
      sessionStorage.setItem('seed-corrupt', 'yes');
    }
  });
  await page.goto('/');
  await expect(page.locator('.step')).toHaveCount(128);
  // Seed a supported future grid via the actual persisted session, not a synthetic page.
  await page.locator('.step').first().click();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seed-grid')) {
      const state = JSON.parse(localStorage.getItem('drum808.session.v1')!);
      state.pattern.stepsPerBar = 12;
      state.pattern.tracks.forEach((track: { steps: number[] }) => { track.steps = track.steps.slice(0, 12); });
      localStorage.setItem('drum808.session.v1', JSON.stringify(state));
      sessionStorage.setItem('seed-grid', 'yes');
    }
  });
  await page.reload();
  await expect(page.locator('.step')).toHaveCount(96);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'Worker', { value: class { constructor() { throw new Error('不可用'); } } });
    Storage.prototype.setItem = () => { throw new Error('不可用'); };
  });
  await page.reload();
  await page.locator('.step').first().click();
  await expect(page.locator('#save-status')).toContainText('无法保存');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.locator('.step-heading.is-current')).toHaveCount(1);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.locator('.is-current')).toHaveCount(0);
});

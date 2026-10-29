import { expect, test, type Locator, type Page } from '@playwright/test';

const artifacts = '.codex-runs/20261029-135010-save-library/artifacts-1';
const values = (page: Page) => page.locator('.step').evaluateAll(cells => cells.map(cell => cell.getAttribute('data-velocity')));
async function dragUp(page: Page, knob: Locator, distance: number): Promise<void> {
  const rect = (await knob.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2 - distance, { steps: 12 });
  await page.mouse.up();
}

test('knobs support keyboard, capture drag, fine adjustment, reset and persistence without painting', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const before = await values(page);
  const bpm = page.getByRole('slider', { name: 'BPM', exact: true });
  await bpm.press('ArrowUp');
  await expect(page.getByLabel('BPM 数值')).toHaveValue('129');
  await expect(bpm).toHaveAttribute('aria-valuenow', '129');
  await bpm.press('End');
  await expect(page.getByLabel('BPM 数值')).toHaveValue('200');
  await bpm.press('ArrowUp');
  await expect(bpm).toHaveAttribute('aria-valuenow', '200');
  await bpm.press('Home');
  await expect(page.getByLabel('BPM 数值')).toHaveValue('60');
  await bpm.press('ArrowDown');
  await expect(bpm).toHaveAttribute('aria-valuenow', '60');
  await expect(bpm).toHaveAttribute('aria-valuetext', '60 BPM');
  await dragUp(page, bpm, 50);
  await expect(page.getByLabel('BPM 数值')).toHaveValue('95');
  await expect(bpm).not.toHaveClass(/is-dragging/);
  await page.mouse.move(10, 10);
  await expect(bpm).toHaveAttribute('aria-valuenow', '95');
  await bpm.dblclick();
  await expect(page.getByLabel('BPM 数值')).toHaveValue('128');
  await page.keyboard.down('Shift');
  await dragUp(page, bpm, 50);
  await page.keyboard.up('Shift');
  await expect(bpm).toHaveAttribute('aria-valuenow', '132');
  await bpm.press('PageUp');
  await expect(page.getByLabel('BPM 数值')).toHaveValue('142');
  await bpm.press('PageDown');
  await expect(page.getByLabel('BPM 数值')).toHaveValue('132');

  const volume = page.getByRole('slider', { name: '底鼓音量' });
  await volume.press('ArrowUp');
  await expect(page.locator('#track-volume-value')).toHaveText('81%');
  await volume.press('End');
  await expect(volume).toHaveAttribute('aria-valuenow', '100');
  await volume.press('ArrowUp');
  await expect(volume).toHaveAttribute('aria-valuenow', '100');
  await volume.press('Home');
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
  await volume.press('ArrowDown');
  await expect(volume).toHaveAttribute('aria-valuenow', '0');
  await volume.dblclick();
  await expect(volume).toHaveAttribute('aria-valuenow', '80');
  await volume.press('ArrowLeft');
  await expect(volume).toHaveAttribute('aria-valuenow', '79');
  expect(await values(page)).toEqual(before);
  await page.reload();
  await expect(page.getByLabel('BPM 数值')).toHaveValue('132');
  await expect(volume).toHaveAttribute('aria-valuenow', '79');
  expect(await values(page)).toEqual(before);
});

test('wheel adjusts only the hovered knob and leaves page scrolling available elsewhere', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto('/');
  const bpm = page.getByRole('slider', { name: 'BPM', exact: true });
  await bpm.hover();
  await page.mouse.wheel(0, -120);
  await expect(bpm).toHaveAttribute('aria-valuenow', '129');
  await page.mouse.wheel(0, 120);
  await expect(bpm).toHaveAttribute('aria-valuenow', '128');
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.locator('.grid-title').hover();
  await page.mouse.wheel(0, 350);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(bpm).toHaveAttribute('aria-valuenow', '128');
});

test('exactly one audio-clock LED advances and stop clears every LED', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.transport-led')).toHaveCount(16);
  await expect(page.locator('.transport-led.is-lit')).toHaveCount(0);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  const led = page.locator('.transport-led.is-lit');
  await expect(led).toHaveCount(1);
  const first = await led.getAttribute('data-led-step');
  await page.waitForTimeout(1000);
  await expect(led).toHaveCount(1);
  expect(await led.getAttribute('data-led-step')).not.toBe(first);
  expect(await led.getAttribute('data-led-step')).toBe(await page.locator('.step-heading.is-current').getAttribute('data-head'));
  await expect(page.locator('.playhead-column')).toBeVisible();
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await expect(page.locator('.transport-led.is-lit')).toHaveCount(0);
  await expect(page.locator('.playhead-column')).toBeHidden();
});

test('390px phone shows six complete steps, touch knobs capture and cancel without scrolling or painting', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/');
  const sizes = await page.locator('.step[data-track="BD"]').evaluateAll(cells => {
    const viewport = document.querySelector('.grid-scroll')!.getBoundingClientRect();
    return cells.map(cell => {
      const rect = cell.getBoundingClientRect();
      return { width: rect.width, height: rect.height, fullyVisible: rect.left >= viewport.left && rect.right <= Math.min(innerWidth, viewport.right) };
    });
  });
  expect(sizes.filter(cell => cell.fullyVisible).length).toBeGreaterThanOrEqual(6);
  for (const cell of sizes) { expect(cell.width).toBeGreaterThanOrEqual(32); expect(cell.height).toBeGreaterThanOrEqual(32); }
  const toggles = await page.locator('.mix-button').evaluateAll(buttons => buttons.map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
  for (const button of toggles) { expect(button.width).toBeGreaterThanOrEqual(28); expect(button.height).toBeGreaterThanOrEqual(28); }
  await expect(page.locator('[data-track-panel="BD"] .track-name')).toBeHidden();
  await expect(page.getByRole('button', { name: '底鼓，选择并试听' })).toHaveAttribute('title', '底鼓，选择并试听');
  console.log('390px phone fully visible steps:', sizes.filter(cell => cell.fullyVisible).length);
  const before = await values(page);
  const bpm = page.getByRole('slider', { name: 'BPM', exact: true });
  const box = (await bpm.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 20 }] });
  await expect(bpm).toHaveAttribute('aria-valuenow', '142');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(bpm).not.toHaveClass(/is-dragging/);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await values(page)).toEqual(before);
  await context.close();
});

test('top-bar knobs close-up at 2x device scale', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.locator('#preset').selectOption('jazz');
  const clip = await page.locator('.top-bar .rotary-control').evaluateAll(controls => {
    const rects = controls.map(control => control.getBoundingClientRect());
    const x = Math.min(...rects.map(rect => rect.x)) - 12;
    const y = Math.min(...rects.map(rect => rect.y)) - 12;
    return { x, y, width: Math.max(...rects.map(rect => rect.right)) - x + 12, height: Math.max(...rects.map(rect => rect.bottom)) - y + 12 };
  });
  await page.screenshot({ path: `${artifacts}/top-knobs-2x.png`, clip });
  await context.close();
});

test('swing knob pointer matches its readout and stores the 50–75% ratio', async ({ page }) => {
  await page.goto('/');
  const knob = page.getByRole('slider', { name: 'Swing', exact: true });
  const angle = () => knob.evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--knob-angle')));
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('drum808.session.v1')!).swing as number);
  await knob.press('End');
  await knob.press('Home');
  await expect(page.locator('#swing-value')).toHaveText('0');
  await expect(knob).toHaveAttribute('aria-valuetext', '直拍');
  expect(await angle()).toBeCloseTo(-135);
  expect(await stored()).toBe(50);
  await expect(knob.locator('.knob-value-arc')).toBeHidden();
  for (let count = 0; count < 5; count++) await knob.press('PageUp');
  await expect(page.locator('#swing-value')).toHaveText('50');
  expect(await angle()).toBeCloseTo(0);
  expect(await stored()).toBe(62.5);
  await knob.press('End');
  await expect(page.locator('#swing-value')).toHaveText('100');
  expect(await angle()).toBeCloseTo(135);
  expect(await stored()).toBe(75);
  await expect(knob.locator('.knob-mark text')).toHaveText('三连');
});

test('circling the knob rim turns it with the hand; dragging up from the centre stays vertical', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const before = await values(page);
  const bpm = page.getByRole('slider', { name: 'BPM', exact: true });
  await bpm.press('Home');
  const rect = (await bpm.boundingBox())!;
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2, r = rect.width / 2;
  const at = (deg: number) => [cx + Math.sin(deg * Math.PI / 180) * r, cy - Math.cos(deg * Math.PI / 180) * r] as const;
  // Clockwise from 9 o'clock over the top to 3 o'clock: 180° of a 270° sweep.
  await page.mouse.move(...at(-90));
  await page.mouse.down();
  const seen: number[] = [];
  for (let deg = -85; deg <= 90; deg += 5) {
    await page.mouse.move(...at(deg));
    seen.push(Number(await bpm.getAttribute('aria-valuenow')));
  }
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  expect(seen.at(-1)!).toBeGreaterThanOrEqual(151);
  expect(seen.at(-1)!).toBeLessThanOrEqual(155);
  // And back counter-clockwise.
  for (let deg = 85; deg >= -90; deg -= 5) await page.mouse.move(...at(deg));
  await page.mouse.up();
  expect(Number(await bpm.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(62);
  expect(await values(page)).toEqual(before);
});

test('small trackpad wheel deltas accumulate instead of jumping a step per event', async ({ page }) => {
  await page.goto('/');
  const bpm = page.getByRole('slider', { name: 'BPM', exact: true });
  await bpm.hover();
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -4);
  await expect(bpm).toHaveAttribute('aria-valuenow', '128');
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -4);
  await expect(bpm).toHaveAttribute('aria-valuenow', '129');
});

test('a rotary drag that passes through the knob centre re-anchors instead of jumping', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const bpm = page.getByRole('slider', { name: 'BPM', exact: true });
  await bpm.press('Home');
  const rect = (await bpm.boundingBox())!;
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2, r = rect.width / 2;
  await page.mouse.move(cx - r, cy);
  await page.mouse.down();
  // Start rotary mode with a tangential move up the left side, then cut straight through the centre.
  await page.mouse.move(cx - r, cy - 10, { steps: 3 });
  const beforeCross = Number(await bpm.getAttribute('aria-valuenow'));
  await page.mouse.move(cx, cy, { steps: 6 });
  await page.mouse.move(cx + r, cy + 10, { steps: 6 });
  await page.mouse.up();
  const after = Number(await bpm.getAttribute('aria-valuenow'));
  expect(Math.abs(after - beforeCross)).toBeLessThanOrEqual(12);
});

import { expect, test, type Page } from '@playwright/test';

const lit = (page: Page, track: string) => page.locator(`.step[data-track="${track}"]:not([data-velocity="0"])`);

test('triplet grids re-quantise the pattern, bypass swing and persist', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.step[data-track="BD"]')).toHaveCount(16);
  await expect(page.locator('.step[data-track="BD"][data-step="0"]')).not.toHaveAttribute('data-velocity', '0');

  await page.getByRole('radio', { name: /12/ }).click();
  await expect(page.getByRole('radio', { name: /12/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.step[data-track="BD"]')).toHaveCount(12);
  await expect(page.locator('[data-led-step]')).toHaveCount(12);
  await expect(page.locator('.step[data-track="BD"][data-step="0"]')).not.toHaveAttribute('data-velocity', '0');
  await expect(page.locator('.swing')).toHaveClass(/is-inactive/);
  await expect(page.locator('#pattern-meta')).toContainText('八分三连');

  await page.reload();
  await expect(page.locator('.step[data-track="BD"]')).toHaveCount(12);
  await page.getByRole('radio', { name: /24/ }).click();
  await expect(page.locator('.step[data-track="BD"]')).toHaveCount(24);
  await page.getByRole('radio', { name: /16/ }).click();
  await expect(page.locator('.step[data-track="BD"]')).toHaveCount(16);
  await expect(page.locator('.swing')).not.toHaveClass(/is-inactive/);
});

test('jazz ride preset plays on a 12-step grid', async ({ page }) => {
  await page.goto('/');
  await page.locator('#preset').selectOption('jazzride');
  await expect(page.locator('.step[data-track="OH"]')).toHaveCount(12);
  await expect(lit(page, 'OH')).toHaveCount(6);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const step = await page.locator('[data-led-step].is-lit').getAttribute('data-led-step').catch(() => null);
    if (step) seen.add(step);
    await page.waitForTimeout(90);
  }
  expect(seen.size).toBeGreaterThan(2);
  for (const step of seen) expect(Number(step)).toBeLessThan(12);
  await page.getByRole('button', { name: '停止', exact: true }).click();
});

test('keyboard plays tracks, records only while recording and playing, and ignores text inputs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /清空节奏/ }).click();
  await expect(lit(page, 'BD')).toHaveCount(0);

  // Not recording: keys only play.
  await page.locator('body').press('a');
  await expect(page.locator('[data-track-panel="BD"]')).toHaveClass(/is-hit/);
  await expect(lit(page, 'BD')).toHaveCount(0);

  await page.getByRole('button', { name: '录制' }).click();
  await expect(page.getByRole('button', { name: '录制' })).toHaveAttribute('aria-pressed', 'true');
  // Recording but stopped: still nothing written.
  await page.locator('body').press('a');
  await expect(lit(page, 'BD')).toHaveCount(0);

  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.locator('[data-led-step].is-lit')).toHaveCount(1);
  await page.locator('body').press('a');
  await expect(lit(page, 'BD')).toHaveCount(1);
  await expect(lit(page, 'BD').first()).toHaveAttribute('data-velocity', '2');
  await page.locator('body').press('Shift+S');
  await expect(lit(page, 'SD')).toHaveCount(1);
  await expect(lit(page, 'SD').first()).toHaveAttribute('data-velocity', '3');

  // Typing in the BPM field must not play or record.
  await page.getByLabel('BPM 数值').focus();
  await page.keyboard.press('d');
  await expect(lit(page, 'CH')).toHaveCount(0);
  await page.getByRole('button', { name: '停止', exact: true }).click();
});

test('metronome toggles like a hardware key', async ({ page }) => {
  await page.goto('/');
  const metronome = page.getByRole('button', { name: '节拍器' });
  await expect(metronome).toHaveAttribute('aria-pressed', 'false');
  await metronome.click();
  await expect(metronome).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '停止', exact: true }).click();
  await metronome.click();
  await expect(metronome).toHaveAttribute('aria-pressed', 'false');
});

test('IME composition never triggers pads or transport', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    for (const code of ['KeyA', 'Space']) document.body.dispatchEvent(new KeyboardEvent('keydown', { code, key: 'Process', isComposing: true, bubbles: true }));
  });
  await expect(page.locator('[data-track-panel="BD"]')).not.toHaveClass(/is-hit/);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
});

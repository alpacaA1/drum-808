import { expect, test } from '@playwright/test';
import { setKnob } from './controls';

const artifacts = '.codex-runs/20261028-144635-m1-sequencer/artifacts-4';

test('all tracks have at least 3:1 off/on contrast and three distinct velocity treatments', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: /清空节奏/ }).click();
  for (const id of ['BD', 'SD', 'CH', 'OH', 'CP', 'LT', 'RS', 'CB']) {
    const normal = page.locator(`.step[data-track="${id}"][data-step="1"]`);
    const ghost = page.locator(`.step[data-track="${id}"][data-step="2"]`);
    const accent = page.locator(`.step[data-track="${id}"][data-step="3"]`);
    await normal.click();
    await ghost.click();
    await ghost.click({ button: 'right' });
    await ghost.click({ button: 'right' });
    await accent.click();
    await accent.click({ button: 'right' });
    await expect(normal).toHaveAttribute('aria-pressed', 'true');
    await expect(ghost).toHaveAttribute('data-velocity', '1');
    await expect(accent).toHaveAttribute('data-velocity', '3');
  }
  const results = await page.locator('.step').evaluateAll(cells => {
    function luminance(color: string) {
      const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const linear = value / 255;
        return linear <= 0.04045 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }
    const offColors = cells.filter(cell => cell.getAttribute('data-velocity') === '0').map(cell => getComputedStyle(cell).backgroundColor);
    return ['BD', 'SD', 'CH', 'OH', 'CP', 'LT', 'RS', 'CB'].map(id => {
      const styles = [1, 2, 3].map(level => {
        const cell = cells.find(cell => cell.getAttribute('data-track') === id && cell.getAttribute('data-velocity') === String(level))!;
        const style = getComputedStyle(cell);
        return { background: style.backgroundColor, shadow: style.boxShadow, innerBlock: getComputedStyle(cell, '::before').opacity, led: getComputedStyle(cell.querySelector('.step-led')!).opacity };
      });
      const on = luminance(styles[1].background);
      const ratios = offColors.map(color => {
        const off = luminance(color);
        return (Math.max(on, off) + 0.05) / (Math.min(on, off) + 0.05);
      });
      return { id, minContrast: Math.min(...ratios), styles };
    });
  });
  console.log('Computed WCAG off/normal contrast:', JSON.stringify(results, null, 2));
  for (const { id, minContrast, styles } of results) {
    expect(minContrast, id).toBeGreaterThanOrEqual(3);
    expect(new Set(styles.map(style => style.background)).size, id).toBe(3);
    expect(styles[0].innerBlock, id).toBe('1');
    expect(styles[1].innerBlock, id).toBe('0');
    expect(styles[1].shadow, id).not.toBe(styles[2].shadow);
    expect(styles[1].led, id).toBe('0');
    expect(styles[2].led, id).toBe('1');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.locator('.step').first().evaluate(cell => ({ animation: getComputedStyle(cell).animationName, transition: getComputedStyle(cell).transitionDuration }));
  expect(motion).toEqual({ animation: 'none', transition: '0s' });
  await page.locator('#preset').selectOption('jazz');
  await page.locator('h1').click();
  await page.locator('.machine').evaluate(element => { element.style.filter = 'grayscale(1)'; });
  await page.screenshot({ path: `${artifacts}/desktop-grayscale.png` });
});

test('track selection changes only the editor and selected mixer values survive reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-track-panel="BD"]')).toHaveClass(/is-selected/);
  await expect(page.locator('#selected-track-name')).toHaveText('底鼓');
  const steps = await page.locator('.step').evaluateAll(cells => cells.map(cell => cell.getAttribute('data-velocity')));
  const snare = page.getByRole('button', { name: '军鼓，选择并试听' });
  await snare.click();
  await expect(page.locator('[data-track-panel="SD"]')).toHaveClass(/is-selected/);
  await expect(snare).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#selected-track-name')).toHaveText('军鼓');
  await expect(page.locator('#audio-hint')).toHaveText('声音已就绪');
  expect(await page.locator('.step').evaluateAll(cells => cells.map(cell => cell.getAttribute('data-velocity')))).toEqual(steps);
  await setKnob(page, '军鼓音量', 67);
  await setKnob(page, '军鼓响弦', 81);
  await page.reload();
  await expect(page.locator('#selected-track-name')).toHaveText('底鼓');
  await expect(page.getByRole('slider', { name: '底鼓音量' })).toHaveAttribute('aria-valuenow', '80');
  await snare.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#selected-track-name')).toHaveText('军鼓');
  await expect(page.getByRole('slider', { name: '军鼓音量' })).toHaveAttribute('aria-valuenow', '67');
  await expect(page.getByRole('slider', { name: '军鼓响弦' })).toHaveAttribute('aria-valuenow', '81');
  expect(await page.locator('.step').evaluateAll(cells => cells.map(cell => cell.getAttribute('data-velocity')))).toEqual(steps);
});

test('compact desktop and small phone retain the intended control layout', async ({ page }) => {
  await page.goto('/');
  for (const width of [1024, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const layout = await page.locator('.top-bar').evaluate(bar => {
      const elements = ['.brand', '.transport-group', '.tempo', '.swing', '.master-control'];
      return elements.map(selector => {
        const rect = bar.querySelector(selector)!.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      });
    });
    if (width >= 1024) {
      // All five groups occupy the same single row (vertical ranges overlap).
      expect(Math.max(...layout.map(item => item.top))).toBeLessThan(Math.min(...layout.map(item => item.bottom)));
      const grid = (await page.locator('.grid-card').boundingBox())!;
      const side = (await page.locator('.side-panel').boundingBox())!;
      expect(side.x).toBeGreaterThan(grid.x + grid.width);
      expect(side.width).toBeGreaterThanOrEqual(280);
      expect(side.width).toBeLessThanOrEqual(320);
    } else {
      expect(layout[2].top).toBeGreaterThan(layout[0].bottom);
      expect(layout[2].top).toBe(layout[3].top);
      expect(layout[3].top).toBe(layout[4].top);
      const grid = (await page.locator('.grid-card').boundingBox())!;
      const side = (await page.locator('.side-panel').boundingBox())!;
      expect(side.y).toBeGreaterThan(grid.y + grid.height);
      const button = (await page.locator('[data-select-track="BD"]').boundingBox())!;
      expect(button.height).toBeGreaterThanOrEqual(32);
    }
  }
});

for (const stepsPerBar of [12, 24]) {
  test(`${stepsPerBar}-step grid computes beat columns and four equal colour strips`, async ({ page }) => {
    await page.goto('/');
    await page.locator('.step').first().click();
    await page.addInitScript(({ steps }) => {
      const state = JSON.parse(localStorage.getItem('drum808.session.v1')!);
      state.pattern.stepsPerBar = steps;
      state.pattern.tracks.forEach((track: { steps: number[] }) => {
        track.steps = Array.from({ length: steps }, (_, index) => track.steps[index] ?? 0);
      });
      localStorage.setItem('drum808.session.v1', JSON.stringify(state));
    }, { steps: stepsPerBar });
    await page.reload();
    await expect(page.locator('.step')).toHaveCount(8 * stepsPerBar);
    await expect(page.locator('.transport-led')).toHaveCount(stepsPerBar);
    await expect(page.locator('.transport-led.is-lit')).toHaveCount(0);
    for (let group = 0; group < 4; group++) await expect(page.locator(`.step-heading.group-${group}`)).toHaveCount(stepsPerBar / 4);
    const beats = await page.locator('.step[data-track="BD"].is-beat').evaluateAll(cells => cells.map(cell => Number(cell.getAttribute('data-step'))));
    expect(beats).toEqual([0, stepsPerBar / 4, stepsPerBar / 2, stepsPerBar * 3 / 4]);
  });
}

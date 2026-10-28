import { expect, type Page } from '@playwright/test';

/** Use the actual keyboard interaction rather than injecting state into a control. */
export async function setKnob(page: Page, label: string, value: number): Promise<void> {
  const knob = page.getByRole('slider', { name: label, exact: true });
  const min = Number(await knob.getAttribute('aria-valuemin'));
  const offset = value - min;
  await knob.press('Home');
  for (let count = 0; count < Math.floor(offset / 10); count++) await knob.press('PageUp');
  for (let count = 0; count < offset % 10; count++) await knob.press('ArrowUp');
  await expect(knob).toHaveAttribute('aria-valuenow', String(value));
}

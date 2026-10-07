import { expect, test } from '@playwright/test';
import { openBattle, stubFonts, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => stubFonts(page));

test('training replay plays and scrubs to the end without errors (Review Focus 1, 3)', async ({ page }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'training');
  await expect(page.getByRole('tab', { name: 'Engagement' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const scrub = page.getByRole('slider', { name: 'Battle time' });
  await scrub.focus();
  await page.keyboard.press('End');
  await expect(page.locator('.clock')).toHaveText('T+20:00');
  await page.keyboard.press('Home');
  await expect(page.locator('.clock')).toHaveText('T+0:00');
  // On phones the log is a closed drawer, so check that it has entries rather than that it is on screen.
  await expect(page.locator('.log-list li').first()).toBeAttached();
  expect(errors).toEqual([]);
});

test('Manticore: director view, perceived picture and the ship view (Review Focus 5)', async ({ page }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'manticore');
  await expect(page.getByRole('button', { name: 'Director' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lbl.fleet:visible').first()).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByLabel('Perceived').check();
  await expect(page.locator('.lbl.fleet:visible')).toHaveCount(0);
  await expect(page.locator('.lbl.contact:visible').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Ship' }).click();
  await expect(page.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lbl.spec:visible').first()).toBeVisible();
  await page.getByRole('button', { name: 'Roll demo' }).click();
  await expect(page.locator('.lbl.demo:visible')).toBeVisible();
  expect(errors).toEqual([]);
});

test('density menu changes the sampling readout (Review Focus 4)', async ({ page }) => {
  await openBattle(page, 'training');
  await page.evaluate(() => window.__honorCic!.store.set({ t: 30 }));
  await expect(page.locator('.transport .readout').filter({ hasText: 'Sampling 1:4' })).toBeVisible();
  await page.getByRole('button', { name: 'Density' }).click();
  await page.getByLabel('1:1', { exact: true }).check();
  await expect(page.locator('.transport .readout').filter({ hasText: 'Sampling 1:1' })).toBeVisible();
});

test('honours prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openBattle(page, 'training');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByLabel('Reduce motion')).toBeChecked();
});

test('phone layout: bottom bar, sheets and no sideways scroll', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone project only');
  await openBattle(page, 'training');
  const bar = page.getByRole('navigation', { name: 'Panels' });
  await expect(bar).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await bar.getByRole('button', { name: 'Log' }).click();
  await expect(page.locator('#right')).toBeVisible();
});

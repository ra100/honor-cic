import { expect, test } from '@playwright/test';
import { stubFonts, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => stubFonts(page));

test('lists the packs with labelled dates and an evidence meter, and opens a replay', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: 'Honorverse battle replays' })).toBeVisible();
  const card = page.locator('[data-pack="manticore"]');
  await expect(card.getByRole('heading', { name: 'Battle of Manticore' })).toBeVisible();
  await expect(card).toContainText('24 July 1921 PD [W]');
  await expect(card.getByRole('meter', { name: 'Evidence quality' })).toBeVisible();
  await card.getByRole('link', { name: 'Open replay' }).click();
  await expect(page).toHaveURL(/#\/battle\/manticore$/);
  expect(errors).toEqual([]);
});

test('an unknown route offers the way back', async ({ page }) => {
  await page.goto('/#/nowhere');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to catalog' }).click();
  await expect(page.getByRole('heading', { name: 'Honorverse battle replays' })).toBeVisible();
});

test('the catalog never scrolls sideways', async ({ page }) => {
  await page.goto('/#/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe('small phones', () => {
  test.use({ viewport: { width: 360, height: 740 } });
  test('the catalog stacks each card and never scrolls sideways at 360 px', async ({ page }) => {
    await page.goto('/#/');
    await page.locator('[data-pack="manticore"]').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

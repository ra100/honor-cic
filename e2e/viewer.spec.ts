import { expect, test, type Page } from '@playwright/test';
import { openBattle, setState, state, stubFonts, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => stubFonts(page));

async function settledRenderCount(page: Page): Promise<number> {
  let previous = -1;
  let unchanged = 0;
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__honorCic!.renderCount());
    unchanged = current === previous ? unchanged + 1 : 0;
    previous = current;
    return unchanged;
  }, { intervals: [100, 200, 300], timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  return previous;
}

test('training replay plays and scrubs to the end without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'training');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const scrub = page.getByRole('slider', { name: 'Battle time' });
  await scrub.focus();
  await page.keyboard.press('End');
  await expect(page.locator('.clock-t')).toHaveText('T+20:00');
  await page.keyboard.press('Home');
  await expect(page.locator('.clock-t')).toHaveText('T+0:00');
  await expect(page.locator('#log li').first()).toBeAttached();
  expect(errors).toEqual([]);
});

test('Manticore opens in the director inside the Site A console', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'manticore');
  await expect(page.locator('.ident h1')).toHaveText('Battle of Manticore');
  await expect(page.getByRole('button', { name: 'Director' })).toHaveClass(/\bon\b/);
  await expect(page.locator('#caption .shot-no')).toContainText('Shot 1.1');
  await expect(page.locator('.tallies .k').first()).toHaveText(/Missiles in space/i);
  if (!isMobile) {
    await expect(page.locator('#forces')).toContainText('Home Fleet');
    await expect(page.locator('#forces')).toContainText('Inside limit');
  }
  await setState(page, { t: 120 });
  if (isMobile) await page.locator('#hudToggles').getByRole('button', { name: 'Log' }).click();
  await expect(page.locator('#log li').first()).toBeVisible();
  await page.locator('#log li').first().click();
  expect(await state<number>(page, 't')).toBeLessThan(120);
  expect(errors).toEqual([]);
});

test('scale tabs switch between System, Engagement and Ship detail', async ({ page }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'manticore');
  for (const [name, scale] of [['Engagement', 'engagement'], ['Ship detail', 'ship'], ['System', 'system']] as const) {
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    expect(await state(page, 'scale')).toBe(scale);
    expect(await state(page, 'camera')).toBe('free');
  }
  await page.keyboard.press('2');
  expect(await state(page, 'scale')).toBe('engagement');
  expect(errors).toEqual([]);
});

test('system presets frame the binary, the companion and the outer orbits', async ({ page }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'manticore');
  await page.getByRole('tab', { name: 'System' }).click();
  const before = await settledRenderCount(page);
  for (const [name, focus] of [['Binary & junction', 'binary'], ['Manticore-B', 'secondary'], ['Outer orbits', 'outer'], ['Manticore-A', 'primary']] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveClass(/\bactive\b/);
    expect(await state(page, 'systemFocus')).toBe(focus);
  }
  expect(await settledRenderCount(page)).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test('ship detail context tools drive the wedge demos', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'manticore');
  await page.getByRole('tab', { name: 'Ship detail' }).click();
  const classData = page.locator('#hudToggles').getByRole('button', { name: 'Class data' });
  if (isMobile) await classData.click();
  await expect(page.locator('.object-panel')).toBeVisible();
  await expect(page.locator('.object-panel .obj-title')).toContainText('Invictus');
  // On a phone the class sheet covers the demo tools until it is closed again.
  if (isMobile) await classData.click();
  await page.getByRole('button', { name: 'Belly-up roll' }).click();
  await expect(page.getByRole('button', { name: 'Belly-up roll' })).toHaveClass(/\bactive\b/);
  expect(await state(page, 'shipRoll')).toBe(true);
  await page.getByRole('button', { name: 'Transit sails' }).click();
  expect(await state(page, 'shipSails')).toBe(true);
  await page.getByRole('button', { name: 'Fire / defense demo' }).click();
  expect(await state(page, 'shipSails')).toBe(false);
  expect(await state(page, 'fireStartedAt')).not.toBeNull();
  await expect(page.locator('#readout')).not.toBeEmpty();
  const classes = page.getByRole('combobox', { name: 'Ship class' });
  const option = await classes.locator('option').nth(2).getAttribute('value');
  await classes.selectOption(option!);
  expect(await state(page, 'selectedClass')).toBe(option);
  expect(errors).toEqual([]);
});

test('menus: shots jump the director, layers change the picture and density, key opens notes', async ({ page }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'manticore');
  await page.getByRole('button', { name: 'Shots', exact: true }).click();
  await expect(page.locator('#menu-shots')).toBeVisible();
  const items = page.locator('#menu-shots .mi');
  expect(await items.count()).toBeGreaterThan(5);
  await items.nth(3).click();
  await expect(page.locator('#menu-shots')).toBeHidden();
  expect(await state(page, 'camera')).toBe('director');
  expect(await state<number>(page, 't')).toBeGreaterThan(0);

  await page.getByRole('tab', { name: 'Engagement' }).click();
  await setState(page, { menu: 'layers' });
  await expect(page.locator('#menu-layers')).toBeVisible();
  await page.locator('#menu-layers .seg button', { hasText: '1 : 16' }).click();
  expect(await state(page, 'density')).toBe(16);
  await page.locator('#menu-layers .seg button', { hasText: 'Perceived' }).click();
  expect(await state<{ enabled: boolean }>(page, 'perceived')).toMatchObject({ enabled: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-layers')).toBeHidden();

  await page.getByRole('button', { name: 'Key', exact: true }).click();
  await expect(page.locator('#menu-key')).toContainText('Resonance zone');
  await page.getByRole('button', { name: 'Notes and sources' }).click();
  await expect(page.getByRole('dialog', { name: 'Notes and sources' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('paused rendering settles, then wakes for replay time and orbit input', async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openBattle(page, 'training');
  await setState(page, { camera: 'free' });
  const idle = await settledRenderCount(page);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__honorCic!.renderCount())).toBe(idle);
  await setState(page, { t: 300 });
  const afterScrub = await settledRenderCount(page);
  expect(afterScrub).toBeGreaterThan(idle);
  const box = (await page.locator('.plot').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  expect(await settledRenderCount(page)).toBeGreaterThan(afterScrub);
  expect(errors).toEqual([]);
});

test('honours prefers-reduced-motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openBattle(page, 'training');
  expect(await state(page, 'reducedMotion')).toBe(true);
});

test('phone: Forces, the log and class data open as sheets and nothing scrolls sideways', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone project only');
  const errors = watchErrors(page);
  await openBattle(page, 'manticore');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.locator('#hudToggles').getByRole('button', { name: 'Forces' }).click();
  await expect(page.locator('#forces')).toBeVisible();
  await page.locator('#hudToggles').getByRole('button', { name: 'Log' }).click();
  await expect(page.locator('#side')).toBeVisible();
  await page.getByRole('tab', { name: 'Ship detail' }).click();
  await expect(page.locator('.object-panel')).toBeHidden();
  await page.locator('#hudToggles').getByRole('button', { name: 'Class data' }).click();
  await expect(page.locator('.object-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('WebGL unavailable keeps the console usable', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, options?: unknown) {
      if (kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl') return null;
      return getContext.call(this, kind, options);
    } as HTMLCanvasElement['getContext'];
  });
  await openBattle(page, 'training');
  await expect(page.locator('.notice')).toContainText('This viewer needs WebGL');
  await expect(page.locator('.plot')).toBeHidden();
  if (isMobile) await page.locator('#hudToggles').getByRole('button', { name: 'Forces' }).click();
  await expect(page.locator('#forces')).toContainText('Training squadron Red');
  await page.getByRole('link', { name: 'Catalog' }).click();
  await expect(page.locator('.catalog')).toBeVisible();
  expect(errors).toEqual([]);
});

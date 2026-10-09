import { expect, test, type Page } from '@playwright/test';
import { openBattle, openControls, stubFonts, watchErrors } from './helpers';

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
  await openControls(page);
  await expect(page.getByRole('button', { name: 'Director' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.lbl.fleet:visible').first()).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByLabel('Perceived').check();
  await expect(page.locator('.lbl.fleet:visible')).toHaveCount(0);
  await expect(page.locator('.lbl.contact:visible').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Ship' }).click();
  await openControls(page);
  await expect(page.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('.lbl.spec:visible').first()).toBeVisible();
  await page.getByRole('button', { name: 'Roll demo' }).click();
  await expect(page.locator('.lbl.demo:visible')).toBeVisible();
  expect(errors).toEqual([]);
});

async function settledRenderCount(page: Page): Promise<number> {
  let previous = -1;
  let unchanged = 0;
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__honorCic!.renderCount());
    unchanged = current === previous ? unchanged + 1 : 0;
    previous = current;
    return unchanged;
  }, { intervals: [100, 200, 300], timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  return previous;
}

test('paused renders settle after orbit input, then wake for replay, framing and motion changes', async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openBattle(page, 'training');
  const initial = await settledRenderCount(page);
  await page.evaluate(() => window.__honorCic!.store.set({ t: 30, camera: 'free' }));
  await expect.poll(() => page.evaluate(() => window.__honorCic!.renderCount())).toBeGreaterThan(initial);
  const beforeInput = await settledRenderCount(page);
  const plot = (await page.locator('.plot').boundingBox())!;
  const point = { x: plot.x + plot.width / 2, y: plot.y + plot.height / 3 };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 40, point.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__honorCic!.renderCount())).toBeGreaterThan(beforeInput);
  const afterInput = await settledRenderCount(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__honorCic!.renderCount())).toBe(afterInput);

  await page.evaluate(() => window.__honorCic!.store.set({ playing: true, speed: 1 }));
  await expect.poll(() => page.evaluate(() => window.__honorCic!.store.get().t)).toBeGreaterThan(30);
  await page.evaluate(() => window.__honorCic!.store.set({ playing: false }));
  const paused = await settledRenderCount(page);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width + 16, height: viewport.height });
  await expect.poll(() => page.evaluate(() => window.__honorCic!.renderCount())).toBeGreaterThan(paused);
  await settledRenderCount(page);

  await page.evaluate(() => window.__honorCic!.store.set({ camera: 'director' }));
  const director = await settledRenderCount(page);
  const directorTime = await page.evaluate(() => {
    const state = window.__honorCic!.store.get();
    window.__honorCic!.store.set({ t: state.t + 1 });
    return state.t + 1;
  });
  await expect.poll(() => page.evaluate(() => window.__honorCic!.renderCount())).toBeGreaterThan(director);
  await settledRenderCount(page);
  expect(await page.evaluate(() => window.__honorCic!.store.get().t)).toBe(directorTime);
  expect(await page.evaluate(() => window.__honorCic!.store.get().camera)).toBe('director');

  await page.getByRole('tab', { name: 'Ship' }).click();
  await page.getByRole('button', { name: 'Roll demo' }).click();
  const progress = await page.evaluate(() => window.__honorCic!.store.get().demoProgress);
  await expect.poll(() => page.evaluate(() => window.__honorCic!.store.get().demoProgress)).not.toBe(progress);
  expect(await page.evaluate(() => window.__honorCic!.store.get().playing)).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await settledRenderCount(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__honorCic!.renderCount())).toBe(reduced);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => page.evaluate(() => window.__honorCic!.renderCount())).toBeGreaterThan(reduced);
  await page.getByRole('button', { name: 'Roll demo' }).click();
  await settledRenderCount(page);
  expect(errors).toEqual([]);
});

test('Ship keeps active demo annotations readable inside the measured plot', async ({ page, isMobile }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (isMobile) await page.setViewportSize({ width: 320, height: page.viewportSize()!.height });
  await openBattle(page, 'training');
  await page.getByRole('tab', { name: 'Ship' }).click();
  for (const [button, kind] of [['Roll demo', 'roll'], ['Pod demo', 'pods'], ['Broadside demo', 'broadside']] as const) {
    await page.getByRole('button', { name: button }).click();
    await expect(page.locator('.lbl.demo:visible')).toBeVisible();
    const label = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.viewer')!;
      const style = getComputedStyle(root);
      const bounds = root.querySelector('.plot')!.getBoundingClientRect();
      const label = root.querySelector<HTMLElement>('.lbl.demo:not([hidden])')!;
      const rect = label.getBoundingClientRect();
      return {
        text: label.textContent,
        overflow: label.scrollWidth - label.clientWidth,
        inside: rect.left >= bounds.left + parseFloat(style.getPropertyValue('--plot-left')) - 1
          && rect.top >= bounds.top + parseFloat(style.getPropertyValue('--plot-top')) - 1
          && rect.right <= bounds.right - parseFloat(style.getPropertyValue('--plot-right')) + 1
          && rect.bottom <= bounds.bottom - parseFloat(style.getPropertyValue('--plot-bottom')) + 1,
      };
    });
    expect(label.inside, kind).toBe(true);
    expect(label.overflow, kind).toBeLessThanOrEqual(1);
    expect(label.text, kind).toContain('[S]');
    await expect(page.locator('.lbl.title:visible').first()).toBeVisible();
    await expect(page.locator('.lbl.spec:visible').first()).toBeVisible();
    await page.getByRole('button', { name: button }).click();
  }
  expect(errors).toEqual([]);
});

test('density menu changes the sampling readout (Review Focus 4)', async ({ page }) => {
  await openBattle(page, 'training');
  await page.evaluate(() => window.__honorCic!.store.set({ t: 30 }));
  await expect(page.locator('.transport .readout').filter({ hasText: 'Sampling 1:4' })).toBeVisible();
  if (!await page.getByRole('button', { name: 'Density', exact: true }).isVisible()) await openControls(page);
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

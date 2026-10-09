import { expect, test, type Page } from '@playwright/test';
import type { Mesh, MeshBasicMaterial } from 'three';
import { TECH } from '../src/core/tech';
import type { ShipView } from '../src/render/scales/ship-view';
import { openBattle, openControls, stubFonts, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => stubFonts(page));

test('scale tabs are one Tab stop with arrow, Home and End navigation', async ({ page }) => {
  await openBattle(page, 'training');
  const engagement = page.getByRole('tab', { name: 'Engagement' });
  await engagement.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Ship' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Ship' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'System' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Ship' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(engagement).toBeFocused();
  await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Controls', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__honorCic!.store.get().t)).toBe(0);
});

test('phone scale names remain readable without breaking words', async ({ page }) => {
  await openBattle(page, 'training');
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 844 });
    const tabs = await page.getByRole('tab').evaluateAll((elements) => elements.map((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return { text: element.textContent, lines: [...range.getClientRects()].filter((rect) => rect.width > 0).length };
    }));
    expect(tabs, `${width}px scale names`).toEqual([
      { text: 'System', lines: 1 }, { text: 'Engagement', lines: 1 }, { text: 'Ship', lines: 1 },
    ]);
  }
});

test('Ship is an inspection workspace, with explicit framing and opt-in replay', async ({ page }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'training');
  await page.getByRole('tab', { name: 'Ship' }).click();
  await expect(page.getByRole('region', { name: 'Ship inspection' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hull', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Ship class')).toBeVisible();
  for (const name of ['Forces', 'Log', 'Density', 'Shots']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('slider', { name: 'Battle time' })).toHaveCount(0);
  await expect(page.getByLabel('Theater')).toBeHidden();
  await page.getByRole('button', { name: 'Defensive envelope' }).click();
  expect(await page.evaluate(() => window.__honorCic!.store.get().shipFraming)).toBe('defenses');
  await page.getByRole('button', { name: 'Hull', exact: true }).click();
  await page.getByLabel('Ship class').selectOption('rhn-ca');
  await expect(page.locator('.ship-title')).toHaveText(TECH.classes['rhn-ca'].name);
  await expect.poll(async () => {
    const ship = await shipPresentation(page);
    return ship && { classId: ship.classId, mounts: ship.mounts };
  }).toEqual({ classId: 'rhn-ca', mounts: { missile: 20, graser: 8 } });
  for (const name of ['Roll demo', 'Pod demo', 'Broadside demo']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByText('Class figures and sources', { exact: true }).click();
  const figure = page.locator('.ship-workspace .ev').first();
  await figure.focus();
  await page.keyboard.press('Enter');
  await expect(figure).toHaveAttribute('aria-expanded', 'true');
  await openControls(page);
  await page.getByRole('button', { name: 'Replay controls' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('slider', { name: 'Battle time' })).toBeVisible();
  expect(errors).toEqual([]);
});

async function shipPresentation(page: Page) {
  return page.evaluate(() => {
    const view = window.__honorCic?.view() as ShipView | undefined;
    if (!view || view.id !== 'ship') return null;
    let visibleDefenses = 0;
    view.scene.traverseVisible((object) => {
      const mesh = object as Mesh;
      const material = mesh.material as MeshBasicMaterial | undefined;
      if (mesh.isMesh && material?.color?.getHex() === 0x00d2ff && material.opacity > 0 && mesh.geometry.getAttribute('position').count > 0) visibleDefenses++;
    });
    return {
      classId: view.currentClass(), mounts: view.mountCount(), wedge: view.wedgeVisible(),
      visibleDefenses, distance: view.camera.position.length(),
    };
  });
}

test('compact Ship inspection retains hidden technical figures and their sources', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 375, height: 844 });
  await openBattle(page, 'manticore');
  await page.getByRole('tab', { name: 'Ship' }).click();
  await page.getByText('Class figures and sources', { exact: true }).click();
  const figures = page.locator('.class-details .figs');
  expect(await figures.locator('dt').allTextContents()).toEqual(expect.arrayContaining([
    'Maximum acceleration', 'Normal acceleration', 'Broadside lasers, each side',
    'Broadside energy torpedoes, each side', 'Broadside counter-missile tubes, each side',
    'Broadside point-defense clusters, each side', 'Bow grasers', 'Bow counter-missile tubes',
    'Stern point-defense clusters', 'Pod capacity', 'LAC bays', 'Band width',
  ]));
  const bow = figures.locator('dt').filter({ hasText: /^Bow grasers$/ }).locator('+ dd .ev');
  await expect(bow).toContainText('10');
  await expect(bow).toContainText('[W]');
  await bow.click();
  await expect(bow).toHaveAttribute('aria-expanded', 'true');
  await expect(figures.locator('.src:visible')).toContainText('§5.2 fore');
  await page.getByLabel('Ship class').selectOption('rmn-clac');
  await expect(page.locator('.ship-title')).toContainText('Covington');
  await expect(figures.locator('dt').filter({ hasText: /^LAC bays$/ }).locator('+ dd .ev')).toContainText('124');
  expect(errors).toEqual([]);
});

test('explicit defensive framing reveals geometry from the initial layers and honors later hiding', async ({ page }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'training');
  await page.getByRole('tab', { name: 'Ship' }).click();
  expect(await page.evaluate(() => ({
    framing: window.__honorCic!.store.get().shipFraming,
    protection: window.__honorCic!.store.get().layers.protection,
  }))).toEqual({ framing: 'hull', protection: false });
  const initialLayers = await page.evaluate(() => window.__honorCic!.store.get().layers);
  await expect.poll(async () => (await shipPresentation(page))?.classId).toBe('saganami-c');
  const hull = (await shipPresentation(page))!;
  expect(hull.visibleDefenses).toBe(0);
  await page.getByRole('button', { name: 'Defensive envelope' }).click();
  await expect.poll(async () => (await shipPresentation(page))?.visibleDefenses).toBe(4);
  expect(await page.evaluate(() => window.__honorCic!.store.get().layers)).toEqual({ ...initialLayers, protection: true });
  const envelope = (await shipPresentation(page))!;
  expect(envelope.wedge).toBe(true);
  expect(envelope.distance).toBeGreaterThan(hull.distance * 10);
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  await page.getByLabel('Protection', { exact: false }).uncheck();
  await expect.poll(async () => (await shipPresentation(page))?.visibleDefenses).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Defensive envelope' }).click();
  await expect.poll(async () => (await shipPresentation(page))?.visibleDefenses).toBe(4);
  await page.getByRole('button', { name: 'Hull', exact: true }).click();
  await expect.poll(async () => (await shipPresentation(page))?.visibleDefenses).toBe(0);
  expect(await page.evaluate(() => window.__honorCic!.store.get().layers.protection)).toBe(true);
  expect(errors).toEqual([]);
});

test('Manticore class inspection selects the registered Haven pod-layer and its real mounts', async ({ page }) => {
  const errors = watchErrors(page);
  await openBattle(page, 'manticore');
  await page.getByRole('tab', { name: 'Ship' }).click();
  await page.getByLabel('Ship class').selectOption('sovereign-of-space');
  await expect(page.locator('.ship-title')).toHaveText('Sovereign of Space-class SD(P)');
  await expect(page.locator('.ship-identity')).toContainText('Class reference.');
  await expect.poll(async () => {
    const ship = await shipPresentation(page);
    return ship && { classId: ship.classId, mounts: ship.mounts };
  }).toEqual({ classId: 'sovereign-of-space', mounts: { missile: 0, graser: 36 } });
  await page.getByText('Class figures and sources', { exact: true }).click();
  await expect(page.locator('.class-details .readout')).toContainText('Unknown hull dimensions');
  expect(errors).toEqual([]);
});

test('contextual panels and menus close with Escape and return focus without duplicate Layers actions', async ({ page }) => {
  await openBattle(page, 'training');
  const forces = page.getByRole('button', { name: 'Forces', exact: true });
  await expect(page.locator('#context-drawer')).toBeHidden();
  await forces.click();
  await expect(page.getByRole('button', { name: 'Close panel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(forces).toBeFocused();
  const logButton = page.getByRole('button', { name: 'Log', exact: true });
  await logButton.click();
  const log = page.getByRole('log', { name: 'CIC log entries' });
  await log.focus();
  await expect(log).toBeFocused();
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__honorCic!.store.get().playing)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(logButton).toBeFocused();
  const layers = page.getByRole('button', { name: 'Layers', exact: true });
  await expect(layers).toHaveCount(1);
  await layers.click();
  await expect(page.getByRole('button', { name: 'Close Layers' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(layers).toBeFocused();
  await page.getByRole('tab', { name: 'System' }).click();
  await expect(page.locator('.system-context')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Density', exact: true })).toHaveCount(0);
});

test('Notes formats actual Markdown and returns focus from its native dialog', async ({ page }) => {
  await openBattle(page, 'manticore');
  await openControls(page);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Notes and sources' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.notes h2').first()).toBeVisible();
  await expect(dialog.locator('.notes strong').first()).toHaveText('P');
  await expect(dialog.locator('.notes ul').first()).toBeVisible();
  expect(await dialog.locator('.notes').innerText()).not.toContain('##');
  await expect(dialog.locator('.notes a[href="https://honorverse.fandom.com/wiki/Battle_of_Manticore"]')).toHaveAttribute('rel', 'noopener noreferrer');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Controls', exact: true })).toBeFocused();
});

test('live device motion changes do not overwrite an explicit choice; reduced-motion demos can be stepped', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openBattle(page, 'training');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const reduce = page.getByLabel('Reduce motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(reduce).toBeChecked();
  await reduce.uncheck();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(reduce).not.toBeChecked();
  await page.getByRole('button', { name: 'Use device setting' }).click();
  await expect(reduce).toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Ship' }).click();
  await page.getByRole('button', { name: 'Roll demo' }).click();
  const position = page.getByRole('slider', { name: 'Demo position' });
  await expect(position).toBeVisible();
  await position.focus();
  await page.keyboard.press('End');
  expect(await page.evaluate(() => window.__honorCic!.store.get().demoProgress)).toBe(1);
});

async function idleRenderCount(page: Page): Promise<number> {
  let previous = -1;
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__honorCic!.renderCount());
    const stable = current === previous;
    previous = current;
    return stable;
  }, { intervals: [100, 200, 300], timeout: 10_000 }).toBe(true);
  return previous;
}

test('paused scenes become idle; input, camera damping and active demos wake rendering', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openBattle(page, 'training');
  const idle = await idleRenderCount(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__honorCic!.renderCount())).toBe(idle);
  await page.evaluate(() => window.__honorCic!.store.set({ t: 30, camera: 'free' }));
  await expect.poll(() => page.evaluate(() => window.__honorCic!.renderCount())).toBeGreaterThan(idle);
  const beforeDrag = await idleRenderCount(page);
  const plot = await page.locator('.plot').boundingBox();
  if (!plot) throw new Error('No plot bounds');
  await page.mouse.move(plot.x + plot.width / 2, plot.y + plot.height / 3);
  await page.mouse.down();
  await page.mouse.move(plot.x + plot.width / 2 + 40, plot.y + plot.height / 3 + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__honorCic!.renderCount())).toBeGreaterThan(beforeDrag);
  await idleRenderCount(page);
  await page.getByRole('tab', { name: 'Ship' }).click();
  await page.getByRole('button', { name: 'Pod demo' }).click();
  const demo = await page.evaluate(() => window.__honorCic!.store.get().demoProgress);
  await expect.poll(() => page.evaluate(() => window.__honorCic!.store.get().demoProgress)).not.toBe(demo);
  await page.getByRole('button', { name: 'Pod demo' }).click();
  const stopped = await idleRenderCount(page);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__honorCic!.renderCount())).toBe(stopped);
});

test('catalog stays viewer-lazy and navigation cancels an in-flight solver without a stale mount', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const trace = { started: 0, stopped: 0 };
    Object.assign(window, { solverTrace: trace });
    class DeferredWorker {
      onmessage = null;
      onerror = null;
      onmessageerror = null;
      postMessage() { trace.started++; }
      terminate() { trace.stopped++; }
    }
    Object.assign(window, { Worker: DeferredWorker });
  });
  const viewerRequests: string[] = [];
  page.on('request', (request) => { if (/\/assets\/viewer-|\/ui\/viewer\/viewer\.ts/.test(request.url())) viewerRequests.push(request.url()); });
  await page.goto('/#/');
  await expect(page.locator('.catalog')).toBeVisible();
  expect(viewerRequests).toEqual([]);
  await page.locator('[data-pack="training"]').getByRole('link', { name: 'Open replay' }).click();
  await expect(page.getByText('Computing replay:', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Back to catalog' }).click();
  await expect(page.locator('.catalog')).toBeVisible();
  await expect(page.locator('.viewer')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { solverTrace: { started: number; stopped: number } }).solverTrace)).toEqual({ started: 1, stopped: 1 });
  expect(errors).toEqual([]);
});

test('controls reflow at phone, intermediate, desktop and 200% desktop-equivalent widths', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop project covers all layout widths');
  await openBattle(page, 'training');
  for (const [width, height] of [[320, 700], [375, 844], [520, 800], [590, 800], [600, 800], [860, 800], [1100, 900], [1440, 900], [720, 450]]) {
    await page.setViewportSize({ width, height });
    for (const scale of ['System', 'Engagement', 'Ship']) {
      await page.getByRole('tab', { name: scale }).click();
      await expect(page.locator('.viewer')).toHaveAttribute('data-scale', scale.toLowerCase());
      const audit = await page.evaluate(() => {
        const controls = [...document.querySelectorAll<HTMLElement>('.viewer button, .viewer select, .viewer input, .viewer summary, .viewer .btn')];
        const visible = controls.filter((element) => element.getClientRects().length > 0);
        const edgeControls = [...document.querySelectorAll<HTMLElement>('.topbar .btn, .topbar [role="tab"], .plot-tools button, .plot-tools select, .transport button, .transport select, .transport input')]
          .filter((element) => element.getClientRects().length > 0);
        const plotStyle = getComputedStyle(document.querySelector('.viewer')!);
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          safeHeight: innerHeight - parseFloat(plotStyle.getPropertyValue('--plot-top')) - parseFloat(plotStyle.getPropertyValue('--plot-bottom')),
          small: visible.filter((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.width < 43.9 || bounds.height < 43.9;
          }).map((element) => element.getAttribute('aria-label') ?? element.textContent),
          occluded: edgeControls.filter((element) => {
            const bounds = element.getBoundingClientRect();
            return !element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
          }).map((element) => element.getAttribute('aria-label') ?? element.textContent),
          brokenDemoWords: [...document.querySelectorAll('.demos button')].filter((button) => button.getClientRects().length > 0).flatMap((button) => {
            const text = button.firstChild!;
            return [...(text.textContent ?? '').matchAll(/[a-z]+/gi)].flatMap((word) => {
              const range = document.createRange();
              range.setStart(text, word.index);
              range.setEnd(text, word.index + word[0].length);
              return range.getClientRects().length > 1 ? [word[0]] : [];
            });
          }),
        };
      });
      expect(audit.overflow, `${width}px ${scale}`).toBeLessThanOrEqual(0);
      expect(audit.small, `${width}px ${scale}`).toEqual([]);
      expect(audit.occluded, `${width}px ${scale}`).toEqual([]);
      expect(audit.brokenDemoWords, `${width}px ${scale}`).toEqual([]);
      expect(audit.safeHeight, `${width}px ${scale}`).toBeGreaterThan(0);
      if (scale === 'Engagement') {
        await page.getByRole('button', { name: 'Forces', exact: true }).click();
        await expect(page.locator('#context-drawer')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'View', exact: true }).click();
        await expect(page.locator('#menu-view')).toBeVisible();
        await page.keyboard.press('Escape');
        if (width < 860) await openControls(page);
        await page.getByRole('button', { name: 'Density', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Missile density' })).toBeVisible();
        await page.getByLabel('1:2', { exact: true }).check();
        expect(await page.evaluate(() => window.__honorCic!.store.get().density)).toBe(2);
        await page.getByLabel('1:4', { exact: true }).check();
        await page.keyboard.press('Escape');
      }
    }
  }
});

test('camera, fullscreen and replay controls perform their actions', async ({ page }, info) => {
  const errors = watchErrors(page);
  const actions: string[] = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openBattle(page, 'manticore');
  await openControls(page);
  await page.getByRole('button', { name: 'Director', exact: true }).click();
  await expect(page.locator('#menu-controls')).toBeHidden();
  expect(await page.evaluate(() => window.__honorCic!.store.get().camera)).toBe('director');
  actions.push('Director -> event camera');
  await openControls(page);
  await page.getByRole('button', { name: 'Free', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Free', exact: true })).toHaveAttribute('aria-pressed', 'true');
  actions.push('Free -> manual camera');
  const follow = page.getByRole('button', { name: 'Follow', exact: true });
  for (const enabled of [false, true]) {
    await follow.click();
    await expect(follow).toHaveAttribute('aria-pressed', String(enabled));
    expect(await page.evaluate(() => window.__honorCic!.store.get().follow)).toBe(enabled);
    actions.push(`Follow -> ${enabled}`);
  }
  await page.evaluate(() => {
    const view = window.__honorCic!.view()!;
    view.camera.position.multiplyScalar(2);
    view.camera.updateMatrixWorld();
  });
  const moved = await page.evaluate(() => window.__honorCic!.view()!.camera.position.length());
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__honorCic!.view()!.camera.position.length())).not.toBe(moved);
  actions.push('Reset view -> restored camera fit');
  const fullscreen = page.getByRole('button', { name: 'Fullscreen', exact: true });
  await fullscreen.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('viewer'))).toBe(true);
  await fullscreen.click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  actions.push('Fullscreen -> enter and exit');
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Help', exact: true });
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(help).toBeHidden();
  await expect(page.getByRole('button', { name: 'Controls', exact: true })).toBeFocused();
  actions.push('Help -> open, Close -> dismiss and return focus');

  const speed = page.getByRole('combobox', { name: 'Playback speed' });
  for (const value of ['0.25', '0.5', '1', '2', '4', '8', '15', '30', '60', '120', '240', 'auto']) {
    await speed.selectOption(value);
    expect(await page.evaluate(() => window.__honorCic!.store.get().speed)).toBe(value === 'auto' ? value : Number(value));
    actions.push(`Playback speed -> ${value}`);
  }
  await speed.selectOption('1');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__honorCic!.store.get().t)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  actions.push('Play -> replay advances, Pause -> stops');
  const time = page.getByRole('slider', { name: 'Battle time' });
  await time.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.clock')).toHaveText('T+0:00');
  await page.getByRole('button', { name: 'Next phase' }).click();
  await expect.poll(() => page.evaluate(() => window.__honorCic!.store.get().t)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Previous phase' }).click();
  await expect(page.locator('.clock')).toHaveText('T+0:00');
  actions.push('Next phase -> next event, Previous phase -> opening');
  await time.focus();
  await page.keyboard.press('End');
  const end = await page.evaluate(() => ({ t: window.__honorCic!.store.get().t, duration: window.__honorCic!.duration }));
  expect(end.t).toBe(end.duration);
  actions.push('Battle time -> exact replay end');
  expect(errors).toEqual([]);
  await info.attach('controls-click-through', { body: JSON.stringify(actions, null, 2), contentType: 'application/json' });
});

test('layers, picture, density and theater controls update the displayed battle', async ({ page }, info) => {
  const errors = watchErrors(page);
  const actions: string[] = [];
  await openBattle(page, 'manticore');
  await page.getByRole('tab', { name: 'Engagement', exact: true }).click();
  await page.getByRole('button', { name: 'Layers', exact: true }).click();
  const layers = page.getByRole('dialog', { name: 'Layers', exact: true });
  await expect(layers).toBeVisible();
  for (const box of await layers.getByRole('checkbox').all()) {
    const original = await box.isChecked();
    const before = await page.evaluate(() => window.__honorCic!.store.get().layers);
    await box.setChecked(!original);
    await expect.poll(async () => {
      const after = await page.evaluate(() => window.__honorCic!.store.get().layers);
      return Object.keys(before).filter((key) => before[key as keyof typeof before] !== after[key as keyof typeof after]).length;
    }).toBe(1);
    await box.setChecked(original);
    expect(await page.evaluate(() => window.__honorCic!.store.get().layers)).toEqual(before);
    actions.push(`${await box.locator('..').innerText()} -> toggled and restored`);
  }
  await layers.getByRole('button', { name: 'Close Layers' }).click();
  await expect(layers).toBeHidden();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const view = page.getByRole('dialog', { name: 'View', exact: true });
  await expect(view).toBeVisible();
  await view.getByLabel('Perceived', { exact: false }).check();
  await expect(page.locator('.lbl.fleet:visible')).toHaveCount(0);
  for (const side of ['haven', 'alliance']) {
    await view.getByRole('combobox', { name: 'Commander' }).selectOption(side);
    expect(await page.evaluate(() => window.__honorCic!.store.get().perceived)).toEqual({ enabled: true, side });
    actions.push(`Commander -> ${side}, enemy truth labels withheld`);
  }
  await view.getByLabel('Actual', { exact: false }).check();
  await expect(page.locator('.lbl.fleet:visible').first()).toBeVisible();
  actions.push('Actual -> ground-truth fleets, Perceived -> commander contacts');
  await view.getByRole('button', { name: 'Close View' }).click();
  await expect(view).toBeHidden();
  await page.locator('.scrub').evaluate((input: HTMLInputElement) => {
    input.value = '30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (!await page.getByRole('button', { name: 'Density', exact: true }).isVisible()) await openControls(page);
  await page.getByRole('button', { name: 'Density', exact: true }).click();
  const density = page.getByRole('dialog', { name: 'Missile density', exact: true });
  await expect(density).toBeVisible();
  for (const ratio of [1, 2, 4, 8, 16]) {
    await density.getByLabel(`1:${ratio}`, { exact: true }).check();
    expect(await page.evaluate(() => window.__honorCic!.store.get().density)).toBe(ratio);
    await expect(page.locator('.sampling')).toContainText(`Sampling 1:${ratio},`);
    actions.push(`Density 1:${ratio} -> displayed sampling ratio`);
  }
  await density.getByRole('button', { name: 'Close Missile density' }).click();
  await expect(density).toBeHidden();
  if (!await page.getByRole('combobox', { name: 'Theater' }).isVisible()) await openControls(page);
  for (const theater of ['junction', 'sphinx']) {
    await page.getByRole('combobox', { name: 'Theater' }).selectOption(theater);
    expect(await page.evaluate(() => window.__honorCic!.store.get().theater)).toBe(theater);
    expect(await page.evaluate(() => window.__honorCic!.store.get().camera)).toBe('free');
    actions.push(`Theater -> ${theater}, free camera`);
  }
  expect(errors).toEqual([]);
  await info.attach('battle-click-through', { body: JSON.stringify(actions, null, 2), contentType: 'application/json' });
});

test('forces selection, inspector actions, log filters and evidence disclosures remain usable', async ({ page }, info) => {
  const errors = watchErrors(page);
  const actions: string[] = [];
  await openBattle(page, 'manticore');
  await page.getByRole('tab', { name: 'Engagement', exact: true }).click();
  await page.getByRole('button', { name: 'Forces', exact: true }).click();
  await expect(page.locator('#forces')).toBeVisible();
  await page.locator('#forces').getByRole('button', { name: 'Home Fleet', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Selected ship', exact: true });
  await expect(inspector).toBeVisible();
  expect(await page.evaluate(() => window.__honorCic!.store.get().selectedShip)).not.toBeNull();
  actions.push('Home Fleet -> selected ship inspector');
  for (const figure of await inspector.locator('button.ev').all()) {
    await figure.click();
    await expect(figure).toHaveAttribute('aria-expanded', 'true');
    await expect(figure.locator('..').locator('.src')).toBeVisible();
    await figure.click();
    await expect(figure).toHaveAttribute('aria-expanded', 'false');
    actions.push(`${await figure.innerText()} -> source opened and closed`);
  }
  await inspector.getByRole('button', { name: 'Show class', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Ship', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ship-identity')).not.toContainText('Class reference.');
  actions.push('Show class -> selected ship inspection');
  await page.getByRole('tab', { name: 'Engagement', exact: true }).click();
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(inspector).toBeHidden();
  expect(await page.evaluate(() => window.__honorCic!.store.get().selectedShip)).toBeNull();
  actions.push('Clear selection -> closed inspector and cleared ship');
  await page.evaluate(() => window.__honorCic!.store.set({ t: 300 }));
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  const filter = page.getByRole('combobox', { name: 'Show log entries for' });
  for (const side of ['alliance', 'haven', 'all']) {
    await filter.selectOption(side);
    expect(await page.evaluate(() => window.__honorCic!.store.get().logSide)).toBe(side);
    if (side !== 'all') {
      await expect(page.locator(`.log-list li.${side === 'alliance' ? 'hostile' : 'allied'}`)).toHaveCount(0);
      await expect.poll(() => page.locator(`.log-list li.${side === 'alliance' ? 'allied' : 'hostile'}`).count()).toBeGreaterThan(0);
    }
    actions.push(`Log filter -> ${side}`);
  }
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect(page.locator('#context-drawer')).toBeHidden();
  await page.getByRole('link', { name: 'Back to catalog' }).click();
  await expect(page.locator('.catalog')).toBeVisible();
  await expect(page.locator('.viewer')).toHaveCount(0);
  actions.push('Back to catalog -> catalog, viewer disposed');
  expect(errors).toEqual([]);
  await info.attach('context-click-through', { body: JSON.stringify(actions, null, 2), contentType: 'application/json' });
});

test('WebGL unavailable keeps an explicit notice and usable forces, log and navigation', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Forces', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Forces', exact: true })).toContainText('Training squadron Red');
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect(page.locator('#context-drawer')).toBeHidden();
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page.getByRole('log', { name: 'CIC log entries', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to catalog' }).click();
  await expect(page.locator('.catalog')).toBeVisible();
  expect(errors).toEqual([]);
});

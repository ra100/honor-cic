import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { Mesh, Points } from 'three';
import { sampleFrame, unitPosition } from '../src/core/replay';
import { parsePack } from '../src/core/schema';
import { solve } from '../src/core/solver/solve';
import { dist, type Vec3 } from '../src/core/vec';
import { shotsFor } from '../src/render/director';
import { beamTheatersFor } from '../src/render/salvos';
import type { EngagementView } from '../src/render/scales/engagement-view';
import type { ShipView } from '../src/render/scales/ship-view';
import { openBattle, openControls, stubFonts, watchErrors } from './helpers';

test.beforeEach(async ({ page }) => {
  await stubFonts(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

async function capture(page: Page, info: TestInfo, name: string) {
  let previous = -1;
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.__honorCic!.renderCount());
    const settled = current > 0 && current === previous;
    previous = current;
    return settled;
  }, { intervals: [100, 200, 300], timeout: 10_000 }).toBe(true);
  const state = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.viewer')!;
    const style = getComputedStyle(root);
    const insets = Object.fromEntries(['top', 'right', 'bottom', 'left'].map((edge) =>
      [edge, parseFloat(style.getPropertyValue(`--plot-${edge}`))]));
    const view = window.__honorCic!.view()!;
    const background = view.scene.background;
    const hull = view.scene.getObjectByName('physical-hull') as Mesh | undefined;
    let hullBounds = null;
    if (hull) {
      const vertices = hull.geometry.getAttribute('position');
      const points = Array.from({ length: vertices.count }, (_, i) => {
        const p = view.camera.position.clone().set(vertices.getX(i), vertices.getY(i), vertices.getZ(i))
          .applyMatrix4(hull.matrixWorld).project(view.camera);
        return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
      });
      hullBounds = {
        left: Math.min(...points.map((p) => p.x)), right: Math.max(...points.map((p) => p.x)),
        top: Math.min(...points.map((p) => p.y)), bottom: Math.max(...points.map((p) => p.y)),
      };
    }
    const ships = view.id === 'engagement' ? view as EngagementView : null;
    const positions = ships?.debugPositions();
    const counts = ships?.drawCounts();
    const shipCount = counts?.ships ?? 0;
    const pointClouds = view.scene.children.filter((node): node is Points =>
      'isPoints' in node && node.isPoints === true);
    const shipCloud = positions && shipCount ? pointClouds.find((cloud) =>
      cloud.geometry.drawRange.count === shipCount
      && cloud.geometry.getAttribute('position').getX(0) === positions[0]) : undefined;
    const shipPixels = positions ? Array.from({ length: ships!.drawCounts().ships }, (_, i) => {
      const p = view.camera.position.clone().fromArray(positions, i * 3).project(view.camera);
      return {
        x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2,
        size: shipCloud?.geometry.getAttribute('size').getX(i) ?? 0,
      };
    }) : [];
    let visibleMissiles = 0;
    if (positions && counts) {
      for (let i = shipCount; i < shipCount + counts.dots; i++) {
        const p = view.camera.position.clone().fromArray(positions, i * 3).project(view.camera);
        const x = (p.x + 1) * innerWidth / 2, y = (1 - p.y) * innerHeight / 2;
        if (p.z >= -1 && p.z <= 1 && x >= insets.left && x <= innerWidth - insets.right
          && y >= insets.top && y <= innerHeight - insets.bottom) visibleMissiles++;
      }
    }
    return {
      state: window.__honorCic!.store.get(),
      insets,
      viewport: { width: innerWidth, height: innerHeight },
      safeWidth: innerWidth - insets.left - insets.right,
      safeHeight: innerHeight - insets.top - insets.bottom,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      background: background && 'getHex' in background ? background.getHex() : null,
      hullBounds,
      shipPixels,
      counts,
      visibleMissiles,
      labels: [...root.querySelectorAll<HTMLElement>('.lbl:not([hidden])')].map((label) => {
        const bounds = label.getBoundingClientRect();
        return {
          text: label.textContent, width: label.offsetWidth, height: label.offsetHeight,
          bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
          overflow: label.scrollWidth - label.clientWidth,
        };
      }),
    };
  });
  expect(state.background).toBe(0x020208);
  expect(state.safeWidth).toBeGreaterThan(0);
  expect(state.safeHeight).toBeGreaterThan(0);
  expect(state.overflow).toBeLessThanOrEqual(0);
  if (name === 'manticore-engagement' || name === 'training-engagement') {
    expect(state.shipPixels.length).toBeGreaterThan(0);
    let gap = Infinity;
    state.shipPixels.forEach((p, i) => {
      expect(p.size).toBeGreaterThan(0);
      for (const other of state.shipPixels.slice(0, i)) {
        gap = Math.min(gap, Math.hypot(p.x - other.x, p.y - other.y) - (p.size + other.size) / 2);
      }
    });
    expect(gap, 'Individual ship marker footprints must remain distinguishable').toBeGreaterThanOrEqual(1);
    for (const p of state.shipPixels) {
      expect(p.x).toBeGreaterThanOrEqual(state.insets.left);
      expect(p.x).toBeLessThanOrEqual(state.viewport.width - state.insets.right);
      expect(p.y).toBeGreaterThanOrEqual(state.insets.top);
      expect(p.y).toBeLessThanOrEqual(state.viewport.height - state.insets.bottom);
    }
  }
  for (const label of state.labels) {
    expect(label.bounds.left, label.text ?? '').toBeGreaterThanOrEqual(state.insets.left - 1);
    expect(label.bounds.top, label.text ?? '').toBeGreaterThanOrEqual(state.insets.top - 1);
    expect(label.bounds.right, label.text ?? '').toBeLessThanOrEqual(state.viewport.width - state.insets.right + 1);
    expect(label.bounds.bottom, label.text ?? '').toBeLessThanOrEqual(state.viewport.height - state.insets.bottom + 1);
    expect(label.overflow, label.text ?? '').toBeLessThanOrEqual(1);
    if (state.hullBounds) {
      const hull = state.hullBounds;
      expect(label.bounds.right <= hull.left || hull.right <= label.bounds.left
        || label.bounds.bottom <= hull.top || hull.bottom <= label.bounds.top, `Hull obscured by ${label.text}`).toBe(true);
    }
    if (name === 'manticore-engagement' || name === 'training-engagement') {
      expect(state.shipPixels.some((p) => p.x > label.bounds.left && p.x < label.bounds.right
        && p.y > label.bounds.top && p.y < label.bounds.bottom), `Formation obscured by ${label.text}`).toBe(false);
    }
  }
  const path = info.outputPath(`${name}.png`);
  const image = await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
  if (state.hullBounds) {
    const hullPixels = await page.evaluate(async ({ bytes, bounds, width }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      try {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const ratio = bitmap.width / width;
        const left = Math.max(0, Math.floor(bounds.left * ratio));
        const top = Math.max(0, Math.floor(bounds.top * ratio));
        const right = Math.min(bitmap.width, Math.ceil(bounds.right * ratio));
        const bottom = Math.min(bitmap.height, Math.ceil(bounds.bottom * ratio));
        const pixels = context.getImageData(left, top, right - left, bottom - top).data;
        let visible = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 40 && pixels[i + 1] > 40 && pixels[i + 2] > 40) visible++;
        }
        return visible;
      } finally {
        bitmap.close();
      }
    }, { bytes: [...image], bounds: state.hullBounds, width: state.viewport.width });
    expect(hullPixels, `${name}: the paused hull must remain visible in the captured plot`).toBeGreaterThan(0);
  }
  const statePath = info.outputPath(`${name}-state.json`);
  await writeFile(statePath, JSON.stringify(state, null, 2));
  await info.attach(`${name}-state`, { path: statePath, contentType: 'application/json' });
  return state;
}

for (const scenario of ['manticore', 'training']) {
  test(`${scenario}: visual evidence of each workspace, physical defenses and paused demos`, async ({ page, isMobile }, info) => {
    const errors = watchErrors(page);
    await page.setViewportSize(isMobile ? { width: 375, height: 844 } : { width: 1440, height: 900 });
    await openBattle(page, scenario);
    for (const scale of ['System', 'Engagement', 'Ship']) {
      await page.getByRole('tab', { name: scale, exact: true }).click();
      await expect(page.locator('.viewer')).toHaveAttribute('data-scale', scale.toLowerCase());
      await capture(page, info, `${scenario}-${scale.toLowerCase()}`);
    }
    await expect(page.locator('.ship-title')).not.toBeEmpty();
    await page.getByRole('button', { name: 'Defensive envelope' }).click();
    await capture(page, info, `${scenario}-defenses`);
    await page.getByRole('button', { name: 'Hull', exact: true }).click();
    for (const demo of ['Roll', 'Pod', 'Broadside']) {
      await page.getByRole('button', { name: `${demo} demo`, exact: true }).click();
      await expect(page.locator('.lbl.demo:visible')).toBeVisible();
      await capture(page, info, `${scenario}-${demo.toLowerCase()}`);
      if (demo === 'Broadside') {
        await page.getByRole('slider', { name: 'Demo position' }).evaluate((element) => {
          (element as HTMLInputElement).value = '0.05';
          element.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await expect.poll(() => page.evaluate(() => (window.__honorCic!.view() as ShipView).shotsFiring())).toBeGreaterThan(0);
        await capture(page, info, `${scenario}-broadside-active`);
      }
      await page.getByRole('button', { name: `${demo} demo`, exact: true }).click();
    }
    expect(errors).toEqual([]);
  });
}

test('paused Ship plots retain their image after repeated reframing', async ({ page }, info) => {
  const errors = watchErrors(page);
  const expectRetainedHull = async () => {
    const pixel = await page.evaluate(() => {
      const view = window.__honorCic!.view()!;
      const hull = view.scene.getObjectByName('physical-hull')!;
      const centre = view.camera.position.clone().set(0, 0, 0).applyMatrix4(hull.matrixWorld).project(view.camera);
      const canvas = document.querySelector('canvas')!;
      const gl = canvas.getContext('webgl2')!;
      const rgba = new Uint8Array(4);
      gl.readPixels(Math.floor((centre.x + 1) * canvas.width / 2), Math.floor((centre.y + 1) * canvas.height / 2),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return [...rgba];
    });
    expect(pixel[3], 'The settled drawing buffer must remain opaque instead of being discarded').toBe(255);
    expect(pixel.slice(0, 3).some((channel) => channel > 40), 'The retained pixel must contain the hull, not the void').toBe(true);
  };
  await page.setViewportSize({ width: 520, height: 800 });
  await openBattle(page, 'training');
  await page.getByRole('tab', { name: 'Ship', exact: true }).click();
  await expect(page.locator('.viewer')).toHaveAttribute('data-scale', 'ship');
  await capture(page, info, 'paused-hull-initial');
  await expectRetainedHull();
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Defensive envelope', exact: true }).click();
    await capture(page, info, `paused-envelope-${i}`);
    await page.getByRole('button', { name: 'Hull', exact: true }).click();
    await capture(page, info, `paused-hull-${i}`);
    await expectRetainedHull();
  }
  expect(errors).toEqual([]);
});

test('workspaces retain an unobstructed plot at intermediate and zoom-equivalent widths', async ({ page, isMobile }, info) => {
  test.skip(isMobile, 'desktop project captures the intermediate and zoom-equivalent layout matrix');
  const errors = watchErrors(page);
  await openBattle(page, 'training');
  for (const [width, height] of [[520, 800], [860, 800], [1100, 900], [720, 450]]) {
    await page.setViewportSize({ width, height });
    for (const scale of ['System', 'Engagement', 'Ship']) {
      await page.getByRole('tab', { name: scale, exact: true }).click();
      await capture(page, info, `training-${width}-${scale.toLowerCase()}`);
    }
  }
  expect(errors).toEqual([]);
});

test('Manticore: narrative shots preserve event timing and supply visual acceptance evidence', async ({ page }, info) => {
  const errors = watchErrors(page);
  const [meta, bodies, forces, timeline] = await Promise.all(['meta', 'bodies', 'forces', 'timeline']
    .map(async (file): Promise<unknown> => JSON.parse(await readFile(`scenarios/manticore/${file}.json`, 'utf8'))));
  const parsed = parsePack({ meta, bodies, forces, timeline, notes: '' });
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const replay = solve(parsed.pack);
  const directorShots = shotsFor(parsed.pack, replay);
  const beamTheaters = beamTheatersFor(replay);
  await openBattle(page, 'manticore');
  await openControls(page);
  await page.getByRole('button', { name: 'Shots', exact: true }).click();
  const shotsMenu = page.getByRole('dialog', { name: 'Director shots', exact: true });
  await expect(shotsMenu).toBeVisible();
  const shots = await page.locator('.shot').allTextContents();
  await info.attach('director-shots', { body: JSON.stringify(shots, null, 2), contentType: 'application/json' });
  await page.keyboard.press('Escape');
  await expect(shotsMenu).toBeHidden();
  for (const [name, text] of [
    ['flight', 'Missiles in flight'],
    ['impact', 'Terminal defense and impact'],
    ['aftermath', 'First-wave aftermath'],
    ['lac', 'LAC'],
    ['energy-pass', 'Close-range energy pass'],
  ]) {
    if (!await page.getByRole('button', { name: 'Shots', exact: true }).isVisible()) await openControls(page);
    await page.getByRole('button', { name: 'Shots', exact: true }).click();
    await expect(shotsMenu).toBeVisible();
    const shot = page.locator('.shot').filter({ hasText: text }).first();
    await expect(shot).toBeVisible();
    await shot.click();
    await expect(shotsMenu).toBeHidden();
    expect(await page.evaluate(() => window.__honorCic!.store.get().camera)).toBe('director');
    const start = await page.evaluate(() => window.__honorCic!.store.get().t);
    const selected = directorShots.find((s) => s.t0 === start);
    if (!selected) throw new Error(`No solved shot starts at ${start}`);
    let points: Vec3[] = [];
    if (name === 'flight') {
      const frame = sampleFrame(replay, start);
      const packets = (selected.focus?.packets ?? []).filter((i) => frame.packetAlive[i] > 0);
      expect(packets.length).toBeGreaterThan(0);
      points = packets.map((i): Vec3 => [frame.packetPos[i * 3], frame.packetPos[i * 3 + 1], frame.packetPos[i * 3 + 2]]);
      const centre: Vec3 = [0, 0, 0];
      for (const p of points) for (let k = 0; k < 3; k++) centre[k] += p[k] / points.length;
      const context = [...new Set(packets.flatMap((i) => [replay.packets[i].fromUnit, replay.packets[i].toUnit]))]
        .filter((i) => frame.unitCount[i] > 0)
        .sort((a, b) => dist(unitPosition(replay.units[a], start), centre) - dist(unitPosition(replay.units[b], start), centre))[0];
      expect(context).toBeDefined();
      points.push(unitPosition(replay.units[context], start));
    } else if (name === 'aftermath') {
      const packets = replay.packets.filter((p) => p.planId === selected.focus?.planId)
        .sort((a, b) => a.tLaunch - b.tLaunch);
      expect(packets.length).toBeGreaterThan(0);
      const wave = packets.filter((p) => p.salvoId === packets[0].salvoId);
      expect(start).toBeCloseTo(Math.max(...wave.map((p) => p.tArrive)) + 1, 6);
      const frame = sampleFrame(replay, start);
      expect(wave.every((p) => frame.packetAlive[replay.packets.indexOf(p)] === 0)).toBe(true);
    } else {
      await capture(page, info, `manticore-${name}-setup`);
      const wave = (selected.focus?.packets ?? []).map((i) => replay.packets[i]);
      const beams = name === 'impact'
        ? replay.beams.filter((b) => b.kind === 'laserhead' && beamTheaters.get(b) === selected.theater
          && wave.some((p) => Math.abs(b.t - p.tArrive) < 1e-6))
        : (selected.focus?.beams ?? []).map((i) => replay.beams[i]);
      const beam = beams.filter((b) => b.t >= selected.t0 && b.t < selected.t1).sort((a, b) => a.t - b.t)[0];
      expect(beam, `${name} must sample a resolved active beam`).toBeDefined();
      const t = beam.t + beam.dur / 2;
      await page.evaluate((t) => window.__honorCic!.store.set({ t }), t);
      points = [beam.from, beam.to];
      await info.attach(`${name}-resolved-event`, {
        body: JSON.stringify({ shotStart: start, eventStart: beam.t, duration: beam.dur, sample: t, kind: beam.kind }),
        contentType: 'application/json',
      });
    }
    const state = await capture(page, info, `manticore-${name}`);
    if (name === 'flight') expect(state.visibleMissiles).toBeGreaterThan(0);
    else if (name !== 'aftermath') expect(state.counts?.fx).toBeGreaterThan(0);
    const projected = await page.evaluate((points) => {
      const view = window.__honorCic!.view() as EngagementView;
      return points.map((point) => {
        const p = view.toRender(point).project(view.camera);
        return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2, z: p.z };
      });
    }, points);
    for (const point of projected) {
      expect(point.z).toBeGreaterThanOrEqual(-1);
      expect(point.z).toBeLessThanOrEqual(1);
      expect(point.x).toBeGreaterThanOrEqual(state.insets.left);
      expect(point.x).toBeLessThanOrEqual(state.viewport.width - state.insets.right);
      expect(point.y).toBeGreaterThanOrEqual(state.insets.top);
      expect(point.y).toBeLessThanOrEqual(state.viewport.height - state.insets.bottom);
    }
  }
  expect(errors).toEqual([]);
});

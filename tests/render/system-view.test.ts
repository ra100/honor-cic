import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { LAYERS, type ViewContext } from '../../src/render/scales/types';
import { SystemView } from '../../src/render/scales/system-view';
import { getPack } from '../../src/registry';

describe('SystemView', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const ctx = (t: number): ViewContext => ({
    replay, pack, tech: TECH, frame: sampleFrame(replay, t, createFrame(replay)),
    layers: Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewContext['layers'],
    perceived: { enabled: false, side: 'alliance' }, density: 4, theater: 'range', focusSide: 'alliance', systemFocus: 'primary', ship: { roll: false, pods: true, sails: false, fireT: null },
    selectedShip: null, selectedClass: null, reducedMotion: false,
  });
  it('builds bodies, orbits and hyper limits from the pack', () => {
    const v = new SystemView(pack, replay, null);
    v.update(ctx(0));
    const names = v.labels().map((l) => l.text);
    expect(names).toContain('Range star');
    expect(names).toContain('Range planet');
    expect(names.some((n) => n.includes('hyper limit'))).toBe(true);
  });
  it('draws no ground-truth fleets in the perceived picture, only delayed contacts (Review Focus 5)', () => {
    const v = new SystemView(pack, replay, null);
    const c = ctx(30);
    c.perceived = { enabled: true, side: 'alliance' };
    v.update(c);
    expect(v.labels().some((l) => l.cls.split(' ').includes('fleet'))).toBe(false);
    const red = v.labels().find((l) => l.key === 'contact:tf-red');
    expect(red?.sub ?? '').toContain('old');
  });

  it('hides the celestial layer when it is switched off', () => {
    const v = new SystemView(pack, replay, null);
    const c = ctx(0);
    c.layers.celestial = false;
    v.update(c);
    expect(v.labels().some((l) => l.cls.includes('planet'))).toBe(false);
  });

  it('preserves external composition on the first update, then adjusts safe-area fit without accumulating zoom', () => {
    const v = new SystemView(pack, replay, null);
    v.setPose([30e6, -10e6, 3e6], [10e6, 5e6, 0]);
    const before = v.camera.position.clone();
    v.update(ctx(0));
    expect(v.camera.position.toArray()).toEqual(before.toArray());
    const c = { ...ctx(0), plotInsets: { top: 40, right: 250, bottom: 160, left: 50 } };
    v.update(c);
    const centre = new THREE.Vector3(10, 5, 0).project(v.camera);
    expect(centre.x).toBeCloseTo(-0.2, 6);
    expect(centre.y).toBeCloseTo(0.12, 6);
    const fit = v.camera.position.clone();
    v.update(c);
    expect(v.camera.position.toArray()).toEqual(fit.toArray());
    v.update(ctx(0));
    expect(v.camera.position.distanceTo(before)).toBeLessThan(1e-6);
  });

  it('keeps a headless Follow target and viewing offset consistent', () => {
    const v = new SystemView(pack, replay, null);
    v.setPose([0, -10e6, 5e6], [0, 0, 0]);
    v.update(ctx(0));
    const before = v.camera.position.clone();
    v.followTarget([1e6, 2e6, 3e6]);
    expect(v.camera.position.clone().sub(new THREE.Vector3(1, 2, 3)).toArray()).toEqual(before.toArray());
    v.followTarget([2e6, 3e6, 4e6]);
    expect(v.camera.position.clone().sub(new THREE.Vector3(2, 3, 4)).toArray()).toEqual(before.toArray());
  });
});

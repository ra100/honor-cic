import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { exclusionsAt, indexBodies, type ConeExclusion } from '../../src/core/solver/orbits';
import { TECH } from '../../src/core/tech';
import { LM_KM } from '../../src/core/units';
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
    // Nothing true is pickable either.
    expect(v.pick(0, 0)).toBeNull();
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

  it('gives fleets Site B callouts with a leader offset and a side colour', () => {
    const v = new SystemView(pack, replay, null);
    v.update(ctx(0));
    const blue = v.labels().find((l) => l.key === 'unit:tf-blue');
    expect(blue?.text).toBe('BLUE');
    expect(blue?.offset).toBeDefined();
    expect(blue?.color).toMatch(/^rgba\(0, 255, 102/);
  });

  it('tweens to a new preset in free camera, but a director pose always wins', () => {
    const v = new SystemView(pack, replay, null);
    v.update(ctx(0));
    expect(v.animating()).toBe(false);
    v.update({ ...ctx(0), systemFocus: 'outer' });
    expect(v.animating()).toBe(true);
    v.setPose([0, -3e9, 1e9], [0, 0, 0]);
    v.update({ ...ctx(0), systemFocus: 'primary' });
    expect(v.animating()).toBe(false);
  });
});

describe('SystemView with the Manticore pack', () => {
  const pack = getPack('manticore')!;
  const replay = solve(pack, TECH);
  const ctx = (t: number): ViewContext => ({
    replay, pack, tech: TECH, frame: sampleFrame(replay, t, createFrame(replay)),
    layers: Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewContext['layers'],
    perceived: { enabled: false, side: 'alliance' }, density: 4, theater: 'sphinx', focusSide: 'alliance', systemFocus: 'primary', ship: { roll: false, pods: true, sails: false, fireT: null },
    selectedShip: null, selectedClass: null, reducedMotion: false,
  });
  const zone = exclusionsAt(indexBodies(pack.bodies), 0).find((e): e is ConeExclusion => e.kind === 'resonance-zone')!;

  it('draws the resonance zone as the solver enforces it: apex on the terminus, 22 LM base on the star', () => {
    const v = new SystemView(pack, replay, null);
    v.update(ctx(0));
    const cone = v.scene.getObjectsByProperty('type', 'Mesh').find((m) => (m as THREE.Mesh).geometry instanceof THREE.ConeGeometry) as THREE.Mesh<THREE.ConeGeometry>;
    const g = cone.geometry.parameters;
    expect(g.radius).toBeCloseTo(22 * LM_KM / 1e6, 6);
    expect(g.height).toBeCloseTo(412 * LM_KM / 1e6, 6);
    expect(g.openEnded).toBe(true);
    // ConeGeometry puts its apex on +Y: it must land on the terminus, the base centre on the star.
    cone.updateMatrixWorld();
    const apex = new THREE.Vector3(0, g.height / 2, 0).applyMatrix4(cone.matrixWorld);
    const base = new THREE.Vector3(0, -g.height / 2, 0).applyMatrix4(cone.matrixWorld);
    expect(apex.distanceTo(new THREE.Vector3(...zone.apex.map((x) => x / 1e6)))).toBeLessThan(1e-3);
    expect(base.distanceTo(new THREE.Vector3(...zone.base.map((x) => x / 1e6)))).toBeLessThan(1e-3);
  });

  it('labels the zone and the planets from the pack, in a wide view of the primary', () => {
    const v = new SystemView(pack, replay, null);
    v.update(ctx(0));
    const byKey = new Map(v.labels().map((l) => [l.key, l]));
    expect(byKey.get('zone:junction')?.sub).toBe('Provisional 44 LM cone · hyper translation lethal [S]');
    expect(byKey.get('body:sphinx')?.sub).toBe('Manticore-A IV · 15.3 LM · HMSS Vulcan');
    expect(byKey.get('body:manticore-a')?.sub).toBe('Primary · 1.12 solar masses');
    expect(byKey.get('limit:manticore-a')?.text).toBe('Manticore-A · 22.00 LM hyper limit');
  });

  it('dims fleets that have not arrived yet and says when they will', () => {
    const v = new SystemView(pack, replay, null);
    v.update({ ...ctx(0), systemFocus: 'outer' });
    const fifth = v.labels().find((l) => l.key === 'unit:fifth-fleet');
    expect(fifth?.cls).toContain('pending');
    expect(fifth?.sub).toMatch(/^arrives T\+/);
    expect(fifth?.offset ?? null).not.toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { ShipView } from '../../src/render/scales/ship-view';
import { LAYERS, type ViewContext } from '../../src/render/scales/types';
import { getPack } from '../../src/registry';

describe('ShipView technical workspace', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const ctx = (patch: Partial<ViewContext> = {}): ViewContext => ({
    replay, pack, tech: TECH, frame: sampleFrame(replay, 0, createFrame(replay)),
    layers: Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewContext['layers'],
    perceived: { enabled: false, side: 'alliance' }, density: 4, theater: 'range', focusSide: 'alliance', systemFocus: 'primary', ship: { roll: false, pods: true, sails: false, fireT: null },
    selectedShip: null, selectedClass: null, reducedMotion: false, ...patch,
  });

  it('builds the chosen class to its published dimensions and mounts (MTS §5.4)', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.currentClass()).toBe('saganami-c');
    const [l, b, h] = v.hullKm();
    expect(l).toBeCloseTo(0.61, 6);
    expect(b).toBeCloseTo(0.074, 6);
    expect(h).toBeCloseTo(0.062, 6);
    expect(v.mountCount()).toEqual({ missile: 40, graser: 16 });
  });

  it('frames the hull by default, and shows true-scale defenses only in their framing mode with protection enabled', () => {
    const v = new ShipView(pack, replay, null);
    const c = ctx({ selectedClass: 'saganami-c' });
    v.update(c);
    const hullDistance = v.camera.position.length();
    expect(v.wedgeVisible()).toBe(false);
    v.update({ ...c, shipFraming: 'defenses' });
    expect(v.wedgeVisible()).toBe(true);
    expect(v.camera.position.length()).toBeGreaterThan(hullDistance * 10);
    c.layers.protection = false;
    v.update({ ...c, shipFraming: 'defenses' });
    expect(v.wedgeVisible()).toBe(false);
    v.update(c);
    expect(v.camera.position.length()).toBeCloseTo(hullDistance, 6);
  });

  it('follows the selected ship when no class is chosen', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedShip: replay.ships.findIndex((s) => s.side === 'haven') }));
    expect(v.currentClass()).toBe('rhn-ca');
  });

  it('labels every figure with its evidence class or "unknown"', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    const specs = v.labels().filter((l) => l.cls.includes('spec'));
    expect(specs.length).toBeGreaterThan(3);
    expect(specs.every((l) => /\[(P|W|D|S)\]|unknown/.test(`${l.text} ${l.sub ?? ''}`))).toBe(true);
  });

  it('moves pods astern as the pod demo runs', () => {
    const v = new ShipView(pack, replay, null);
    v.setDemo('pods', 0);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    const before = v.podsOut();
    v.setDemo('pods', 1);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.podsOut()).toBeGreaterThan(before);
  });

  it('fires the starboard broadside in the broadside demo', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.shotsFiring()).toBe(0);
    v.setDemo('broadside', 0.05);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.shotsFiring()).toBeGreaterThan(0);
    expect(v.labels().some((l) => l.text.startsWith('Broadside: 20 tubes and 8 grasers'))).toBe(true);
  });

  it('uses a lit procedural hull whose bounds remain the physical dimensions', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'invictus' }));
    const hull = v.scene.getObjectByName('physical-hull') as THREE.Mesh;
    expect(hull.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(hull.geometry.type).not.toBe('BoxGeometry');
    const size = hull.geometry.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(0.01);
    v.hullKm().forEach((dimension, i) => expect(size.toArray()[i]).toBeCloseTo(dimension, 6));
    expect(v.mountLayout().filter((m) => m.kind === 'pod_lanes')).toHaveLength(6);
    expect(v.mountLayout().filter((m) => m.kind === 'pd')).toHaveLength(170);
  });

  it('discloses missing dimensions rather than treating a placeholder as a measurement', () => {
    const unknown = Object.values(TECH.classes).find((c) => c.length.value === null)!;
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: unknown.id }));
    expect(v.status().scaleNote).toContain('Unknown hull dimensions');
    expect(v.labels().some((l) => l.sub?.includes('placeholder hull'))).toBe(true);
  });

  it('reframes safe-area changes once, without resetting a free camera between frames', () => {
    const v = new ShipView(pack, replay, null);
    const c = ctx({ selectedClass: 'saganami-c', plotInsets: { top: 100, right: 200, bottom: 150, left: 20 } });
    v.update(c);
    v.camera.position.multiplyScalar(0.8);
    const free = v.camera.position.clone();
    v.update(c);
    expect(v.camera.position.toArray()).toEqual(free.toArray());
    expect(new THREE.Vector3().project(v.camera).x).toBeCloseTo(-0.18, 6);
    expect(new THREE.Vector3().project(v.camera).y).toBeCloseTo(0.05, 6);
  });

  it('keeps only identity and dimensions on narrow plots, with a separate active demo annotation', () => {
    const v = new ShipView(pack, replay, null);
    v.camera.aspect = 0.375;
    const c = ctx({ selectedClass: 'saganami-c', plotInsets: { top: 116, right: 0, bottom: 520, left: 0 } });
    v.update(c);
    expect(v.labels().map((l) => l.key)).toEqual(['title', 'hull']);
    for (const demo of ['roll', 'pods', 'broadside'] as const) {
      v.setDemo(demo, 0.5);
      v.update(c);
      expect(v.labels().map((l) => l.key)).toEqual(['title', 'hull', 'demo']);
      const annotation = v.labels().find((l) => l.key === 'demo')!;
      expect(`${annotation.text} ${annotation.sub}`).toContain('[S]');
      expect((annotation.sub ?? '').length).toBeLessThan(80);
    }
  });

  it('excludes the rolled physical hull from every plot annotation', () => {
    const v = new ShipView(pack, replay, null);
    v.setDemo('roll', 0.5);
    v.update(ctx({ selectedShip: 0 }));
    const hull = v.scene.getObjectByName('physical-hull') as THREE.Mesh;
    const box = hull.geometry.boundingBox!;
    const corners = [box.min.x, box.max.x].flatMap((x) =>
      [box.min.y, box.max.y].flatMap((y) =>
        [box.min.z, box.max.z].map((z) => new THREE.Vector3(x, y, z).applyMatrix4(hull.matrixWorld).toArray())));
    expect(v.labels().length).toBeGreaterThan(0);
    for (const label of v.labels()) expect(label.avoid?.map((p) => p.toArray())).toEqual(corners);
  });

  it('lets a selected hull be picked and does not invent Keyhole fit for class inspection', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.labels().some((l) => /fitted/.test(l.text))).toBe(false);
    v.update(ctx({ selectedShip: 0 }));
    const centre = new THREE.Vector3().project(v.camera);
    expect(v.pick(centre.x, centre.y)).toBe(0);
  });

  it('does not disclose a selected enemy’s truth status or equipment in perceived mode', () => {
    const enemy = replay.ships.findIndex((s) => s.side === 'haven');
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedShip: enemy, perceived: { enabled: true, side: 'alliance' } }));
    expect(v.labels().some((l) => l.key === 'ship' || l.key === 'equipment' || l.cls === 'damage')).toBe(false);
    expect(v.pick(0, 0)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { GRADE_TECHNICAL } from '../../src/render/grade';
import { ShipView } from '../../src/render/scales/ship-view';
import { LAYERS, type ViewContext } from '../../src/render/scales/types';
import { bandCorners, MOUNT_LEGEND } from '../../src/render/ship/site-b';
import { getPack } from '../../src/registry';

describe('ShipView: Site B wedge around the true-scale hull', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const manticore = getPack('manticore')!;
  const manticoreReplay = solve(manticore, TECH);
  const ctx = (patch: Partial<ViewContext> = {}, r = replay, p = pack): ViewContext => ({
    replay: r, pack: p, tech: TECH, frame: sampleFrame(r, 0, createFrame(r)),
    layers: Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewContext['layers'],
    perceived: { enabled: false, side: 'alliance' }, density: 4, theater: 'range', focusSide: 'alliance', systemFocus: 'primary',
    ship: { roll: false, pods: true, sails: false, fireT: null },
    selectedShip: null, selectedClass: null, reducedMotion: false, ...patch,
  });
  /** A view on a manual clock, so damping and drift are deterministic. */
  const clocked = (r = replay, p = pack) => {
    const time = { s: 0 };
    return { view: new ShipView(p, r, null, () => time.s), time };
  };

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

  it('develops through the technical grade and keeps the shared sky', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'invictus' }));
    expect(v.grade).toBe(GRADE_TECHNICAL);
    expect(v.scene.background).toBeNull();
    expect(v.camera.fov).toBe(44);
  });

  it('lights the hull as Site B\'s glossy metal while its bounds stay the physical dimensions', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'invictus' }));
    const hull = v.scene.getObjectByName('physical-hull') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(hull.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(hull.material.metalness).toBe(0.75);
    expect(hull.material.roughness).toBe(0.43);
    expect(hull.material.color.getHex()).toBe(0x758994);
    const size = hull.geometry.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(0.01);
    v.hullKm().forEach((dimension, i) => expect(size.toArray()[i]).toBeCloseTo(dimension, 6));
    const lights = v.scene.children.filter((o): o is THREE.Light => o instanceof THREE.Light);
    expect(lights.map((l) => [l.type, l.color.getHex(), l.intensity])).toEqual([
      ['AmbientLight', 0x9dbce4, 2], ['DirectionalLight', 0xe5f6ff, 3.5], ['DirectionalLight', 0x2889b5, 2],
    ]);
  });

  it('scales the double stress bands to the hull length, flaring from the stern kilt to the bow throat', () => {
    for (const id of ['invictus', 'saganami-c', 'shrike-b']) {
      const v = new ShipView(pack, replay, null);
      v.update(ctx({ selectedClass: id }));
      const l = v.hullKm()[0] / 0.01;
      const k = l / 10.237;
      const box = new THREE.Box3();
      v.scene.traverse((o) => { if (o.name === 'band-fill') box.expandByObject(o); });
      expect(box.min.x / k, id).toBeCloseTo(-6.16 - 0.04, 3);
      expect(box.max.x / k, id).toBeCloseTo(6.72 - 0.04, 3);
      expect(box.max.z / k, id).toBeCloseTo(4, 3);
      expect(box.min.z / k, id).toBeCloseTo(-4, 3);
      expect(box.max.y / k, id).toBeCloseTo(4.455, 3);
      const corners = bandCorners(1, 1);
      expect(corners[0][1]).toBeCloseTo(1.2, 6);
      expect(corners[2][1]).toBeCloseTo(4, 6);
    }
  });

  it('draws four band planes with doubled outlines and two sidewalls', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'invictus' }));
    const named = (name: string) => { const out: THREE.Object3D[] = []; v.scene.traverse((o) => { if (o.name === name) out.push(o); }); return out; };
    expect(named('band-fill')).toHaveLength(4);
    expect(named('band-edge')).toHaveLength(4);
    expect(named('sidewall')).toHaveLength(2);
    expect(v.wedgeVisible()).toBe(true);
  });

  it('hides the fields with the protection layer and in transit configuration, where sails take over', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'invictus', layers: { ...ctx().layers, protection: false } }));
    expect(v.wedgeVisible()).toBe(false);
    v.update(ctx({ selectedClass: 'invictus', ship: { roll: false, pods: true, sails: true, fireT: null } }));
    expect(v.wedgeVisible()).toBe(false);
    expect(v.podsOut()).toBe(0);
    expect(v.scene.getObjectByName('sails')!.visible).toBe(true);
    expect(v.labels().find((l) => l.key === 'bands')?.text).toBe('SAIL FIELDS NORMAL TO HULL AXIS');
    v.update(ctx({ selectedClass: 'invictus' }));
    expect(v.wedgeVisible()).toBe(true);
    expect(v.scene.getObjectByName('sails')!.visible).toBe(false);
    expect(v.labels().find((l) => l.key === 'bands')?.text).toBe('DORSAL / VENTRAL DOUBLE STRESS BANDS');
  });

  it('closes the ends only where the class data fits bow or stern walls', () => {
    const walls = (id: string) => {
      const v = new ShipView(pack, replay, null);
      v.update(ctx({ selectedClass: id }));
      return v.scene.getObjectByName('endwalls')!.children.length;
    };
    expect(walls('invictus')).toBe(0);
    expect(walls('katana')).toBe(1);
    expect(walls('shrike-b')).toBe(1);
  });

  it('labels bow, stern and bands with Site B\'s callouts and colours', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'invictus' }));
    const byKey = Object.fromEntries(v.labels().map((l) => [l.key, l]));
    expect(byKey.bow).toMatchObject({ text: 'BOW / DEEPER THROAT', color: '#8ac8d3' });
    expect(byKey.stern).toMatchObject({ text: 'STERN / 6 POD LANES', color: '#d7b47d' });
    expect(byKey.bands).toMatchObject({ text: 'DORSAL / VENTRAL DOUBLE STRESS BANDS', color: '#5ae0f3' });
    expect(byKey.caption).toBeUndefined();
    expect(v.labels().every((l) => /\bnote\b/.test(l.cls))).toBe(true);
    const katana = new ShipView(pack, replay, null);
    katana.update(ctx({ selectedClass: 'katana' }));
    expect(katana.labels().find((l) => l.key === 'bow')?.text).toBe('BOW BUCKLER / DRIVE APERTURE');
    expect(katana.labels().find((l) => l.key === 'stern')?.text).toBe('STERN / SHALLOWER KILT');
  });

  it('keeps every mount at its class count, coloured by Site B\'s palette', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'invictus' }));
    const layout = v.mountLayout();
    expect(layout.filter((m) => m.kind === 'pd')).toHaveLength(62 * 2 + 22 + 24);
    expect(layout.filter((m) => m.kind === 'cm')).toHaveLength(84 * 2 + 24 + 14);
    expect(layout.filter((m) => m.kind === 'pod_lanes')).toHaveLength(6);
    const drawn = (kind: string) => (v.scene.getObjectByName(`mounts-${kind}`) as THREE.InstancedMesh).count;
    expect(drawn('pd')).toBe(170);
    expect(drawn('cm')).toBe(206);
    expect(drawn('graser')).toBe(56);
    expect(v.status().scaleNote).toBe(MOUNT_LEGEND);
  });

  it('fits Keyhole platforms per ship, never per class', () => {
    const home = new ShipView(manticore, manticoreReplay, null);
    home.update(ctx({ selectedClass: 'invictus' }, manticoreReplay, manticore));
    expect(home.keyholeFit()).toBe(1);
    expect(home.labels().filter((l) => l.text === 'KEYHOLE I / DEFENSE')).toHaveLength(2);
    const eighth = manticoreReplay.ships.findIndex((s) => s.equipment.includes('keyhole-ii'));
    home.update(ctx({ selectedShip: eighth }, manticoreReplay, manticore));
    expect(home.keyholeFit()).toBe(2);
    expect(home.labels().filter((l) => l.text === 'KEYHOLE II / APOLLO')).toHaveLength(2);
    const cruiser = new ShipView(manticore, manticoreReplay, null);
    cruiser.update(ctx({ selectedClass: 'saganami-c' }, manticoreReplay, manticore));
    expect(cruiser.keyholeFit()).toBe(0);
    expect(cruiser.labels().some((l) => l.text.startsWith('KEYHOLE'))).toBe(false);
    home.update(ctx({ selectedClass: 'invictus', layers: { ...ctx().layers, comms: false } }, manticoreReplay, manticore));
    expect(home.labels().some((l) => l.text.startsWith('KEYHOLE'))).toBe(false);
  });

  it('trails three pods per stern lane on tethers, or racks a cruiser\'s external flatpacks', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'invictus' }));
    expect(v.podsOut()).toBe(18);
    v.update(ctx({ selectedClass: 'agamemnon' }));
    expect(v.podsOut()).toBe(12);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.podsOut()).toBe(40);
    v.update(ctx({ selectedClass: 'nike' }));
    expect(v.podsOut()).toBe(0);
    v.update(ctx({ selectedClass: 'invictus', ship: { roll: false, pods: false, sails: false, fireT: null } }));
    expect(v.podsOut()).toBe(0);
  });

  it('damps the belly-up roll toward 90°, holding it once settled', () => {
    const { view, time } = clocked();
    const c = ctx({ selectedClass: 'invictus' });
    view.update(c);
    expect(view.rollAngle()).toBe(0);
    const rolled = ctx({ selectedClass: 'invictus', ship: { roll: true, pods: true, sails: false, fireT: null } });
    time.s = 0.05;
    view.update(rolled);
    expect(view.rollAngle()).toBeGreaterThan(0);
    expect(view.rollAngle()).toBeLessThan(Math.PI / 2);
    expect(view.animating()).toBe(true);
    for (let i = 0; i < 40; i++) { time.s += 0.05; view.update(rolled); }
    expect(view.rollAngle()).toBe(Math.PI / 2);
    const reduced = clocked();
    reduced.view.update(c);
    reduced.time.s = 0.05;
    reduced.view.update({ ...rolled, reducedMotion: true });
    expect(reduced.view.rollAngle()).toBe(Math.PI / 2);
  });

  it('keeps frames coming only while the roll damps, pods drift or the demo runs', () => {
    const { view, time } = clocked();
    view.update(ctx({ selectedClass: 'nike' }));
    expect(view.animating()).toBe(false);
    view.update(ctx({ selectedClass: 'invictus' }));
    expect(view.animating()).toBe(true);
    view.update(ctx({ selectedClass: 'invictus', reducedMotion: true }));
    expect(view.animating()).toBe(false);
    view.update(ctx({ selectedClass: 'invictus', ship: { roll: false, pods: false, sails: false, fireT: null } }));
    expect(view.animating()).toBe(false);
    time.s = 1;
    view.update(ctx({ selectedClass: 'nike', ship: { roll: false, pods: true, sails: false, fireT: 3 } }));
    expect(view.animating()).toBe(true);
    view.update(ctx({ selectedClass: 'nike', ship: { roll: false, pods: true, sails: false, fireT: null } }));
    expect(view.animating()).toBe(false);
  });

  it('drifts the pods aft over each ejection cycle: two Site B units in twelve seconds', () => {
    const { view, time } = clocked();
    const c = ctx({ selectedClass: 'invictus' });
    view.update(c);
    const xs = () => {
      const pods: number[] = [];
      view.scene.getObjectByName('pods')!.traverse((o) => { if (o.name === 'pod') pods.push(o.getWorldPosition(new THREE.Vector3()).x); });
      return pods;
    };
    const before = xs();
    expect(before).toHaveLength(18);
    for (let i = 0; i < 120; i++) { time.s += 0.05; view.update(c); }
    const k = view.hullKm()[0] / 0.01 / 10.237;
    xs().forEach((x, i) => expect((before[i] - x) / k).toBeCloseTo(1, 3));
  });

  it('runs the fire / defense demo from fireT and reports each step as the status', () => {
    const v = new ShipView(pack, replay, null);
    const at = (t: number | null, roll = false) => ctx({ selectedClass: 'invictus', ship: { roll, pods: true, sails: false, fireT: t } });
    v.update(at(null));
    expect(v.shotsFiring()).toBe(0);
    v.update(at(0.5));
    expect(v.status().scaleNote).toBe('Launch through an open aspect; clear the wedge before turning.');
    v.update(at(3));
    expect(v.shotsFiring()).toBeGreaterThan(50);
    v.update(at(2));
    expect(v.status().scaleNote).toBe('CM accelerating toward a predicted wedge intersection.');
    v.update(at(null));
    expect(v.shotsFiring()).toBe(0);
    expect(v.status().scaleNote).toBe(MOUNT_LEGEND);
    v.update(at(3, false));
    v.update(at(3, false));
    v.update(ctx({ selectedClass: 'invictus', ship: { roll: false, pods: true, sails: true, fireT: 3 } }));
    expect(v.shotsFiring()).toBe(0);
  });

  it('stops laserhead beams on the stress bands once the hull has rolled', () => {
    const v = new ShipView(pack, replay, null, () => 0);
    const at = (t: number) => ctx({ selectedClass: 'invictus', reducedMotion: true, ship: { roll: true, pods: true, sails: false, fireT: t } });
    const statuses = new Set<string>();
    for (let t = 0; t < 20; t += 0.05) {
      v.update(at(t));
      statuses.add(v.status().scaleNote);
    }
    expect(statuses).toContain('Laserhead beam intercepted by the wedge; no through-wedge hit.');
  });

  it('drops a sidewall with its generator and the whole wedge with both impeller rings', () => {
    const damaged = (subsystems: Array<{ t: number; sub: 'wall_stbd' | 'drive_fore' | 'drive_aft'; value: number }>) => {
      const r = { ...replay, ships: replay.ships.map((s, i) => (i === 0 ? { ...s, subsystems } : s)) };
      const v = new ShipView(pack, r, null);
      v.update(ctx({ selectedShip: 0 }, r));
      return v;
    };
    const wall = damaged([{ t: 0, sub: 'wall_stbd', value: 0 }]);
    expect(wall.wedgeVisible()).toBe(false);
    expect(wall.scene.getObjectByName('bands')!.visible).toBe(true);
    expect(wall.labels().find((l) => l.key === 'damage-stbd')?.text).toBe('STARBOARD SIDEWALL DOWN');
    const drive = damaged([{ t: 0, sub: 'drive_fore', value: 0 }, { t: 0, sub: 'drive_aft', value: 0 }]);
    expect(drive.scene.getObjectByName('bands')!.visible).toBe(false);
    expect(drive.labels().find((l) => l.key === 'damage-drive')?.text).toBe('IMPELLER RINGS LOST · NO WEDGE');
    expect(damaged([{ t: 0, sub: 'drive_fore', value: 0 }]).wedgeVisible()).toBe(true);
  });

  it('frames the whole wedge and pod matrix with the bow lower right and the stern upper left', () => {
    const v = new ShipView(pack, replay, null);
    v.camera.aspect = 1.6;
    v.update(ctx({ selectedClass: 'invictus' }));
    const bow = new THREE.Vector3(v.hullKm()[0] / 0.02, 0, 0).project(v.camera);
    const stern = new THREE.Vector3(-v.hullKm()[0] / 0.02, 0, 0).project(v.camera);
    expect(bow.x).toBeGreaterThan(stern.x);
    expect(bow.y).toBeLessThan(stern.y);
    const box = new THREE.Box3();
    v.scene.traverse((o) => { if (o.name === 'band-fill') box.expandByObject(o); });
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).project(v.camera);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the user\'s viewing angle and zoom when the class changes, as the fields scale with the hull', () => {
    const v = new ShipView(pack, replay, null);
    v.camera.aspect = 1.6;
    v.update(ctx({ selectedClass: 'invictus' }));
    const target = () => (v as unknown as { orbit: THREE.Vector3 }).orbit;
    const k = () => v.hullKm()[0] / 0.01 / 10.237;
    const offset = v.camera.position.clone().sub(target());
    offset.applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.6).multiplyScalar(1.3);
    v.camera.position.copy(target()).add(offset);
    v.update(ctx({ selectedClass: 'invictus', plotInsets: { top: 1, right: 0, bottom: 0, left: 0 } }));
    const before = v.camera.position.clone().sub(target());
    const zoom = before.length() / k();
    v.update(ctx({ selectedClass: 'shrike-b', plotInsets: { top: 1, right: 0, bottom: 0, left: 0 } }));
    const after = v.camera.position.clone().sub(target());
    expect(after.clone().normalize().dot(before.clone().normalize())).toBeCloseTo(1, 6);
    expect(after.length() / k()).toBeCloseTo(zoom, 1);
  });

  it('reframes safe-area changes once, without resetting a free camera between frames', () => {
    const v = new ShipView(pack, replay, null);
    const c = ctx({ selectedClass: 'saganami-c', plotInsets: { top: 100, right: 200, bottom: 150, left: 20 } });
    v.update(c);
    v.camera.position.multiplyScalar(0.8);
    const free = v.camera.position.clone();
    v.update(c);
    expect(v.camera.position.toArray()).toEqual(free.toArray());
  });

  it('follows the selected ship when no class is chosen', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedShip: replay.ships.findIndex((s) => s.side === 'haven') }));
    expect(v.currentClass()).toBe('rhn-ca');
  });

  it('discloses unknown hull dimensions instead of the mount legend', () => {
    const unknown = Object.values(TECH.classes).find((c) => c.length.value === null)!;
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: unknown.id }));
    expect(v.status().scaleNote).toContain('Unknown hull dimensions');
  });

  it('lets a selected hull be picked, but not an enemy hull in the perceived picture', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedShip: 0 }));
    const centre = v.scene.getObjectByName('physical-hull')!.getWorldPosition(new THREE.Vector3()).project(v.camera);
    expect(v.pick(centre.x, centre.y)).toBe(0);
    const enemy = replay.ships.findIndex((s) => s.side === 'haven');
    v.update(ctx({ selectedShip: enemy, perceived: { enabled: true, side: 'alliance' } }));
    expect(v.pick(0, 0)).toBeNull();
  });

  it('disposes its geometry and controls without throwing', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'invictus' }));
    expect(() => v.dispose()).not.toThrow();
  });
});

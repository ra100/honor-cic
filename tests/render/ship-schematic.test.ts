import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { baseValue } from '../../src/core/evidence';
import { TECH } from '../../src/core/tech';
import { buildHullSchematic, HULL_KM_PER_UNIT, hullSections, MOUNT_KINDS } from '../../src/render/ship-schematic';

describe('procedural hull schematics', () => {
  it('preserves the exact physical extents of every dimensioned class', () => {
    for (const cls of Object.values(TECH.classes).filter((c) => c.length.value !== null && c.beam.value !== null && c.height.value !== null)) {
      const hull = buildHullSchematic(cls);
      expect(hull.placeholder).toBe(false);
      const size = hull.geometry.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(HULL_KM_PER_UNIT);
      [cls.length, cls.beam, cls.height].forEach((dimension, i) => expect(size.toArray()[i], cls.id).toBeCloseTo(baseValue(dimension)!, 6));
      for (const p of [...hull.mounts.map((m) => m.position), ...hull.bays]) {
        p.toArray().forEach((v, i) => expect(Math.abs(v), cls.id).toBeLessThanOrEqual(hull.dimensionsKm[i] / HULL_KM_PER_UNIT / 2 + 1e-6));
      }
      hull.geometry.dispose();
    }
  });

  it('expands all real mount kinds, with broadsides counted per side and chase mounts once', () => {
    for (const cls of Object.values(TECH.classes)) {
      const hull = buildHullSchematic(cls);
      for (const kind of MOUNT_KINDS) {
        expect(hull.mounts.filter((m) => m.kind === kind && m.aspect === 'port')).toHaveLength(cls.broadside[kind].value ?? 0);
        expect(hull.mounts.filter((m) => m.kind === kind && m.aspect === 'starboard')).toHaveLength(cls.broadside[kind].value ?? 0);
        for (const aspect of ['fore', 'aft'] as const) expect(hull.mounts.filter((m) => m.kind === kind && m.aspect === aspect)).toHaveLength(cls[aspect][kind].value ?? 0);
      }
      expect(hull.bays).toHaveLength(cls.lac_bays.value ?? 0);
      hull.geometry.dispose();
    }
  });

  it('distinguishes hammerhead capital hulls, full-bodied carriers and compact LACs', () => {
    const carrier = Object.values(TECH.classes).find((c) => c.hull === 'CLAC')!;
    const lac = Object.values(TECH.classes).find((c) => c.hull === 'LAC')!;
    const capital = hullSections(TECH.classes.invictus);
    expect(capital.find((s) => s.x === 0.31)?.beam).toBeLessThan(capital.find((s) => s.x === 0.38)!.beam);
    expect(hullSections(carrier)).not.toEqual(capital);
    expect(hullSections(lac)).not.toEqual(capital);
    expect(buildHullSchematic(carrier).bays).toHaveLength(carrier.lac_bays.value!);
  });

  it('does not fabricate stern pod lanes for external flatpack cruisers', () => {
    const hull = buildHullSchematic(TECH.classes['saganami-c']);
    expect(hull.mounts.some((m) => m.kind === 'pod_lanes')).toBe(false);
    expect(hull.mounts.filter((m) => m.kind === 'missile' && m.aspect === 'starboard')).toHaveLength(20);
    hull.geometry.dispose();
  });
});

describe('Site B mount rhythm on the schematic hull', () => {
  const key = (p: THREE.Vector3) => p.toArray().map((v) => v.toFixed(4)).join(',');

  it('never stacks two mounts on one spot', () => {
    for (const cls of Object.values(TECH.classes)) {
      const hull = buildHullSchematic(cls);
      const seen = new Set(hull.mounts.map((m) => key(m.position)));
      expect(seen.size, cls.id).toBe(hull.mounts.length);
      hull.geometry.dispose();
    }
  });

  it('stacks Invictus CM and PD into 22 seven-dot ticks per side with the grasers between them', () => {
    const hull = buildHullSchematic(TECH.classes.invictus);
    const stbd = hull.mounts.filter((m) => m.aspect === 'starboard');
    const columns = new Map<string, number>();
    for (const m of stbd.filter((m) => m.kind === 'cm' || m.kind === 'pd')) columns.set(m.position.x.toFixed(4), (columns.get(m.position.x.toFixed(4)) ?? 0) + 1);
    expect(columns.size).toBe(22);
    expect(Math.max(...columns.values())).toBe(7);
    const graserZ = new Set(stbd.filter((m) => m.kind === 'graser').map((m) => m.position.z.toFixed(4)));
    expect(graserZ).toEqual(new Set(['0.0000']));
    expect(stbd.every((m) => m.position.y < 0)).toBe(true);
    hull.geometry.dispose();
  });

  it('opens the stern pod lanes on Site B\'s two-row rail matrix', () => {
    const hull = buildHullSchematic(TECH.classes.invictus);
    const lanes = hull.mounts.filter((m) => m.kind === 'pod_lanes');
    expect(lanes).toHaveLength(6);
    expect(new Set(lanes.map((m) => m.position.z.toFixed(4))).size).toBe(2);
    expect(new Set(lanes.map((m) => m.position.y.toFixed(4))).size).toBe(3);
    expect(lanes.every((m) => m.aspect === 'aft' && m.position.x === lanes[0].position.x && m.position.x < 0)).toBe(true);
    hull.geometry.dispose();
  });

  it('puts a lone forward graser on the axis and rings the other bow and stern mounts', () => {
    const shrike = buildHullSchematic(TECH.classes['shrike-b']);
    const spinal = shrike.mounts.filter((m) => m.aspect === 'fore' && m.kind === 'graser');
    expect(spinal).toHaveLength(1);
    expect(spinal[0].position.y).toBe(0);
    expect(spinal[0].position.z).toBe(0);
    const pd = shrike.mounts.filter((m) => m.aspect === 'fore' && m.kind === 'pd');
    const radii = pd.map((m) => Math.hypot(m.position.y / shrike.dimensionsKm[1], m.position.z / shrike.dimensionsKm[2]));
    radii.forEach((r) => expect(r).toBeCloseTo(radii[0], 6));
    shrike.geometry.dispose();
  });

  it('shades around the hull smoothly, keeping the creases between sections', () => {
    const hull = buildHullSchematic(TECH.classes.invictus);
    const normal = hull.geometry.getAttribute('normal');
    const position = hull.geometry.getAttribute('position');
    const neck = 0.31 * hull.dimensionsKm[0] / HULL_KM_PER_UNIT + 1e-3;
    const midBody = new Map<string, Set<string>>();
    const all = new Map<string, Set<string>>();
    for (let tri = 0; tri < position.count; tri += 3) {
      const vs = [0, 1, 2].map((i) => new THREE.Vector3().fromBufferAttribute(position, tri + i));
      const inMid = vs.every((p) => Math.abs(p.x) <= neck);
      vs.forEach((p, i) => {
        const n = new THREE.Vector3().fromBufferAttribute(normal, tri + i).toArray().map((v) => v.toFixed(3)).join(',');
        for (const map of inMid ? [midBody, all] : [all]) map.set(key(p), (map.get(key(p)) ?? new Set()).add(n));
      });
    }
    expect(midBody.size).toBe(16);
    for (const normals of midBody.values()) expect(normals.size).toBe(1);
    for (const p of midBody.keys()) expect(all.get(p)!.size).toBeGreaterThan(1);
    hull.geometry.dispose();
  });
});

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

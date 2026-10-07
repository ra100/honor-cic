import { describe, expect, it } from 'vitest';
import { TECH, allSourceValues, capOf, podArithmetic, shipEquipment, wholeShipTotal } from '../../src/core/tech';
import { C_KM_S, gToKmS2 } from '../../src/core/units';

const cls = (id: string) => {
  const c = TECH.classes[id];
  if (!c) throw new Error(`missing class ${id}`);
  return c;
};

describe('ship classes (MTS §5)', () => {
  it('Nike BC: 25 M and 12 G per broadside at 674.3 g, 50 tubes in total', () => {
    const n = cls('nike');
    expect(n.broadside.missile.value).toBe(25);
    expect(n.broadside.graser.value).toBe(12);
    expect(n.accel_max.value).toBe(674.3);
    expect(n.hull).toBe('BC');
    expect(wholeShipTotal(n, 'missile')).toBe(50);
  });
  it('Saganami-C: 20 M per broadside, 40 combined', () => {
    expect(cls('saganami-c').broadside.missile.value).toBe(20);
    expect(wholeShipTotal(cls('saganami-c'), 'missile')).toBe(40);
  });
  it('Invictus: no broadside missile tubes, 1,074 pods, six per twelve seconds', () => {
    const i = cls('invictus');
    expect(i.broadside.missile.value).toBe(0);
    expect(i.pod_capacity.value).toBe(1074);
    expect(i.pod_eject_count.value).toBe(6);
    expect(i.pod_eject_cycle.value).toBe(12);
  });
  it('never inherits Keyhole II from the class', () => {
    const i = cls('invictus');
    expect(i.keyhole_allowed).toBe('keyhole-ii');
    expect(shipEquipment(i, { equipment: [] })).toEqual([]);
    expect(shipEquipment(i, { equipment: ['keyhole-ii'] })).toEqual(['keyhole-ii']);
  });
  it('gives the solver every input it needs, so solving never throws', () => {
    const paths = [
      'accel_max', 'accel_normal', 'durability', 'broadside.cm', 'broadside.pd', 'fore.cm', 'fore.pd',
      'defense.cm_waves', 'defense.pk_cm', 'defense.pd_shots', 'defense.pk_pd',
      'wedge.band_offset', 'wedge.band_length', 'wedge.band_width', 'wedge.sidewall_offset', 'hyper_cycle',
    ];
    for (const c of Object.values(TECH.classes)) {
      for (const p of paths) expect(capOf(c, null, p).value, `${c.id}.${p}`).not.toBeNull();
    }
  });
  it('lets a ship entry override a class value and keeps the override provenance', () => {
    const o = { 'accel_normal': { value: 400, unit: 'g' as const, evidence: 'S' as const, source_id: 'x', uncertainty: 'damaged' } };
    expect(capOf(cls('nike'), { overrides: o }, 'accel_normal').value).toBe(400);
    expect(capOf(cls('nike'), null, 'accel_normal').value).toBe(539.4);
  });
});

describe('pods and Apollo arithmetic (MTS §4.3, §10.2)', () => {
  it('counts an all-Apollo Invictus magazine correctly', () => {
    expect(podArithmetic(1074, TECH.podLoads['apollo']!)).toEqual({ attackEw: 8592, controllers: 1074, totalVehicles: 9666 });
    expect(podArithmetic(1074, TECH.podLoads['mk17-mk23']!).attackEw).toBe(10740);
  });
  it('reproduces the Eighth Fleet strike counts', () => {
    expect(podArithmetic(7776, TECH.podLoads['apollo']!)).toEqual({ attackEw: 62208, controllers: 7776, totalVehicles: 69984 });
  });
});

describe('missile profiles (MTS §4.1, §8.2)', () => {
  it('keeps Mk16 DDM and Mk23 MDM distinct', () => {
    expect(TECH.missiles['mk16-ddm']!.stages).toHaveLength(2);
    expect(TECH.missiles['mk23']!.stages).toHaveLength(3);
    expect(TECH.missiles['mk23']!.mass.value).toBe(94);
  });
  it('has no profile that reaches c with all stages burning (classical, from rest)', () => {
    for (const m of Object.values(TECH.missiles)) {
      const v = m.stages.reduce((s, st) => s + gToKmS2(st.accel.value as number) * (st.duration.value as number), 0);
      expect(v / C_KM_S, m.id).toBeLessThan(0.9);
    }
  });
});

describe('evidence policy', () => {
  it('gives every value a source and every S value a reason', () => {
    for (const { path, v } of allSourceValues(TECH)) {
      expect(v.source_id, path).not.toBe('');
      if (v.evidence === 'S') expect(v.uncertainty, path).toBeTruthy();
    }
  });
});

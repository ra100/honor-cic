import { describe, expect, it } from 'vitest';
import { coneContains, exclusionsAt, indexBodies, type ConeExclusion } from '../../../src/core/solver/orbits';
import { LM_KM } from '../../../src/core/units';
import { getPack } from '../../../src/registry';
import { coneFade, coneFrame, coneRadiusAt, coneSurfaceDistance } from '../../../src/render/system/resonance';

const pack = getPack('manticore')!;
const index = indexBodies(pack.bodies);
const zone = exclusionsAt(index, 0).find((e): e is ConeExclusion => e.kind === 'resonance-zone')!;

describe('resonance zone geometry', () => {
  it('frames the cone exactly as the solver enforces it: base on the star, apex on the terminus', () => {
    const f = coneFrame(zone);
    expect(zone.base).toEqual([0, 0, 0]);
    expect(f.height / LM_KM).toBeCloseTo(412, 6);
    expect(f.baseRadius / LM_KM).toBeCloseTo(22, 6);
    expect(f.centre[0] / LM_KM).toBeCloseTo(206, 6);
    expect(f.axis[0]).toBeCloseTo(1, 9);
    expect(coneRadiusAt(zone, 0) / LM_KM).toBeCloseTo(22, 6);
    expect(coneRadiusAt(zone, 206 * LM_KM) / LM_KM).toBeCloseTo(11, 6);
    expect(coneRadiusAt(zone, -1)).toBe(0);
  });

  it('measures distance to the wall with the same inside test as coneContains', () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 400; i++) {
      const p: [number, number, number] = [(rnd() * 460 - 30) * LM_KM, (rnd() - 0.5) * 60 * LM_KM, (rnd() - 0.5) * 60 * LM_KM];
      const inside = coneContains(zone.base, zone.apex, zone.radius, p);
      expect(coneSurfaceDistance(zone, p) < 0).toBe(inside);
    }
    expect(Math.abs(coneSurfaceDistance(zone, [100 * LM_KM, 22 * LM_KM * (1 - 100 / 412), 0]))).toBeLessThan(1);
  });

  it('shows the zone in strategic views, dims it near the star and hides it from inside', () => {
    const wide: [number, number, number] = [-40 * LM_KM, -130 * LM_KM, 90 * LM_KM];
    const close: [number, number, number] = [-2 * LM_KM, 14 * LM_KM, 3 * LM_KM];
    expect(coneFade(wide, zone)).toBeGreaterThan(0.25);
    expect(coneFade(close, zone)).toBeLessThan(coneFade(wide, zone) / 2);
    expect(coneFade([200 * LM_KM, 0, 0], zone)).toBe(0);
  });
});

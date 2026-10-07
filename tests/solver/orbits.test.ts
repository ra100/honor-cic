import { describe, expect, it } from 'vitest';
import { bodyPosition, exclusionsAt, indexBodies, insideExclusion, orbitPolyline } from '../../src/core/solver/orbits';
import { TECH } from '../../src/core/tech';
import { LM_KM } from '../../src/core/units';
import { validateStatic } from '../../src/core/validate';
import { dist, len, sub } from '../../src/core/vec';
import { getPack } from '../../src/registry';

const pack = getPack('manticore')!;
const idx = indexBodies(pack.bodies);
const lm = (km: number) => km / LM_KM;

describe('orbits (MTS §1.2, §2)', () => {
  it('puts Manticore-B 739 LM from A', () => {
    expect(lm(len(bodyPosition(idx, 'manticore-b', 0)))).toBeCloseTo(739, 1);
  });
  it('keeps B-system orbits centered on B at every time (check 2)', () => {
    for (const t of [0, 2700, 5400]) {
      const r = dist(bodyPosition(idx, 'gryphon', t), bodyPosition(idx, 'manticore-b', t));
      expect(lm(r)).toBeCloseTo(18.2, 6);
    }
  });
  it('places Sphinx at its epoch phase', () => {
    const p = bodyPosition(idx, 'sphinx', 0);
    expect(lm(p[0])).toBeCloseTo(15.3 * Math.cos((25 * Math.PI) / 180), 6);
    expect(lm(p[1])).toBeCloseTo(15.3 * Math.sin((25 * Math.PI) / 180), 6);
  });
  it('moves Sphinx a little over 90 minutes', () => {
    const moved = dist(bodyPosition(idx, 'sphinx', 0), bodyPosition(idx, 'sphinx', 5400));
    expect(moved).toBeGreaterThan(10_000);
    expect(moved).toBeLessThan(200_000);
  });
  it('draws each orbit through its body (check 3)', () => {
    const p = bodyPosition(idx, 'sphinx', 1234);
    const poly = orbitPolyline(idx, 'sphinx', 1234, 4096);
    const nearest = Math.min(...poly.map((q) => dist(p, q)));
    expect(nearest / (15.3 * LM_KM)).toBeLessThan(1e-3);
  });
  it('knows the hyper limit and the terminus exclusion', () => {
    const ex = exclusionsAt(idx, 0);
    expect(ex.find((e) => e.body === 'manticore-a')?.radius).toBeCloseTo(22 * LM_KM, 0);
    expect(insideExclusion(idx, [10 * LM_KM, 0, 0], 0)?.body).toBe('manticore-a');
    expect(insideExclusion(idx, [30 * LM_KM, 0, 0], 0)).toBeNull();
    const j = bodyPosition(idx, 'junction', 0);
    expect(insideExclusion(idx, [j[0] + 500_000, j[1], j[2]], 0)?.kind).toBe('terminus');
    expect(len(sub(j, [412 * LM_KM, 0, 0]))).toBeLessThan(1);
  });
  it('passes the positional frames and projection checks on every pack', () => {
    const bad = validateStatic(pack, TECH).filter((i) => (i.check === 'frames' || i.check === 'projection') && i.severity === 'error');
    expect(bad).toEqual([]);
  });
});

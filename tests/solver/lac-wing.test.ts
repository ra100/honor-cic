import { describe, expect, it } from 'vitest';
import { lacFront, lacWing, SQUADRON_SIZE } from '../../src/core/solver/lac-wing';
import { lanePoint } from '../../src/core/solver/packets';
import { dist, len, type Vec3 } from '../../src/core/vec';

describe('LAC wing layout', () => {
  const wing = lacWing('hf-lacs', 2300, 2000);

  it('places every LAC, twelve to a squadron', () => {
    expect(wing.slots).toHaveLength(2300);
    const sizes = new Map<number, number>();
    for (const q of wing.squadron) sizes.set(q, (sizes.get(q) ?? 0) + 1);
    expect(sizes.size).toBe(Math.ceil(2300 / SQUADRON_SIZE));
    expect([...sizes.values()].filter((n) => n !== SQUADRON_SIZE)).toHaveLength(1);
  });

  it('spreads squadrons across the threat axis, not along it', () => {
    const across = Math.max(...wing.slots.map((s) => Math.hypot(s[0], s[2])));
    const along = Math.max(...wing.slots.map((s) => Math.abs(s[1])));
    expect(across).toBeGreaterThan(0.9 * wing.front);
    expect(across).toBeLessThan(1.1 * wing.front);
    expect(along).toBeLessThan(0.02 * wing.front);
  });

  it('keeps squadrons apart and their LACs together', () => {
    const centre = (q: number): Vec3 => {
      const own = wing.slots.filter((_, i) => wing.squadron[i] === q);
      return own.reduce((a, s) => [a[0] + s[0] / own.length, a[1] + s[1] / own.length, a[2] + s[2] / own.length], [0, 0, 0]);
    };
    const inner = Math.max(...wing.slots.filter((_, i) => wing.squadron[i] === 7).map((s) => dist(s, centre(7))));
    const nearest = Math.min(...Array.from({ length: 40 }, (_, q) => q).filter((q) => q !== 7).map((q) => dist(centre(q), centre(7))));
    expect(nearest).toBeGreaterThan(3 * inner);
  });

  it('thins by a fixed order: each count keeps a subset of the larger one', () => {
    const alive = (n: number) => new Set(wing.slots.map((_, i) => i).filter((i) => wing.lossRank[i] < n));
    expect(alive(2300).size).toBe(2300);
    expect(alive(807).size).toBe(807);
    for (const i of alive(807)) expect(alive(1403).has(i)).toBe(true);
    expect(new Set(wing.lossRank).size).toBe(2300);
  });

  it('is deterministic and sized by the count', () => {
    expect(lacWing('hf-lacs', 2300, 2000).slots).toEqual(wing.slots);
    expect(wing.front).toBeCloseTo(lacFront(2300, 2000), 6);
    expect(lacFront(4 * 2300, 2000)).toBeCloseTo(2 * lacFront(2300, 2000), -3);
  });
});

describe('squadron lanes', () => {
  const fromV: Vec3 = [0, 52_000, 0];

  it('puts the launch in the lane of a target the wing is closing on', () => {
    const p = lanePoint([0, 0, 0], fromV, [40_000, 168_000, 5_000], [0, 0, 0], 300_000);
    expect(p[0]).toBeCloseTo(40_000, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(5_000, 6);
  });

  it('caps the lane at the front', () => {
    const p = lanePoint([0, 0, 0], fromV, [500_000, 168_000, 0], [0, 0, 0], 300_000);
    expect(len(p)).toBeCloseTo(300_000, 3);
  });

  it('fires from the centre when the target is not closing', () => {
    expect(lanePoint([0, 0, 0], fromV, [40_000, -168_000, 0], [0, 0, 0], 300_000)).toEqual([0, 0, 0]);
    expect(lanePoint([0, 0, 0], [0, 0, 0], [40_000, 168_000, 0], [0, 0, 0], 300_000)).toEqual([0, 0, 0]);
  });
});

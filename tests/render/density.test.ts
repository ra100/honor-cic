import { describe, expect, it } from 'vitest';
import { DOT_CAP, DotCache, displaySpreadKm, packetSpreadKm, planDensity } from '../../src/render/density';

describe('planDensity (MTS §11.3, Review Focus 4)', () => {
  it('draws one dot per N missiles at the chosen ratio', () => {
    const plan = planDensity(new Uint32Array([100, 7, 0]), 4);
    expect(plan.effectiveRatio).toBe(4);
    expect(Array.from(plan.perPacket)).toEqual([25, 2, 0]);
    expect(plan.dots).toBe(27);
    expect(plan.total).toBe(107);
  });
  it('caps the dot count at 1:1 on a 740k-missile battle and reports the effective ratio', () => {
    const alive = new Uint32Array(1000).fill(740);
    const plan = planDensity(alive, 1);
    expect(plan.dots).toBeLessThanOrEqual(DOT_CAP);
    expect(plan.effectiveRatio).toBeGreaterThan(1);
    expect(plan.total).toBe(740_000);
  });
  it('spreads young packets tightly and old ones wider, within a bound', () => {
    expect(packetSpreadKm(0)).toBeLessThan(packetSpreadKm(100));
    expect(packetSpreadKm(1e6)).toBe(20_000);
  });
  it('widens a packet so it stays visible from far away, never below its own spread', () => {
    expect(displaySpreadKm(1_000, 6.5e7)).toBeGreaterThanOrEqual(0.005 * 6.5e7);
    expect(displaySpreadKm(20_000, 1e5)).toBe(20_000);
  });
  it('places dots deterministically, so scrubbing never reshuffles them', () => {
    const a = new DotCache().offsets(42, 10);
    const b = new DotCache().offsets(42, 10);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a).every((v) => Math.abs(v) <= 1)).toBe(true);
  });
});

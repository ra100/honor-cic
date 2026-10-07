import { describe, expect, it } from 'vitest';
import { basis } from '../../src/core/solver/formation';
import { classifyAspect, endwallFactor, launchBlocked, orientationAt, type WedgeDims } from '../../src/core/solver/geometry';
import { scale } from '../../src/core/vec';

const SD: WedgeDims = { bandOffset: 12, bandLength: 40, bandWidth: 30 };
const o = basis([1, 0, 0], [0, 0, 1]);
const from = (v: [number, number, number]) => scale(v, -1) as [number, number, number];

describe('classifyAspect (MTS §3.1, §4.6)', () => {
  it('blocks attacks from above and below with the wedge', () => {
    expect(classifyAspect(o, from(o.u), SD)).toBe('wedge');
    expect(classifyAspect(o, o.u, SD)).toBe('wedge');
  });
  it('sends broadside attacks into the sidewall', () => {
    expect(classifyAspect(o, from(o.s), SD)).toBe('sidewall');
  });
  it('finds the throat ahead and the kilt astern', () => {
    expect(classifyAspect(o, from(o.f), SD)).toBe('throat');
    expect(classifyAspect(o, o.f, SD)).toBe('kilt');
  });
  it('uses the band size: steep attacks hit the wedge, shallow ones the sidewall', () => {
    const mix = (a: number, b: number) => [o.s[0] * a + o.u[0] * b, o.s[1] * a + o.u[1] * b, o.s[2] * a + o.u[2] * b] as [number, number, number];
    expect(classifyAspect(o, from(mix(Math.SQRT1_2, Math.SQRT1_2)), SD)).toBe('wedge');
    expect(classifyAspect(o, from(mix(Math.cos(Math.PI / 6), 0.5)), SD)).toBe('sidewall');
  });
  it('a 90° roll turns the wedge toward a broadside threat (MTS §6.2)', () => {
    const rolled = orientationAt([1, 0, 0], [0, 0, 1], [{ t0: 0, t1: 10, angleRad: Math.PI / 2 }], 20);
    expect(classifyAspect(rolled, from(o.s), SD)).toBe('wedge');
    const half = orientationAt([1, 0, 0], [0, 0, 1], [{ t0: 0, t1: 10, angleRad: Math.PI / 2 }], 5);
    expect(half.u[2]).toBeCloseTo(Math.SQRT1_2, 6);
  });
  it('weakens attacks through end walls without making them immune', () => {
    expect(endwallFactor('none')).toBe(1);
    expect(endwallFactor('full')).toBeGreaterThan(0);
    expect(endwallFactor('full')).toBeLessThan(endwallFactor('buckler'));
  });
  it('blocks launches through the ship\'s own wedge', () => {
    expect(launchBlocked(o, o.s, SD)).toBe(false);
    expect(launchBlocked(o, o.u, SD)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { burnDisplacement, burnPlanOf, planIntercept } from '../../src/core/solver/intercept';
import { segmentState } from '../../src/core/solver/kinematics';
import { DrivePhase } from '../../src/core/solver/types';
import { TECH } from '../../src/core/tech';
import { C_KM_S, gToKmS2 } from '../../src/core/units';
import { dist, type Vec3 } from '../../src/core/vec';
import { expandFirePlans, splitEven, arrivalAnchors } from '../../src/core/solver/packets';
import { TimeResolver } from '../../src/core/solver/timeref';
import { miniPack } from '../fixtures/mini-pack';

const mk16 = burnPlanOf(TECH.missiles['mk16-ddm']!);
const mk23 = burnPlanOf(TECH.missiles['mk23']!);
const still = (p: Vec3) => () => p;

describe('burn schedule (MTS §8.2)', () => {
  it('matches the from-rest classical figures for one 46,000 g 180 s stage', () => {
    const { s, v } = burnDisplacement(mk16, 180);
    expect(v).toBeCloseTo(gToKmS2(46_000) * 180, 6);
    expect(s / 1e6).toBeCloseTo(7.308, 3);
  });
  it('coasts before the last stage when the target is beyond powered range', () => {
    const powered = burnDisplacement(mk16, 360).s;
    expect(burnDisplacement(mk16, 400).s).toBeCloseTo(powered + 40 * gToKmS2(46_000) * 180, 3);
  });
});

describe('single-drive missiles of 1900 PD (On Basilisk Station ch. 29)', () => {
  const rmn = burnPlanOf(TECH.missiles['rmn-1900']!);
  it('burns three minutes at 417 km/s² and then goes ballistic', () => {
    const burnout = burnDisplacement(rmn, 180);
    expect(burnout.v).toBeCloseTo(gToKmS2(42_500) * 180, 6);
    expect(burnDisplacement(rmn, 200).s).toBeCloseTo(burnout.s + 20 * burnout.v, 3);
  });
  it('reproduces the warning shot: 192.8 s to a target pulling away at 410 g, 25.62 light-seconds off', () => {
    const a = gToKmS2(410);
    const v0 = 188;
    const r0 = 25.62 * C_KM_S;
    const plan = planIntercept({ plan: rmn, tLaunch: 0, launchP: [0, 0, 0], launchV: [0, 0, 0], target: (t) => [r0 - v0 * t + 0.5 * a * t * t, 0, 0] });
    expect(plan.feasible).toBe(true);
    expect(plan.T).toBeGreaterThan(191.5);
    expect(plan.T).toBeLessThan(194);
    expect(plan.phases.map((p) => p.phase)).toEqual([DrivePhase.Boost, DrivePhase.Coast]);
  });
});

describe('planIntercept', () => {
  it('reaches a stationary target 30 Mkm away in about 369.5 s', () => {
    const plan = planIntercept({ plan: mk16, tLaunch: 0, launchP: [0, 0, 0], launchV: [0, 0, 0], target: still([30e6, 0, 0]) });
    expect(plan.feasible).toBe(true);
    expect(plan.T).toBeCloseTo(369.46, 1);
    expect(dist(segmentState(plan.segments, plan.T).p, [30e6, 0, 0])).toBeLessThan(1);
    expect(plan.phases.map((p) => p.phase)).toEqual([DrivePhase.Boost, DrivePhase.Coast, DrivePhase.Terminal]);
  });

  it('meets a moving target where it will be, not where it was', () => {
    const target = (t: number): Vec3 => [20e6 + 5000 * t, 3e6, 0];
    const plan = planIntercept({ plan: mk16, tLaunch: 100, launchP: [0, 0, 0], launchV: [1000, 0, 0], target });
    expect(plan.feasible).toBe(true);
    expect(dist(segmentState(plan.segments, 100 + plan.T).p, target(100 + plan.T))).toBeLessThan(1);
  });

  it('flies the Apollo shot at 78 Mkm below c', () => {
    const plan = planIntercept({ plan: mk23, tLaunch: 0, launchP: [0, 0, 0], launchV: [0, 0, 0], target: still([78e6, 0, 0]) });
    expect(plan.feasible).toBe(true);
    expect(plan.T).toBeGreaterThan(590);
    expect(plan.T).toBeLessThan(600);
    expect(plan.maxSpeed / C_KM_S).toBeLessThan(0.9);
  });

  it('catches the few-second window of a fly-by instead of turning round after the pass', () => {
    // A LAC closing at 52,000 km/s launches 168,000 km out; the target is 500 km off its line of flight.
    const target = still([500, 168_000, 0]);
    const plan = planIntercept({ plan: mk16, tLaunch: 0, launchP: [0, 0, 0], launchV: [0, 52_000, 0], target });
    expect(plan.feasible).toBe(true);
    expect(plan.T).toBeGreaterThan(3.1);
    expect(plan.T).toBeLessThan(3.3);
    expect(dist(segmentState(plan.segments, plan.T).p, target())).toBeLessThan(1);
  });

  it('still turns round when the pass misses by more than the missile can correct', () => {
    const target = still([40_000, 168_000, 0]);
    const plan = planIntercept({ plan: mk16, tLaunch: 0, launchP: [0, 0, 0], launchV: [0, 52_000, 0], target });
    expect(plan.T).toBeGreaterThan(60);
  });

  it('reports an unreachable target as infeasible instead of forcing it', () => {
    const plan = planIntercept({ plan: mk16, tLaunch: 0, launchP: [0, 0, 0], launchV: [0, 0, 0], target: still([500e6, 0, 0]) });
    expect(plan.feasible).toBe(false);
    expect(plan.maxSpeed).toBeLessThan(C_KM_S);
  });
});

describe('expandFirePlans', () => {
  it('splits counts exactly', () => {
    expect(splitEven(10, 3)).toEqual([4, 3, 3]);
    expect(splitEven(10, 3).reduce((a, b) => a + b)).toBe(10);
  });

  it('turns the mini fire plan into conserved, feasible packets', () => {
    const pack = miniPack();
    const plans = pack.events.filter((e) => e.type === 'fire_plan') as Extract<typeof pack.events[number], { type: 'fire_plan' }>[];
    const pos = (id: string): Vec3 => (id === 'blue-ca' ? [-5e6, 0, 0] : [5e6, 0, 0]);
    const packets = expandFirePlans(plans, TECH, new TimeResolver(pack.events), {
      unitIndex: new Map([['blue-ca', 0], ['red-ca', 1]]),
      unitPosition: (id) => pos(id),
      unitVelocity: () => [0, 0, 0],
      shipSlots: (id) => [0, 1].map((k) => ({ ship: (id === 'blue-ca' ? 0 : 2) + k, offset: () => [0, k * 2000, 0] as Vec3 })),
      side: (id) => (id === 'blue-ca' ? 'blue' : 'red'),
    });
    expect(packets).toHaveLength(2);
    expect(packets.reduce((a, p) => a + p.launched.attack, 0)).toBe(40);
    expect(packets.every((p) => !p.infeasible && p.tArrive > p.tLaunch)).toBe(true);
    expect(arrivalAnchors(packets).arrival.get('fp-blue')).toBeGreaterThan(0);
  });
});

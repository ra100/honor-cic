import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame } from '../../../src/core/replay';
import { solve } from '../../../src/core/solver/solve';
import { TECH } from '../../../src/core/tech';
import type { Vec3 } from '../../../src/core/vec';
import {
  fmtRingKm, gridFade, nearestEnemyUnit, niceRingStep, ringCentreUnit, ringPlan,
} from '../../../src/render/engagement/focus';
import { getPack } from '../../../src/registry';

const unitAt = (f: { unitPos: Float64Array }, i: number): Vec3 => [f.unitPos[i * 3], f.unitPos[i * 3 + 1], f.unitPos[i * 3 + 2]];

describe('range rings on my fleet (Site A §4.1)', () => {
  it('reproduces Site A\'s geometry for its 65 Mkm exchange seen from 64 Mkm: 5 Mkm rings, 10–70 Mkm labels, a 90 Mkm disc', () => {
    const plan = ringPlan([0, 0, 0], 0, [65_000_000, 0, 0], 64_000_000);
    expect(plan.step).toBe(5_000_000);
    expect(plan.radius).toBe(90_000_000);
    expect(plan.labels.map((l) => l.text)).toEqual(['10M km', '20M km', '30M km', '40M km', '50M km', '60M km', '70M km']);
  });

  it('strings the ring labels along the bearing to the enemy at their true distances, in the centre\'s plane', () => {
    const centre: Vec3 = [1e8, -2e8, 5e5];
    const enemy: Vec3 = [1e8 + 3e7, -2e8 + 4e7, 9e5];
    const plan = ringPlan(centre, 3, enemy, 6e7);
    expect(plan.bearing[0]).toBeCloseTo(0.6, 9);
    expect(plan.bearing[1]).toBeCloseTo(0.8, 9);
    expect(plan.enemyKm).toBeCloseTo(Math.hypot(3e7, 4e7, 4e5), 0);
    expect(plan.labels.length).toBeGreaterThan(3);
    for (const l of plan.labels) {
      expect(Math.hypot(l.pos[0] - centre[0], l.pos[1] - centre[1])).toBeCloseTo(l.km, 3);
      expect(l.pos[2]).toBe(centre[2]);
      expect(l.km % (plan.step * 2)).toBe(0);
    }
  });

  it('follows the camera: fine rings in a close-up of my fleet, coarser ones for the whole front, capped by the enemy range', () => {
    const enemy: Vec3 = [65_000_000, 0, 0];
    const close = ringPlan([0, 0, 0], 0, enemy, 530_000);
    expect(close.step).toBe(25_000);
    expect(close.labels[0].text).toBe('50,000 km');
    expect(close.labels.length).toBeLessThanOrEqual(8);
    expect(close.radius).toBeLessThanOrEqual(40 * close.step);
    expect(ringPlan([0, 0, 0], 0, enemy, 15_000_000).step).toBe(1_000_000);
    expect(ringPlan([0, 0, 0], 0, [33_000_000, 0, 0], 3e8).step).toBe(10_000_000);
    expect(ringPlan([0, 0, 0], 0, [33_000_000, 0, 0], 1e12).step).toBe(10_000_000);
    expect(ringPlan([0, 0, 0], null, null, 1e6).step).toBe(50_000);
  });

  it('picks nice steps and formats them as Site A does', () => {
    expect([0.9e6, 2.2e6, 4e6, 7.6e6, 3.3e7].map(niceRingStep)).toEqual([1e6, 2.5e6, 5e6, 1e7, 2.5e7]);
    expect(fmtRingKm(20_000_000)).toBe('20M km');
    expect(fmtRingKm(2_500_000)).toBe('2.5M km');
    expect(fmtRingKm(250_000)).toBe('250,000 km');
  });

  it('fades the grid in close-ups and at system range like Site A\'s 0.4–4 / 260–700 Mkm window', () => {
    expect(gridFade(100_000, 9e7)).toBe(0);
    expect(gridFade(6e7, 9e7)).toBe(1);
    expect(gridFade(1e9, 9e7)).toBe(0);
  });
});

describe('which fleet is mine', () => {
  const pack = getPack('manticore')!;
  const replay = solve(pack, TECH);
  const id = (i: number | null) => (i === null ? null : replay.units[i].id);
  const frame = (t: number) => sampleFrame(replay, t, createFrame(replay));

  it('centres on Home Fleet in the opening and bears on Second Fleet', () => {
    const f = frame(0);
    const sf = replay.units.findIndex((u) => u.id === 'second-fleet');
    const unit = ringCentreUnit(replay, f, 'sphinx', 'alliance', unitAt(f, sf), null);
    expect(id(unit)).toBe('home-fleet');
    expect(id(nearestEnemyUnit(replay, f, 'sphinx', 'alliance', unitAt(f, unit!)))).toBe('second-fleet');
  });

  it('moves to Third Fleet on the second front and to Eighth Fleet for the Apollo strike, by where the camera looks', () => {
    const f = frame(3390);
    const third = replay.units.findIndex((u) => u.id === 'third-fleet');
    const eighth = replay.units.findIndex((u) => u.id === 'eighth-fleet');
    expect(id(ringCentreUnit(replay, f, 'sphinx', 'alliance', unitAt(f, third), null))).toBe('third-fleet');
    expect(id(ringCentreUnit(replay, f, 'sphinx', 'alliance', unitAt(f, eighth), null))).toBe('eighth-fleet');
    expect(id(nearestEnemyUnit(replay, f, 'sphinx', 'alliance', unitAt(f, eighth)))).toBe('fifth-fleet');
  });

  it('follows the selected ship\'s fleet on my side, and the Havenite fleets when Haven is my side', () => {
    const f = frame(3390);
    const eighth = replay.units.findIndex((u) => u.id === 'eighth-fleet');
    const third = replay.units.find((u) => u.id === 'third-fleet')!;
    expect(id(ringCentreUnit(replay, f, 'sphinx', 'alliance', unitAt(f, eighth), third.shipIdx[0]))).toBe('third-fleet');
    const sfShip = replay.units.find((u) => u.id === 'second-fleet')!.shipIdx[0];
    expect(id(ringCentreUnit(replay, f, 'sphinx', 'alliance', unitAt(f, eighth), sfShip))).toBe('eighth-fleet');
    expect(replay.units[ringCentreUnit(replay, f, 'sphinx', 'haven', unitAt(f, eighth), null)!].side).toBe('haven');
  });

  it('stays on my side after my wall of battle is gone', () => {
    const f = frame(1000);
    const hf = replay.units.findIndex((u) => u.id === 'home-fleet');
    expect(f.unitCount[hf]).toBe(0);
    const unit = ringCentreUnit(replay, f, 'sphinx', 'alliance', unitAt(f, hf), null);
    expect(unit).not.toBeNull();
    expect(replay.units[unit!].side).toBe('alliance');
  });
});

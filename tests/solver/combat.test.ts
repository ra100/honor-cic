import { describe, expect, it } from 'vitest';
import type { OutcomeEvent } from '../../src/core/schema';
import { applyEscapes, finalStatus, reconcileOutcomes, subsystemSteps } from '../../src/core/solver/damage';
import { resolveArrivals, type CombatContext } from '../../src/core/solver/defense';
import type { PacketTrack } from '../../src/core/solver/packets';
import type { ShipRuntime, UnitRuntime } from '../../src/core/solver/runtime';
import { ShipStatus, SUBSYSTEMS, type Subsystem } from '../../src/core/solver/types';
import { TECH } from '../../src/core/tech';
import type { Vec3 } from '../../src/core/vec';

const cls = TECH.classes['saganami-c']!;

function ship(idx: number, opts: Partial<ShipRuntime> = {}): ShipRuntime {
  return {
    idx, unit: 1, side: 'red', classId: cls.id, cls, entry: null, role: cls.role, slot: [idx * 2000, 0, 0],
    name: `S${idx}`, nameEvidence: 'S', flagship: false, equipment: [], readiness: 'routine',
    damage: 0, hits: [], subs: Object.fromEntries(SUBSYSTEMS.map((k) => [k, 1])) as Record<Subsystem, number>,
    escapedAt: Infinity, goneAt: Infinity, steps: [], marks: { ringLost: null, forcedDegradeAt: null, cleared: [] }, ...opts,
  };
}

function unit(idx: number, id: string, side: string, ships: number[], pos: Vec3, rolled = false): UnitRuntime {
  return {
    id, idx, name: id, kind: 'fleet', side, theater: 'main',
    segments: [{ t0: -1e6, t1: 1e6, p0: pos, v0: [0, 0, 0], a: [0, 0, 0] }],
    facing: [-1, 0, 0], up: [0, 0, 1], rolls: rolled ? [{ t0: 0, t1: 1, angleRad: Math.PI / 2 }] : [],
    tAppear: -Infinity, tDepart: Infinity, ships, lacClasses: {}, lacCount: [],
  };
}

function world(opts: { attack?: number; ew?: number; rolled?: boolean; defenders?: number } = {}): CombatContext {
  const n = opts.defenders ?? 4;
  const ships = Array.from({ length: n }, (_, i) => ship(i));
  const packet: PacketTrack = {
    idx: 0, id: 'p', side: 'blue', engagement: 'e', salvoId: 's', planId: 'fp', profileId: 'mk16-ddm',
    fromUnit: 0, toUnit: 1, targetShip: 0, guidance: 'shipboard', tLaunch: 0, tArrive: 100,
    segments: [{ t0: 0, t1: 100, p0: [-1e7, 0, 0], v0: [1e5, 0, 0], a: [0, 0, 0] }], phases: [],
    launched: { attack: opts.attack ?? 200, ew: opts.ew ?? 0, controller: 0 },
    survivors: [{ t: 0, attack: opts.attack ?? 200, ew: opts.ew ?? 0, controller: 0 }],
    maxSpeed: 1e5, infeasible: false, seed: 7,
  };
  return {
    tech: TECH, ships, packets: [packet], beams: [], log: [],
    units: [unit(0, 'attacker', 'blue', [], [-1e7, 0, 0]), unit(1, 'target', 'red', ships.map((s) => s.idx), [0, 0, 0], opts.rolled)],
  };
}

const share = (attack: number, ew = 0) => {
  const st = resolveArrivals(world({ attack, ew })).planStats.get('fp')!;
  return st.intercepted / st.arriving;
};

describe('active defense (MTS §4.7, §6.3, §7.4)', () => {
  it('is deterministic for the same seeds', () => {
    const a = world();
    const b = world();
    resolveArrivals(a);
    resolveArrivals(b);
    expect(a.ships.map((s) => s.damage)).toEqual(b.ships.map((s) => s.damage));
    expect(a.packets[0].survivors).toEqual(b.packets[0].survivors);
  });
  it('saturates: a large salvo loses a smaller share to defense', () => {
    expect(share(20)).toBeGreaterThan(0.5);
    expect(share(20_000)).toBeLessThan(0.1);
  });
  it('EW shields real missiles from defensive fire', () => {
    expect(share(2000, 500)).toBeLessThan(share(2000, 0));
  });
  it('conserves counts: every attack missile is intercepted or expended at arrival', () => {
    const w = world();
    const st = resolveArrivals(w).planStats.get('fp')!;
    const last = w.packets[0].survivors.at(-1)!;
    expect(last).toEqual({ t: 100, attack: 0, ew: 0, controller: 0 });
    expect(st.arriving).toBe(200);
  });
  it('a ship rolled to show its wedge to the threat takes no laserhead damage', () => {
    const rolled = world({ rolled: true });
    resolveArrivals(rolled);
    expect(rolled.ships.reduce((a, s) => a + s.damage, 0)).toBe(0);
    const flat = world();
    resolveArrivals(flat);
    expect(flat.ships.reduce((a, s) => a + s.damage, 0)).toBeGreaterThan(0);
  });
});

const outcome = (counts: Partial<OutcomeEvent['counts']>, extra: Partial<OutcomeEvent> = {}): OutcomeEvent => ({
  id: 'o1', type: 'outcome', t: 200, engagement: 'e', unit: 'target', from: 0, roles: ['screen'],
  counts: { destroyed: 0, mission_kill: 0, degraded: 0, undamaged: 0, abandoned: 0, captured: 0, escaped: 0, ...counts },
  by_class: null, partial: false, escape: null, evidence: 'W', source_id: 't', seed: 3, ...extra,
});

describe('canon outcome reconciliation (MTS §9.1)', () => {
  it('assigns canon results by modeled damage', () => {
    const w = world();
    w.ships[2].hits.push({ t: 100, dmg: 50, aspect: 'sidewall', sub: 'hull' });
    w.ships[2].damage = 50;
    w.ships[1].hits.push({ t: 120, dmg: 5, aspect: 'sidewall', sub: 'launchers' });
    const issues = reconcileOutcomes([{ ev: outcome({ destroyed: 1, degraded: 1, undamaged: 2 }), t: 200, from: 0 }], w.units, w.ships, w.log);
    expect(issues).toEqual([]);
    expect(finalStatus(w.ships[2]).at(-1)?.status).toBe(ShipStatus.Destroyed);
    expect(finalStatus(w.ships[1]).at(-1)?.status).toBe(ShipStatus.Degraded);
    expect(subsystemSteps(w.ships[2]).filter((x) => x.value === 0)).toHaveLength(SUBSYSTEMS.length);
  });
  it('flags canon counts that do not add up to the eligible ships', () => {
    const w = world();
    const issues = reconcileOutcomes([{ ev: outcome({ destroyed: 3 }), t: 200, from: 0 }], w.units, w.ships, w.log);
    expect(issues[0]?.check).toBe('canon');
    expect(issues[0]?.severity).toBe('error');
  });
  it('lets ready ships escape first and keeps them out of the fight', () => {
    const w = world();
    w.ships[3].readiness = 'ready';
    applyEscapes([{ ev: outcome({ escaped: 1 }, { partial: true }), t: 50, from: 0 }], w.units, w.ships);
    expect(w.ships[3].escapedAt).toBe(50);
    resolveArrivals(w);
    expect(w.ships[3].damage).toBe(0);
  });
});

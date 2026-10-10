import { baseValue } from '../evidence';
import { computeHash, type Replay, type ShipTrack, type UnitTrack } from '../replay';
import { rngFor } from '../rng';
import type { BeamAttackEvent, FirePlanEvent, OutcomeEvent, ScenarioPack } from '../schema';
import { TECH, shipEquipment, type TechRegistry } from '../tech';
import type { Issue } from '../validate/types';
import { resolveBeamAttacks } from './beams';
import { applyEscapes, finalStatus, reconcileOutcomes, subsystemSteps, type TimedOutcome } from './damage';
import { resolveArrivals, type CombatContext } from './defense';
import { formationOffsets, toSystem } from './formation';
import { lacFront } from './lac-wing';
import { buildUnitTracks } from './kinematics';
import { narrativeLog } from './log';
import { DEG, indexBodies } from './orbits';
import { arrivalAnchors, expandFirePlans, type LaunchContext } from './packets';
import { unitBasis, unitPos, unitVel, type BeamEvent, type LogEntry, type ShipRuntime, type UnitRuntime } from './runtime';
import { TimeResolver } from './timeref';
import { SUBSYSTEMS, type Subsystem } from './types';

export type SolveProgress = (phase: string, fraction: number) => void;

const ROLE_PRIORITY = { wall: 0, carrier: 1, screen: 2, lac: 3 } as const;

/** Placeholder hull designation such as "HF-007"; always labelled S, never shown as a canon name. */
function designation(unitName: string, n: number): string {
  const initials = unitName.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 3);
  return `${initials}-${String(n).padStart(3, '0')}`;
}

const spacingOf = (u: ScenarioPack['units'][number]): number => baseValue(u.formation.spacing) ?? 10_000;

export function solve(pack: ScenarioPack, tech: TechRegistry = TECH, onProgress: SolveProgress = () => {}): Replay {
  const diagnostics: Issue[] = [];
  const bodies = indexBodies(pack.bodies);
  const timesA = new TimeResolver(pack.events);

  onProgress('kinematics', 0.05);
  const segs = buildUnitTracks(pack, bodies, timesA, [-600, pack.meta.duration_s + 600]);
  const units: UnitRuntime[] = pack.units.map((u, idx) => ({
    id: u.id, idx, name: u.name, kind: u.kind, side: u.side, theater: u.theater,
    segments: segs.get(u.id) as UnitRuntime['segments'],
    facing: u.formation.facing, up: u.formation.up, rolls: [],
    tAppear: u.present.from === null ? -Infinity : timesA.resolve(u.present.from),
    tDepart: u.present.until === null ? Infinity : timesA.resolve(u.present.until),
    ships: [],
    lacClasses: u.kind === 'lac' ? { ...u.classes } : {},
    lacCount: u.kind === 'lac' ? [{ t: -1e12, count: Object.values(u.classes).reduce((a, b) => a + b, 0) }] : [],
  }));

  const ships: ShipRuntime[] = [];
  pack.units.forEach((u, ui) => {
    if (u.kind !== 'fleet') return;
    const total = u.ships.reduce((a, e) => a + e.count, 0);
    const slots = formationOffsets(u.formation.kind, total, spacingOf(u), rngFor('formation', u.id));
    const entries = [...u.ships].sort((a, b) => Number(b.flagship) - Number(a.flagship));
    let slot = 0;
    let seq = 1;
    for (const entry of entries) {
      const cls = tech.classes[entry.class_id];
      for (let k = 0; k < entry.count; k++) {
        const named = entry.names[k];
        ships.push({
          idx: ships.length, unit: ui, side: u.side, classId: cls.id, cls, entry, role: cls.role, slot: slots[slot++],
          name: named ?? designation(u.name, seq++), nameEvidence: named ? entry.name_evidence : 'S',
          flagship: entry.flagship && k === 0, equipment: shipEquipment(cls, entry), readiness: entry.hyper_readiness,
          damage: 0, hits: [], subs: Object.fromEntries(SUBSYSTEMS.map((s) => [s, 1])) as Record<Subsystem, number>,
          escapedAt: Infinity, goneAt: Infinity, steps: [], marks: { ringLost: null, forcedDegradeAt: null, cleared: [] },
        });
        units[ui].ships.push(ships.length - 1);
      }
    }
  });

  onProgress('missiles', 0.2);
  const byId = new Map(units.map((u) => [u.id, u]));
  const unitOf = (id: string) => byId.get(id) as UnitRuntime;
  const launch: LaunchContext = {
    unitIndex: new Map(units.map((u) => [u.id, u.idx])),
    unitPosition: (id, t) => unitPos(unitOf(id), t),
    unitVelocity: (id, t) => unitVel(unitOf(id), t),
    shipSlots: (id) => {
      const u = unitOf(id);
      return [...u.ships]
        .sort((a, b) => ROLE_PRIORITY[ships[a].role] - ROLE_PRIORITY[ships[b].role] || a - b)
        .map((i) => ({ ship: i, offset: (t: number) => toSystem(unitBasis(u, t), ships[i].slot) }));
    },
    side: (id) => unitOf(id).side,
    front: (id) => {
      const u = pack.units[unitOf(id).idx];
      return u.kind === 'lac' ? lacFront(unitOf(id).lacCount[0].count, spacingOf(u)) : null;
    },
  };
  const firePlans = pack.events.filter((e): e is FirePlanEvent => e.type === 'fire_plan');
  const packets = expandFirePlans(firePlans, tech, timesA, launch);
  const anchors = arrivalAnchors(packets);
  const times = timesA.withAnchors(anchors);

  for (const ev of pack.events) {
    if (ev.type !== 'roll') continue;
    const t0 = times.resolve(ev.t);
    unitOf(ev.unit).rolls.push({ t0, t1: t0 + ev.duration_s, angleRad: ev.angle_deg * DEG });
  }
  const outcomes: TimedOutcome[] = pack.events
    .filter((e): e is OutcomeEvent => e.type === 'outcome')
    .map((ev) => ({ ev, t: times.resolve(ev.t), from: times.resolve(ev.from) }));

  onProgress('defense', 0.45);
  applyEscapes(outcomes, units, ships);
  const beams: BeamEvent[] = [];
  const log: LogEntry[] = [];
  const combat: CombatContext = { tech, units, ships, packets, beams, log };
  resolveBeamAttacks(
    pack.events.filter((e): e is BeamAttackEvent => e.type === 'beam_attack').map((ev) => ({ ev, t0: times.resolve(ev.t), t1: times.resolve(ev.until) })),
    combat,
  );
  const { planStats } = resolveArrivals(combat);

  onProgress('outcomes', 0.75);
  diagnostics.push(...reconcileOutcomes(outcomes, units, ships, log));
  for (const u of units) {
    if (!Number.isFinite(u.tAppear)) continue;
    const p = unitPos(u, u.tAppear);
    beams.push({ t: u.tAppear, dur: 2.5, kind: 'transit', from: p, to: p, side: u.side, aspect: null, ship: -1, unit: u.idx, toUnit: u.idx });
  }
  log.push(...narrativeLog(pack, times, units));
  log.sort((a, b) => a.t - b.t);
  beams.sort((a, b) => a.t - b.t);

  const shipTracks: ShipTrack[] = ships.map((s) => ({
    idx: s.idx, unit: s.unit, classId: s.classId, name: s.name, nameEvidence: s.nameEvidence, side: s.side, role: s.role,
    slot: s.slot, flagship: s.flagship, equipment: s.equipment, readiness: s.readiness,
    status: finalStatus(s), subsystems: subsystemSteps(s), damageTaken: s.damage, hitCount: s.hits.length,
  }));
  const unitTracks: UnitTrack[] = units.map((u, i) => ({
    id: u.id, idx: u.idx, name: u.name, kind: u.kind, side: u.side, theater: u.theater, segments: u.segments,
    facing: u.facing, up: u.up, rolls: u.rolls, spacing: spacingOf(pack.units[i]), tAppear: u.tAppear, tDepart: u.tDepart,
    appearVia: pack.units[i].present.from_via, departVia: pack.units[i].present.until_via,
    shipIdx: u.ships, lacClasses: u.lacClasses, lacCount: u.lacCount,
  }));

  const launched: Replay['stats']['launched'] = Object.fromEntries(pack.meta.sides.map((s) => [s.id, { attack: 0, ew: 0, controller: 0, pods: 0 }]));
  for (const p of packets) {
    launched[p.side].attack += p.launched.attack;
    launched[p.side].ew += p.launched.ew;
    launched[p.side].controller += p.launched.controller;
  }
  for (const ev of firePlans) launched[unitOf(ev.from).side].pods += ev.pods ?? 0;
  const finalCounts: Replay['stats']['finalStatus'] = {};
  for (const s of shipTracks) {
    const st = s.status[s.status.length - 1].status;
    const m = (finalCounts[s.side] ??= {});
    m[st] = (m[st] ?? 0) + 1;
  }

  const resolvedTimes: Record<string, number> = {};
  for (const ev of pack.events) resolvedTimes[ev.id] = times.resolve(ev.t);
  for (const ph of pack.meta.phases) resolvedTimes[`phase:${ph.id}`] = times.resolve(ph.t0);
  for (const sh of pack.meta.shots) resolvedTimes[`shot:${sh.id}`] = times.resolve(sh.t0);
  for (const [id, t] of anchors.arrival) resolvedTimes[`arrival:${id}`] = t;
  for (const [id, t] of anchors.lastArrival) resolvedTimes[`last_arrival:${id}`] = t;

  const replay: Omit<Replay, 'hash'> = {
    scenarioId: pack.meta.id, duration_s: pack.meta.duration_s, sides: pack.meta.sides,
    units: unitTracks, ships: shipTracks, packets, beams, log,
    stats: { launched, intercept: Object.fromEntries(planStats), finalStatus: finalCounts },
    diagnostics, resolvedTimes,
  };
  onProgress('done', 1);
  return { ...replay, hash: computeHash(replay) };
}

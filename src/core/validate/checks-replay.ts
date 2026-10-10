import { baseValue, needBase } from '../evidence';
import { ShipStatus, shipPositionAt, unitPosition, unitVelocity, type Replay } from '../replay';
import type { FirePlanEvent, ScenarioPack } from '../schema';
import { latencyIssues, type LatencyItem } from '../sensors';
import { launchBlocked, orientationAt } from '../solver/geometry';
import { segmentState } from '../solver/kinematics';
import { indexBodies, insideExclusion } from '../solver/orbits';
import { TimeResolver } from '../solver/timeref';
import { C_KM_S, fmtDistance } from '../units';
import { dist, dot, norm, sub } from '../vec';
import { issue, type Issue, type Severity, type StaticCtx } from './types';

export interface ReplayCtx extends StaticCtx { replay: Replay }
export type ReplayCheck = (ctx: ReplayCtx) => Issue[];

function solvedTimes(pack: ScenarioPack, r: Replay): TimeResolver {
  const pick = (prefix: string) => new Map(Object.entries(r.resolvedTimes).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
  return new TimeResolver(pack.events).withAnchors({ arrival: pick('arrival:'), lastArrival: pick('last_arrival:') });
}
const unitById = (r: Replay, id: string) => r.units.find((u) => u.id === id) as Replay['units'][number];
const plansOf = (pack: ScenarioPack) => pack.events.filter((e): e is FirePlanEvent => e.type === 'fire_plan');
const canonSeverity = (e: string): Severity => (e === 'P' || e === 'W' ? 'error' : 'warn');

/** MTS §12.2 check 9, missile part. */
const flightCheck: ReplayCheck = ({ pack, replay }) => {
  const out: Issue[] = [];
  const plans = new Map(plansOf(pack).map((e) => [e.id, e]));
  const infeasible = new Map<string, number>();
  for (const p of replay.packets) {
    if (p.maxSpeed >= C_KM_S) out.push(issue('flight', 'error', `${p.id} reaches ${(p.maxSpeed / C_KM_S).toFixed(3)}c; nothing may reach c`, `events.${p.planId}`));
    if (p.infeasible) infeasible.set(p.planId, (infeasible.get(p.planId) ?? 0) + 1);
    const w = plans.get(p.planId)?.arrival_window;
    if (w && (p.tArrive < w[0] || p.tArrive > w[1])) {
      out.push(issue('flight', 'error', `${p.id}: solved arrival ${p.tArrive.toFixed(0)} s is outside the canon window ${w[0]} to ${w[1]} s; arrivals are never forced`, `events.${p.planId}`));
    }
  }
  for (const [plan, n] of infeasible) out.push(issue('flight', 'error', `${plan}: ${n} packets cannot reach their target within the missile's stages and coast limit`, `events.${plan}`));
  return out;
};

/** MTS §12.2 check 10, launch part: tube launches never cross the firing ship's own wedge. */
const launchGeometryCheck: ReplayCheck = ({ pack, tech, replay }) => {
  const out: Issue[] = [];
  const plans = new Map(plansOf(pack).map((e) => [e.id, e]));
  const seen = new Set<string>();
  for (const p of replay.packets) {
    if (plans.get(p.planId)?.launch !== 'tube' || seen.has(p.salvoId)) continue;
    seen.add(p.salvoId);
    const u = replay.units[p.fromUnit];
    if (u.kind !== 'fleet' || !u.shipIdx.length) continue;
    const cls = tech.classes[replay.ships[u.shipIdx[0]].classId];
    const dims = {
      bandOffset: needBase(cls.wedge.band_offset, 'wedge.band_offset'),
      bandLength: needBase(cls.wedge.band_length, 'wedge.band_length'),
      bandWidth: needBase(cls.wedge.band_width, 'wedge.band_width'),
    };
    const dir = norm(sub(segmentState(p.segments, p.tArrive).p, segmentState(p.segments, p.tLaunch).p));
    if (launchBlocked(orientationAt(u.facing, u.up, u.rolls, p.tLaunch), dir, dims)) {
      out.push(issue('geometry', 'error', `${p.salvoId}: tube launch would cross ${u.name}'s own wedge`, `events.${p.planId}`));
    }
  }
  return out;
};

/** MTS §12.2 check 8. */
const latencyCheck: ReplayCheck = ({ pack, replay }) => {
  const times = solvedTimes(pack, replay);
  const items: LatencyItem[] = [];
  for (const ev of pack.events) {
    if (!('reacts_to' in ev) || !ev.reacts_to) continue;
    const ra = ev.reacts_to;
    const trigger = pack.events.find((e) => e.id === ra.ref);
    if (!trigger) continue;
    let tEvent: number;
    let where: string;
    if (trigger.type === 'fire_plan') {
      tEvent = ra.anchor === 'arrival' ? replay.resolvedTimes[`arrival:${trigger.id}`] : times.resolve(trigger.t);
      where = ra.anchor === 'arrival' ? trigger.to : trigger.from;
    } else {
      tEvent = times.resolve(trigger.t);
      where = 'unit' in trigger && typeof trigger.unit === 'string' ? trigger.unit : ra.observer;
    }
    const observer = unitById(replay, ra.observer);
    items.push({
      id: ev.id, t: times.resolve(ev.t), tEvent, eventPos: unitPosition(unitById(replay, where), tEvent),
      sensor: ra.sensor, observer: (t) => unitPosition(observer, t), label: `${ra.ref} (${ra.anchor})`,
    });
  }
  return latencyIssues(items, pack.meta.ftl_speed_c.value ?? 1);
};

const READY_FACTOR = { ready: 0, standby: 1, routine: 4, 'powered-down': 8 } as const;
const EXCLUSION_TEXT = { 'hyper-limit': 'hyper limit', terminus: 'terminus exclusion', 'resonance-zone': 'resonance zone' } as const;

/** MTS §12.2 check 11 and §2.6: hyper transits happen outside exclusions with a ready generator. */
const escapeCheck: ReplayCheck = ({ pack, tech, replay }) => {
  const out: Issue[] = [];
  const bodies = indexBodies(pack.bodies);
  const times = solvedTimes(pack, replay);
  replay.units.forEach((u) => {
    const legs: Array<[number, string | null, string]> = [[u.tAppear, u.appearVia, 'emerges'], [u.tDepart, u.departVia, 'departs']];
    for (const [t, via, what] of legs) {
      if (via !== 'hyper' || !Number.isFinite(t)) continue;
      const ex = insideExclusion(bodies, unitPosition(u, t), t);
      if (ex) out.push(issue('escape', 'error', `${u.name} ${what} through hyper inside ${ex.name}'s ${EXCLUSION_TEXT[ex.kind]} at t=${t.toFixed(0)}`, `units.${u.id}`));
    }
  });
  for (const ev of pack.events) {
    if (ev.type !== 'outcome' || !ev.escape) continue;
    const ready = times.resolve(ev.escape.readiness_from);
    for (const i of unitById(replay, ev.unit).shipIdx) {
      const s = replay.ships[i];
      const esc = s.status.find((x) => x.status === ShipStatus.Escaped);
      if (!esc) continue;
      const need = READY_FACTOR[s.readiness] * needBase(tech.classes[s.classId].hyper_cycle, 'hyper_cycle');
      if (esc.t - ready + 1e-6 < need) {
        out.push(issue('escape', 'error', `${s.name} escapes ${(esc.t - ready).toFixed(0)} s after the order but needs ${need.toFixed(0)} s from ${s.readiness}`, `events.${ev.id}`));
      }
      const ex = insideExclusion(bodies, shipPositionAt(replay, s, esc.t), esc.t);
      if (ex) out.push(issue('escape', 'error', `${s.name} translates out inside ${ex.name}'s ${EXCLUSION_TEXT[ex.kind]}`, `events.${ev.id}`));
    }
  }
  return out;
};

/** Canon calibration: ranges, closing speeds and the interception share must match the sources. */
const canonCheck: ReplayCheck = ({ pack, replay }) => {
  const out: Issue[] = [];
  const times = solvedTimes(pack, replay);
  for (const ev of pack.events) {
    if (ev.type !== 'range') continue;
    const t = times.resolve(ev.t);
    const a = unitById(replay, ev.a);
    const b = unitById(replay, ev.b);
    const pa = unitPosition(a, t);
    const pb = unitPosition(b, t);
    const d = dist(pa, pb);
    if (ev.distance) {
      const want = baseValue(ev.distance) as number;
      if (Math.abs(d - want) > ev.tolerance * want) {
        out.push(issue('canon', canonSeverity(ev.distance.evidence), `${ev.id}: ${a.name} to ${b.name} is ${fmtDistance(d)} at t=${t.toFixed(0)}; canon ${fmtDistance(want)} within ${(ev.tolerance * 100).toFixed(0)}%`, `events.${ev.id}`));
      }
    }
    if (ev.min) {
      const want = baseValue(ev.min) as number;
      if (d < want * (1 - ev.tolerance)) out.push(issue('canon', canonSeverity(ev.min.evidence), `${ev.id}: ${fmtDistance(d)} is below the canon minimum ${fmtDistance(want)}`, `events.${ev.id}`));
    }
    if (ev.closing_min_km_s !== null) {
      const closing = -dot(sub(unitVelocity(b, t), unitVelocity(a, t)), norm(sub(pb, pa)));
      if (closing < ev.closing_min_km_s) out.push(issue('canon', canonSeverity(ev.evidence), `${ev.id}: closing at ${closing.toFixed(0)} km/s; canon says over ${ev.closing_min_km_s} km/s`, `events.${ev.id}`));
    }
  }
  for (const ev of plansOf(pack)) {
    const want = ev.canon_intercept_share?.value;
    if (want === undefined || want === null) continue;
    const st = replay.stats.intercept[ev.id];
    if (!st || st.arriving === 0) {
      out.push(issue('canon', 'warn', `${ev.id}: no arrivals to compare with the canon interception share`, `events.${ev.id}`));
      continue;
    }
    const got = st.intercepted / st.arriving;
    out.push(issue('canon', Math.abs(got - want) > 0.1 ? 'warn' : 'info', `${ev.id}: defenses stopped ${(got * 100).toFixed(1)}% of attack missiles; canon about ${(want * 100).toFixed(0)}%`, `events.${ev.id}`));
  }
  return out;
};

/** Slack over a beam's stated range: swarm and formation spread around the unit centre. S display tolerance. */
const BEAM_RANGE_SLACK = 1.5;

/** MTS §12.2 check 9, beam part: energy weapons fire only from within their stated range. */
const beamRangeCheck: ReplayCheck = ({ pack, replay }) => {
  const out: Issue[] = [];
  const times = solvedTimes(pack, replay);
  for (const ev of pack.events) {
    if (ev.type !== 'beam_attack') continue;
    const range = baseValue(ev.range);
    if (range === null) continue;
    const a = unitById(replay, ev.from);
    const b = unitById(replay, ev.to);
    for (const t of [times.resolve(ev.t), times.resolve(ev.until)]) {
      const d = dist(unitPosition(a, t), unitPosition(b, t));
      if (d > range * BEAM_RANGE_SLACK) {
        out.push(issue('geometry', 'error', `${ev.id}: ${a.name} fires at ${b.name} from ${fmtDistance(d)} at t=${t.toFixed(0)}, beyond its stated range of ${fmtDistance(range)}`, `events.${ev.id}`));
        break;
      }
    }
  }
  return out;
};

/** MTS §12.2 check 6, replay part: packets carry exactly what the plan launched. */
const conservationCheck: ReplayCheck = ({ pack, replay }) => {
  const out: Issue[] = [];
  const sums = new Map<string, { attack: number; ew: number; controller: number }>();
  for (const p of replay.packets) {
    const s = sums.get(p.planId) ?? { attack: 0, ew: 0, controller: 0 };
    s.attack += p.launched.attack;
    s.ew += p.launched.ew;
    s.controller += p.launched.controller;
    sums.set(p.planId, s);
  }
  for (const ev of plansOf(pack)) {
    const s = sums.get(ev.id) ?? { attack: 0, ew: 0, controller: 0 };
    if (s.attack !== ev.totals.attack || s.ew !== ev.totals.ew || s.controller !== ev.totals.controller) {
      out.push(issue('inventory', 'error', `${ev.id}: packets carry ${s.attack}/${s.ew}/${s.controller} attack/EW/controllers; the plan says ${ev.totals.attack}/${ev.totals.ew}/${ev.totals.controller}`, `events.${ev.id}`));
    }
  }
  return out;
};

export const REPLAY_CHECKS: ReplayCheck[] = [flightCheck, launchGeometryCheck, latencyCheck, escapeCheck, canonCheck, beamRangeCheck, conservationCheck];

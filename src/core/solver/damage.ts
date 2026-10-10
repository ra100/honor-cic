import { needBase } from '../evidence';
import { rngFor, shuffleInPlace, type Rng } from '../rng';
import type { OutcomeEvent } from '../schema';
import { issue, type Issue } from '../validate/types';
import type { Hit, LogEntry, ShipRuntime, UnitRuntime } from './runtime';
import { splitEven } from './packets';
import { ShipStatus, SUBSYSTEMS, type Aspect, type Subsystem } from './types';

const SUBS_BY_ASPECT: Record<Exclude<Aspect, 'wedge'>, Array<Subsystem | 'wall'>> = {
  sidewall: ['wall', 'launchers', 'energy', 'defense', 'hull'],
  throat: ['drive_fore', 'sensors', 'energy', 'hull'],
  kilt: ['drive_aft', 'launchers', 'hull'],
};
/** Integrity lost per unit of damage relative to durability. S constant. */
const SUB_WEAR = 3;

export function applyHit(ship: ShipRuntime, t: number, dmg: number, aspect: Aspect, rng: Rng): void {
  if (aspect === 'wedge' || dmg <= 0) return;
  const choices = SUBS_BY_ASPECT[aspect];
  const pick = choices[Math.floor(rng() * choices.length)];
  const sub: Subsystem = pick === 'wall' ? (rng() < 0.5 ? 'wall_port' : 'wall_stbd') : pick;
  const durability = needBase(ship.cls.durability, `${ship.classId}.durability`);
  ship.damage += dmg;
  ship.subs[sub] = Math.max(0, ship.subs[sub] - (SUB_WEAR * dmg) / durability);
  ship.hits.push({ t, dmg, aspect, sub });
  if (ship.damage >= durability && ship.goneAt === Infinity) ship.goneAt = t;
}

const READY_RANK = { ready: 0, standby: 1, routine: 2, 'powered-down': 3 } as const;

export interface TimedOutcome { ev: OutcomeEvent; t: number; from: number }

export const isEscapeOnly = (ev: OutcomeEvent): boolean => {
  const c = ev.counts;
  return c.escaped > 0 && c.destroyed + c.mission_kill + c.degraded + c.undamaged + c.abandoned + c.captured === 0;
};

/** Escapes happen before damage is resolved: escaped ships are not defenders or targets afterwards. */
export function applyEscapes(list: TimedOutcome[], units: UnitRuntime[], ships: ShipRuntime[]): void {
  for (const { ev, t } of list.filter((x) => isEscapeOnly(x.ev)).sort((a, b) => a.t - b.t)) {
    const u = units.find((x) => x.id === ev.unit);
    if (!u) continue;
    const cands = u.ships.map((i) => ships[i]).filter((s) => ev.roles.includes(s.role) && s.escapedAt > t);
    cands.sort((a, b) => READY_RANK[a.readiness] - READY_RANK[b.readiness] || Number(b.flagship) - Number(a.flagship) || a.idx - b.idx);
    for (const s of cands.slice(0, ev.counts.escaped)) {
      s.escapedAt = t;
      s.steps.push({ t, status: ShipStatus.Escaped, cause: `${ev.id}: translated into hyper` });
    }
  }
}

function timeAtShare(hits: Hit[], share: number): number | null {
  const total = hits.reduce((a, h) => a + h.dmg, 0);
  if (total <= 0) return null;
  let acc = 0;
  for (const h of hits) {
    acc += h.dmg;
    if (acc >= share * total) return h.t;
  }
  return hits[hits.length - 1].t;
}

/** LAC losses are spread over the outcome's span in steps about this long, so a wing thins as it fights. S. */
const LAC_LOSS_STEP_S = 2;

function applyLacOutcome(u: UnitRuntime, ev: OutcomeEvent, t: number, from: number, log: LogEntry[]): void {
  const lost = ev.counts.destroyed + ev.counts.captured + ev.counts.abandoned;
  let count = u.lacCount[u.lacCount.length - 1].count;
  if (ev.counts.destroyed > 0) {
    const steps = Math.min(ev.counts.destroyed, Math.max(5, Math.round((t - from) / LAC_LOSS_STEP_S)));
    splitEven(ev.counts.destroyed, steps).forEach((n, k) => {
      count -= n;
      u.lacCount.push({ t: from + ((t - from) * (k + 1)) / steps, count, cause: 'destroyed' });
    });
  }
  if (ev.counts.captured + ev.counts.abandoned > 0) {
    count -= ev.counts.captured + ev.counts.abandoned;
    u.lacCount.push({ t, count, cause: 'captured' });
  }
  u.lacCount.sort((a, b) => a.t - b.t);
  const byClass = ev.by_class ? ` (${Object.entries(ev.by_class).map(([k, n]) => `${n.toLocaleString('en-US')} ${k}`).join(', ')})` : '';
  const verb = ev.counts.captured ? 'captured' : 'lost';
  log.push({ t, side: u.side, kind: 'loss', text: `${u.name}: ${lost.toLocaleString('en-US')} LACs ${verb}${byClass}`, evidence: ev.evidence, source_id: ev.source_id, ref: ev.id });
}

/** Applies canon outcome counts (MTS §9.1): which ship gets which result follows modeled damage, ties broken by seed. */
export function reconcileOutcomes(list: TimedOutcome[], units: UnitRuntime[], ships: ShipRuntime[], log: LogEntry[]): Issue[] {
  const issues: Issue[] = [];
  const finalized = new Set<number>();
  for (const { ev, t, from } of list.filter((x) => !isEscapeOnly(x.ev)).sort((a, b) => a.t - b.t)) {
    const u = units.find((x) => x.id === ev.unit);
    if (!u) continue;
    if (u.kind === 'lac') {
      applyLacOutcome(u, ev, t, from, log);
      continue;
    }
    const c = ev.counts;
    const order: Array<[keyof typeof c, number]> = [
      ['destroyed', c.destroyed], ['mission_kill', c.mission_kill], ['abandoned', c.abandoned],
      ['degraded', c.degraded], ['captured', c.captured], ['escaped', c.escaped], ['undamaged', c.undamaged],
    ];
    const total = order.reduce((a, [, n]) => a + n, 0);
    const cands = u.ships.map((i) => ships[i]).filter((s) => ev.roles.includes(s.role) && s.escapedAt > t && !finalized.has(s.idx));
    if (total > cands.length || (!ev.partial && total !== cands.length)) {
      issues.push(issue('canon', 'error', `${ev.id}: lists ${total} ships but ${u.name} has ${cands.length} eligible ${ev.roles.join('/')} ships at t=${t.toFixed(0)}`, `events.${ev.id}`));
      if (total > cands.length) continue;
    }
    const inWindow = (s: ShipRuntime) => s.hits.filter((h) => h.t >= from && h.t <= t);
    const dmgOf = (s: ShipRuntime) => inWindow(s).reduce((a, h) => a + h.dmg, 0);
    const ranked = shuffleInPlace(rngFor('outcome', ev.id, ev.seed), [...cands]).sort((a, b) => dmgOf(b) - dmgOf(a));
    let k = 0;
    let noHitKills = 0;
    const cause = `${ev.id}`;
    for (const [kind, n] of order) {
      for (let i = 0; i < n; i++) {
        const s = ranked[k++];
        const hits = inWindow(s);
        if (kind === 'destroyed') {
          if (!hits.length) noHitKills++;
          s.steps.push({ t: Math.min(timeAtShare(hits, 0.6) ?? t, t), status: ShipStatus.Destroyed, cause });
          finalized.add(s.idx);
        } else if (kind === 'mission_kill') {
          const big = hits.reduce<Hit | null>((m, h) => (!m || h.dmg > m.dmg ? h : m), null);
          const tm = big?.t ?? t;
          s.marks.ringLost = { t: tm, sub: s.subs.drive_fore <= s.subs.drive_aft ? 'drive_fore' : 'drive_aft' };
          s.steps.push({ t: tm, status: ShipStatus.MissionKill, cause: `${cause}: impeller ring lost` });
        } else if (kind === 'abandoned') {
          s.steps.push({ t, status: ShipStatus.Destroyed, cause: `${cause}: abandoned and scuttled` });
          finalized.add(s.idx);
        } else if (kind === 'degraded') {
          if (!hits.length) s.marks.forcedDegradeAt = t;
          s.steps.push({ t: Math.min(hits[0]?.t ?? t, t), status: ShipStatus.Degraded, cause });
        } else if (kind === 'captured') {
          s.steps.push({ t, status: ShipStatus.Captured, cause });
          finalized.add(s.idx);
        } else if (kind === 'escaped') {
          s.escapedAt = t;
          s.steps.push({ t, status: ShipStatus.Escaped, cause });
        } else {
          s.marks.cleared.push([from, t]);
        }
      }
    }
    if (noHitKills) {
      issues.push(issue('canon', 'warn', `${ev.id}: ${noHitKills} of ${c.destroyed} canon losses had no modeled hits; defense or salvo parameters may be off`, `events.${ev.id}`));
    }
  }
  return issues;
}

const START = -1e12;

/** Status timeline: reconciled steps when present, otherwise the mechanistic result. */
export function finalStatus(s: ShipRuntime): Array<{ t: number; status: ShipStatus; cause: string }> {
  const steps = [...s.steps];
  const damageStatus = steps.some((x) => x.status !== ShipStatus.Escaped);
  if (!damageStatus) {
    if (s.goneAt < s.escapedAt) steps.push({ t: s.goneAt, status: ShipStatus.Destroyed, cause: 'modeled damage' });
    else if (s.hits.length && s.hits[0].t < s.escapedAt) steps.push({ t: s.hits[0].t, status: ShipStatus.Degraded, cause: 'modeled damage' });
  }
  return [{ t: START, status: ShipStatus.Operational, cause: 'start' }, ...steps.sort((a, b) => a.t - b.t)];
}

/** Subsystem integrity steps consistent with the final status. */
export function subsystemSteps(s: ShipRuntime): Array<{ t: number; sub: Subsystem; value: number }> {
  const status = finalStatus(s);
  const destroyedAt = status.find((x) => x.status === ShipStatus.Destroyed)?.t ?? Infinity;
  const cleared = (t: number) => s.marks.cleared.some(([a, b]) => t >= a && t <= b);
  const durability = needBase(s.cls.durability, `${s.classId}.durability`);
  const level = Object.fromEntries(SUBSYSTEMS.map((k) => [k, 1])) as Record<Subsystem, number>;
  const out: Array<{ t: number; sub: Subsystem; value: number }> = [];
  for (const h of [...s.hits].sort((a, b) => a.t - b.t)) {
    if (h.t >= destroyedAt || cleared(h.t)) continue;
    level[h.sub] = Math.max(0, level[h.sub] - (SUB_WEAR * h.dmg) / durability);
    out.push({ t: h.t, sub: h.sub, value: level[h.sub] });
  }
  if (s.marks.ringLost) out.push({ t: s.marks.ringLost.t, sub: s.marks.ringLost.sub, value: 0 });
  if (s.marks.forcedDegradeAt !== null) out.push({ t: s.marks.forcedDegradeAt, sub: 'hull', value: 0.85 });
  if (Number.isFinite(destroyedAt)) for (const sub of SUBSYSTEMS) out.push({ t: destroyedAt, sub, value: 0 });
  return out.sort((a, b) => a.t - b.t);
}

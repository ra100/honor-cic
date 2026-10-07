import { needBase } from '../evidence';
import { binomial, rngFor } from '../rng';
import { capOf, type TechRegistry } from '../tech';
import { add, norm, rotateAbout, scale } from '../vec';
import { applyHit } from './damage';
import { ASPECT_FACTOR, classifyAspect, endwallFactor } from './geometry';
import { segmentState } from './kinematics';
import type { PacketTrack } from './packets';
import { alive, present, shipPos, unitBasis, type BeamEvent, type LogEntry, type ShipRuntime, type UnitRuntime } from './runtime';

/** Arrivals at one target within this many seconds share its defensive channels. S constant. */
export const WINDOW_S = 15;
/** Fraction of defensive channels lost per EW vehicle per attack missile, capped at 50%. S constant (MTS §7.4). */
export const JAM_PER_EW = 2;
/** Apparent tracks each EW vehicle presents to defensive fire control. S constant. */
export const DECOY_TRACKS = 3;
const KEYHOLE_BONUS = 1.25;
const APOLLO_PK_FACTOR = 0.85;
const OVERKILL = 1.5;
const VISUAL_BEAMS_PER_PACKET = 6;
const VISUAL_KILLS_PER_PACKET = 4;

export interface PlanStat { arriving: number; intercepted: number }

export interface CombatContext {
  tech: TechRegistry;
  units: UnitRuntime[];
  ships: ShipRuntime[];
  packets: PacketTrack[];
  beams: BeamEvent[];
  log: LogEntry[];
}

function defenders(ctx: CombatContext, unitIdx: number, t: number): ShipRuntime[] {
  const u = ctx.units[unitIdx];
  if (!present(u, t)) return [];
  return u.ships.map((i) => ctx.ships[i]).filter((s) => alive(s, t));
}

function channelSums(ds: ShipRuntime[]): { cm: number; cmPk: number; pd: number; pdPk: number } {
  const keyhole = ds.some((s) => s.equipment.length > 0) ? KEYHOLE_BONUS : 1;
  let cm = 0, cmPk = 0, pd = 0, pdPk = 0;
  for (const s of ds) {
    const v = (path: string) => needBase(capOf(s.cls, s.entry, path), `${s.classId}.${path}`);
    const c = (v('broadside.cm') + v('fore.cm')) * v('defense.cm_waves') * keyhole;
    const p = (v('broadside.pd') + v('fore.pd')) * v('defense.pd_shots');
    cm += c; cmPk += c * v('defense.pk_cm');
    pd += p; pdPk += p * v('defense.pk_pd');
  }
  return { cm, cmPk: cm ? cmPk / cm : 0, pd, pdPk: pd ? pdPk / pd : 0 };
}

/** Largest-remainder split of `total` across weights. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    out[i] += 1;
  }
  return out;
}

export function resolveArrivals(ctx: CombatContext): { planStats: Map<string, PlanStat> } {
  const planStats = new Map<string, PlanStat>();
  const groups = new Map<string, PacketTrack[]>();
  for (const p of ctx.packets) {
    if (p.infeasible) continue;
    const key = `${p.toUnit}|${Math.floor(p.tArrive / WINDOW_S)}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const ordered = [...groups.values()].sort((a, b) => Math.min(...a.map((p) => p.tArrive)) - Math.min(...b.map((p) => p.tArrive)));

  for (const group of ordered) {
    const tw = Math.min(...group.map((p) => p.tArrive));
    const target = ctx.units[group[0].toUnit];
    const rng = rngFor('defense', target.id, group.map((p) => p.seed).join(','));
    const ds = defenders(ctx, target.idx, tw);
    const attack = group.reduce((a, p) => a + p.launched.attack, 0);
    const ew = group.reduce((a, p) => a + p.launched.ew, 0);
    for (const p of group) {
      const st = planStats.get(p.planId) ?? { arriving: 0, intercepted: 0 };
      st.arriving += p.launched.attack;
      planStats.set(p.planId, st);
    }
    if (ds.length === 0) {
      for (const p of group) p.survivors.push({ t: p.tArrive, attack: 0, ew: 0, controller: 0 });
      ctx.log.push({ t: tw, side: group[0].side, kind: 'arrival', text: `${attack.toLocaleString('en-US')} missiles reach ${target.name}'s position and find no target`, evidence: 'D', source_id: 'honor-cic' });
      continue;
    }

    const ch = channelSums(ds);
    const apolloShare = group.reduce((a, p) => a + (p.guidance === 'apollo' ? p.launched.attack : 0), 0) / Math.max(1, attack);
    const pkScale = 1 - apolloShare * (1 - APOLLO_PK_FACTOR);
    const jam = Math.min(0.5, (JAM_PER_EW * ew) / Math.max(1, attack));
    const apparent = attack + ew * DECOY_TRACKS;
    const cmOnReal = Math.min(attack, Math.round((ch.cm * (1 - jam) * attack) / Math.max(1, apparent)));
    const killedCm = binomial(rng, cmOnReal, ch.cmPk * pkScale);
    const afterCm = attack - killedCm;
    const pdOnReal = Math.min(afterCm, Math.round((ch.pd * (1 - jam) * afterCm) / Math.max(1, afterCm + ew)));
    const killedPd = binomial(rng, pdOnReal, ch.pdPk * pkScale);

    const weights = group.map((p) => p.launched.attack);
    const cmSplit = apportion(killedCm, weights);
    const pdSplit = apportion(killedPd, weights.map((w, i) => w - cmSplit[i]));
    let hits = 0;
    let blocked = 0;
    group.forEach((p, i) => {
      const st = planStats.get(p.planId) as PlanStat;
      st.intercepted += cmSplit[i] + pdSplit[i];
      const left = p.launched.attack - cmSplit[i] - pdSplit[i];
      p.survivors.push({ t: p.tArrive - 4, attack: p.launched.attack - cmSplit[i], ew: p.launched.ew, controller: p.launched.controller });
      p.survivors.push({ t: p.tArrive - 1, attack: left, ew: p.launched.ew, controller: p.launched.controller });
      p.survivors.push({ t: p.tArrive, attack: 0, ew: 0, controller: 0 });

      const approach = norm(segmentState(p.segments, p.tArrive).v);
      for (let k = 0; k < Math.min(VISUAL_KILLS_PER_PACKET, cmSplit[i]); k++) {
        const at = segmentState(p.segments, p.tArrive - 4).p;
        ctx.beams.push({ t: p.tArrive - 4, dur: 0.6, kind: 'cm-kill', from: at, to: at, side: target.side, aspect: null, ship: -1 });
      }
      for (let k = 0; k < Math.min(VISUAL_KILLS_PER_PACKET, pdSplit[i]); k++) {
        const at = segmentState(p.segments, p.tArrive - 1).p;
        ctx.beams.push({ t: p.tArrive - 1, dur: 0.2, kind: 'pd-kill', from: at, to: at, side: target.side, aspect: null, ship: -1 });
      }

      let cursor = Math.max(0, ds.findIndex((s) => s.idx === p.targetShip));
      for (let m = 0; m < left; m++) {
        let ship = ds[cursor % ds.length];
        for (let tries = 0; ship.damage >= OVERKILL * needBase(ship.cls.durability, 'durability') && tries < ds.length; tries++) {
          cursor++;
          ship = ds[cursor % ds.length];
        }
        const jitterAxis = norm([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
        const incoming = rotateAbout(approach, jitterAxis, (rng() - 0.5) * 0.5);
        const o = unitBasis(target, p.tArrive);
        const dims = {
          bandOffset: needBase(ship.cls.wedge.band_offset, 'wedge.band_offset'),
          bandLength: needBase(ship.cls.wedge.band_length, 'wedge.band_length'),
          bandWidth: needBase(ship.cls.wedge.band_width, 'wedge.band_width'),
        };
        const aspect = classifyAspect(o, incoming, dims);
        if (aspect === 'wedge') {
          blocked++;
          continue;
        }
        const prof = ctx.tech.missiles[p.profileId];
        const endwall = aspect === 'throat' ? endwallFactor(ship.cls.bow_wall) : aspect === 'kilt' ? endwallFactor(ship.cls.stern_wall) : 1;
        const dmg = needBase(prof.beams, 'beams') * needBase(prof.hit_fraction, 'hit_fraction') * needBase(prof.damage_per_beam, 'damage_per_beam')
          * ASPECT_FACTOR[aspect] * endwall;
        applyHit(ship, p.tArrive, dmg, aspect, rng);
        hits++;
        if (m < VISUAL_BEAMS_PER_PACKET) {
          const to = shipPos(ctx.units, ship, p.tArrive);
          const standoff = needBase(prof.standoff, 'standoff');
          ctx.beams.push({ t: p.tArrive, dur: 0.35, kind: 'laserhead', from: add(to, scale(incoming, -standoff)), to, side: p.side, aspect, ship: ship.idx });
        }
        cursor++;
      }
    });

    ctx.log.push({
      t: tw, side: group[0].side, kind: 'arrival',
      text: `${attack.toLocaleString('en-US')} attack missiles reach ${target.name}: CM ${killedCm.toLocaleString('en-US')}, PD ${killedPd.toLocaleString('en-US')}, stopped by wedges ${blocked.toLocaleString('en-US')}, hits ${hits.toLocaleString('en-US')}`,
      evidence: 'S', source_id: 'honor-cic',
    });
  }
  return { planStats };
}

import { hashSeed } from '../rng';
import type { FirePlanEvent } from '../schema';
import type { TechRegistry } from '../tech';
import type { Vec3 } from '../vec';
import { burnPlanOf, planIntercept } from './intercept';
import type { Anchors, TimeResolver } from './timeref';
import type { Counts, DrivePhase, KinSegment } from './types';

export interface PacketTrack {
  idx: number;
  id: string;
  side: string;
  engagement: string;
  salvoId: string;
  planId: string;
  profileId: string;
  fromUnit: number;
  toUnit: number;
  targetShip: number;
  guidance: 'shipboard' | 'apollo' | 'autonomous';
  tLaunch: number;
  tArrive: number;
  segments: KinSegment[];
  phases: Array<{ t0: number; phase: DrivePhase }>;
  launched: Counts;
  survivors: Array<{ t: number } & Counts>;
  maxSpeed: number;
  infeasible: boolean;
  seed: number;
}

export interface LaunchContext {
  unitIndex: Map<string, number>;
  unitPosition(id: string, t: number): Vec3;
  unitVelocity(id: string, t: number): Vec3;
  /** Ships of a unit in targeting priority (wall, carrier, screen); empty for LAC groups. */
  shipSlots(id: string): Array<{ ship: number; offset: (t: number) => Vec3 }>;
  side(id: string): string;
}

/** Splits total into n integer parts that differ by at most one and sum exactly to total. */
export function splitEven(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export function expandFirePlans(plans: FirePlanEvent[], tech: TechRegistry, times: TimeResolver, ctx: LaunchContext): PacketTrack[] {
  const out: PacketTrack[] = [];
  for (const ev of plans) {
    const profile = tech.missiles[ev.profile];
    if (!profile) throw new Error(`${ev.id}: unknown missile profile ${ev.profile}`);
    const plan = burnPlanOf(profile);
    const t0 = times.resolve(ev.t);
    const launchers = ctx.shipSlots(ev.from);
    const targets = ctx.shipSlots(ev.to);
    const salvoAttack = splitEven(ev.totals.attack, ev.salvos);
    const salvoEw = splitEven(ev.totals.ew, ev.salvos);
    const salvoCtl = splitEven(ev.totals.controller, ev.salvos);
    for (let k = 0; k < ev.salvos; k++) {
      const tL = t0 + k * ev.interval_s;
      const attack = splitEven(salvoAttack[k], ev.packets_per_salvo);
      const ew = splitEven(salvoEw[k], ev.packets_per_salvo);
      const ctl = splitEven(salvoCtl[k], ev.packets_per_salvo);
      for (let j = 0; j < ev.packets_per_salvo; j++) {
        if (attack[j] + ew[j] + ctl[j] === 0) continue;
        const launcher = launchers.length ? launchers[j % launchers.length] : null;
        const aim = targets.length ? targets[(j * 7 + k) % targets.length] : null;
        const launchP = launcher ? addV(ctx.unitPosition(ev.from, tL), launcher.offset(tL)) : ctx.unitPosition(ev.from, tL);
        const target = (t: number): Vec3 => (aim ? addV(ctx.unitPosition(ev.to, t), aim.offset(t)) : ctx.unitPosition(ev.to, t));
        const ip = planIntercept({ plan, tLaunch: tL, launchP, launchV: ctx.unitVelocity(ev.from, tL), target });
        const launched = { attack: attack[j], ew: ew[j], controller: ctl[j] };
        out.push({
          idx: out.length,
          id: `${ev.id}#${k}.${j}`,
          side: ctx.side(ev.from),
          engagement: ev.engagement,
          salvoId: `${ev.id}#${k}`,
          planId: ev.id,
          profileId: ev.profile,
          fromUnit: ctx.unitIndex.get(ev.from) as number,
          toUnit: ctx.unitIndex.get(ev.to) as number,
          targetShip: aim ? aim.ship : -1,
          guidance: ev.guidance,
          tLaunch: tL,
          tArrive: tL + ip.T,
          segments: ip.segments,
          phases: ip.phases,
          launched,
          survivors: [{ t: tL, ...launched }],
          maxSpeed: ip.maxSpeed,
          infeasible: !ip.feasible,
          seed: hashSeed(ev.seed, k, j),
        });
      }
    }
  }
  return out;
}

const addV = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** First and last solved arrival per fire plan, for `arrival` / `last_arrival` time references. */
export function arrivalAnchors(packets: PacketTrack[]): Anchors {
  const arrival = new Map<string, number>();
  const lastArrival = new Map<string, number>();
  for (const p of packets) {
    arrival.set(p.planId, Math.min(arrival.get(p.planId) ?? Infinity, p.tArrive));
    lastArrival.set(p.planId, Math.max(lastArrival.get(p.planId) ?? -Infinity, p.tArrive));
  }
  return { arrival, lastArrival };
}

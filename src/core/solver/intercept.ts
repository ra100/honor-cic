import { needBase } from '../evidence';
import type { MissileProfile } from '../tech';
import { add, addScaled, len, norm, scale, sub, type Vec3 } from '../vec';
import { DrivePhase, type KinSegment } from './types';

export interface BurnPlan { stages: Array<{ accel: number; dur: number }>; maxCoast: number }

export function burnPlanOf(profile: MissileProfile): BurnPlan {
  return {
    stages: profile.stages.map((s, i) => ({
      accel: needBase(s.accel, `${profile.id}.stages.${i}.accel`),
      dur: needBase(s.duration, `${profile.id}.stages.${i}.duration`),
    })),
    maxCoast: needBase(profile.max_coast, `${profile.id}.max_coast`),
  };
}

/** Burn pieces for a flight of T seconds: stages back to back, a coast inserted before the last stage when needed. */
export function burnSchedule(plan: BurnPlan, T: number): Array<{ dur: number; accel: number; phase: DrivePhase }> {
  const n = plan.stages.length;
  const powered = plan.stages.reduce((a, s) => a + s.dur, 0);
  const out: Array<{ dur: number; accel: number; phase: DrivePhase }> = [];
  const phaseOf = (i: number) => (i === n - 1 ? DrivePhase.Terminal : DrivePhase.Boost);
  if (T <= powered) {
    let left = T;
    plan.stages.forEach((s, i) => {
      const d = Math.min(s.dur, left);
      if (d > 0) out.push({ dur: d, accel: s.accel, phase: phaseOf(i) });
      left -= d;
    });
    return out;
  }
  plan.stages.slice(0, n - 1).forEach((s, i) => out.push({ dur: s.dur, accel: s.accel, phase: phaseOf(i) }));
  out.push({ dur: T - powered, accel: 0, phase: DrivePhase.Coast });
  out.push({ dur: plan.stages[n - 1].dur, accel: plan.stages[n - 1].accel, phase: DrivePhase.Terminal });
  return out;
}

/** Distance and speed gained along the thrust axis from rest after T seconds. */
export function burnDisplacement(plan: BurnPlan, T: number): { s: number; v: number } {
  let s = 0;
  let v = 0;
  for (const p of burnSchedule(plan, T)) {
    s += v * p.dur + 0.5 * p.accel * p.dur * p.dur;
    v += p.accel * p.dur;
  }
  return { s, v };
}

export interface InterceptInput { plan: BurnPlan; tLaunch: number; launchP: Vec3; launchV: Vec3; target: (t: number) => Vec3 }
export interface InterceptPlan {
  feasible: boolean;
  T: number;
  dir: Vec3;
  segments: KinSegment[];
  phases: Array<{ t0: number; phase: DrivePhase }>;
  maxSpeed: number;
  arrival: Vec3;
}

export function planIntercept({ plan, tLaunch, launchP, launchV, target }: InterceptInput): InterceptPlan {
  const powered = plan.stages.reduce((a, s) => a + s.dur, 0);
  const tMax = powered + plan.maxCoast;
  const required = (T: number) => sub(target(tLaunch + T), addScaled(launchP, launchV, T));
  const gap = (T: number) => burnDisplacement(plan, T).s - len(required(T));

  let hiT = -1;
  for (let T = 5; T <= tMax + 1e-9; T += 5) {
    if (gap(T) >= 0) {
      hiT = T;
      break;
    }
  }
  let feasible = hiT > 0;
  let T = tMax;
  if (feasible) {
    let lo = Math.max(0, hiT - 5);
    let hi = hiT;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (gap(mid) >= 0) hi = mid;
      else lo = mid;
    }
    T = hi;
  }
  const dir = norm(required(T));

  const segments: KinSegment[] = [];
  const phases: Array<{ t0: number; phase: DrivePhase }> = [];
  let t = tLaunch;
  let p = launchP;
  let v = launchV;
  let maxSpeed = len(v);
  for (const piece of burnSchedule(plan, T)) {
    const a = scale(dir, piece.accel);
    segments.push({ t0: t, t1: t + piece.dur, p0: p, v0: v, a });
    phases.push({ t0: t, phase: piece.phase });
    p = add(addScaled(p, v, piece.dur), scale(a, 0.5 * piece.dur * piece.dur));
    v = addScaled(v, a, piece.dur);
    t += piece.dur;
    maxSpeed = Math.max(maxSpeed, len(v));
  }
  if (feasible && len(sub(p, target(tLaunch + T))) > 1_000) feasible = false;
  return { feasible, T, dir, segments, phases, maxSpeed, arrival: p };
}

import { baseValue } from './evidence';
import type { CelestialBody } from './schema';
import { bodyPosition, DEG, indexBodies } from './solver/orbits';
import { G0_KM_S2 } from './units';
import { add, addScaled, dist, dot, len, norm, scale, sub, type Vec3 } from './vec';

/**
 * A CIC course projection: where a force goes if it keeps doing what it is doing now. It sees only the force's present
 * position, velocity and thrust, the stars' gravity and where the other forces are now; never the replay's future.
 */

export const GM_SUN_KM3_S2 = 1.32712440018e11;
/** How far ahead a course is projected, s. */
export const HORIZON_S = 3 * 3600;
/** Integration and sample step, s. */
export const COURSE_STEP_S = 20;
/** Thrust within this angle of the bearing to a body or force reads as heading for it. */
export const TARGET_CONE_RAD = 8 * DEG;
/** Cross-track uncertainty: thrust axis error, speed error, and a maneuver the force could start at any moment. */
const HEADING_SIGMA_RAD = 2 * DEG;
const SPEED_SIGMA = 0.005;
const MANEUVER_SIGMA_KM_S2 = G0_KM_S2;
/** An intercept plans its braking with this share of the drive, as a margin. */
const BRAKE_MARGIN = 0.9;
/** Bodies a force can be heading for. */
const DESTINATIONS = new Set(['planet', 'moon', 'station', 'terminus']);
/** Below this a force is coasting, km/s². */
const COAST_KM_S2 = 1e-6;

export interface Mover { id: string; name: string; p: Vec3; v: Vec3 }
export interface CourseTarget { id: string; name: string; kind: 'body' | 'unit' }

export interface CoursePlot {
  /** Replay time the projection starts from, s. */
  t0: number;
  /** Heading for a target and braking to meet it, holding the present thrust, or coasting. */
  mode: 'intercept' | 'burn' | 'coast';
  target: CourseTarget | null;
  /** Seconds after t0 of each sample. */
  times: number[];
  points: Vec3[];
  /** One-sigma cross-track uncertainty at each sample, km. */
  sigma: number[];
  /** Sample where the force flips and starts braking; null when it never does. */
  turnover: number | null;
  /** Arrived at the target, crossed a hyper limit outbound, or reached the horizon. */
  end: 'arrival' | 'limit' | 'horizon';
  /** Body whose hyper limit the course leaves through, when end is 'limit'. */
  limit: string | null;
}

interface Well { id: string; gm: number }
interface Limit { id: string; name: string; radius: number }

export class CourseModel {
  private readonly index: Map<string, CelestialBody>;
  private readonly wells: Well[];
  private readonly limits: Limit[];
  private readonly destinations: CelestialBody[];

  constructor(bodies: CelestialBody[]) {
    this.index = indexBodies(bodies);
    this.wells = bodies.flatMap((b) => (b.mass?.unit === 'Msun' && b.mass.value ? [{ id: b.id, gm: b.mass.value * GM_SUN_KM3_S2 }] : []));
    this.limits = bodies.flatMap((b) => {
      const r = baseValue(b.hyper_limit);
      return r ? [{ id: b.id, name: b.name, radius: r }] : [];
    });
    this.destinations = bodies.filter((b) => DESTINATIONS.has(b.kind));
  }

  /** Gravitational acceleration at p, t seconds after the epoch, km/s². */
  gravity(p: Vec3, t: number): Vec3 {
    let g: Vec3 = [0, 0, 0];
    for (const w of this.wells) {
      const d = sub(bodyPosition(this.index, w.id, t), p);
      const r = len(d);
      if (r > 1) g = addScaled(g, d, w.gm / (r * r * r));
    }
    return g;
  }

  /** The body or force the thrust points at, if any lies within TARGET_CONE_RAD of it. */
  inferTarget(t: number, p: Vec3, a: Vec3, others: Mover[]): CourseTarget | null {
    if (len(a) < COAST_KM_S2) return null;
    const dir = norm(a);
    let best: CourseTarget | null = null;
    let bestCos = Math.cos(TARGET_CONE_RAD);
    const consider = (target: CourseTarget, at: Vec3) => {
      const c = dot(dir, norm(sub(at, p)));
      if (c > bestCos) {
        bestCos = c;
        best = target;
      }
    };
    for (const b of this.destinations) consider({ id: b.id, name: b.name, kind: 'body' }, bodyPosition(this.index, b.id, t));
    for (const o of others) consider({ id: o.id, name: o.name, kind: 'unit' }, o.p);
    return best;
  }

  project(t: number, p0: Vec3, v0: Vec3, a0: Vec3, others: Mover[] = [], horizon = HORIZON_S): CoursePlot {
    const accel = len(a0);
    const target = this.inferTarget(t, p0, a0, others);
    const mode: CoursePlot['mode'] = target ? 'intercept' : accel < COAST_KM_S2 ? 'coast' : 'burn';
    const mover = target?.kind === 'unit' ? others.find((o) => o.id === target.id) ?? null : null;
    // A force is assumed to hold its course; a body follows its orbit.
    const targetAt = (tau: number): { p: Vec3; v: Vec3 } => {
      if (mover) return { p: addScaled(mover.p, mover.v, tau), v: mover.v };
      const id = (target as CourseTarget).id;
      const p = bodyPosition(this.index, id, t + tau);
      return { p, v: sub(bodyPosition(this.index, id, t + tau + 1), p) };
    };
    const inside = this.limits.map((l) => dist(p0, bodyPosition(this.index, l.id, t)) < l.radius);

    const dt = COURSE_STEP_S;
    const plot: CoursePlot = { t0: t, mode, target, times: [0], points: [p0], sigma: [0], turnover: null, end: 'horizon', limit: null };
    let p = p0;
    let v = v0;
    let braking = false;
    for (let tau = 0; tau < horizon; tau += dt) {
      let a: Vec3 = a0;
      if (target) {
        const tg = targetAt(tau);
        const r = sub(tg.p, p);
        const w = sub(v, tg.v);
        const range = len(r);
        if (range < Math.max(1_000, accel * dt * dt) && len(w) < 2 * accel * dt) {
          plot.end = 'arrival';
          break;
        }
        // Bang-bang rendezvous: close at the speed the drive can still kill over the remaining range.
        const want = scale(norm(r), Math.sqrt(2 * BRAKE_MARGIN * accel * range));
        const dv = sub(want, w);
        a = len(dv) < accel * dt ? scale(dv, 1 / dt) : scale(norm(dv), accel);
        const nowBraking = dot(a, r) < 0;
        if (nowBraking && !braking && plot.turnover === null) plot.turnover = plot.points.length - 1;
        braking = nowBraking;
      }
      const g = this.gravity(p, t + tau);
      const total = add(a, g);
      p = add(addScaled(p, v, dt), scale(total, 0.5 * dt * dt));
      v = addScaled(v, total, dt);
      const tt = tau + dt;
      plot.times.push(tt);
      plot.points.push(p);
      plot.sigma.push(SPEED_SIGMA * len(v0) * tt + 0.5 * (accel * Math.sin(HEADING_SIGMA_RAD) + MANEUVER_SIGMA_KM_S2) * tt * tt);
      if (!target) {
        const left = this.limits.findIndex((l, i) => inside[i] && dist(p, bodyPosition(this.index, l.id, t + tt)) >= l.radius);
        if (left >= 0) {
          plot.end = 'limit';
          plot.limit = this.limits[left].name;
          break;
        }
      }
    }
    return plot;
  }
}

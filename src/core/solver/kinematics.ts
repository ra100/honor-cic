import { baseValue } from '../evidence';
import { posToKm, type CelestialBody, type ManeuverEvent, type ScenarioPack, type UnitDef } from '../schema';
import { add, addScaled, norm, scale, sub, type Vec3 } from '../vec';
import { bodyPosition } from './orbits';
import type { TimeResolver } from './timeref';
import type { KinSegment } from './types';

/** Seconds between direction refreshes for toward/away maneuvers. */
export const STEP_S = 60;

export function segmentState(segs: KinSegment[], t: number, outP: Vec3 = [0, 0, 0], outV: Vec3 = [0, 0, 0]): { p: Vec3; v: Vec3 } {
  let lo = 0;
  let hi = segs.length - 1;
  if (t >= segs[hi].t0) lo = hi;
  else {
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].t0 <= t) lo = mid;
      else hi = mid - 1;
    }
  }
  const s = segs[lo];
  const dt = t - s.t0;
  for (let i = 0; i < 3; i++) {
    outV[i] = s.v0[i] + s.a[i] * dt;
    outP[i] = s.p0[i] + s.v0[i] * dt + 0.5 * s.a[i] * dt * dt;
  }
  return { p: outP, v: outV };
}

type Direction = ManeuverEvent['direction'];
interface Thrust { t0: number; t1: number; accel: number; dir: Direction }

function targetOf(dir: Direction): string | null {
  return 'toward' in dir ? dir.toward : 'away' in dir ? dir.away : null;
}

export function buildUnitTracks(
  pack: ScenarioPack,
  bodies: Map<string, CelestialBody>,
  times: TimeResolver,
  span: [number, number],
): Map<string, KinSegment[]> {
  const units = new Map(pack.units.map((u) => [u.id, u]));
  const thrusts = new Map<string, Thrust[]>();
  for (const ev of pack.events) {
    if (ev.type !== 'maneuver') continue;
    const accel = baseValue(ev.accel);
    if (accel === null) throw new Error(`${ev.id}: acceleration unknown`);
    thrusts.set(ev.unit, [...(thrusts.get(ev.unit) ?? []), { t0: times.resolve(ev.t), t1: times.resolve(ev.until), accel, dir: ev.direction }]);
  }

  const deps = (u: UnitDef): string[] => {
    const d: string[] = [];
    if ('relative_to' in u.state.place) d.push(u.state.place.relative_to);
    if ('relative_to' in u.state.velocity) d.push(u.state.velocity.relative_to);
    for (const th of thrusts.get(u.id) ?? []) {
      const target = targetOf(th.dir);
      if (target && units.has(target)) d.push(target);
    }
    return d.filter((x) => x !== u.id);
  };

  const order: UnitDef[] = [];
  const mark = new Map<string, 'visiting' | 'done'>();
  const visit = (u: UnitDef, path: string[]): void => {
    if (mark.get(u.id) === 'done') return;
    if (mark.get(u.id) === 'visiting') throw new Error(`Circular unit dependency: ${[...path, u.id].join(' -> ')}`);
    mark.set(u.id, 'visiting');
    for (const d of deps(u)) visit(units.get(d) as UnitDef, [...path, u.id]);
    mark.set(u.id, 'done');
    order.push(u);
  };
  for (const u of pack.units) visit(u, []);

  const tracks = new Map<string, KinSegment[]>();
  const stateOf = (id: string, t: number) => segmentState(tracks.get(id) as KinSegment[], t);
  const positionOf = (id: string, t: number): Vec3 => (units.has(id) ? stateOf(id, t).p : bodyPosition(bodies, id, t));
  const directionOf = (dir: Direction, p: Vec3, t: number): Vec3 => {
    if ('vector' in dir) return norm(dir.vector);
    if ('toward' in dir) return norm(sub(positionOf(dir.toward, t), p));
    return norm(sub(p, positionOf(dir.away, t)));
  };

  for (const u of order) {
    const tA = times.resolve(u.state.t);
    const pl = u.state.place;
    const p0 = add('frame' in pl ? bodyPosition(bodies, pl.frame, tA) : stateOf(pl.relative_to, tA).p, posToKm(pl.position));
    const vel = u.state.velocity;
    const v0: Vec3 = 'frame' in vel ? [...vel.velocity_km_s] : add(stateOf(vel.relative_to, tA).v, vel.velocity_km_s);
    const own = [...(thrusts.get(u.id) ?? [])].sort((a, b) => a.t0 - b.t0);
    tracks.set(u.id, integrate(p0, v0, tA, span, own, directionOf));
  }
  return tracks;
}

function integrate(
  p0: Vec3, v0: Vec3, tA: number, [tMin, tMax]: [number, number], thrusts: Thrust[],
  directionOf: (dir: Direction, p: Vec3, t: number) => Vec3,
): KinSegment[] {
  const lo = Math.min(tMin, tA);
  const hi = Math.max(tMax, tA);
  const cuts = new Set<number>([lo, hi, tA]);
  for (const th of thrusts) {
    for (let t = th.t0; t < th.t1; t += STEP_S) if (t > lo && t < hi) cuts.add(t);
    if (th.t1 > lo && th.t1 < hi) cuts.add(th.t1);
  }
  const ts = [...cuts].sort((a, b) => a - b);
  const active = (t: number): Thrust | null => thrusts.find((th) => t >= th.t0 && t < th.t1) ?? null;
  const iA = ts.indexOf(tA);

  const forward: KinSegment[] = [];
  let p = p0;
  let v = v0;
  for (let i = iA; i < ts.length - 1; i++) {
    const t0 = ts[i];
    const dt = ts[i + 1] - t0;
    const th = active(t0);
    const a: Vec3 = th ? scale(directionOf(th.dir, p, t0), th.accel) : [0, 0, 0];
    forward.push({ t0, t1: ts[i + 1], p0: p, v0: v, a });
    p = add(addScaled(p, v, dt), scale(a, 0.5 * dt * dt));
    v = addScaled(v, a, dt);
  }

  const backward: KinSegment[] = [];
  p = p0;
  v = v0;
  for (let i = iA; i > 0; i--) {
    const t0 = ts[i - 1];
    const t1 = ts[i];
    const dt = t1 - t0;
    const th = active(t0);
    // The start state is unknown, so the direction is taken at the segment's known end.
    const a: Vec3 = th ? scale(directionOf(th.dir, p, t1), th.accel) : [0, 0, 0];
    const vStart = addScaled(v, a, -dt);
    const pStart = sub(sub(p, scale(vStart, dt)), scale(a, 0.5 * dt * dt));
    backward.push({ t0, t1, p0: pStart, v0: vStart, a });
    p = pStart;
    v = vStart;
  }
  return [...backward.reverse(), ...forward];
}

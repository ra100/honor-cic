import { cross, dot, norm, rotateAbout, type Vec3 } from '../vec';
import { basis, type Basis } from './formation';
import type { Aspect } from './types';

export interface WedgeDims { bandOffset: number; bandLength: number; bandWidth: number }
/** A turn of the unit's axes: about the bow (a roll) or, with axis 'up', about the dorsal axis (a turn of the bow). */
export interface Roll { t0: number; t1: number; angleRad: number; axis?: 'bow' | 'up' }

/** Unit axes at t: turns apply in time order, each about the axes left by the ones before, the current one interpolated. */
export function orientationAt(facing: Vec3, up: Vec3, rolls: Roll[], t: number): Basis {
  const b = basis(facing, up);
  let f = b.f;
  let u = b.u;
  for (const r of rolls) {
    if (t <= r.t0) continue;
    const angle = t >= r.t1 ? r.angleRad : (r.angleRad * (t - r.t0)) / (r.t1 - r.t0);
    if (r.axis === 'up') f = rotateAbout(f, u, angle);
    else u = rotateAbout(u, f, angle);
  }
  return { f, u, s: cross(f, u) };
}

/** Where an attack travelling along `incoming` meets the ship (MTS §3.1, §4.6). */
export function classifyAspect(o: Basis, incoming: Vec3, w: WedgeDims, standoffKm = 30_000): Aspect {
  const d = norm(incoming);
  const df = dot(d, o.f);
  const ds = dot(d, o.s);
  const du = dot(d, o.u);
  const of = -df * standoffKm;
  const os = -ds * standoffKm;
  const ou = -du * standoffKm;
  if (Math.abs(du) > 1e-12) {
    const plane = ou > 0 ? w.bandOffset : -w.bandOffset;
    const k = (plane - ou) / du;
    if (k > 0) {
      const hf = of + df * k;
      const hs = os + ds * k;
      if (Math.abs(hf) <= w.bandLength / 2 && Math.abs(hs) <= w.bandWidth / 2) return 'wedge';
    }
  }
  if (Math.abs(ds) >= Math.abs(df)) return 'sidewall';
  return of > 0 ? 'throat' : 'kilt';
}

/** Damage multiplier by aspect before end walls. The sidewall value is S: walls attenuate, they do not grant immunity. */
export const ASPECT_FACTOR: Record<Aspect, number> = { wedge: 0, sidewall: 0.35, throat: 1, kilt: 1 };

/** Multiplier for attacks through the throat or kilt (MTS §4.6: a bow wall is sidewall-grade, not complete immunity). */
export function endwallFactor(wall: 'none' | 'buckler' | 'full'): number {
  return wall === 'none' ? 1 : wall === 'buckler' ? 0.6 : ASPECT_FACTOR.sidewall;
}

/** True when a launch toward the target would cross the ship's own stress band (MTS §12.2 check 10). */
export function launchBlocked(o: Basis, dirToTarget: Vec3, w: WedgeDims): boolean {
  return classifyAspect(o, [-dirToTarget[0], -dirToTarget[1], -dirToTarget[2]], w) === 'wedge';
}

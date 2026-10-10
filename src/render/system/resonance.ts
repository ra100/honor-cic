import type { ConeExclusion } from '../../core/solver/orbits';
import { dot, len, sub, type Vec3 } from '../../core/vec';

export interface ConeFrame {
  /** Midpoint between base and apex, km. */
  centre: Vec3;
  /** Unit vector from the base (star) to the apex (terminus). */
  axis: Vec3;
  /** Base-to-apex length, km. */
  height: number;
  baseRadius: number;
}

/** The drawn cone is the enforced one: apex at the terminus, base disc through the star (`coneContains` in orbits.ts). */
export function coneFrame(e: ConeExclusion): ConeFrame {
  const v = sub(e.apex, e.base);
  const height = len(v);
  return {
    centre: [(e.base[0] + e.apex[0]) / 2, (e.base[1] + e.apex[1]) / 2, (e.base[2] + e.apex[2]) / 2],
    axis: height > 0 ? [v[0] / height, v[1] / height, v[2] / height] : [0, 0, 1],
    height,
    baseRadius: e.radius,
  };
}

/** Cone radius at axial distance s from the base, zero outside the cone's length. */
export function coneRadiusAt(e: ConeExclusion, s: number): number {
  const h = len(sub(e.apex, e.base));
  return s < 0 || s > h ? 0 : e.radius * (1 - s / h);
}

/** Distance from p to the cone's slanted wall, km; negative inside the zone. */
export function coneSurfaceDistance(e: ConeExclusion, p: Vec3): number {
  const v = sub(e.apex, e.base);
  const h = len(v);
  if (h <= 0) return len(sub(p, e.base));
  const a: Vec3 = [v[0] / h, v[1] / h, v[2] / h];
  const rel = sub(p, e.base);
  const s = dot(rel, a);
  const rho = len([rel[0] - a[0] * s, rel[1] - a[1] * s, rel[2] - a[2] * s]);
  // In the (s, rho) half-plane the wall is the segment from the base rim (0, R) to the apex (h, 0).
  const R = e.radius;
  const k = Math.max(0, Math.min(1, (s * h - (rho - R) * R) / (h * h + R * R)));
  const d = Math.hypot(s - k * h, rho - R * (1 - k));
  const inside = s >= 0 && s <= h && rho < R * (1 - s / h);
  return inside ? -d : d;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** The wall softens over this fraction of the base radius next to the base rim, so it meets the hyper globe gently. */
export const BASE_FADE = 0.12;

/**
 * Site A's cone strength (0.3) scaled by how far out the camera is: full from a system-wide view of the star
 * (user-1) outward, about two thirds at the hyper limit, faint in close-ups near the star, and off inside the zone or
 * right at its wall (A §3.8, §3.11). Distances are in base radii, so the fade suits any pack.
 */
export function coneFade(eye: Vec3, e: ConeExclusion): number {
  const d = coneSurfaceDistance(e, eye);
  if (d <= 0) return 0;
  const R = e.radius;
  const range = len(sub(eye, e.base));
  return 0.3 * smoothstep(0.1 * R, 0.8 * R, d) * (0.15 + 0.85 * smoothstep(0.4 * R, 4.5 * R, range));
}

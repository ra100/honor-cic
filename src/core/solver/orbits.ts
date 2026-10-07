import { baseValue } from '../evidence';
import { posToKm, type CelestialBody } from '../schema';
import { add, dist, type Vec3 } from '../vec';

export const DEG = Math.PI / 180;

export function indexBodies(bodies: CelestialBody[]): Map<string, CelestialBody> {
  return new Map(bodies.map((b) => [b.id, b]));
}

function ringPoint(radius: number, angle: number, inclination: number): Vec3 {
  const y0 = radius * Math.sin(angle);
  return [radius * Math.cos(angle), y0 * Math.cos(inclination), y0 * Math.sin(inclination)];
}

/** Body position relative to its parent at t seconds after the epoch. */
export function localOffset(b: CelestialBody, t: number): Vec3 {
  if (b.orbit) {
    const r = baseValue(b.orbit.radius) ?? 0;
    const phase = (b.orbit.phase.value ?? 0) * DEG;
    const period = baseValue(b.orbit.period);
    const omega = period ? (2 * Math.PI) / period : 0;
    return ringPoint(r, phase + omega * t, (b.orbit.inclination.value ?? 0) * DEG);
  }
  if (b.offset) return posToKm(b.offset);
  return [0, 0, 0];
}

export function bodyPosition(index: Map<string, CelestialBody>, id: string, t: number): Vec3 {
  const b = index.get(id);
  if (!b) throw new Error(`Unknown body "${id}"`);
  const local = localOffset(b, t);
  return b.parent_id === null ? local : add(bodyPosition(index, b.parent_id, t), local);
}

/** The orbit drawn in the same frame as bodyPosition at time t (MTS §12.2 check 3). */
export function orbitPolyline(index: Map<string, CelestialBody>, id: string, t: number, n = 256): Vec3[] {
  const b = index.get(id);
  if (!b?.orbit || b.parent_id === null) return [];
  const parent = bodyPosition(index, b.parent_id, t);
  const r = baseValue(b.orbit.radius) ?? 0;
  const inc = (b.orbit.inclination.value ?? 0) * DEG;
  return Array.from({ length: n }, (_, i) => add(parent, ringPoint(r, (2 * Math.PI * i) / n, inc)));
}

export interface Exclusion { body: string; name: string; center: Vec3; radius: number; kind: 'hyper-limit' | 'terminus' }

export function exclusionsAt(index: Map<string, CelestialBody>, t: number): Exclusion[] {
  const out: Exclusion[] = [];
  for (const b of index.values()) {
    const hyper = baseValue(b.hyper_limit);
    if (hyper !== null) out.push({ body: b.id, name: b.name, center: bodyPosition(index, b.id, t), radius: hyper, kind: 'hyper-limit' });
    const ex = baseValue(b.exclusion);
    if (ex !== null) out.push({ body: b.id, name: b.name, center: bodyPosition(index, b.id, t), radius: ex, kind: 'terminus' });
  }
  return out;
}

export function insideExclusion(index: Map<string, CelestialBody>, p: Vec3, t: number): Exclusion | null {
  return exclusionsAt(index, t).find((e) => dist(p, e.center) < e.radius) ?? null;
}

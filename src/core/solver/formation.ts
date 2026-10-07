import type { Rng } from '../rng';
import { add, cross, dot, norm, scale, sub, type Vec3 } from '../vec';

export interface Basis { f: Vec3; s: Vec3; u: Vec3 }

/**
 * Ship axes for a formation facing a threat. A wall presents its broadsides, so starboard points at the
 * threat, up is made orthogonal to it, and forward completes the right-handed frame (s = f × u).
 */
export function basis(facing: Vec3, up: Vec3): Basis {
  const s = norm(facing);
  const u = norm(sub(up, scale(s, dot(up, s))));
  return { f: cross(u, s), s, u };
}

export const toSystem = (b: Basis, o: Vec3): Vec3 => add(add(scale(b.f, o[0]), scale(b.s, o[1])), scale(b.u, o[2]));

/** Local offsets [forward, starboard, up] in km. Slots are sorted by distance, so the first is central (flagship). */
export function formationOffsets(kind: 'wall' | 'globe' | 'column' | 'swarm', n: number, spacing: number, rng: Rng): Vec3[] {
  if (n <= 0) return [];
  let pts: Vec3[];
  if (kind === 'column') {
    pts = Array.from({ length: n }, (_, i): Vec3 => [-i * spacing, 0, 0]);
  } else if (kind === 'wall') {
    const cols = Math.ceil(Math.sqrt(n * 1.6));
    const rows = Math.ceil(n / cols);
    pts = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pts.push([(c - (cols - 1) / 2) * spacing, (rng() - 0.5) * 0.04 * spacing, (r - (rows - 1) / 2) * spacing * 0.6]);
      }
    }
  } else {
    const radius = spacing * Math.cbrt(n) * 0.62;
    const golden = Math.PI * (3 - Math.sqrt(5));
    pts = Array.from({ length: n }, (_, i): Vec3 => {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - y * y);
      const k = radius * Math.cbrt((i + 1) / n);
      return [y * k, Math.cos(i * golden) * r * k, Math.sin(i * golden) * r * k];
    });
  }
  pts.sort((a, b) => a[0] ** 2 + a[1] ** 2 + a[2] ** 2 - (b[0] ** 2 + b[1] ** 2 + b[2] ** 2));
  return pts.slice(0, n);
}

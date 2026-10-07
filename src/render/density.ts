import { hashSeed, mulberry32 } from '../core/rng';

/** Upper bound on drawn missile dots; above it the effective ratio doubles until the plan fits. */
export const DOT_CAP = 250_000;
const MAX_DOTS_PER_PACKET = 4096;

export interface DensityPlan { ratio: number; effectiveRatio: number; dots: number; total: number; perPacket: Uint32Array }

function countDots(alive: Uint32Array, ratio: number): number {
  let n = 0;
  for (let i = 0; i < alive.length; i++) if (alive[i]) n += Math.min(MAX_DOTS_PER_PACKET, Math.ceil(alive[i] / ratio));
  return n;
}

export function planDensity(alive: Uint32Array, ratio: number, cap = DOT_CAP): DensityPlan {
  let total = 0;
  for (let i = 0; i < alive.length; i++) total += alive[i];
  let effectiveRatio = ratio;
  let dots = countDots(alive, effectiveRatio);
  while (dots > cap) {
    effectiveRatio *= 2;
    dots = countDots(alive, effectiveRatio);
  }
  const perPacket = new Uint32Array(alive.length);
  for (let i = 0; i < alive.length; i++) perPacket[i] = alive[i] ? Math.min(MAX_DOTS_PER_PACKET, Math.ceil(alive[i] / effectiveRatio)) : 0;
  return { ratio, effectiveRatio, dots, total, perPacket };
}

/** Display-only spread of a packet's representative dots, km. S display aid, not a physical dispersion. */
export const packetSpreadKm = (age: number): number => Math.min(20_000, 50 + 30 * Math.max(0, age));

/** Stable unit-ball offsets per packet, so dots never reshuffle while scrubbing. */
export class DotCache {
  private cache = new Map<number, Float32Array>();
  offsets(packetSeed: number, n: number): Float32Array {
    const have = this.cache.get(packetSeed);
    if (have && have.length >= n * 3) return have;
    const size = Math.min(MAX_DOTS_PER_PACKET, Math.max(n, 64));
    const rng = mulberry32(hashSeed('dots', packetSeed));
    const out = new Float32Array(size * 3);
    for (let i = 0; i < size; i++) {
      let x = 0, y = 0, z = 0;
      do {
        x = rng() * 2 - 1;
        y = rng() * 2 - 1;
        z = rng() * 2 - 1;
      } while (x * x + y * y + z * z > 1);
      out.set([x, y, z], i * 3);
    }
    this.cache.set(packetSeed, out);
    return out;
  }
}

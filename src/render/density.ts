import { hashSeed, mulberry32 } from '../core/rng';

/** Upper bound on drawn missile dots; above it the effective ratio doubles until the plan fits. */
export const DOT_CAP = 250_000;
export const MAX_DOTS_PER_PACKET = 4096;

export interface DensityPlan { ratio: number; effectiveRatio: number; dots: number; total: number; perPacket: Uint32Array }

function countDots(alive: Uint32Array, ratio: number): number {
  let n = 0;
  for (let i = 0; i < alive.length; i++) n += sampledCount(alive[i], ratio);
  return n;
}

export function planDensity(alive: Uint32Array, ratio: number, cap = DOT_CAP): DensityPlan {
  let total = 0;
  for (let i = 0; i < alive.length; i++) total += alive[i];
  ratio = Number.isFinite(ratio) ? Math.max(1, Math.round(ratio)) : 1;
  cap = Number.isFinite(cap) ? Math.max(1, Math.floor(cap)) : DOT_CAP;
  let effectiveRatio = ratio;
  let dots = countDots(alive, effectiveRatio);
  while (dots > cap) {
    effectiveRatio *= 2;
    dots = countDots(alive, effectiveRatio);
  }
  const perPacket = new Uint32Array(alive.length);
  for (let i = 0; i < alive.length; i++) perPacket[i] = sampledCount(alive[i], effectiveRatio);
  return { ratio, effectiveRatio, dots, total, perPacket };
}

/** Display-only spread of a packet's representative dots, km. S display aid, not a physical dispersion. */
export const packetSpreadKm = (age: number): number => Math.min(20_000, 50 + 30 * Math.max(0, age));

/** Share of the camera distance a packet cloud never shrinks below, so salvos read as clouds at fleet range (S display aid). */
export const DISPLAY_SPREAD_FRACTION = 0.0075;
export const displaySpreadKm = (physicalKm: number, cameraDistanceKm: number): number =>
  Math.max(physicalKm, cameraDistanceKm * DISPLAY_SPREAD_FRACTION);

/**
 * Site A's per-missile path scatter (A report §4.7, `lateralOff`): each bird bows off the straight line by up to
 * 7.5 % of the flight distance through its first Bézier control point, which puts the widest point of a salvo cloud
 * about a third of the way out (0.033 of the flight distance) and closes it again on the launcher and the target.
 */
export const SALVO_SCATTER = 0.033;
export function salvoSpreadKm(flightKm: number, coveredShare: number): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(coveredShare) ? coveredShare : 0));
  return Math.max(0, flightKm) * SALVO_SCATTER * 6.75 * f * (1 - f) * (1 - f);
}

/** Missiles of a packet a ratio samples: one per `ratio`, at most MAX_DOTS_PER_PACKET (as planDensity). */
export const sampledCount = (missiles: number, ratio: number): number =>
  missiles > 0 ? Math.min(MAX_DOTS_PER_PACKET, Math.ceil(missiles / Math.max(1, ratio))) : 0;

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

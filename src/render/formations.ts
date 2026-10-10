import type { Vec3 } from '../core/vec';

/** Clear space kept between neighbouring glyphs, CSS px. */
export const GLYPH_GAP_PX = 3;
/** A formation is never drawn more than this far from its centre, CSS px. */
export const MAX_FORMATION_RADIUS_PX = 180;
/** Nor more than this share of the way to the nearest other fleet, so neighbouring formations never interleave. */
export const NEIGHBOUR_SHARE = 0.42;

/** Median distance from each formation slot to its nearest neighbour, km: the formation's own spacing. */
export function slotSpacingKm(slots: readonly Vec3[]): number {
  if (slots.length < 2) return 0;
  const nearest = slots.map((a, i) => {
    let best = Infinity;
    for (let j = 0; j < slots.length; j++) {
      if (j === i) continue;
      const b = slots[j];
      best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    return best;
  }).sort((a, b) => a - b);
  return nearest[Math.floor(nearest.length / 2)];
}

export const slotRadiusKm = (slots: readonly Vec3[]): number => slots.reduce((r, s) => Math.max(r, Math.hypot(s[0], s[1], s[2])), 0);

export interface SpreadInput {
  /** Kilometres per CSS pixel at the camera's look distance. */
  kmPerPx: number;
  spacingKm: number;
  radiusKm: number;
  /** Largest glyph of the fleet plus the clear gap, CSS px. */
  minGapPx: number;
  /** Distance to the nearest other fleet in the theater; Infinity when alone. */
  neighbourKm: number;
}

/**
 * How many times larger than life a fleet's 3D formation is drawn about its true centre [S]: enough for neighbouring
 * glyphs to stay apart at the camera's zoom, never more than MAX_FORMATION_RADIUS_PX across or NEIGHBOUR_SHARE of the way
 * to the next fleet, and never smaller than life. It depends on zoom and positions only, never on the view direction, so
 * orbiting turns the formation instead of reshaping it.
 */
export function formationSpread(i: SpreadInput): number {
  if (!(i.spacingKm > 0) || !(i.radiusKm > 0) || !(i.kmPerPx > 0) || !Number.isFinite(i.kmPerPx)) return 1;
  const readable = (i.minGapPx * i.kmPerPx) / i.spacingKm;
  const radiusCap = (MAX_FORMATION_RADIUS_PX * i.kmPerPx) / i.radiusKm;
  const neighbourCap = Number.isFinite(i.neighbourKm) ? (NEIGHBOUR_SHARE * i.neighbourKm) / i.radiusKm : Infinity;
  return Math.max(1, Math.min(readable, radiusCap, neighbourCap));
}

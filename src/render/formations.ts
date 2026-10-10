import { unitPresent, type Frame, type Replay } from '../core/replay';
import { lacFront } from '../core/solver/lac-wing';
import type { Vec3 } from '../core/vec';

/**
 * Every formation, LAC wings included, is drawn this many times larger than life about its true centre [S]: walls come out
 * 1.5–2.2 Mkm wide, as in Site A, ships stay apart from a few Mkm out, and the size is the same for every fleet at every
 * zoom, so zooming in brings a fleet closer instead of reshaping it.
 */
export const FORMATION_SCALE = 4;
/** A fleet is never drawn more than this share of the way to the nearest other fleet, so formations never interleave. */
export const NEIGHBOUR_SHARE = 0.42;

export const slotRadiusKm = (slots: readonly Vec3[]): number => slots.reduce((r, s) => Math.max(r, Math.hypot(s[0], s[1], s[2])), 0);

/**
 * How many times larger than life a fleet is drawn: FORMATION_SCALE, less when that would carry it past NEIGHBOUR_SHARE of
 * the way to the nearest other fleet, and never smaller than life. Positions only: neither zoom nor view direction.
 */
export function formationScale(radiusKm: number, neighbourKm: number): number {
  if (!(radiusKm > 0)) return 1;
  const cap = Number.isFinite(neighbourKm) ? (NEIGHBOUR_SHARE * neighbourKm) / radiusKm : Infinity;
  return Math.max(1, Math.min(FORMATION_SCALE, cap));
}

const RADII = new WeakMap<Replay, Float64Array>();

/** Each unit's true formation radius, km: the reach of its ships' slots, or the front its LAC wing covers. */
export function formationRadii(replay: Replay): Float64Array {
  let radii = RADII.get(replay);
  if (!radii) {
    radii = Float64Array.from(replay.units, (u) => (u.kind === 'lac'
      ? lacFront(u.lacCount[0]?.count ?? 0, u.spacing)
      : slotRadiusKm(u.shipIdx.map((s) => replay.ships[s].slot))));
    RADII.set(replay, radii);
  }
  return radii;
}

/**
 * How many times larger than life each unit is drawn at the frame time when the theater is shown: LAC wings always
 * FORMATION_SCALE, each fleet of the theater formationScale against the nearest other fleet still fighting there,
 * everything else 1. Shared by the Engagement view and the director, so the camera frames what is drawn.
 */
export function drawnScales(replay: Replay, frame: Frame, theater: string, radii: ArrayLike<number> = formationRadii(replay)): Float64Array {
  const out = new Float64Array(replay.units.length).fill(1);
  const fleets: number[] = [];
  replay.units.forEach((u, i) => {
    if (u.kind === 'lac') out[i] = FORMATION_SCALE;
    else if (u.theater === theater && unitPresent(u, frame.t)) fleets.push(i);
  });
  const fighting = fleets.filter((i) => frame.unitCount[i] > 0);
  const p = frame.unitPos;
  for (const i of fleets) {
    let neighbourKm = Infinity;
    for (const j of fighting) {
      if (j !== i) neighbourKm = Math.min(neighbourKm, Math.hypot(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]));
    }
    out[i] = formationScale(radii[i], neighbourKm);
  }
  return out;
}

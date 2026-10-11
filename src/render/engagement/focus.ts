import type { Frame, Replay } from '../../core/replay';
import { fmtCount } from '../../core/units';
import type { Vec3 } from '../../core/vec';

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const MANTISSAS = [1, 2.5, 5];

/** The 1 / 2.5 / 5 × 10ⁿ km spacing closest to the target on a log scale. */
export function niceRingStep(targetKm: number): number {
  if (!Number.isFinite(targetKm) || targetKm <= 0) return 1_000_000;
  const exp = Math.floor(Math.log10(targetKm));
  let best = 10 ** exp;
  let bestErr = Infinity;
  for (const e of [exp - 1, exp, exp + 1]) {
    for (const m of MANTISSAS) {
      const c = m * 10 ** e;
      const err = Math.abs(Math.log(c / targetKm));
      if (err < bestErr) {
        bestErr = err;
        best = c;
      }
    }
  }
  return best;
}

/** Site A's ring label text: "10M km"; below a million kilometres the full figure. */
export function fmtRingKm(km: number): string {
  if (km >= 1_000_000) return `${Number((km / 1_000_000).toFixed(2))}M km`;
  return `${fmtCount(km)} km`;
}

export interface RingLabel { km: number; text: string; pos: Vec3 }

export interface RingPlan {
  /** Unit the rings centre on, or null when no fleet of my side is present. */
  unit: number | null;
  centre: Vec3;
  /** Unit vector in the ring plane (constant z) toward the reference enemy; +x without one. */
  bearing: Vec3;
  enemyKm: number | null;
  /** Minor ring spacing; majors fall on every second ring. */
  step: number;
  /** Disc radius; rings fade out over its outer 40 %. */
  radius: number;
  labels: RingLabel[];
}

/** Most ring labels strung along the bearing; Site A shows seven. */
export const MAX_RING_LABELS = 8;

/**
 * Site A's tactical grid (A report §4.1) generalised from its one geometry. There, a camera 64 Mkm from Home Fleet sees
 * 5 Mkm rings, 10 Mkm majors and a 90 Mkm disc reaching past Second Fleet 65 Mkm away. Here the spacing follows the
 * camera's distance to the ring centre the same way (the nice step nearest 6.6 % of it), so the rings stay readable from
 * a close-up of my fleet out to the whole front, never coarser than three times A's spacing for the enemy's range. The
 * disc reaches 1.25 enemy distances within 18 to 40 rings, and the major labels run along the bearing to the enemy.
 */
export function ringPlan(centre: Vec3, unit: number | null, enemy: Vec3 | null, cameraKm: number): RingPlan {
  let bearing: Vec3 = [1, 0, 0];
  let enemyKm: number | null = null;
  if (enemy) {
    const dx = enemy[0] - centre[0];
    const dy = enemy[1] - centre[1];
    const flat = Math.hypot(dx, dy);
    enemyKm = Math.hypot(dx, dy, enemy[2] - centre[2]);
    if (flat > 1e-6) bearing = [dx / flat, dy / flat, 0];
  }
  const camera = Math.max(1, Number.isFinite(cameraKm) ? cameraKm : 1);
  const hasEnemy = enemyKm !== null && enemyKm > 1;
  const step = niceRingStep(hasEnemy ? Math.min(0.066 * camera, (3 * enemyKm!) / 13) : 0.066 * camera);
  const major = step * 2;
  const reach = hasEnemy ? Math.ceil((1.25 * enemyKm!) / major - 1e-9) * major : 0;
  const radius = Math.min(40 * step, Math.max(18 * step, reach));
  const labels: RingLabel[] = [];
  for (let k = 1; k <= MAX_RING_LABELS && k * major <= 0.8 * radius + 1e-6; k++) {
    const km = k * major;
    labels.push({ km, text: fmtRingKm(km), pos: [centre[0] + bearing[0] * km, centre[1] + bearing[1] * km, centre[2]] });
  }
  return { unit, centre: [...centre], bearing, enemyKm, step, radius, labels };
}

/** Grid visibility by camera distance to the ring centre: A fades in from 0.4 to 4 Mkm and out from 260 to 700 Mkm of a 90 Mkm disc. */
export function gridFade(cameraKm: number, radius: number): number {
  return smoothstep(0.0044 * radius, 0.044 * radius, cameraKm) * (1 - smoothstep(2.9 * radius, 7.8 * radius, cameraKm));
}

/** A shows ring labels from 5 to 260 Mkm of a 90 Mkm disc. */
export const ringLabelsShown = (cameraKm: number, radius: number): boolean => cameraKm >= 0.055 * radius && cameraKm <= 2.9 * radius;

/** Fleet rings and vectors stay on within 400 Mkm of a 90 Mkm disc (A §4.2). */
export const fleetMarksShown = (cameraKm: number, radius: number): boolean => cameraKm < 4.4 * radius;

const unitAt = (frame: Frame, i: number): Vec3 => [frame.unitPos[i * 3], frame.unitPos[i * 3 + 1], frame.unitPos[i * 3 + 2]];
const distTo = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * "My fleet": the unit the free camera follows when it is mine (a LAC group too), else the selected ship's fleet when it
 * is on my side, else my side's fleet nearest the look point. Fleets with
 * ships left come first, then my LAC groups, then my fleets that are still on the plot but have lost every ship, so the
 * rings stay on my side after a wall of battle is destroyed. The look point follows the camera, so the rings move to
 * whichever of my fleets the shot or the user is watching.
 */
export function ringCentreUnit(
  replay: Replay, frame: Frame, theater: string, side: string, look: Vec3, selectedShip: number | null, followed: number | null = null,
): number | null {
  const mine = (i: number): boolean => {
    const u = replay.units[i];
    return !!u && u.side === side && u.theater === theater && u.kind === 'fleet' && frame.unitCount[i] > 0;
  };
  const f = followed === null ? undefined : replay.units[followed];
  if (f && f.side === side && f.theater === theater && frame.unitCount[followed!] > 0) return followed;
  if (selectedShip !== null) {
    const unit = replay.ships[selectedShip]?.unit;
    if (unit !== undefined && mine(unit)) return unit;
  }
  const tiers: Array<(i: number) => boolean> = [
    mine,
    (i) => replay.units[i].side === side && replay.units[i].theater === theater && replay.units[i].kind === 'lac' && frame.unitCount[i] > 0,
    (i) => {
      const u = replay.units[i];
      return u.side === side && u.theater === theater && u.kind === 'fleet' && frame.t >= u.tAppear && frame.t < u.tDepart;
    },
  ];
  for (const ok of tiers) {
    let best: number | null = null;
    let bestKm = Infinity;
    for (let i = 0; i < replay.units.length; i++) {
      if (!ok(i)) continue;
      const km = distTo(unitAt(frame, i), look);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/** The present enemy fleet nearest the point; LAC groups only when no enemy fleet is present. */
export function nearestEnemyUnit(replay: Replay, frame: Frame, theater: string, side: string, from: Vec3): number | null {
  for (const kind of ['fleet', 'lac'] as const) {
    let best: number | null = null;
    let bestKm = Infinity;
    replay.units.forEach((u, i) => {
      if (u.side === side || u.theater !== theater || u.kind !== kind || frame.unitCount[i] === 0) return;
      const km = distTo(unitAt(frame, i), from);
      if (km < bestKm) {
        bestKm = km;
        best = i;
      }
    });
    if (best !== null) return best;
  }
  return null;
}

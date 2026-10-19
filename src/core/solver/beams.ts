import { needBase } from '../evidence';
import { rngFor, type Rng } from '../rng';
import type { BeamAttackEvent } from '../schema';
import { fmtDistance } from '../units';
import { add, dist, norm, sub, type Vec3 } from '../vec';
import { applyHit } from './damage';
import type { CombatContext } from './defense';
import { ASPECT_FACTOR, classifyAspect, endwallFactor } from './geometry';
import { alive, shipPos, unitBasis, unitPos, type ShipRuntime } from './runtime';

/** Abstract damage of one hitting shot by weapon. S constants: a graser shot is the LAC calibration, a grav lance shot
 * collapses a sidewall rather than wrecking the hull, and an energy torpedo is a heavy short-range plasma bolt. */
const DAMAGE: Record<BeamAttackEvent['weapon'], number> = {
  graser: 6, laser: 6, 'lac-mixed': 6, 'grav-lance': 4, 'energy-torpedo': 8,
};
const KIND: Record<BeamAttackEvent['weapon'], 'graser' | 'laser' | 'lance' | 'torpedo'> = {
  graser: 'graser', laser: 'laser', 'lac-mixed': 'graser', 'grav-lance': 'lance', 'energy-torpedo': 'torpedo',
};
const WEAPON_TEXT: Record<BeamAttackEvent['weapon'], string> = {
  graser: 'grasers', laser: 'lasers', 'lac-mixed': 'LAC weapons', 'grav-lance': 'the grav lance', 'energy-torpedo': 'energy torpedoes',
};
/** Drawn shots per attack, spread evenly from its start to its end. */
const VISUAL_SHOTS = 400;

const jitter = (rng: Rng, r: number): Vec3 => [(rng() - 0.5) * r, (rng() - 0.5) * r, (rng() - 0.5) * r];

function dims(s: ShipRuntime) {
  return {
    bandOffset: needBase(s.cls.wedge.band_offset, 'wedge.band_offset'),
    bandLength: needBase(s.cls.wedge.band_length, 'wedge.band_length'),
    bandWidth: needBase(s.cls.wedge.band_width, 'wedge.band_width'),
  };
}

/** Energy weapons resolve as instantaneous rays (MTS §4.4); energy torpedoes are drawn the same way at these short ranges. */
export function resolveBeamAttacks(list: Array<{ ev: BeamAttackEvent; t0: number; t1: number }>, ctx: CombatContext): void {
  for (const { ev, t0, t1 } of list) {
    const from = ctx.units.find((u) => u.id === ev.from);
    const to = ctx.units.find((u) => u.id === ev.to);
    if (!from || !to) continue;
    const rng = rngFor('beam', ev.id, ev.seed);
    const kind = KIND[ev.weapon];
    const stride = Math.max(1, Math.ceil(ev.shots / VISUAL_SHOTS));
    const tags = { side: from.side, unit: from.idx, toUnit: to.idx };
    for (let k = 0; k < ev.shots; k++) {
      const t = t0 + ((t1 - t0) * (k + 0.5)) / ev.shots;
      const visual = k % stride === 0;
      const origin = add(unitPos(from, t), jitter(rng, from.ships.length > 1 || from.kind === 'lac' ? 20_000 : 0));
      if (to.kind === 'fleet') {
        const ds = to.ships.map((i) => ctx.ships[i]).filter((s) => alive(s, t));
        if (!ds.length) break;
        const ship = ds[Math.floor(rng() * ds.length)];
        const target = shipPos(ctx.units, ship, t);
        const incoming = norm(sub(target, origin));
        const aspect = classifyAspect(unitBasis(to, t), incoming, dims(ship));
        const endwall = aspect === 'throat' ? endwallFactor(ship.cls.bow_wall) : aspect === 'kilt' ? endwallFactor(ship.cls.stern_wall) : 1;
        applyHit(ship, t, DAMAGE[ev.weapon] * ASPECT_FACTOR[aspect] * endwall, aspect, rng);
        if (visual) ctx.beams.push({ t, dur: 0.5, kind, from: origin, to: target, aspect, ship: ship.idx, ...tags });
      } else if (visual) {
        ctx.beams.push({ t, dur: 0.4, kind, from: origin, to: add(unitPos(to, t), jitter(rng, 20_000)), aspect: null, ship: -1, ...tags });
      }
    }
    const weapon = WEAPON_TEXT[ev.weapon];
    ctx.log.push({
      t: t0, side: from.side, kind: 'beam',
      text: `${from.name} engages ${to.name} with ${weapon} at ${fmtDistance(dist(unitPos(from, t0), unitPos(to, t0)))}`,
      evidence: ev.evidence, source_id: ev.source_id, ref: ev.id,
    });
  }
}

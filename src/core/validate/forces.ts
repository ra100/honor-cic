import type { FirePlanEvent, ScenarioPack, ShipEntry, UnitDef } from '../schema';
import { capOf, type ShipClass, type TechRegistry } from '../tech';

export interface ShipGroup { cls: ShipClass; count: number; entry: ShipEntry | null }

export function shipsOf(u: UnitDef, tech: TechRegistry): ShipGroup[] {
  if (u.kind === 'fleet') {
    return u.ships.flatMap((s) => {
      const cls = tech.classes[s.class_id];
      return cls ? [{ cls, count: s.count, entry: s }] : [];
    });
  }
  return Object.entries(u.classes).flatMap(([id, count]) => {
    const cls = tech.classes[id];
    return cls ? [{ cls, count, entry: null }] : [];
  });
}

function sumKnown(parts: Array<number | null>): number | null {
  return parts.some((p) => p === null) ? null : parts.reduce<number>((a, b) => a + (b as number), 0);
}

/** Attack tubes that bear on one target: one broadside plus the bow (MTS §5.1). */
export const launcherTubes = (u: UnitDef, tech: TechRegistry): number | null =>
  sumKnown(shipsOf(u, tech).map(({ cls, count, entry }) => {
    const b = capOf(cls, entry, 'broadside.missile').value;
    const f = capOf(cls, entry, 'fore.missile').value;
    return b === null || f === null ? null : count * (b + f);
  }));

/** Pods per second the unit can eject from internal rails. */
export const ejectRate = (u: UnitDef, tech: TechRegistry): number | null =>
  sumKnown(shipsOf(u, tech)
    .filter(({ cls }) => (cls.pod_capacity.value ?? 1) > 0)
    .map(({ cls, count, entry }) => {
      const n = capOf(cls, entry, 'pod_eject_count').value;
      const c = capOf(cls, entry, 'pod_eject_cycle').value;
      return n === null || c === null || c === 0 ? null : (count * n) / c;
    }));

export const podCapacity = (u: UnitDef, tech: TechRegistry): number | null =>
  sumKnown(shipsOf(u, tech).map(({ cls, count, entry }) => {
    const p = capOf(cls, entry, 'pod_capacity').value;
    return p === null ? null : count * p;
  }));

export const magazineTotal = (u: UnitDef, tech: TechRegistry): number | null =>
  sumKnown(shipsOf(u, tech).map(({ cls, count, entry }) => {
    const m = capOf(cls, entry, 'magazine').value;
    return m === null ? null : count * m;
  }));

export const firePlans = (pack: ScenarioPack): FirePlanEvent[] =>
  pack.events.filter((e): e is FirePlanEvent => e.type === 'fire_plan');

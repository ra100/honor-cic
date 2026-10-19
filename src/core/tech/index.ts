import type { ShipEntry } from '../schema';
import { CLASSES } from './classes';
import { EQUIPMENT, MISSILES, POD_LOADS } from './missiles';
import type { MountKey, PodLoad, ShipClass, SV, TechRegistry } from './types';

export * from './types';

export const TECH: TechRegistry = {
  classes: CLASSES,
  missiles: MISSILES,
  podLoads: POD_LOADS,
  equipment: EQUIPMENT,
  eras: {
    'pre-war-1900': { label: 'Pre-war single-drive missiles, about 1900 PD', year_from: 1895, year_to: 1905 },
    'early-apollo-1921': { label: 'Early Apollo, 1921 PD', year_from: 1921, year_to: 1921 },
  },
};

const isSV = (x: unknown): x is SV =>
  typeof x === 'object' && x !== null && 'evidence' in x && 'source_id' in x && 'unit' in x;

/** Class value at a dotted path, replaced by the ship entry's override when present (provenance kept). */
export function capOf(cls: ShipClass, entry: Pick<ShipEntry, 'overrides'> | null, path: string): SV {
  const override = entry?.overrides[path];
  if (override) return override;
  const v = path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], cls);
  if (!isSV(v)) throw new Error(`Unknown capability path "${path}" on class ${cls.id}`);
  return v;
}

/** Two broadsides plus both ends (MTS §5.1); null when any part is unknown. */
export function wholeShipTotal(cls: ShipClass, mount: MountKey): number | null {
  const parts = [cls.broadside[mount], cls.broadside[mount], cls.fore[mount], cls.aft[mount]];
  if (parts.some((p) => p.value === null)) return null;
  return parts.reduce((s, p) => s + (p.value as number), 0);
}

export function podArithmetic(pods: number, load: PodLoad): { attackEw: number; controllers: number; totalVehicles: number } {
  const attackEw = pods * load.attack_ew;
  const controllers = pods * load.controller;
  return { attackEw, controllers, totalVehicles: attackEw + controllers };
}

/** Equipment comes only from the ship entry, never from the class (MTS §5.2, Appendix B). */
export function shipEquipment(_cls: ShipClass, entry: Pick<ShipEntry, 'equipment'>): string[] {
  return [...entry.equipment];
}

export function allSourceValues(obj: unknown, path = ''): Array<{ path: string; v: SV }> {
  if (isSV(obj)) return [{ path, v: obj }];
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => allSourceValues(v, path ? `${path}.${k}` : k));
}

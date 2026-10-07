import { sv } from '../evidence';
import type { Unit } from '../units';
import type { Mounts, MountKey, SV } from './types';

/** W value quoted by the MTS (which cites the wiki), with the MTS section as locator. */
export const MTS = (value: number | null, unit: Unit, locator: string, uncertainty?: string): SV =>
  sv(value, unit, 'W', 'mts', uncertainty ? { locator, uncertainty } : { locator });

/** P value quoted by the MTS from a novel or the author. */
export const AUTHOR = (value: number, unit: Unit, locator: string): SV => sv(value, unit, 'P', 'mts', { locator });

/** D value computed from sourced inputs; `how` states the calculation. */
export const DER = (value: number, unit: Unit, how: string): SV => sv(value, unit, 'D', 'mts', { uncertainty: how });

/** S value: project reconstruction. `why` is mandatory and shown in the inspector. */
export const REC = (value: number | null, unit: Unit, why: string): SV =>
  sv(value, unit, 'S', 'honor-cic', { uncertainty: why, status: 'unverified' });

const KEYS: MountKey[] = ['missile', 'graser', 'laser', 'energy_torpedo', 'cm', 'pd', 'pod_lanes'];

/** Mounts quoted from one MTS table; keys absent from the table are 0 because the table lists the full fit. */
export function mtsMounts(locator: string, m: Partial<Record<MountKey, number>>): Mounts {
  return Object.fromEntries(
    KEYS.map((k) => [k, k in m ? MTS(m[k] as number, 'count', locator) : MTS(0, 'count', locator, 'not listed in the table')]),
  ) as Mounts;
}

/** Mounts with no published table; every value is a labelled reconstruction. */
export function recMounts(why: string, m: Partial<Record<MountKey, number>>): Mounts {
  return Object.fromEntries(KEYS.map((k) => [k, REC(m[k] ?? 0, 'count', why)])) as Mounts;
}

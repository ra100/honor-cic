import type { EvidenceLabel } from '../evidence';
import type { ShipEntry } from '../schema';
import type { Role, ShipClass } from '../tech';
import { add, type Vec3 } from '../vec';
import { toSystem, type Basis } from './formation';
import { orientationAt, type Roll } from './geometry';
import { segmentState } from './kinematics';
import type { Aspect, KinSegment, Subsystem } from './types';

export interface UnitRuntime {
  id: string;
  idx: number;
  name: string;
  kind: 'fleet' | 'lac';
  side: string;
  theater: string;
  segments: KinSegment[];
  facing: Vec3;
  up: Vec3;
  rolls: Roll[];
  tAppear: number;
  tDepart: number;
  ships: number[];
  lacClasses: Record<string, number>;
  lacCount: Array<{ t: number; count: number }>;
}

export interface Hit { t: number; dmg: number; aspect: Aspect; sub: Subsystem }

export interface ShipRuntime {
  idx: number;
  unit: number;
  side: string;
  classId: string;
  cls: ShipClass;
  entry: ShipEntry | null;
  role: Role;
  /** Formation slot in the unit frame [forward, starboard, up], km. */
  slot: Vec3;
  name: string;
  nameEvidence: EvidenceLabel;
  flagship: boolean;
  equipment: string[];
  readiness: 'powered-down' | 'routine' | 'standby' | 'ready';
  damage: number;
  hits: Hit[];
  subs: Record<Subsystem, number>;
  escapedAt: number;
  /** Provisional mechanistic destruction time; Infinity while the ship survives. */
  goneAt: number;
  /** Status steps written by reconciliation; empty means "use the mechanistic result". */
  steps: Array<{ t: number; status: number; cause: string }>;
  /** Adjustments written by reconciliation so subsystem pips agree with canon statuses. */
  marks: { ringLost: { t: number; sub: 'drive_fore' | 'drive_aft' } | null; forcedDegradeAt: number | null; cleared: Array<[number, number]> };
}

export interface BeamEvent {
  t: number;
  dur: number;
  kind: 'laserhead' | 'graser' | 'laser' | 'cm-kill' | 'pd-kill' | 'transit';
  from: Vec3;
  to: Vec3;
  side: string;
  aspect: Aspect | null;
  ship: number;
  /** Firing unit, when one fired it. */
  unit?: number;
  /** Unit the beam or kill happens at. */
  toUnit?: number;
}

export interface LogEntry {
  t: number;
  side: string | null;
  kind: string;
  text: string;
  evidence: EvidenceLabel;
  source_id: string;
  ref?: string;
}

export const unitPos = (u: UnitRuntime, t: number): Vec3 => segmentState(u.segments, t).p;
export const unitVel = (u: UnitRuntime, t: number): Vec3 => segmentState(u.segments, t).v;
export const unitBasis = (u: UnitRuntime, t: number): Basis => orientationAt(u.facing, u.up, u.rolls, t);

export function shipPos(units: UnitRuntime[], s: ShipRuntime, t: number): Vec3 {
  const u = units[s.unit];
  return add(unitPos(u, t), toSystem(unitBasis(u, t), s.slot));
}

export const present = (u: UnitRuntime, t: number): boolean => t >= u.tAppear && t < u.tDepart;
export const alive = (s: ShipRuntime, t: number): boolean => s.escapedAt > t && s.goneAt > t;

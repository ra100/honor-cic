import type { Vec3 } from '../vec';

export interface KinSegment { t0: number; t1: number; p0: Vec3; v0: Vec3; a: Vec3 }

export enum DrivePhase { Boost = 0, Coast = 1, Terminal = 2, Gone = 3 }

export enum ShipStatus { Operational = 0, Degraded = 1, MissionKill = 2, Destroyed = 3, Escaped = 4, Captured = 5, Absent = 6 }

export const STATUS_TEXT: Record<ShipStatus, string> = {
  [ShipStatus.Operational]: 'operational', [ShipStatus.Degraded]: 'degraded', [ShipStatus.MissionKill]: 'mission kill',
  [ShipStatus.Destroyed]: 'destroyed', [ShipStatus.Escaped]: 'escaped', [ShipStatus.Captured]: 'captured', [ShipStatus.Absent]: 'not present',
};

/** Subsystem damage states (MTS §5.8, §9.1). */
export type Subsystem =
  | 'drive_fore' | 'drive_aft' | 'wall_port' | 'wall_stbd' | 'launchers' | 'energy' | 'defense' | 'sensors' | 'hull';
export const SUBSYSTEMS: Subsystem[] = [
  'drive_fore', 'drive_aft', 'wall_port', 'wall_stbd', 'launchers', 'energy', 'defense', 'sensors', 'hull',
];
export const SUBSYSTEM_TEXT: Record<Subsystem, string> = {
  drive_fore: 'Forward impeller ring', drive_aft: 'Aft impeller ring', wall_port: 'Port sidewall', wall_stbd: 'Starboard sidewall',
  launchers: 'Launchers', energy: 'Energy mounts', defense: 'Point defense', sensors: 'Sensors', hull: 'Hull',
};

export interface Counts { attack: number; ew: number; controller: number }

export type Aspect = 'wedge' | 'sidewall' | 'throat' | 'kilt';

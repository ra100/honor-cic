import { hashSeed } from './rng';
import { orientationAt, type Roll } from './solver/geometry';
import { toSystem } from './solver/formation';
import { segmentState } from './solver/kinematics';
import type { PacketTrack } from './solver/packets';
import type { BeamEvent, LogEntry } from './solver/runtime';
import { DrivePhase, ShipStatus, SUBSYSTEMS, type Counts, type KinSegment, type Subsystem } from './solver/types';
import type { Role } from './tech';
import type { Issue } from './validate/types';
import type { Vec3 } from './vec';

export * from './solver/types';
export type { BeamEvent, LogEntry, PacketTrack };

export interface UnitTrack {
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
  /** Formation spacing from the pack, km. */
  spacing: number;
  tAppear: number;
  tDepart: number;
  appearVia: string | null;
  departVia: string | null;
  shipIdx: number[];
  lacClasses: Record<string, number>;
  /** LACs in the group from each time on; `cause` says how the step's losses went. */
  lacCount: Array<{ t: number; count: number; cause?: 'destroyed' | 'captured' }>;
}

export interface ShipTrack {
  idx: number;
  unit: number;
  classId: string;
  name: string;
  nameEvidence: 'P' | 'W' | 'D' | 'S';
  side: string;
  role: Role;
  slot: Vec3;
  flagship: boolean;
  equipment: string[];
  readiness: 'powered-down' | 'routine' | 'standby' | 'ready';
  status: Array<{ t: number; status: ShipStatus; cause: string }>;
  subsystems: Array<{ t: number; sub: Subsystem; value: number }>;
  damageTaken: number;
  hitCount: number;
}

export interface ReplayStats {
  launched: Record<string, Counts & { pods: number }>;
  intercept: Record<string, { arriving: number; intercepted: number }>;
  finalStatus: Record<string, Partial<Record<ShipStatus, number>>>;
}

export interface Replay {
  scenarioId: string;
  duration_s: number;
  sides: Array<{ id: string; name: string; color: string }>;
  units: UnitTrack[];
  ships: ShipTrack[];
  packets: PacketTrack[];
  beams: BeamEvent[];
  log: LogEntry[];
  stats: ReplayStats;
  diagnostics: Issue[];
  resolvedTimes: Record<string, number>;
  hash: string;
}

export const clampT = (r: Replay, t: number): number => Math.min(Math.max(t, 0), r.duration_s);
export const unitPosition = (u: UnitTrack, t: number, out?: Vec3): Vec3 => segmentState(u.segments, t, out).p;
export const unitVelocity = (u: UnitTrack, t: number): Vec3 => segmentState(u.segments, t).v;
export const unitPresent = (u: UnitTrack, t: number): boolean => t >= u.tAppear && t < u.tDepart;

function lastAtOrBefore<T extends { t: number }>(steps: T[], t: number): T | null {
  let lo = 0;
  let hi = steps.length - 1;
  let found: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].t <= t) {
      found = steps[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function shipStatusAt(r: Replay, s: ShipTrack, t: number): ShipStatus {
  if (!unitPresent(r.units[s.unit], t)) return ShipStatus.Absent;
  return lastAtOrBefore(s.status, t)?.status ?? ShipStatus.Operational;
}

export function subsystemsAt(s: ShipTrack, t: number): Record<Subsystem, number> {
  const out = Object.fromEntries(SUBSYSTEMS.map((k) => [k, 1])) as Record<Subsystem, number>;
  for (const step of s.subsystems) {
    if (step.t > t) break;
    out[step.sub] = step.value;
  }
  return out;
}

const TERMINAL = new Set([ShipStatus.Destroyed, ShipStatus.Escaped]);

/** Hull position; wrecks drift on at the velocity they had when destroyed. */
export function shipPositionAt(r: Replay, s: ShipTrack, t: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const u = r.units[s.unit];
  const end = s.status.find((x) => TERMINAL.has(x.status) && x.t <= t);
  const tt = end ? end.t : t;
  const base = segmentState(u.segments, tt);
  const off = toSystem(orientationAt(u.facing, u.up, u.rolls, tt), s.slot);
  const drift = end && end.status === ShipStatus.Destroyed ? t - end.t : 0;
  for (let i = 0; i < 3; i++) out[i] = base.p[i] + off[i] + base.v[i] * drift;
  return out;
}

export function packetPositionAt(p: PacketTrack, t: number, out?: Vec3): Vec3 {
  return segmentState(p.segments, Math.min(Math.max(t, p.tLaunch), p.tArrive), out).p;
}

export function packetAliveAt(p: PacketTrack, t: number): Counts {
  if (t < p.tLaunch) return { attack: 0, ew: 0, controller: 0 };
  const s = lastAtOrBefore(p.survivors, t);
  return s ? { attack: s.attack, ew: s.ew, controller: s.controller } : { attack: 0, ew: 0, controller: 0 };
}

export function packetPhaseAt(p: PacketTrack, t: number): DrivePhase {
  if (t < p.tLaunch || t >= p.tArrive) return DrivePhase.Gone;
  let phase = DrivePhase.Boost;
  for (const ph of p.phases) if (ph.t0 <= t) phase = ph.phase;
  return phase;
}

export const lacCountAt = (u: UnitTrack, t: number): number => lastAtOrBefore(u.lacCount, t)?.count ?? 0;

export interface Frame {
  t: number;
  shipPos: Float64Array;
  shipStatus: Uint8Array;
  unitPos: Float64Array;
  unitCount: Uint32Array;
  packetPos: Float64Array;
  packetAlive: Uint32Array;
  packetPhase: Uint8Array;
}

export function createFrame(r: Replay): Frame {
  return {
    t: 0,
    shipPos: new Float64Array(r.ships.length * 3),
    shipStatus: new Uint8Array(r.ships.length),
    unitPos: new Float64Array(r.units.length * 3),
    unitCount: new Uint32Array(r.units.length),
    packetPos: new Float64Array(r.packets.length * 3),
    packetAlive: new Uint32Array(r.packets.length),
    packetPhase: new Uint8Array(r.packets.length),
  };
}

const ALIVE_STATUSES = new Set([ShipStatus.Operational, ShipStatus.Degraded, ShipStatus.MissionKill, ShipStatus.Captured]);

/** Pure function of (replay, t): the same t always gives the same frame. */
export function sampleFrame(r: Replay, tIn: number, f: Frame = createFrame(r)): Frame {
  const t = clampT(r, tIn);
  f.t = t;
  const tmp: Vec3 = [0, 0, 0];
  const counts = new Uint32Array(r.units.length);
  r.ships.forEach((s, i) => {
    const st = shipStatusAt(r, s, t);
    f.shipStatus[i] = st;
    shipPositionAt(r, s, t, tmp);
    f.shipPos.set(tmp, i * 3);
    if (ALIVE_STATUSES.has(st)) counts[s.unit]++;
  });
  r.units.forEach((u, i) => {
    unitPosition(u, t, tmp);
    f.unitPos.set(tmp, i * 3);
    f.unitCount[i] = !unitPresent(u, t) ? 0 : u.kind === 'lac' ? lacCountAt(u, t) : counts[i];
  });
  r.packets.forEach((p, i) => {
    packetPositionAt(p, t, tmp);
    f.packetPos.set(tmp, i * 3);
    const a = packetAliveAt(p, t);
    f.packetPhase[i] = packetPhaseAt(p, t);
    f.packetAlive[i] = f.packetPhase[i] === DrivePhase.Gone ? 0 : a.attack + a.ew;
  });
  return f;
}

function firstAfter(log: LogEntry[], t: number): number {
  let lo = 0;
  let hi = log.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (log[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Entries with t0 < e.t ≤ t1. Consecutive calls cover every entry exactly once (Review Focus 3). */
export function logBetween(r: Replay, t0: number, t1: number): LogEntry[] {
  if (t1 <= t0) return [];
  return r.log.slice(firstAfter(r.log, t0), firstAfter(r.log, t1));
}

export const logUntil = (r: Replay, t: number): LogEntry[] => r.log.slice(0, firstAfter(r.log, t));

/** Deterministic digest of the solved outcome; equal packs give equal hashes. */
export function computeHash(r: Omit<Replay, 'hash'>): string {
  const parts: Array<string | number> = [r.scenarioId, r.packets.length, r.beams.length, r.log.length];
  for (const s of r.ships) for (const st of s.status) parts.push(s.idx, st.status, Math.round(st.t * 1000));
  for (const p of r.packets) {
    const last = p.survivors[p.survivors.length - 2] ?? p.survivors[0];
    parts.push(Math.round(p.tArrive * 1000), last.attack);
  }
  return hashSeed(...parts).toString(16).padStart(8, '0');
}

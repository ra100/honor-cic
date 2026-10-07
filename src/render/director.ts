import type { Frame, Replay } from '../core/replay';
import type { ScenarioPack } from '../core/schema';
import type { Vec3 } from '../core/vec';

export interface DirectorShot {
  id: string;
  label: string;
  desc: string;
  t0: number;
  t1: number;
  theater: string;
  scale: 'system' | 'engagement';
  subject: string[];
  distanceKm: number;
  elevDeg: number;
  azimDeg: number;
  orbitDegPerMin: number;
}

export interface DirectorPose { shotId: string; scale: 'system' | 'engagement'; theater: string; eye: Vec3; target: Vec3 }

export function shotsFor(pack: ScenarioPack, replay: Replay): DirectorShot[] {
  const shots = pack.meta.shots
    .map((s) => ({
      id: s.id, label: s.label, desc: s.desc, t0: replay.resolvedTimes[`shot:${s.id}`] ?? 0, t1: replay.duration_s,
      theater: s.theater, scale: s.scale, subject: s.subject, distanceKm: s.distance_km,
      elevDeg: s.elev_deg, azimDeg: s.azim_deg, orbitDegPerMin: s.orbit_deg_per_min,
    }))
    .sort((a, b) => a.t0 - b.t0);
  shots.forEach((s, i) => {
    if (i + 1 < shots.length) s.t1 = shots[i + 1].t0;
  });
  return shots;
}

/** In the perceived picture the camera follows the observer's own fleet; with no observer it holds (null), so framing never reveals where an enemy really is. */
export function perceivedSubject(shot: DirectorShot, observerId: string | null, perceived: boolean): DirectorShot | null {
  if (!perceived) return shot;
  return observerId ? { ...shot, subject: [observerId] } : null;
}

/** The shot running at t; before the first shot starts, the first shot. */
export function shotAt(shots: DirectorShot[], t: number): DirectorShot | null {
  let found: DirectorShot | null = shots[0] ?? null;
  for (const s of shots) if (s.t0 <= t) found = s;
  return found;
}

/** Centre of the present units with these ids, at the frame time. */
export function subjectCentroid(replay: Replay, frame: Frame, ids: string[]): Vec3 | null {
  const set = new Set(ids);
  return centroid(replay, frame, (i) => set.has(replay.units[i].id));
}

/**
 * What the free camera follows: the selected ship's unit, else the current shot's subjects.
 * In the perceived picture only the commander's own side, so following never reveals a true enemy position.
 */
export function followSubjects(replay: Replay, shots: DirectorShot[], t: number, selectedShip: number | null, perceivedSide: string | null): string[] {
  const sel = selectedShip !== null ? replay.ships[selectedShip] : undefined;
  let ids = sel ? [replay.units[sel.unit].id] : shotAt(shots, t)?.subject ?? [];
  if (perceivedSide !== null) {
    ids = ids.filter((id) => replay.units.find((u) => u.id === id)?.side === perceivedSide);
    if (ids.length === 0) {
      const own = replay.units.find((u) => u.side === perceivedSide && u.kind === 'fleet' && t >= u.tAppear && t < u.tDepart);
      ids = own ? [own.id] : [];
    }
  }
  return ids;
}

function centroid(replay: Replay, frame: Frame, pick: (i: number) => boolean): Vec3 | null {
  const c: Vec3 = [0, 0, 0];
  let n = 0;
  replay.units.forEach((_, i) => {
    if (!pick(i) || frame.unitCount[i] === 0) return;
    for (let k = 0; k < 3; k++) c[k] += frame.unitPos[i * 3 + k];
    n++;
  });
  return n ? [c[0] / n, c[1] / n, c[2] / n] : null;
}

export function directorPose(shot: DirectorShot, replay: Replay, frame: Frame, reducedMotion: boolean): DirectorPose {
  const subject = new Set(shot.subject);
  const target =
    centroid(replay, frame, (i) => subject.has(replay.units[i].id)) ??
    centroid(replay, frame, (i) => replay.units[i].theater === shot.theater) ??
    [0, 0, 0];
  const orbit = reducedMotion ? 0 : (shot.orbitDegPerMin * (frame.t - shot.t0)) / 60;
  const az = ((shot.azimDeg + orbit) * Math.PI) / 180;
  const el = (shot.elevDeg * Math.PI) / 180;
  const d = shot.distanceKm;
  const eye: Vec3 = [target[0] + d * Math.cos(el) * Math.cos(az), target[1] + d * Math.cos(el) * Math.sin(az), target[2] + d * Math.sin(el)];
  return { shotId: shot.id, scale: shot.scale, theater: shot.theater, eye, target };
}

/** Eases the camera toward the director pose; a snap is a cut. */
export class CameraRig {
  eye: Vec3 = [0, 0, 0];
  target: Vec3 = [0, 0, 0];
  private started = false;

  follow(pose: DirectorPose, dtWallS: number, snap: boolean): void {
    if (snap || !this.started) {
      this.eye = [...pose.eye];
      this.target = [...pose.target];
      this.started = true;
      return;
    }
    // Exponential approach with a 0.25 s half-life of wall time.
    const k = 1 - Math.pow(0.5, dtWallS / 0.25);
    for (let i = 0; i < 3; i++) {
      this.eye[i] += (pose.eye[i] - this.eye[i]) * k;
      this.target[i] += (pose.target[i] - this.target[i]) * k;
    }
  }
}

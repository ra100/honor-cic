import { ShipStatus, unitPosition, type Frame, type Replay } from '../core/replay';
import type { ScenarioPack, TimeRef } from '../core/schema';
import { bodyPosition, indexBodies } from '../core/solver/orbits';
import { dist, type Vec3 } from '../core/vec';
import { packetSpreadKm } from './density';
import { beamTheatersFor } from './salvos';

export type ShotKind = 'establish' | 'launch' | 'flight' | 'encounter' | 'impact' | 'aftermath';
export interface SpeedWindow { t0: number; t1: number; rate: number }
interface ShotFocus { packets?: number[]; beams?: number[]; planId?: string; eventId?: string }

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
  kind?: ShotKind;
  focus?: ShotFocus;
  bodyTarget?: Vec3;
  observerOnly?: boolean;
  speedWindows?: SpeedWindow[];
}

export interface DirectorPose { shotId: string; scale: 'system' | 'engagement'; theater: string; eye: Vec3; target: Vec3; cut?: boolean }

export function resolvedTime(ref: TimeRef, replay: Replay): number {
  if (typeof ref === 'number') return ref;
  const key = ref.anchor === 'arrival' ? `arrival:${ref.ref}` : ref.anchor === 'last_arrival' ? `last_arrival:${ref.ref}` : ref.ref;
  return (replay.resolvedTimes[key] ?? 0) + ref.offset_s;
}

function mergeWindows(windows: SpeedWindow[]): SpeedWindow[] {
  const out: SpeedWindow[] = [];
  for (const rate of [0.25, 0.5, 1, 4]) {
    const sorted = windows.filter((w) => w.rate === rate && w.t1 > w.t0).sort((a, b) => a.t0 - b.t0);
    let current: SpeedWindow | null = null;
    for (const window of sorted) {
      if (current && window.t0 <= current.t1) current.t1 = Math.max(current.t1, window.t1);
      else { current = { ...window }; out.push(current); }
    }
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

export function shotsFor(pack: ScenarioPack, replay: Replay): DirectorShot[] {
  const bodies = indexBodies(pack.bodies);
  const plans = new Map<string, number[]>();
  replay.packets.forEach((p, i) => {
    const group = plans.get(p.planId) ?? [];
    group.push(i);
    plans.set(p.planId, group);
  });
  const beamAttacks = pack.events.filter((e) => e.type === 'beam_attack');
  const beamIndices = (ids: string[], t0: number, t1: number) => replay.beams.flatMap((b, i) => {
    const target = replay.ships[b.ship];
    return b.t >= t0 && b.t <= t1 && (b.kind === 'graser' || b.kind === 'laser' || b.kind === 'laserhead')
      && ((target && ids.includes(replay.units[target.unit].id)) || ids.some((id) => {
        const unit = replay.units.find((u) => u.id === id && u.side === b.side);
        return !!unit && dist(unitPosition(unit, b.t), b.from) <= 20_000;
      })) ? [i] : [];
  });
  const shots: DirectorShot[] = pack.meta.shots.map((s) => {
    const start = s.t0;
    const ref = typeof start === 'number' ? undefined : pack.events.find((e) => e.id === start.ref);
    const packets = ref?.type === 'fire_plan' ? plans.get(ref.id) ?? [] : [];
    const arrival = typeof s.t0 !== 'number' && (s.t0.anchor === 'arrival' || s.t0.anchor === 'last_arrival');
    const kind: ShotKind = s.scale === 'system' ? 'establish' : ref?.type === 'surrender' || ref?.type === 'outcome' ? 'aftermath' : packets.length ? arrival ? 'impact' : 'launch' : 'establish';
    const shot: DirectorShot = {
      id: s.id, label: s.label, desc: s.desc, t0: replay.resolvedTimes[`shot:${s.id}`] ?? 0, t1: replay.duration_s,
      theater: s.theater, scale: s.scale, subject: [...s.subject], distanceKm: s.distance_km,
      elevDeg: s.elev_deg, azimDeg: s.azim_deg, orbitDegPerMin: s.orbit_deg_per_min,
      kind, focus: packets.length ? { packets, planId: ref?.id } : undefined,
    };
    const lacSubjects = shot.subject.filter((id) => replay.units.find((u) => u.id === id)?.kind === 'lac');
    const encounter = beamAttacks.filter((e) => lacSubjects.includes(e.from) || lacSubjects.includes(e.to)).sort((a, b) => resolvedTime(a.t, replay) - resolvedTime(b.t, replay))[0];
    if (encounter && s.scale === 'engagement') {
      shot.t0 = Math.max(0, resolvedTime(encounter.t, replay) - 3);
      shot.subject = [encounter.from, encounter.to];
      shot.kind = 'encounter';
      shot.desc = 'The solved LAC encounter, followed by the close-range pass. Camera placement is schematic [S]; replay timing is unchanged.';
      shot.focus = { eventId: encounter.id, beams: beamIndices(shot.subject, resolvedTime(encounter.t, replay), resolvedTime(encounter.until, replay)) };
    } else if (packets.length) {
      const first = replay.packets[packets[0]];
      if (kind === 'launch') shot.subject = [replay.units[first.fromUnit].id];
      if (kind === 'impact') shot.subject = [replay.units[first.toUnit].id];
    }
    if (shot.subject.every((id) => bodies.has(id))) {
      shot.bodyTarget = bodyPosition(bodies, shot.subject[0], shot.t0);
    }
    return shot;
  });
  if (!shots.length) shots.push({
    id: 'establish', label: 'The theater', desc: 'Scenario geometry, schematic camera [S].',
    t0: 0, t1: replay.duration_s, theater: pack.meta.theaters[0].id, scale: 'engagement',
    subject: replay.units.filter((u) => u.theater === pack.meta.theaters[0].id).map((u) => u.id),
    distanceKm: 25_000_000, elevDeg: 25, azimDeg: 30, orbitDegPerMin: 2, kind: 'establish',
  });
  const authoredIds = new Set(shots.map((s) => s.id));
  const addShot = (shot: DirectorShot): void => {
    if (shot.t0 < 0 || shot.t0 >= replay.duration_s || shots.some((s) => Math.abs(s.t0 - shot.t0) < 0.5)) return;
    if (shot.kind !== 'encounter' && shots.some((s) => {
      const encounter = beamAttacks.find((e) => e.id === s.focus?.eventId);
      return encounter && shot.t0 >= s.t0 && shot.t0 < resolvedTime(encounter.until, replay) + 0.5;
    })) return;
    shots.push(shot);
  };
  const eventShot = (id: string, kind: ShotKind, t0: number, subject: string[], theater: string, focus: ShotFocus, label: string): DirectorShot => ({
    id, kind, t0, t1: replay.duration_s, subject, theater, scale: 'engagement', focus, label,
    desc: kind === 'flight'
      ? 'Packet-focused composition with the nearest present launcher or target as context [S]. Solved positions, routes, counts and timing are unchanged.'
      : 'Camera composition [S], sampled from the solved replay; physical positions, counts and timing are unchanged.',
    distanceKm: 100_000, elevDeg: kind === 'aftermath' ? 32 : kind === 'flight' ? 12 : 18,
    azimDeg: kind === 'launch' ? -60 : kind === 'flight' ? 75 : kind === 'encounter' ? 40 : 120,
    orbitDegPerMin: kind === 'aftermath' ? 0 : kind === 'flight' ? 1.5 : 0.8,
  });
  for (const event of beamAttacks) {
    const t0 = resolvedTime(event.t, replay), t1 = resolvedTime(event.until, replay);
    const subject = [event.from, event.to];
    const theater = replay.units.find((u) => u.id === event.from)?.theater;
    if (!theater) continue;
    if (!shots.some((s) => s.focus?.eventId && Math.abs(s.t0 - (t0 - 3)) < 1)) {
      addShot(eventShot(`beam:${event.id}`, 'encounter', Math.max(0, t0 - 3), subject, theater, { eventId: event.id, beams: beamIndices(subject, t0, t1) }, event.weapon === 'lac-mixed' ? 'LAC encounter' : 'Close-range energy pass'));
    }
  }
  for (const event of pack.events.filter((e) => e.type === 'fire_plan')) {
    const packets = plans.get(event.id);
    if (!packets?.length) continue;
    const ordered = [...packets].sort((a, b) => replay.packets[a].tLaunch - replay.packets[b].tLaunch);
    const first = replay.packets[ordered[0]];
    const firstWave = ordered.filter((i) => replay.packets[i].salvoId === first.salvoId);
    const from = replay.units[first.fromUnit], to = replay.units[first.toUnit];
    const firstArrival = Math.min(...firstWave.map((i) => replay.packets[i].tArrive));
    const lastArrival = Math.max(...firstWave.map((i) => replay.packets[i].tArrive));
    const launch = replay.packets[ordered.find((i) => replay.packets[i].tLaunch > 0) ?? ordered[0]];
    if (!shots.some((s) => s.kind === 'launch' && s.focus?.planId === event.id) && launch.tLaunch > 0) {
      addShot(eventShot(`launch:${event.id}`, 'launch', Math.max(0, launch.tLaunch - 3), [from.id], from.theater, { planId: event.id, packets: ordered.filter((i) => replay.packets[i].salvoId === launch.salvoId) }, event.launch === 'tube' ? 'Tube launch' : event.launch === 'tow' ? 'Towed pods firing' : 'Pod launch'));
    }
    const flight = first.tLaunch + Math.max(8, Math.min(40, (firstArrival - first.tLaunch) * 0.18));
    if (flight < firstArrival - 12) addShot(eventShot(`flight:${event.id}`, 'flight', flight, [from.id, to.id], to.theater, { planId: event.id, packets: firstWave }, 'Missiles in flight'));
    if (!shots.some((s) => s.kind === 'impact' && s.focus?.planId === event.id)) {
      addShot(eventShot(`impact:${event.id}`, 'impact', Math.max(first.tLaunch, firstArrival - 8), [to.id], to.theater, { planId: event.id, packets: firstWave }, 'Terminal defense and impact'));
    }
    addShot(eventShot(`aftermath:${event.id}`, 'aftermath', lastArrival + 1, [to.id], to.theater, { planId: event.id }, 'First-wave aftermath'));
  }
  shots.sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
  const budget = 40;
  const eventBudget = Math.max(0, budget - authoredIds.size - shots.filter((s) => s.kind === 'encounter' && !authoredIds.has(s.id)).length);
  let events = 0;
  const selected = shots.filter((s) => authoredIds.has(s.id) || s.kind === 'encounter' || events++ < eventBudget);
  const windows = new Map<string, SpeedWindow[]>();
  const pace = (theater: string, t0: number, t1: number): void => {
    const list = windows.get(theater) ?? [];
    list.push({ t0: Math.max(0, t0 - 12), t1: t0 - 3, rate: 4 }, { t0: Math.max(0, t0 - 3), t1: t0, rate: 1 }, { t0, t1, rate: 0.25 });
    windows.set(theater, list);
  };
  const launched = new Set<string>();
  for (const p of replay.packets) {
    if (launched.has(p.salvoId)) continue;
    launched.add(p.salvoId);
    pace(replay.units[p.fromUnit].theater, p.tLaunch, p.tLaunch + 0.75);
  }
  const beamTheaters = beamTheatersFor(replay);
  for (const beam of replay.beams) {
    const theater = beamTheaters.get(beam);
    if (theater) pace(theater, beam.t, beam.t + beam.dur);
  }
  const merged = new Map([...windows].map(([theater, list]) => [theater, mergeWindows(list)]));
  selected.forEach((s, i) => {
    s.t1 = selected[i + 1]?.t0 ?? replay.duration_s;
    s.speedWindows = (merged.get(s.theater) ?? []).filter((w) => w.t1 > s.t0 && w.t0 < s.t1).map((w) => ({ ...w, t0: Math.max(s.t0, w.t0), t1: Math.min(s.t1, w.t1) }));
  });
  return selected;
}

/** In the perceived picture the camera follows the observer's own fleet; with no observer it holds (null), so framing never reveals where an enemy really is. */
export function perceivedSubject(shot: DirectorShot, observerId: string | null, perceived: boolean): DirectorShot | null {
  if (!perceived) return shot;
  return observerId ? { ...shot, subject: [observerId], kind: 'establish', focus: undefined, bodyTarget: undefined, observerOnly: true } : null;
}

/** The shot running at t; before the first shot starts, the first shot. */
export function shotAt(shots: DirectorShot[], t: number): DirectorShot | null {
  let found: DirectorShot | null = shots[0] ?? null;
  for (const s of shots) if (s.t0 <= t) found = s;
  return found;
}

export function directorSpeed(shots: DirectorShot[], t: number): number | null {
  const shot = shotAt(shots, t);
  const rates = shot?.speedWindows?.filter((w) => t >= w.t0 && t < w.t1).map((w) => w.rate) ?? [];
  return rates.length ? Math.min(...rates) : null;
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
  let target: Vec3 =
    centroid(replay, frame, (i) => subject.has(replay.units[i].id)) ??
    shot.bodyTarget ??
    (shot.observerOnly ? null : centroid(replay, frame, (i) => replay.units[i].theater === shot.theater)) ??
    [0, 0, 0];
  const points: Vec3[] = [];
  let displayRadius = 0;
  replay.units.forEach((u, i) => {
    if (!subject.has(u.id)) return;
    const centre = Array.from(frame.unitPos.subarray(i * 3, i * 3 + 3)) as Vec3;
    points.push(centre);
    if (u.kind === 'lac') displayRadius = Math.max(displayRadius, Math.min(30_000, 2_000 * Math.sqrt(frame.unitCount[i] / 100)));
    else for (const ship of u.shipIdx) {
      const status = frame.shipStatus[ship];
      const recentWreck = shot.kind === 'aftermath' && replay.ships[ship].status.some((s) => s.status === ShipStatus.Destroyed && s.t <= frame.t && frame.t - s.t <= 30);
      if (status === ShipStatus.Absent || status === ShipStatus.Escaped || (status === ShipStatus.Destroyed && !recentWreck)) continue;
      points.push(Array.from(frame.shipPos.subarray(ship * 3, ship * 3 + 3)) as Vec3);
    }
  });
  if (shot.kind === 'flight' && !shot.observerOnly) {
    const packets = (shot.focus?.packets ?? []).filter((i) => frame.packetAlive[i] > 0);
    if (packets.length) {
      points.length = 0;
      target = [0, 0, 0];
      for (const i of packets) {
        const p = Array.from(frame.packetPos.subarray(i * 3, i * 3 + 3)) as Vec3;
        points.push(p);
        for (let k = 0; k < 3; k++) target[k] += p[k] / packets.length;
        displayRadius = Math.max(displayRadius, packetSpreadKm(frame.t - replay.packets[i].tLaunch));
      }
      const endpoints = [...new Set(packets.flatMap((i) => [replay.packets[i].fromUnit, replay.packets[i].toUnit]))]
        .filter((i) => frame.unitCount[i] > 0 && replay.units[i].theater === shot.theater)
        .map((i) => ({ i, pos: Array.from(frame.unitPos.subarray(i * 3, i * 3 + 3)) as Vec3 }))
        .sort((a, b) => dist(a.pos, target) - dist(b.pos, target) || a.i - b.i);
      const context = endpoints[0];
      if (context) {
        points.push(context.pos);
        for (const ship of replay.units[context.i].shipIdx) {
          const status = frame.shipStatus[ship];
          if (status !== ShipStatus.Absent && status !== ShipStatus.Escaped && status !== ShipStatus.Destroyed) {
            points.push(Array.from(frame.shipPos.subarray(ship * 3, ship * 3 + 3)) as Vec3);
          }
        }
      }
    }
  }
  for (const i of shot.focus?.beams ?? []) {
    const beam = replay.beams[i];
    if (beam.t <= frame.t && frame.t < beam.t + beam.dur) points.push(beam.from, beam.to);
  }
  if (shot.kind === 'aftermath' && points.length && !subjectCentroid(replay, frame, shot.subject)) target = points[0];
  const orbit = reducedMotion ? 0 : (shot.orbitDegPerMin * (frame.t - shot.t0)) / 60;
  const az = ((shot.azimDeg + orbit) * Math.PI) / 180;
  const el = (shot.elevDeg * Math.PI) / 180;
  const radius = points.reduce((r, p) => Math.max(r, dist(p, target)), 0) + displayRadius;
  const d = !shot.kind || shot.kind === 'establish' ? Math.max(shot.distanceKm, radius * 2.8) : Math.max(20_000, radius * 2.8);
  const eye: Vec3 = [target[0] + d * Math.cos(el) * Math.cos(az), target[1] + d * Math.cos(el) * Math.sin(az), target[2] + d * Math.sin(el)];
  return { shotId: shot.id, scale: shot.scale, theater: shot.theater, eye, target, cut: reducedMotion };
}

/** Eases the camera toward the director pose; a snap is a cut. */
export class CameraRig {
  eye: Vec3 = [0, 0, 0];
  target: Vec3 = [0, 0, 0];
  private started = false;
  private shotId = '';

  follow(pose: DirectorPose, dtWallS: number, snap: boolean): void {
    if (snap || pose.cut || !this.started || pose.shotId !== this.shotId) {
      this.eye = [...pose.eye];
      this.target = [...pose.target];
      this.started = true;
      this.shotId = pose.shotId;
      return;
    }
    // Exponential approach with a 0.25 s half-life of wall time.
    const k = 1 - Math.pow(0.5, Math.max(0, Number.isFinite(dtWallS) ? dtWallS : 0) / 0.25);
    for (let i = 0; i < 3; i++) {
      this.eye[i] += (pose.eye[i] - this.eye[i]) * k;
      this.target[i] += (pose.target[i] - this.target[i]) * k;
    }
  }

  settled(pose: DirectorPose): boolean {
    return dist(this.eye, pose.eye) < 0.001 && dist(this.target, pose.target) < 0.001;
  }
}

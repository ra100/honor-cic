import { DrivePhase, packetPositionAt, unitPosition, type BeamEvent, type PacketTrack, type Replay } from '../core/replay';
import { dist, type Vec3 } from '../core/vec';

export const TRAIL_CAP = 8_192;
export const LAUNCH_CUE_S = 0.75;

export interface PacketTrail { head: Vec3; tail: Vec3; tailT: number }

/** Both ends sample solved segments; shortening a trail changes its history window, not its path. */
export function packetTrailAt(packet: PacketTrack, t: number, phase: DrivePhase, cameraDistanceKm: number): PacketTrail {
  const head = packetPositionAt(packet, t);
  const history = phase === DrivePhase.Terminal ? 0.35 : phase === DrivePhase.Coast ? 0.9 : 0.6;
  const maxLength = Math.max(1, cameraDistanceKm * 0.015);
  let low = Math.max(packet.tLaunch, Math.min(packet.tArrive, t) - history);
  let high = Math.min(packet.tArrive, Math.max(packet.tLaunch, t));
  if (dist(head, packetPositionAt(packet, low)) > maxLength) {
    for (let i = 0; i < 10; i++) {
      const mid = (low + high) / 2;
      if (dist(head, packetPositionAt(packet, mid)) > maxLength) low = mid;
      else high = mid;
    }
    low = high;
  }
  return { head, tail: packetPositionAt(packet, low), tailT: low };
}

export const trailStride = (dots: number, cap = TRAIL_CAP): number => Math.max(1, Math.ceil(dots / Math.max(1, cap)));

export function beamTheater(beam: BeamEvent, replay: Replay): string | null {
  const ship = replay.ships[beam.ship];
  if (ship) return replay.units[ship.unit].theater;
  if (beam.kind === 'cm-kill' || beam.kind === 'pd-kill') {
    const lead = beam.kind === 'cm-kill' ? 4 : 1;
    const packet = replay.packets.find((p) => Math.abs(p.tArrive - lead - beam.t) < 1e-6 && dist(packetPositionAt(p, beam.t), beam.to) < 1e-3);
    return packet ? replay.units[packet.toUnit].theater : null;
  }
  const candidates = replay.units
    .filter((u) => u.side === beam.side && (beam.kind !== 'transit' || Math.abs(u.tAppear - beam.t) < 1e-6 || Math.abs(u.tDepart - beam.t) < 1e-6))
    .map((u) => ({ theater: u.theater, distance: dist(unitPosition(u, beam.t), beam.from) }))
    .sort((a, b) => a.distance - b.distance);
  const closest = candidates[0];
  if (!closest || closest.distance > 20_000) return null;
  if (candidates[1]?.distance === closest.distance && candidates[1].theater !== closest.theater) return null;
  return closest.theater;
}

const theaterCache = new WeakMap<Replay, ReadonlyMap<BeamEvent, string | null>>();

export function beamTheatersFor(replay: Replay): ReadonlyMap<BeamEvent, string | null> {
  const cached = theaterCache.get(replay);
  if (cached) return cached;
  const out = new Map<BeamEvent, string | null>();
  const positions = new Map<string, string | null>();
  for (const beam of replay.beams) {
    const key = `${beam.ship}|${beam.kind}|${beam.t}|${beam.from.join(',')}`;
    if (!positions.has(key)) positions.set(key, beamTheater(beam, replay));
    out.set(beam, positions.get(key)!);
  }
  theaterCache.set(replay, out);
  return out;
}

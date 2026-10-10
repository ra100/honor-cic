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

/** Site A's streak history (A report §4.7): seven seconds under drive, a quarter of that coasting. */
export const STREAK_TRAIL_S = 7;
export const COAST_TRAIL_SHARE = 0.25;

/**
 * When a missile streak's tail was: A's history window, never before launch nor, on the terminal leg, before the
 * terminal burn began; then shortened so the chord to the head stays within maxKm. Both ends stay on the solved path.
 */
export function streakTailT(packet: PacketTrack, t: number, phase: DrivePhase, terminalT0: number, maxKm: number): number {
  const now = Math.min(Math.max(t, packet.tLaunch), packet.tArrive);
  const window = phase === DrivePhase.Coast ? STREAK_TRAIL_S * COAST_TRAIL_SHARE : STREAK_TRAIL_S;
  let low = Math.max(packet.tLaunch, now - window);
  if (phase === DrivePhase.Terminal && terminalT0 <= now) low = Math.max(low, terminalT0);
  const head = packetPositionAt(packet, now);
  if (!(maxKm > 0) || dist(head, packetPositionAt(packet, low)) <= maxKm) return low;
  let high = now;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (dist(head, packetPositionAt(packet, mid)) > maxKm) low = mid;
    else high = mid;
  }
  return high;
}

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

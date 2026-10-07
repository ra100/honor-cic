import { DrivePhase, packetPhaseAt, packetPositionAt, unitPosition, unitVelocity, type Replay } from './replay';
import { perceivedContacts, type Contact, type Trackable } from './sensors';
import { segmentState } from './solver/kinematics';

/** What a commander in this theater could detect: units under impeller and missile packets aimed into the theater. */
export function replayTrackables(r: Replay, theater: string): Trackable[] {
  const out: Trackable[] = [];
  for (const u of r.units) {
    if (u.theater !== theater) continue;
    out.push({
      id: u.id, kind: u.kind, side: u.side, label: u.name, from: u.tAppear, until: u.tDepart,
      pos: (t) => unitPosition(u, t), vel: (t) => unitVelocity(u, t), sensorAt: () => 'grav',
    });
  }
  for (const p of r.packets) {
    if (r.units[p.toUnit].theater !== theater) continue;
    out.push({
      id: p.id, kind: 'packet', side: p.side, label: `${r.units[p.fromUnit].name} salvo`, from: p.tLaunch, until: p.tArrive,
      pos: (t) => packetPositionAt(p, t),
      vel: (t) => segmentState(p.segments, Math.min(Math.max(t, p.tLaunch), p.tArrive)).v,
      // A coasting missile has no wedge, so only light-speed sensors see it (MTS §7.1).
      sensorAt: (t) => (packetPhaseAt(p, t) === DrivePhase.Coast ? 'light' : 'grav'),
    });
  }
  return out;
}

/** The fleet carrying the side's commander in a theater: the flagship's unit, else the first present fleet. */
export function observerUnit(r: Replay, side: string, theater: string, t: number): number | null {
  const present = r.units.filter((u) => u.side === side && u.theater === theater && u.kind === 'fleet' && t >= u.tAppear && t < u.tDepart);
  const flag = present.find((u) => u.shipIdx.some((i) => r.ships[i].flagship));
  return (flag ?? present[0])?.idx ?? null;
}

export interface CommanderPicture { observer: number | null; contacts: Contact[] }

export function commanderPicture(r: Replay, tracks: Trackable[], side: string, theater: string, t: number, ftlC: number): CommanderPicture {
  const observer = observerUnit(r, side, theater, t);
  if (observer === null) return { observer, contacts: [] };
  const u = r.units[observer];
  const others = tracks.filter((o) => o.id !== u.id);
  return { observer, contacts: perceivedContacts((tt) => unitPosition(u, tt), others, t, ftlC) };
}

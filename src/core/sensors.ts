import { C_KM_S } from './units';
import { issue, type Issue } from './validate/types';
import { addScaled, dist, type Vec3 } from './vec';

export type SensorKind = 'grav' | 'light';

/** Track uncertainty at the moment of measurement, km. S constant. */
export const BASE_SIGMA_KM = 1_000;
/** Dead-reckoning uncertainty growth per second of contact age, km/s. S constant. */
export const SIGMA_GROWTH_KM_S = 50;

export function propagationDelay(km: number, sensor: SensorKind, ftlC: number): number {
  return km / (C_KM_S * (sensor === 'grav' ? ftlC : 1));
}

/** Earliest time an observer can know about an event: t − tEvent = |observer(t) − eventPos| / speed. */
export function observationTime(tEvent: number, eventPos: Vec3, observerPos: (t: number) => Vec3, sensor: SensorKind, ftlC: number): number {
  let t = tEvent;
  for (let i = 0; i < 30; i++) {
    const next = tEvent + propagationDelay(dist(observerPos(t), eventPos), sensor, ftlC);
    if (Math.abs(next - t) < 1e-4) return next;
    t = next;
  }
  return t;
}

export interface Trackable {
  id: string;
  kind: 'fleet' | 'lac' | 'packet';
  side: string;
  label: string;
  from: number;
  until: number;
  pos(t: number): Vec3;
  vel(t: number): Vec3;
  sensorAt(t: number): SensorKind;
}

export interface Contact {
  id: string;
  kind: Trackable['kind'];
  side: string;
  label: string;
  measuredAt: number;
  age: number;
  observed: Vec3;
  predicted: Vec3;
  sigmaKm: number;
  identity: 'confirmed' | 'probable' | 'unknown';
  sensor: SensorKind;
}

export function perceivedContacts(observerPos: (t: number) => Vec3, objects: Trackable[], t: number, ftlC: number): Contact[] {
  const obs = observerPos(t);
  const out: Contact[] = [];
  for (const o of objects) {
    let tm = t;
    let sensor: SensorKind = o.sensorAt(t);
    for (let i = 0; i < 30; i++) {
      sensor = o.sensorAt(tm);
      const next = t - propagationDelay(dist(obs, o.pos(tm)), sensor, ftlC);
      if (Math.abs(next - tm) < 1e-4) {
        tm = next;
        break;
      }
      tm = next;
    }
    if (tm < o.from || tm >= o.until) continue;
    const age = t - tm;
    const observed = o.pos(tm);
    out.push({
      id: o.id, kind: o.kind, side: o.side, label: o.label, measuredAt: tm, age, observed,
      predicted: addScaled(observed, o.vel(tm), age),
      sigmaKm: BASE_SIGMA_KM + SIGMA_GROWTH_KM_S * age,
      identity: o.kind === 'packet' ? 'probable' : age < 120 ? 'confirmed' : 'probable',
      sensor,
    });
  }
  return out;
}

export interface LatencyItem { id: string; t: number; tEvent: number; eventPos: Vec3; sensor: SensorKind; observer: (t: number) => Vec3; label: string }

/** A commander cannot react before the observation arrives (MTS §12.2 check 8). */
export function latencyIssues(items: LatencyItem[], ftlC: number): Issue[] {
  return items.flatMap((it) => {
    const seen = observationTime(it.tEvent, it.eventPos, it.observer, it.sensor, ftlC);
    return it.t + 1e-6 < seen
      ? [issue('latency', 'error', `${it.id} at t=${it.t.toFixed(1)} reacts to ${it.label}, which cannot be observed before t=${seen.toFixed(1)}`, `events.${it.id}`)]
      : [];
  });
}

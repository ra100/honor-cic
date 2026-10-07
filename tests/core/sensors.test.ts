import { describe, expect, it } from 'vitest';
import { latencyIssues, observationTime, perceivedContacts, propagationDelay, type Trackable } from '../../src/core/sensors';
import { LM_KM } from '../../src/core/units';
import type { Vec3 } from '../../src/core/vec';

const here = (): Vec3 => [0, 0, 0];

describe('propagation (MTS §7.2 table)', () => {
  it('matches the light-speed and 64c columns', () => {
    expect(propagationDelay(LM_KM, 'light', 64)).toBeCloseTo(60, 6);
    expect(propagationDelay(22 * LM_KM, 'grav', 64)).toBeCloseTo(20.625, 3);
    expect(observationTime(0, [70e6, 0, 0], here, 'light', 64)).toBeCloseTo(233.495, 2);
    expect(observationTime(0, [70e6, 0, 0], here, 'grav', 64)).toBeCloseTo(3.648, 3);
  });
});

describe('perceivedContacts (MTS §7.1)', () => {
  const ship: Trackable = {
    id: 'u1', kind: 'fleet', side: 'red', label: 'Red', from: 0, until: Infinity,
    pos: (t) => [LM_KM + 0.5 * 2 * t * t, 0, 0], vel: (t) => [2 * t, 0, 0], sensorAt: () => 'light',
  };
  it('shows nothing until light from the object arrives', () => {
    expect(perceivedContacts(here, [ship], 30, 64)).toEqual([]);
  });
  it('shows a stale observed position, not ground truth', () => {
    const [c] = perceivedContacts(here, [ship], 200, 64);
    expect(c.age).toBeGreaterThan(55);
    expect(c.observed[0]).toBeLessThan(ship.pos(200)[0]);
    expect(c.sigmaKm).toBeGreaterThan(1000);
  });
  it('sees wedges faster than light', () => {
    const grav = { ...ship, sensorAt: () => 'grav' as const };
    const [c] = perceivedContacts(here, [grav], 30, 64);
    expect(c.age).toBeLessThan(1);
  });
});

describe('latencyIssues (MTS §12.2 check 8)', () => {
  it('rejects a reaction before the triggering event can be observed', () => {
    const item = { id: 'sig', tEvent: 0, eventPos: [70e6, 0, 0] as Vec3, sensor: 'light' as const, observer: here, label: 'launch' };
    expect(latencyIssues([{ ...item, t: 100 }], 64)).toHaveLength(1);
    expect(latencyIssues([{ ...item, t: 300 }], 64)).toEqual([]);
  });
});

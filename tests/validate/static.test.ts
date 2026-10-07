import { describe, expect, it } from 'vitest';
import type { ScenarioPack } from '../../src/core/schema';
import { TECH } from '../../src/core/tech';
import { hasErrors, validateStatic, type CheckId } from '../../src/core/validate';
import { miniPack as pack } from '../fixtures/mini-pack';

const SVS = (value: number, unit: string) => ({ value, unit, evidence: 'S', source_id: 't', uncertainty: 'test' });
const errorsOf = (p: ScenarioPack, check: CheckId) =>
  validateStatic(p, TECH).filter((i) => i.severity === 'error' && i.check === check);

describe('static validators (MTS §12.2)', () => {
  it('passes the mini pack with no errors', () => {
    const issues = validateStatic(pack(), TECH);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(hasErrors(issues)).toBe(false);
  });

  it('units: rejects a planet radius in degrees', () => {
    expect(errorsOf(pack((r) => { r.bodies.bodies[1].radius.unit = 'deg'; }), 'units')).toHaveLength(1);
  });

  it('frames: orbital order must follow the designation (Draco A-V inside Roc A-VI)', () => {
    const p = pack((r) =>
      r.bodies.bodies.push({
        id: 'inner', name: 'Inner', kind: 'planet', ordinal: 2, parent_id: 'star', radius: SVS(1000, 'km'),
        orbit: { radius: SVS(5, 'LM'), phase: SVS(0, 'deg'), period: SVS(1, 'yr'), inclination: SVS(0, 'deg') },
        offset: null, hyper_limit: null, exclusion: null,
      }),
    );
    expect(errorsOf(p, 'frames')[0]?.message).toMatch(/orbits inside/);
  });

  it('epoch: an orbit radius without a phase gives no position', () => {
    expect(errorsOf(pack((r) => { r.bodies.bodies[1].orbit.phase.value = null; }), 'epoch')).toHaveLength(1);
  });

  it('weapons: a salvo cannot exceed the tubes bearing', () => {
    expect(errorsOf(pack((r) => { r.timeline.events[0].totals.attack = 41; }), 'weapons')).toHaveLength(1);
  });

  it('inventory: Apollo arithmetic must hold', () => {
    const p = pack((r) => Object.assign(r.timeline.events[0], {
      launch: 'tow', pod_load: 'apollo', pods: 10, profile: 'mk23', guidance: 'apollo',
      totals: { attack: 80, ew: 0, controller: 9 },
    }));
    expect(errorsOf(p, 'inventory').some((i) => /gives 80 attack\/EW and 10 controllers/.test(i.message))).toBe(true);
  });

  it('inventory: launches cannot exceed magazines', () => {
    const p = pack((r) => Object.assign(r.timeline.events[0], { salvos: 100, interval_s: 18, totals: { attack: 3000, ew: 0, controller: 0 } }));
    expect(errorsOf(p, 'inventory').some((i) => /exceeds magazines of 2400/.test(i.message))).toBe(true);
  });

  it('guidance: Apollo without a Keyhole II ship is rejected', () => {
    const p = pack((r) => {
      Object.assign(r.timeline.events[0], {
        launch: 'tow', pod_load: 'apollo', pods: 5, profile: 'mk23', guidance: 'apollo',
        totals: { attack: 40, ew: 0, controller: 5 },
      });
    });
    expect(errorsOf(p, 'guidance').some((i) => /Keyhole II/.test(i.message))).toBe(true);
  });

  it('guidance: a class that cannot carry Keyhole II cannot be given one', () => {
    expect(errorsOf(pack((r) => { r.forces.units[0].ships[0].equipment = ['keyhole-ii']; }), 'guidance')).toHaveLength(1);
  });

  it('era: later classes cannot appear in earlier scenarios', () => {
    const errs = errorsOf(pack((r) => { r.meta.year_pd = 1919; }), 'era');
    expect(errs.some((i) => /Edward Saganami-C/.test(i.message))).toBe(true);
    expect(errs.some((i) => /outside era/.test(i.message))).toBe(true);
  });
});

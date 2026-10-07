import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng';
import { buildUnitTracks, segmentState } from '../../src/core/solver/kinematics';
import { formationOffsets } from '../../src/core/solver/formation';
import { bodyPosition, indexBodies } from '../../src/core/solver/orbits';
import { TimeResolver, UnresolvedArrivalError } from '../../src/core/solver/timeref';
import type { KinSegment } from '../../src/core/solver/types';
import { TECH } from '../../src/core/tech';
import { G0_KM_S2 } from '../../src/core/units';
import { validateStatic } from '../../src/core/validate';
import { dist, len } from '../../src/core/vec';
import { miniPack } from '../fixtures/mini-pack';

const S = (value: number, unit: string) => ({ value, unit, evidence: 'S', source_id: 't', uncertainty: 'test' });
const tracksOf = (p: ReturnType<typeof miniPack>) =>
  buildUnitTracks(p, indexBodies(p.bodies), new TimeResolver(p.events), [-600, p.meta.duration_s + 600]);

describe('segmentState', () => {
  const segs: KinSegment[] = [{ t0: 0, t1: 100, p0: [0, 0, 0], v0: [0, 0, 0], a: [2, 0, 0] }];
  it('integrates constant acceleration exactly', () => {
    expect(segmentState(segs, 10).p[0]).toBe(100);
    expect(segmentState(segs, 10).v[0]).toBe(20);
  });
  it('extrapolates before the first and after the last segment', () => {
    expect(segmentState(segs, -10).p[0]).toBe(100);
    expect(segmentState(segs, 200).v[0]).toBe(400);
  });
});

describe('TimeResolver', () => {
  const p = miniPack((r) => r.timeline.events.push(
    { id: 'n1', type: 'note', t: { ref: 'fp-blue', anchor: 'launch', offset_s: 30 }, text: 'x', side: null, evidence: 'S', source_id: 't', seed: 0 },
    { id: 'n2', type: 'note', t: { ref: 'fp-blue', anchor: 'arrival', offset_s: -5 }, text: 'y', side: null, evidence: 'S', source_id: 't', seed: 0 },
  ));
  it('resolves numbers, t and launch anchors', () => {
    const tr = new TimeResolver(p.events);
    expect(tr.resolve(12)).toBe(12);
    expect(tr.resolve({ ref: 'n1', anchor: 't', offset_s: 1 })).toBe(31);
  });
  it('refuses arrival anchors until arrivals are solved', () => {
    const tr = new TimeResolver(p.events);
    expect(() => tr.resolve({ ref: 'n2', anchor: 't', offset_s: 0 })).toThrow(UnresolvedArrivalError);
    expect(tr.tryResolve({ ref: 'n2', anchor: 't', offset_s: 0 })).toBeNull();
    const solved = tr.withAnchors({ arrival: new Map([['fp-blue', 400]]), lastArrival: new Map([['fp-blue', 410]]) });
    expect(solved.resolve({ ref: 'n2', anchor: 't', offset_s: 0 })).toBe(395);
  });
});

describe('buildUnitTracks', () => {
  it('places a unit relative to a body at its anchor time', () => {
    const p = miniPack();
    const blue = segmentState(tracksOf(p).get('blue-ca')!, 0).p;
    const planet = bodyPosition(indexBodies(p.bodies), 'planet', 0);
    expect(dist(blue, [planet[0] - 5e6, planet[1], planet[2]])).toBeLessThan(1e-6);
  });

  it('places a unit relative to another unit at a later anchor time', () => {
    const p = miniPack((r) => {
      r.forces.units[1].state = {
        t: 100, place: { relative_to: 'blue-ca', position: { value: [1, 0, 0], unit: 'Mkm' } },
        velocity: { relative_to: 'blue-ca', velocity_km_s: [0, 0, 0] }, evidence: 'S',
      };
    });
    const tr = tracksOf(p);
    const d = dist(segmentState(tr.get('red-ca')!, 100).p, segmentState(tr.get('blue-ca')!, 100).p);
    expect(d).toBeCloseTo(1e6, 3);
  });

  it('applies a maneuver toward a target', () => {
    const p = miniPack((r) => r.timeline.events.push({
      id: 'm1', type: 'maneuver', t: 0, unit: 'blue-ca', until: 300, accel: S(100, 'g'),
      direction: { toward: 'red-ca' }, evidence: 'S', source_id: 't', seed: 0,
    }));
    const v = segmentState(tracksOf(p).get('blue-ca')!, 300).v;
    expect(len(v)).toBeCloseTo(100 * G0_KM_S2 * 300, 0);
  });

  it('back-integrates from a mid-battle anchor', () => {
    const p = miniPack((r) => {
      r.forces.units[0].state.t = 1000;
      r.timeline.events.push({
        id: 'm2', type: 'maneuver', t: 0, unit: 'blue-ca', until: 1000, accel: S(100, 'g'),
        direction: { vector: [1, 0, 0] }, evidence: 'S', source_id: 't', seed: 0,
      });
    });
    const segs = tracksOf(p).get('blue-ca')!;
    expect(segmentState(segs, 1000).v[0]).toBeCloseTo(0, 6);
    expect(segmentState(segs, 0).v[0]).toBeCloseTo(-100 * G0_KM_S2 * 1000, 6);
  });
});

describe('formations (MTS §6.1)', () => {
  it('builds a wall with the centre slot first and no overlap', () => {
    const o = formationOffsets('wall', 9, 1000, mulberry32(1));
    expect(len(o[0])).toBeLessThan(700);
    let min = Infinity;
    for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) min = Math.min(min, dist(o[i], o[j]));
    expect(min).toBeGreaterThanOrEqual(590);
  });
  it('rejects spacing that lets wedges overlap', () => {
    const p = miniPack((r) => { r.forces.units[0].formation.spacing.value = 10; });
    expect(validateStatic(p, TECH).some((i) => i.check === 'geometry' && i.severity === 'error')).toBe(true);
  });
  it('rejects maneuvers beyond the slowest ship', () => {
    const p = miniPack((r) => r.timeline.events.push({
      id: 'm3', type: 'maneuver', t: 0, unit: 'blue-ca', until: 10, accel: S(2000, 'g'),
      direction: { vector: [1, 0, 0] }, evidence: 'S', source_id: 't', seed: 0,
    }));
    expect(validateStatic(p, TECH).some((i) => i.check === 'flight' && i.severity === 'error')).toBe(true);
  });
});

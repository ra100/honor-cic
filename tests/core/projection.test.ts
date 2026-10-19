import { describe, expect, it } from 'vitest';
import { COURSE_STEP_S, CourseModel, GM_SUN_KM3_S2 } from '../../src/core/projection';
import { parsePack } from '../../src/core/schema';
import { bodyPosition, indexBodies } from '../../src/core/solver/orbits';
import { G0_KM_S2, LM_KM } from '../../src/core/units';
import { dist, len, norm, scale, sub, type Vec3 } from '../../src/core/vec';
import { miniPackRaw } from '../fixtures/mini-pack';

const parsed = parsePack(miniPackRaw());
if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
const bodies = parsed.pack.bodies;
const model = new CourseModel(bodies);
const planet = bodyPosition(indexBodies(bodies), 'planet', 0);

describe('CourseModel', () => {
  it('pulls toward the star with its stated mass', () => {
    const p: Vec3 = [1e8, 0, 0];
    const g = model.gravity(p, 0);
    expect(len(g)).toBeCloseTo(GM_SUN_KM3_S2 / 1e16, 12);
    expect(norm(g)[0]).toBeCloseTo(-1, 9);
  });

  it('coasts on a straight line bent only by gravity, the cone widening with time', () => {
    const p0: Vec3 = [0, 2 * LM_KM, 0];
    const c = model.project(0, p0, [1000, 0, 0], [0, 0, 0], [], 3600);
    expect(c.mode).toBe('coast');
    expect(c.target).toBeNull();
    const last = c.points[c.points.length - 1];
    expect(last[0]).toBeCloseTo(3.6e6, -3);
    expect(last[1]).toBeLessThan(p0[1]);
    for (let i = 1; i < c.sigma.length; i++) expect(c.sigma[i]).toBeGreaterThan(c.sigma[i - 1]);
  });

  it('reads thrust toward a body as heading for it, and brakes to arrive there at rest', () => {
    const p0: Vec3 = [planet[0], planet[1] - 30e6, 0];
    const accel = 300 * G0_KM_S2;
    const a = scale(norm(sub(planet, p0)), accel);
    const c = model.project(0, p0, [0, 0, 0], a);
    expect(c.mode).toBe('intercept');
    expect(c.target).toEqual({ id: 'planet', name: 'Planet', kind: 'body' });
    expect(c.end).toBe('arrival');
    const end = c.points[c.points.length - 1];
    const tEnd = c.times[c.times.length - 1];
    expect(dist(end, bodyPosition(indexBodies(bodies), 'planet', tEnd))).toBeLessThan(50_000);
    // Starting at rest, the flip comes about halfway, a little early for the braking margin.
    expect(c.turnover).not.toBeNull();
    const flip = c.times[c.turnover as number] / tEnd;
    expect(flip).toBeGreaterThan(0.4);
    expect(flip).toBeLessThan(0.55);
    // Brachistochrone time at full drive, give or take the margin and the planet's motion.
    expect(tEnd).toBeGreaterThan(2 * Math.sqrt(30e6 / accel));
    expect(tEnd).toBeLessThan(1.25 * 2 * Math.sqrt(30e6 / accel));
  });

  it('chases another force that thrust points at, and ignores one off the bow', () => {
    const p0: Vec3 = [0, 3 * LM_KM, 0];
    const ahead = { id: 'red', name: 'Red', p: [p0[0] + 20e6, p0[1], 0] as Vec3, v: [0, 0, 0] as Vec3 };
    const abeam = { id: 'green', name: 'Green', p: [p0[0], p0[1] + 20e6, 0] as Vec3, v: [0, 0, 0] as Vec3 };
    const c = model.project(0, p0, [0, 0, 0], [2, 0, 0], [abeam, ahead]);
    expect(c.target?.id).toBe('red');
    expect(model.inferTarget(0, p0, [2, 0, 0], [abeam])).toBeNull();
  });

  it('holds a burn with no target until it leaves the hyper limit', () => {
    const p0: Vec3 = [0, -20 * LM_KM, 0];
    const c = model.project(0, p0, [0, 0, 0], [0, -3, 0]);
    expect(c.mode).toBe('burn');
    expect(c.end).toBe('limit');
    expect(c.limit).toBe('Star');
    const last = c.points[c.points.length - 1];
    expect(len(last)).toBeGreaterThanOrEqual(22 * LM_KM);
    expect(len(c.points[c.points.length - 2])).toBeLessThan(22 * LM_KM);
    expect(c.times[1]).toBe(COURSE_STEP_S);
  });
});

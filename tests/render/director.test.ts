import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { dist } from '../../src/core/vec';
import { CameraRig, directorPose, shotAt, shotsFor, type DirectorPose } from '../../src/render/director';
import { getPack } from '../../src/registry';

describe('director', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const shots = shotsFor(pack, replay);
  const frameAt = (t: number) => sampleFrame(replay, t, createFrame(replay));
  const az = (p: DirectorPose) => (Math.atan2(p.eye[1] - p.target[1], p.eye[0] - p.target[0]) * 180) / Math.PI;

  it('orders shots by resolved start and closes each at the next start', () => {
    expect(shots.map((s) => s.id)).toEqual(['overview']);
    expect(shots[0].t0).toBe(0);
    expect(shots[0].t1).toBe(replay.duration_s);
    expect(shotAt(shots, 500)?.id).toBe('overview');
  });

  it('aims at the centre of the subject units from the shot distance', () => {
    const f = frameAt(100);
    const pose = directorPose(shots[0], replay, f, false);
    const a = replay.units.findIndex((u) => u.id === 'tf-blue');
    const b = replay.units.findIndex((u) => u.id === 'tf-red');
    for (let k = 0; k < 3; k++) expect(pose.target[k]).toBeCloseTo((f.unitPos[a * 3 + k] + f.unitPos[b * 3 + k]) / 2, 3);
    expect(dist(pose.eye, pose.target)).toBeCloseTo(2.5e7, 0);
  });

  it('orbits at the shot rate, and holds still with reduced motion', () => {
    const p0 = directorPose(shots[0], replay, frameAt(0), false);
    const p1 = directorPose(shots[0], replay, frameAt(60), false);
    expect(az(p1) - az(p0)).toBeCloseTo(4, 3);
    expect(az(directorPose(shots[0], replay, frameAt(60), true))).toBeCloseTo(az(p0), 6);
  });

  it('eases toward a pose, and snaps on a cut', () => {
    const rig = new CameraRig();
    rig.follow({ shotId: 'a', scale: 'engagement', theater: 'x', eye: [0, 0, 0], target: [0, 0, 0] }, 0.016, true);
    rig.follow({ shotId: 'a', scale: 'engagement', theater: 'x', eye: [100, 0, 0], target: [0, 0, 0] }, 0.016, false);
    expect(rig.eye[0]).toBeGreaterThan(0);
    expect(rig.eye[0]).toBeLessThan(100);
    rig.follow({ shotId: 'b', scale: 'engagement', theater: 'x', eye: [100, 0, 0], target: [0, 0, 0] }, 0.016, true);
    expect(rig.eye[0]).toBe(100);
  });
});

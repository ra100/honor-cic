import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bodyPosition, indexBodies, orbitPolyline } from '../../../src/core/solver/orbits';
import { LM_KM } from '../../../src/core/units';
import type { Vec3 } from '../../../src/core/vec';
import { getPack } from '../../../src/registry';
import { systemCatalog } from '../../../src/render/system/catalog';
import { CameraTween, presetPose, type PresetInput } from '../../../src/render/system/presets';
import type { SystemFocus } from '../../../src/render/scales/types';

const pack = getPack('manticore')!;
const index = indexBodies(pack.bodies);
const input: PresetInput = { index, catalog: systemCatalog(pack), t: 0, fleets: [], fovDeg: 45 };

/** NDC of each point seen from the preset pose, on a square plot. */
function ndc(focus: SystemFocus, points: Vec3[], inp: PresetInput = input): THREE.Vector3[] {
  const p = presetPose(focus, inp);
  const cam = new THREE.PerspectiveCamera(45, 1, 0.01, 1e9);
  cam.up.set(0, 0, 1);
  cam.position.set(p.eye[0] / 1e6, p.eye[1] / 1e6, p.eye[2] / 1e6);
  cam.lookAt(p.target[0] / 1e6, p.target[1] / 1e6, p.target[2] / 1e6);
  cam.updateMatrixWorld();
  return points.map((q) => new THREE.Vector3(q[0] / 1e6, q[1] / 1e6, q[2] / 1e6).project(cam));
}
const inFrame = (v: THREE.Vector3) => Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z > -1 && v.z < 1;
const limitRing = (id: string, r: number): Vec3[] => {
  const c = bodyPosition(index, id, 0);
  return Array.from({ length: 24 }, (_, i) => [c[0] + r * Math.cos(i * Math.PI / 12), c[1] + r * Math.sin(i * Math.PI / 12), c[2] + r * (i % 2 ? 1 : -1) * 0.2] as Vec3);
};

describe('system camera presets', () => {
  it('primary: the origin star and its whole hyper sphere, star near the centre', () => {
    const p = presetPose('primary', input);
    expect(p.target).toEqual(bodyPosition(index, 'manticore-a', 0));
    expect(ndc('primary', limitRing('manticore-a', 22 * LM_KM)).every(inFrame)).toBe(true);
  });

  it('primary keeps fleets fighting just outside the limit in frame', () => {
    const fleet: Vec3 = [5 * LM_KM, 30 * LM_KM, 0];
    expect(ndc('primary', [fleet], { ...input, fleets: [fleet] }).every(inFrame)).toBe(true);
  });

  it('secondary: the companion star and its limit', () => {
    expect(presetPose('secondary', input).target).toEqual(bodyPosition(index, 'manticore-b', 0));
    expect(ndc('secondary', limitRing('manticore-b', 22.12 * LM_KM)).every(inFrame)).toBe(true);
  });

  it('binary: both stars, their limits and the terminus', () => {
    const pts = [...limitRing('manticore-a', 22 * LM_KM), ...limitRing('manticore-b', 22.12 * LM_KM), bodyPosition(index, 'junction', 0)];
    expect(ndc('binary', pts).every(inFrame)).toBe(true);
  });

  it('outer: every orbit round the origin star', () => {
    const pts = pack.bodies.filter((b) => b.parent_id === 'manticore-a' && b.orbit).flatMap((b) => orbitPolyline(index, b.id, 0, 24));
    expect(ndc('outer', pts).every(inFrame)).toBe(true);
  });

  it('works for a single-star pack with no terminus', () => {
    const t = getPack('training')!;
    const ti = indexBodies(t.bodies);
    const inp: PresetInput = { index: ti, catalog: systemCatalog(t), t: 0, fleets: [], fovDeg: 45 };
    for (const f of ['primary', 'secondary', 'binary', 'outer'] as const) {
      const p = presetPose(f, inp);
      expect(p.target).toEqual([0, 0, 0]);
      expect(p.eye.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('CameraTween', () => {
  const from = { eye: [10, 0, 0] as Vec3, target: [0, 0, 0] as Vec3 };
  const to = { eye: [0, 1000, 0] as Vec3, target: [5, 5, 0] as Vec3 };
  it('starts and ends on the given poses', () => {
    const tw = new CameraTween(from, to, 2);
    const a = tw.at(0);
    expect(a.eye[0]).toBeCloseTo(10, 9);
    expect(a.done).toBe(false);
    const b = tw.at(2);
    expect(b.done).toBe(true);
    b.eye.forEach((x, i) => expect(x).toBeCloseTo(to.eye[i], 6));
    b.target.forEach((x, i) => expect(x).toBeCloseTo(to.target[i], 9));
  });
  it('changes distance geometrically, so long zooms do not rush the near end', () => {
    const mid = new CameraTween(from, to, 2).at(1);
    const d = Math.hypot(mid.eye[0] - mid.target[0], mid.eye[1] - mid.target[1], mid.eye[2] - mid.target[2]);
    const d1 = Math.hypot(to.eye[0] - to.target[0], to.eye[1] - to.target[1]);
    expect(d).toBeCloseTo(Math.sqrt(10 * d1), 6);
  });
});

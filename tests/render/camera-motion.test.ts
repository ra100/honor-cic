import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { describe, expect, it } from 'vitest';
import { continueOrbitDamping, snapshotCamera } from '../../src/render/camera-motion';
import { renderScheduler, type FrameClock } from '../../src/ui/viewer/scheduler';

function orbit(radius: number) {
  const camera = new THREE.PerspectiveCamera(50, 1.5, radius * 1e-5, radius * 1000);
  camera.position.set(0, radius * 0.4, radius);
  const controls = new OrbitControls(camera);
  controls.enableDamping = true;
  const rotate = () => {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 15;
    controls.update(0.2);
    controls.autoRotate = false;
  };
  return { camera, controls, rotate };
}

describe('projected camera damping', () => {
  it('settles at the same visible displacement for ship, System and kilometer-scale cameras', () => {
    const frames: number[] = [];
    const positions: THREE.Vector3[] = [];
    for (const radius of [0.01, 1, 1e7]) {
      const { camera, controls, rotate } = orbit(radius);
      rotate();
      let count = 0;
      let moving = true;
      while (moving && count < 1000) {
        const before = snapshotCamera(camera, controls.target);
        controls.update();
        moving = continueOrbitDamping(camera, controls, before, 800);
        count++;
      }
      expect(moving).toBe(false);
      expect(count).toBeGreaterThan(40);
      expect(count).toBeLessThan(200);
      const settled = camera.position.clone();
      const reference = orbit(radius);
      reference.rotate();
      for (let i = 0; i < 800; i++) reference.controls.update();
      expect(settled.distanceTo(reference.camera.position)).toBeLessThan(radius * 1e-10);
      for (let i = 0; i < 100; i++) controls.update();
      expect(camera.position.distanceTo(settled)).toBeLessThan(radius * 1e-10);
      expect(controls.enableDamping).toBe(true);
      frames.push(count);
      positions.push(settled.divideScalar(radius));
    }
    expect(frames[1]).toBe(frames[0]);
    expect(frames[2]).toBe(frames[0]);
    expect(positions[1].distanceTo(positions[0])).toBeLessThan(1e-10);
    expect(positions[2].distanceTo(positions[0])).toBeLessThan(1e-10);
  });

  it('lets the scheduler stop drawing completely and reawaken for another camera input', () => {
    const { camera, controls, rotate } = orbit(1e7);
    let pending: ((now: number) => void) | null = null;
    let rendered = 0;
    let now = 0;
    const clock: FrameClock = {
      request: (callback) => { pending = callback; return 1; },
      cancel: () => { pending = null; },
    };
    const scheduler = renderScheduler(() => {
      const before = snapshotCamera(camera, controls.target);
      controls.update();
      rendered++;
      return continueOrbitDamping(camera, controls, before, 800);
    }, clock);
    const settle = () => {
      for (let i = 0; pending && i < 1000; i++) {
        const callback = pending;
        pending = null;
        callback(now += 16);
      }
      expect(pending).toBeNull();
    };
    rotate();
    scheduler.invalidate();
    settle();
    const firstCount = rendered;
    expect(firstCount).toBeLessThan(200);
    const position = camera.position.clone();
    now += 20_000;
    expect(rendered).toBe(firstCount);
    rotate();
    scheduler.invalidate();
    settle();
    expect(rendered).toBeGreaterThan(firstCount);
    expect(camera.position.distanceTo(position)).toBeGreaterThan(1);
    scheduler.dispose();
  });

  it('does not animate a reduced-motion camera and preserves its fully applied input', () => {
    const { camera, controls, rotate } = orbit(1e7);
    rotate();
    controls.enableDamping = false;
    const before = snapshotCamera(camera, controls.target);
    controls.update();
    const position = camera.position.clone();
    expect(continueOrbitDamping(camera, controls, before, 800)).toBe(false);
    expect(camera.position.toArray()).toEqual(position.toArray());
    expect(controls.enableDamping).toBe(false);
  });
});

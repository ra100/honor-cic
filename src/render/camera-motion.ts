import type { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraSnapshot {
  position: Vector3;
  target: Vector3;
  rotation: Quaternion;
}

export function snapshotCamera(camera: PerspectiveCamera, target: Vector3): CameraSnapshot {
  return { position: camera.position.clone(), target: target.clone(), rotation: camera.quaternion.clone() };
}

export function continueOrbitDamping(camera: PerspectiveCamera, controls: OrbitControls, before: CameraSnapshot, height: number): boolean {
  if (!controls.enableDamping) return false;
  const radius = Math.max(camera.near, Math.min(before.position.distanceTo(before.target), camera.position.distanceTo(controls.target)));
  const translation = camera.position.distanceTo(before.position) + controls.target.distanceTo(before.target);
  const angle = camera.quaternion.angleTo(before.rotation);
  const pixels = height * Math.abs(camera.projectionMatrix.elements[5]) / 2 * (translation / radius + angle);
  // OrbitControls' absolute epsilon otherwise keeps kilometer-scale cameras awake for a subpixel tail.
  const remainingPixels = pixels / Math.max(Number.EPSILON, controls.dampingFactor);
  if (remainingPixels > 0.25) return true;
  // Apply the rest now so waking the renderer cannot replay latent input.
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  camera.updateMatrixWorld();
  return false;
}

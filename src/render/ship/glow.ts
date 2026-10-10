import * as THREE from 'three';

const STOPS: Array<[number, number]> = [[0, 1], [0.12, 0.7], [0.35, 0.15], [1, 0]];

/** Alpha of Site B's 128 px radial glow (B report §1.8) at a fraction of its radius. */
export function glowAlpha(r: number): number {
  if (r >= 1) return 0;
  for (let i = 1; i < STOPS.length; i++) {
    const [r1, a1] = STOPS[i];
    if (r <= r1) {
      const [r0, a0] = STOPS[i - 1];
      return a0 + (a1 - a0) * (r - r0) / (r1 - r0);
    }
  }
  return 0;
}

let shared: THREE.DataTexture | null = null;

/** Site B's shared sprite glow as a DataTexture, so it builds without a canvas. */
export function glowTexture(): THREE.Texture {
  if (shared) return shared;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(glowAlpha(r) * 255);
    }
  }
  shared = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  shared.magFilter = THREE.LinearFilter;
  shared.minFilter = THREE.LinearFilter;
  shared.needsUpdate = true;
  return shared;
}

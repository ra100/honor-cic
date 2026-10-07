import * as THREE from 'three';
import type { Vec3 } from '../core/vec';

/** Physical km in, render units out, relative to a moving origin (MTS §8.5). */
export class FloatingOrigin {
  origin: Vec3 = [0, 0, 0];
  constructor(readonly kmPerUnit: number) {}
  set(o: Vec3): void {
    this.origin = [o[0], o[1], o[2]];
  }
  write(src: ArrayLike<number>, i: number, dst: { [k: number]: number }, j: number): void {
    dst[j] = (src[i] - this.origin[0]) / this.kmPerUnit;
    dst[j + 1] = (src[i + 1] - this.origin[1]) / this.kmPerUnit;
    dst[j + 2] = (src[i + 2] - this.origin[2]) / this.kmPerUnit;
  }
  point(p: ArrayLike<number>, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set((p[0] - this.origin[0]) / this.kmPerUnit, (p[1] - this.origin[1]) / this.kmPerUnit, (p[2] - this.origin[2]) / this.kmPerUnit);
  }
  km(units: number): number {
    return units * this.kmPerUnit;
  }
}

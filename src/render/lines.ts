import * as THREE from 'three';

/** Dynamic batch of coloured line segments, rebuilt each frame. */
export class LineBatch {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private n = 0;

  constructor(readonly capacity: number, additive = false, opacity = 1) {
    this.pos = new Float32Array(capacity * 6);
    this.col = new Float32Array(capacity * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false });
    if (additive) m.blending = THREE.AdditiveBlending;
    this.lines = new THREE.LineSegments(g, m);
    this.lines.frustumCulled = false;
  }

  get drawn(): number {
    return this.n;
  }

  begin(): void {
    this.n = 0;
  }

  seg(a: THREE.Vector3, b: THREE.Vector3, rgb: [number, number, number], rgbB: [number, number, number] = rgb): void {
    if (this.n >= this.capacity) return;
    const i = this.n++ * 6;
    this.pos[i] = a.x; this.pos[i + 1] = a.y; this.pos[i + 2] = a.z;
    this.pos[i + 3] = b.x; this.pos[i + 4] = b.y; this.pos[i + 5] = b.z;
    this.col.set(rgb, i);
    this.col.set(rgbB, i + 3);
  }

  loop(pts: THREE.Vector3[], rgb: [number, number, number]): void {
    for (let i = 0; i < pts.length; i++) this.seg(pts[i], pts[(i + 1) % pts.length], rgb);
  }

  commit(): void {
    const g = this.lines.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.n * 2);
  }
}

import * as THREE from 'three';

/** Shapes: 0 disc, 1 diamond (ships of the wall), 2 triangle (screen), 3 square (carriers), 4 ring (uncertainty). */
const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float size; attribute float shape; attribute vec3 color;
  varying vec3 vColor; varying float vShape;
  void main() {
    vColor = color; vShape = shape;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const FRAG = /* glsl */ `
  varying vec3 vColor; varying float vShape;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a = 0.0;
    if (vShape < 0.5) a = 1.0 - smoothstep(0.75, 1.0, length(p));
    else if (vShape < 1.5) a = 1.0 - smoothstep(0.8, 1.0, abs(p.x) + abs(p.y));
    else if (vShape < 2.5) a = step(-0.9, p.y) * step(abs(p.x) * 1.8 - 0.9, -p.y);
    else if (vShape < 3.5) a = step(max(abs(p.x), abs(p.y)), 0.8);
    else a = smoothstep(0.7, 0.8, length(p)) * (1.0 - smoothstep(0.9, 1.0, length(p)));
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor, a);
  }`;

export function makeSpriteMaterial(additive = false): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false });
  if (additive) m.blending = THREE.AdditiveBlending;
  return m;
}

export class PointCloud {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private shape: Float32Array;
  private count = 0;

  constructor(readonly capacity: number, additive = false) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('shape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, makeSpriteMaterial(additive));
    this.points.frustumCulled = false;
  }

  get drawn(): number {
    return this.count;
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, y: number, z: number, rgb: [number, number, number], size: number, shape: number): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = rgb[0]; this.col[i * 3 + 1] = rgb[1]; this.col[i * 3 + 2] = rgb[2];
    this.size[i] = size;
    this.shape[i] = shape;
  }

  commit(): void {
    const g = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'shape']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.count);
  }
}

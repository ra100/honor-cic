import * as THREE from 'three';
import { MAX_EMISSION } from './palette';

export const MAX_SYMBOL_PX = 24;
export const SHAPE = { disc: 0, wall: 1, screen: 2, carrier: 3, ring: 4, lac: 5, cross: 6, powered: 7, podWall: 8 } as const;

const VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float pixelRatio;
  attribute float size; attribute float shape; attribute vec3 color; attribute float opacity;
  varying vec3 vColor; varying float vShape; varying float vOpacity;
  void main() {
    vColor = color; vShape = shape; vOpacity = opacity;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(size, 1.0, ${MAX_SYMBOL_PX.toFixed(1)}) * pixelRatio;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const FRAG = /* glsl */ `
  uniform float alphaGain;
  varying vec3 vColor; varying float vShape; varying float vOpacity;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a = 0.0;
    if (vShape < 0.5) a = 1.0 - smoothstep(0.75, 1.0, length(p));
    else if (vShape < 1.5) a = 1.0 - smoothstep(0.8, 1.0, abs(p.x) + abs(p.y));
    else if (vShape < 2.5) a = step(-0.9, p.y) * step(abs(p.x) * 1.8 - 0.9, -p.y);
    else if (vShape < 3.5) a = step(max(abs(p.x), abs(p.y)), 0.8);
    else if (vShape < 4.5) a = smoothstep(0.65, 0.76, length(p)) * (1.0 - smoothstep(0.86, 1.0, length(p)));
    else if (vShape < 5.5) a = (1.0 - smoothstep(0.12, 0.3, abs(p.y - abs(p.x) * 0.8 + 0.35))) * step(abs(p.x), 0.8);
    else if (vShape < 6.5) a = (1.0 - smoothstep(0.18, 0.3, min(abs(p.x), abs(p.y)))) * step(max(abs(p.x), abs(p.y)), 0.85);
    else if (vShape < 7.5) a = 1.0 - smoothstep(0.55, 1.0, length(p));
    else {
      float r = abs(p.x) + abs(p.y);
      a = (1.0 - smoothstep(0.8, 1.0, r)) * max(1.0 - smoothstep(0.25, 0.38, r), smoothstep(0.55, 0.65, r));
    }
    if (a < 0.02) discard;
    gl_FragColor = vec4(clamp(vColor, 0.0, ${MAX_EMISSION.toFixed(1)}), a * vOpacity * alphaGain);
  }`;

export function makeSpriteMaterial(additive = false): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    uniforms: { pixelRatio: { value: 1 }, alphaGain: { value: additive ? 0.35 : 1 } },
  });
  if (additive) m.blending = THREE.AdditiveBlending;
  return m;
}

export class PointCloud {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private shape: Float32Array;
  private opacity: Float32Array;
  private count = 0;

  constructor(readonly capacity: number, additive = false) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    this.opacity = new Float32Array(capacity);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('shape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('opacity', new THREE.BufferAttribute(this.opacity, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, makeSpriteMaterial(additive));
    this.points.frustumCulled = false;
  }

  get drawn(): number {
    return this.count;
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, y: number, z: number, rgb: [number, number, number], size: number, shape: number, opacity = 1): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = rgb[0]; this.col[i * 3 + 1] = rgb[1]; this.col[i * 3 + 2] = rgb[2];
    this.size[i] = Number.isFinite(size) ? Math.max(1, Math.min(MAX_SYMBOL_PX, size)) : 1;
    this.shape[i] = shape;
    this.opacity[i] = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0;
  }

  commit(): void {
    const g = this.points.geometry;
    for (const name of ['position', 'color', 'size', 'shape', 'opacity']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.count);
  }

}

export function setSpritePixelRatio(scene: THREE.Scene, pixelRatio: number): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Points)) return;
    const material = object.material;
    for (const m of Array.isArray(material) ? material : [material]) {
      if (m instanceof THREE.ShaderMaterial && m.uniforms.pixelRatio) m.uniforms.pixelRatio.value = Math.max(1, Math.min(2, pixelRatio));
    }
  });
}

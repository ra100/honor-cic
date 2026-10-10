import * as THREE from 'three';
import { CULL_GLSL, pxPerUnit, RIBBON_GLSL } from './glsl';

/** Upload only the rows written this frame. */
function flush(attr: THREE.InstancedBufferAttribute, n: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.max(1, n) * attr.itemSize);
  attr.needsUpdate = true;
}

/** Glow shapes: Site A's blast billboard, a ring with a core (hyper footprints, shock fronts), and a tight spark. */
export const GLOW = { blast: 0, ring: 1, spark: 2 } as const;

const GLOW_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uPx;
attribute vec3 aPos;
attribute vec2 aSize;
attribute vec4 aCol;
attribute float aShape;
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float d = max(-mv.z, 1e-6);
  float r = aSize.x;
  if (r * uPx / d < aSize.y) r = aSize.y * d / uPx;
  mv.xy += position.xy * r;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  vUv = position.xy;
  vCol = aCol;
  vShape = aShape;
}`;

const GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float d = length(vUv);
  if (d > 1.0) discard;
  float g;
  if (vShape < 0.5) g = exp(-d * d * 10.0) * 1.4 + exp(-d * 4.0) * 0.35;
  else if (vShape < 1.5) g = exp(-pow((d - 0.74) * 10.0, 2.0)) * 0.85 + exp(-d * d * 40.0) * 0.8;
  else g = exp(-d * d * 22.0) * 1.6 + exp(-d * 6.0) * 0.12;
  g *= 1.0 - smoothstep(0.8, 1.0, d);
  gl_FragColor = vec4(vCol.rgb * g * vCol.a, 1.0);
}`;

/** Additive billboards with a pixel floor (A report §3.1 GLOW_VS, §4.8 blasts and sparks), rebuilt each frame. */
export class GlowBatch {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly col: Float32Array;
  private readonly shape: Float32Array;
  private n = 0;

  constructor(readonly capacity: number, renderOrder = 6) {
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity * 2);
    this.col = new Float32Array(capacity * 4);
    this.shape = new Float32Array(capacity);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, uniforms: { uPx: { value: 1000 } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  get drawn(): number {
    return this.n;
  }

  begin(heightPx: number, fovDeg: number, zoom: number): void {
    this.n = 0;
    this.material.uniforms.uPx.value = pxPerUnit(heightPx, fovDeg, zoom);
  }

  /** `radius` in render units; `minPx` CSS-pixel radius floor; colour is linear HDR (intensity > 1.1 blooms). */
  push(p: THREE.Vector3, radius: number, minPx: number, rgb: readonly number[], intensity: number, shape: number): void {
    if (this.n >= this.capacity || !(intensity > 0)) return;
    const i = this.n++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.size[i * 2] = radius; this.size[i * 2 + 1] = minPx;
    this.col[i * 4] = rgb[0]; this.col[i * 4 + 1] = rgb[1]; this.col[i * 4 + 2] = rgb[2]; this.col[i * 4 + 3] = intensity;
    this.shape[i] = shape;
  }

  commit(): void {
    for (const name of ['aPos', 'aSize', 'aCol', 'aShape']) flush(this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute, this.n);
    this.geometry.instanceCount = this.n;
  }

  positions(): Float32Array {
    return this.pos.slice(0, this.n * 3);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const BEAM_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aCol;
attribute vec2 aW;
varying vec2 vQ;
varying vec4 vCol;
varying float vPulse;
${RIBBON_GLSL}
void main() {
  vec3 a = (modelViewMatrix * vec4(aA, 1.0)).xyz;
  vec3 b = (modelViewMatrix * vec4(aB, 1.0)).xyz;
  if (!clipSeg(a, b)) { ${CULL_GLSL} return; }
  gl_Position = ribbonProj(a, b, position.x, position.y, aW.x, aW.x, aW.x * 0.5, aW.x * 0.5);
  #include <logdepthbuf_vertex>
  vQ = vec2(position.x, position.y);
  vCol = aCol;
  vPulse = aW.y;
}`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vQ;
varying vec4 vCol;
varying float vPulse;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float a = 1.0 - vQ.y * vQ.y;
  float I = vCol.a;
  if (vPulse > 0.0) {
    // Apollo telemetry (A report §4.8): brighter toward the missile, with pulses travelling outward.
    float x = clamp(vQ.x, 0.0, 1.0);
    float p = smoothstep(0.82, 1.0, fract(x * 22.0 - uTime * 0.9 + vPulse * 7.0));
    I *= 0.16 + 0.45 * x + p * 0.9;
  }
  gl_FragColor = vec4((vCol.rgb * a * a + vec3(pow(a, 8.0)) * 0.5) * I, 1.0);
}`;

/** Additive screen-space beams between two points (A report §4.8 lasing rods, grasers, telemetry), rebuilt each frame. */
export class BeamBatch {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly col: Float32Array;
  private readonly w: Float32Array;
  private n = 0;

  constructor(readonly capacity: number, renderOrder = 5) {
    this.a = new Float32Array(capacity * 3);
    this.b = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 4);
    this.w = new Float32Array(capacity * 2);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(this.a, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aB', new THREE.InstancedBufferAttribute(this.b, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aCol', new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aW', new THREE.InstancedBufferAttribute(this.w, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      uniforms: { uViewport: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.05 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  get drawn(): number {
    return this.n;
  }

  begin(widthPx: number, heightPx: number, near: number, t: number): void {
    this.n = 0;
    const u = this.material.uniforms;
    (u.uViewport.value as THREE.Vector2).set(widthPx, heightPx);
    u.uNear.value = near;
    u.uTime.value = t;
  }

  /** `pulse` > 0 draws Apollo telemetry pulses seeded by it. */
  push(a: THREE.Vector3, b: THREE.Vector3, rgb: readonly number[], intensity: number, widthPx: number, pulse = 0): void {
    if (this.n >= this.capacity || !(intensity > 0)) return;
    const i = this.n++;
    this.a[i * 3] = a.x; this.a[i * 3 + 1] = a.y; this.a[i * 3 + 2] = a.z;
    this.b[i * 3] = b.x; this.b[i * 3 + 1] = b.y; this.b[i * 3 + 2] = b.z;
    this.col[i * 4] = rgb[0]; this.col[i * 4 + 1] = rgb[1]; this.col[i * 4 + 2] = rgb[2]; this.col[i * 4 + 3] = intensity;
    this.w[i * 2] = widthPx * 0.5; this.w[i * 2 + 1] = pulse;
  }

  commit(): void {
    for (const name of ['aA', 'aB', 'aCol', 'aW']) flush(this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute, this.n);
    this.geometry.instanceCount = this.n;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

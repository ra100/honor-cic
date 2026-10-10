import * as THREE from 'three';
import { hashSeed, mulberry32 } from '../../core/rng';
import { CULL_GLSL, pxPerUnit, RIBBON_GLSL } from './glsl';

/** Site A missile streaks (A report §4.7): physical width and minimum CSS-pixel width. */
export const STREAK_PHYS_W_KM = 30;
export const STREAK_MIN_W_PX = 1.7;
/** Each missile draws between this share and all of its packet's trail, so a cloud's tails do not end on one plane. */
export const TRAIL_STAGGER = 0.55;
const TEX_W = 1024;
const PER = 4;
/** Local index of a retired instance: never below a packet's sampled count, so the shader always culls it. */
const RETIRED = 1e9;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform highp sampler2D uData;
uniform float uPx;
uniform float uPhysW;
uniform float uMinW;
uniform float uGain;
uniform float uTime;
attribute vec4 aOff;
attribute vec2 aPk;
varying vec2 vQ;
varying vec3 vCol;
varying float vI;
vec4 fetchData(int k) {
  int j = int(aPk.x + 0.5) * ${PER} + k;
  return texelFetch(uData, ivec2(j % ${TEX_W}, j / ${TEX_W}), 0);
}
${RIBBON_GLSL}
void main() {
  vec4 flags = fetchData(3);
  // flags: keep share, EW share, seconds to arrival, missiles sampled now. Later slots of a packet are spent missiles.
  if (aPk.y >= flags.w || aOff.w > flags.x) { ${CULL_GLSL} return; }
  vec4 head = fetchData(0);
  vec4 tail = fetchData(1);
  vec4 col = fetchData(2);
  vec3 pH = head.xyz + aOff.xyz * head.w;
  vec3 pT = tail.xyz + aOff.xyz * tail.w;
  pT = mix(pH, pT, ${TRAIL_STAGGER.toFixed(3)} + ${(1 - TRAIL_STAGGER).toFixed(3)} * fract(aOff.w * 31.7));
  vec4 mH = modelViewMatrix * vec4(pH, 1.0);
  vec4 mT = modelViewMatrix * vec4(pT, 1.0);
  vec3 ra = mT.xyz, rb = mH.xyz;
  if (!clipSeg(ra, rb)) { ${CULL_GLSL} return; }
  float w = clamp(uPhysW * uPx / max(-rb.z, 1e-9), uMinW, 7.0);
  gl_Position = ribbonProj(ra, rb, position.x, position.y, w * 0.45, w, 0.0, w * 0.8);
  #include <logdepthbuf_vertex>
  vQ = vec2(1.0 - position.x, position.y);
  vec3 c = col.rgb;
  float I = col.w;
  // EW birds: a share of each packet, paler, strobing on the last 45 s of the run (A report §4.7).
  if (fract(aOff.w * 7.31) < flags.y) {
    c = mix(c, vec3(1.0), 0.45);
    I *= 0.9;
    if (flags.z < 45.0) {
      float ph = fract(uTime * 0.9 + aOff.w * 17.0);
      float strobe = smoothstep(0.9, 0.97, ph) * (1.0 - smoothstep(0.97, 1.0, ph));
      I += strobe * 7.0;
      c = mix(c, vec3(0.9, 0.85, 1.0), strobe);
    }
  }
  float dh = -mH.z;
  float nearFade = dh > 0.0 ? smoothstep(uNear * 4.0, uNear * 200.0, dh) : 0.3;
  vCol = c;
  vI = I * uGain * nearFade;
}`;

const FRAG = /* glsl */ `
varying vec2 vQ;
varying vec3 vCol;
varying float vI;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float a = 1.0 - vQ.y * vQ.y;
  float along = clamp(1.0 - vQ.x, 0.0, 1.0);
  float g = a * a * (0.1 + 0.9 * along * along);
  float core = pow(a, 6.0) * along * along * along;
  gl_FragColor = vec4((vCol * g + vec3(core) * 0.7) * vI, 1.0);
}`;

export interface StreakPacket {
  head: THREE.Vector3;
  headSpread: number;
  tail: THREE.Vector3;
  tailSpread: number;
  rgb: readonly [number, number, number];
  intensity: number;
  keep: number;
  ewShare: number;
  toArrival: number;
}

interface Slot { start: number; size: number }

/**
 * Instanced screen-space ribbons, one per sampled missile, blended by MAX so a cloud saturates to its own hue instead of
 * white (A report §1.8, §4.7). Packet kinematics live in a float texture rewritten each frame. Each packet owns a fixed
 * run of instances sized for its launch count, so missiles lost to defences only hide slots and the instance buffers are
 * rebuilt only when packets launch or the sampling ratio changes.
 */
export class StreakLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly data: Float32Array<ArrayBuffer>;
  private readonly texture: THREE.DataTexture;
  private readonly off: Float32Array;
  private readonly pk: Float32Array;
  private readonly offAttr: THREE.InstancedBufferAttribute;
  private readonly pkAttr: THREE.InstancedBufferAttribute;
  private readonly rnd = new Map<number, Float32Array>();
  private readonly slots = new Map<number, Slot>();
  private readonly now: Uint32Array;
  private ratio = 0;
  private used = 0;
  private dirty: Array<[number, number]> = [];

  constructor(readonly packets: number, readonly capacity: number) {
    const rows = Math.max(1, Math.ceil((Math.max(1, packets) * PER) / TEX_W));
    this.data = new Float32Array(new ArrayBuffer(TEX_W * rows * 16));
    this.texture = new THREE.DataTexture(this.data, TEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.now = new Uint32Array(packets);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.off = new Float32Array(Math.max(1, capacity) * 4);
    this.pk = new Float32Array(Math.max(1, capacity) * 2);
    this.offAttr = new THREE.InstancedBufferAttribute(this.off, 4).setUsage(THREE.DynamicDrawUsage);
    this.pkAttr = new THREE.InstancedBufferAttribute(this.pk, 2).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aOff', this.offAttr);
    this.geometry.setAttribute('aPk', this.pkAttr);
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uData: { value: this.texture }, uViewport: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.05 },
        uPx: { value: 1000 }, uPhysW: { value: STREAK_PHYS_W_KM }, uMinW: { value: STREAK_MIN_W_PX }, uGain: { value: 1 }, uTime: { value: 0 },
      },
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  /** Sampled missiles this frame: one streak each, before the crowded-view share is applied. */
  get count(): number {
    let n = 0;
    for (const [i, s] of this.slots) n += Math.min(s.size, this.now[i]);
    return n;
  }

  private randoms(seed: number, n: number): Float32Array {
    const have = this.rnd.get(seed);
    if (have && have.length >= n) return have;
    const rng = mulberry32(hashSeed('streak', seed));
    const out = new Float32Array(Math.max(n, 64));
    for (let i = 0; i < out.length; i++) out[i] = rng();
    this.rnd.set(seed, out);
    return out;
  }

  private fill(i: number, slot: Slot, seed: number, offsets: Float32Array): void {
    const r = this.randoms(seed, slot.size);
    for (let k = 0; k < slot.size; k++) {
      const at = slot.start + k;
      this.off[at * 4] = offsets[k * 3];
      this.off[at * 4 + 1] = offsets[k * 3 + 1];
      this.off[at * 4 + 2] = offsets[k * 3 + 2];
      this.off[at * 4 + 3] = r[k];
      this.pk[at * 2] = i;
      this.pk[at * 2 + 1] = k;
    }
    this.dirty.push([slot.start, slot.size]);
  }

  /**
   * `now[i]` missiles of packet i are sampled this frame; `size(i)` is the most it will ever need at this ratio (its
   * launch count). Offsets and randoms stay attached to a missile for its whole flight, so scrubbing never reshuffles.
   */
  plan(now: Uint32Array, ratio: number, size: (i: number) => number, seeds: (i: number) => number, offsets: (i: number, n: number) => Float32Array): void {
    this.now.set(now);
    let rebuild = ratio !== this.ratio;
    const need: number[] = [];
    let live = 0;
    for (let i = 0; i < now.length && !rebuild; i++) {
      if (now[i] === 0) continue;
      const slot = this.slots.get(i);
      if (!slot) need.push(i);
      else if (slot.size < now[i]) rebuild = true;
      else live += slot.size;
    }
    let extra = 0;
    for (const i of need) extra += Math.min(size(i), this.capacity);
    if (!rebuild && this.used + extra > this.capacity) rebuild = true;
    if (rebuild) {
      this.ratio = ratio;
      this.slots.clear();
      this.used = 0;
      this.dirty = [];
      const suffix = new Float64Array(now.length + 1);
      for (let j = now.length - 1; j >= 0; j--) suffix[j] = suffix[j + 1] + now[j];
      for (let i = 0; i < now.length; i++) {
        if (now[i] === 0) continue;
        const n = Math.max(now[i], Math.min(size(i), this.capacity - this.used - suffix[i + 1]));
        if (this.used + n > this.capacity) break;
        this.claim(i, n, seeds, offsets);
      }
    } else {
      for (const i of need) this.claim(i, Math.min(size(i), this.capacity - this.used), seeds, offsets);
      // Forget gone packets once their slots outweigh the live ones; their instances are retired so a packet that
      // comes back (scrubbing) never draws twice, and the next launch that does not fit compacts the buffers.
      if (live < this.used / 2) {
        for (const [i, slot] of [...this.slots]) {
          if (now[i] !== 0) continue;
          for (let k = 0; k < slot.size; k++) this.pk[(slot.start + k) * 2 + 1] = RETIRED;
          this.dirty.push([slot.start, slot.size]);
          this.slots.delete(i);
        }
      }
    }
    this.geometry.instanceCount = this.used;
    if (this.dirty.length) {
      this.offAttr.clearUpdateRanges();
      this.pkAttr.clearUpdateRanges();
      for (const [start, n] of this.dirty) {
        this.offAttr.addUpdateRange(start * 4, n * 4);
        this.pkAttr.addUpdateRange(start * 2, n * 2);
      }
      this.offAttr.needsUpdate = true;
      this.pkAttr.needsUpdate = true;
      this.dirty = [];
    }
  }

  private claim(i: number, n: number, seeds: (i: number) => number, offsets: (i: number, n: number) => Float32Array): void {
    if (n <= 0) return;
    const slot = { start: this.used, size: n };
    this.slots.set(i, slot);
    this.used += n;
    this.fill(i, slot, seeds(i), offsets(i, n));
  }

  hide(i: number): void {
    this.data[(i * PER + 3) * 4 + 3] = 0;
  }

  write(i: number, p: StreakPacket): void {
    const d = this.data;
    let at = i * PER * 4;
    d[at++] = p.head.x; d[at++] = p.head.y; d[at++] = p.head.z; d[at++] = p.headSpread;
    d[at++] = p.tail.x; d[at++] = p.tail.y; d[at++] = p.tail.z; d[at++] = p.tailSpread;
    d[at++] = p.rgb[0]; d[at++] = p.rgb[1]; d[at++] = p.rgb[2]; d[at++] = p.intensity;
    d[at++] = p.keep; d[at++] = p.ewShare; d[at++] = p.toArrival; d[at] = this.now[i];
  }

  view(widthPx: number, heightPx: number, fovDeg: number, zoom: number, near: number, gain: number, t: number): void {
    const u = this.material.uniforms;
    (u.uViewport.value as THREE.Vector2).set(widthPx, heightPx);
    u.uPx.value = pxPerUnit(heightPx, fovDeg, zoom);
    u.uNear.value = near;
    u.uGain.value = gain;
    u.uTime.value = t;
  }

  commit(): void {
    this.texture.needsUpdate = true;
  }

  /** Every sampled missile in packet order: [slot, packet] pairs, independent of where the allocator put them. */
  private *sampled(): Generator<[number, number]> {
    const order = [...this.slots.keys()].sort((a, b) => a - b);
    for (const i of order) {
      const s = this.slots.get(i)!;
      const n = Math.min(s.size, this.now[i]);
      for (let k = 0; k < n; k++) yield [s.start + k, i];
    }
  }

  private kept(slot: number, i: number): boolean {
    return this.off[slot * 4 + 3] <= this.data[(i * PER + 3) * 4];
  }

  /** CPU mirror of the vertex shader for inspection: [head xyz, tail xyz] of every streak drawn this frame. */
  segments(): Float32Array {
    const out: number[] = [];
    const d = this.data;
    for (const [n, i] of this.sampled()) {
      if (!this.kept(n, i)) continue;
      const at = i * PER * 4;
      const ox = this.off[n * 4], oy = this.off[n * 4 + 1], oz = this.off[n * 4 + 2];
      const hx = d[at] + ox * d[at + 3], hy = d[at + 1] + oy * d[at + 3], hz = d[at + 2] + oz * d[at + 3];
      const r = this.off[n * 4 + 3] * 31.7;
      const k = TRAIL_STAGGER + (1 - TRAIL_STAGGER) * (r - Math.floor(r));
      out.push(hx, hy, hz,
        hx + (d[at + 4] + ox * d[at + 7] - hx) * k, hy + (d[at + 5] + oy * d[at + 7] - hy) * k, hz + (d[at + 6] + oz * d[at + 7] - hz) * k);
    }
    return new Float32Array(out);
  }

  /** Head position of every sampled missile, drawn or thinned, in packet order. */
  heads(): Float32Array {
    const out: number[] = [];
    const d = this.data;
    for (const [n, i] of this.sampled()) {
      const at = i * PER * 4;
      out.push(d[at] + this.off[n * 4] * d[at + 3], d[at + 1] + this.off[n * 4 + 1] * d[at + 3], d[at + 2] + this.off[n * 4 + 2] * d[at + 3]);
    }
    return new Float32Array(out);
  }

  /** Streaks drawn this frame, after the crowded-view share. */
  drawn(): number {
    let n = 0;
    for (const [slot, i] of this.sampled()) if (this.kept(slot, i)) n++;
    return n;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

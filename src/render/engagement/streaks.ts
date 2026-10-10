import * as THREE from 'three';
import { hashSeed, mulberry32 } from '../../core/rng';
import { CULL_GLSL, pxPerUnit, RIBBON_GLSL } from './glsl';

/** Site A missile streaks (A report §4.7): physical width and minimum CSS-pixel width. */
export const STREAK_PHYS_W_KM = 30;
export const STREAK_MIN_W_PX = 1.7;
/** Each missile draws between this share and all of its packet's trail, so a cloud's tails do not end on one plane. */
export const TRAIL_STAGGER = 0.55;
const TEX_W = 1024;
/** Texels per packet: head, tail, colour, flags, launch offset, aim offset, launch/aim weights at head and tail. */
const PER = 7;
/** Local index of a retired instance: never below a packet's sampled count, so the shader always culls it. */
const RETIRED = 1e9;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform highp sampler2D uData;
uniform highp sampler2D uAnch;
uniform float uPx;
uniform float uPhysW;
uniform float uMinW;
uniform float uGain;
uniform float uTime;
attribute vec4 aOff;
attribute vec2 aPk;
attribute vec2 aAnc;
varying vec2 vQ;
varying vec3 vCol;
varying float vI;
vec4 fetchData(int k) {
  int j = int(aPk.x + 0.5) * ${PER} + k;
  return texelFetch(uData, ivec2(j % ${TEX_W}, j / ${TEX_W}), 0);
}
vec4 fetchAnchor(float a) {
  int j = int(a + 0.5);
  return texelFetch(uAnch, ivec2(j % ${TEX_W}, j / ${TEX_W}), 0);
}
${RIBBON_GLSL}
void main() {
  vec4 flags = fetchData(3);
  // flags: keep share, EW share, seconds to arrival, missiles sampled now. Later slots of a packet are spent missiles.
  if (aPk.y >= flags.w || aOff.w > flags.x) { ${CULL_GLSL} return; }
  vec4 head = fetchData(0);
  vec4 tail = fetchData(1);
  vec4 col = fetchData(2);
  // Each missile leaves its own launcher's glyph and comes down on its own target's: the offsets of those glyphs from
  // their fleet centres replace the packet's solved launch and aim offsets, weighted in near either end of the flight.
  vec4 launchOff = fetchData(4);
  vec4 aimOff = fetchData(5);
  vec4 wts = fetchData(6);
  vec4 la = fetchAnchor(aAnc.x);
  vec4 ta = fetchAnchor(aAnc.y);
  vec3 cL = la.w > 0.5 ? la.xyz - launchOff.xyz : vec3(0.0);
  vec3 cT = ta.w > 0.5 ? ta.xyz - aimOff.xyz : vec3(0.0);
  vec3 pH = head.xyz + aOff.xyz * head.w + wts.x * cL + wts.y * cT;
  vec3 pT = tail.xyz + aOff.xyz * tail.w + wts.z * cL + wts.w * cT;
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
  /** The packet's solved launch point from its launching unit's centre, and its aim point from the target unit's. */
  launchOff: THREE.Vector3;
  aimOff: THREE.Vector3;
  /** How far each missile is pulled onto its launcher's glyph [0] and its target's glyph [1], at the head and the tail. */
  headPull: readonly [number, number];
  tailPull: readonly [number, number];
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
  private readonly anchorData: Float32Array<ArrayBuffer>;
  private readonly anchorTexture: THREE.DataTexture;
  private readonly off: Float32Array;
  private readonly pk: Float32Array;
  private readonly anc: Float32Array;
  private readonly offAttr: THREE.InstancedBufferAttribute;
  private readonly pkAttr: THREE.InstancedBufferAttribute;
  private readonly ancAttr: THREE.InstancedBufferAttribute;
  private readonly rnd = new Map<number, Float32Array>();
  private readonly slots = new Map<number, Slot>();
  private readonly now: Uint32Array;
  private ratio = 0;
  private used = 0;
  private dirty: Array<[number, number]> = [];

  /**
   * `anchors` sizes the table of launch and aim points: index 0 means none, the rest are glyphs (ships, LAC swarm points)
   * written each frame as offsets from their unit's centre.
   */
  constructor(readonly packets: number, readonly capacity: number, readonly anchors = 1) {
    const texture = (data: Float32Array<ArrayBuffer>, rows: number) => {
      const tex = new THREE.DataTexture(data, TEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
      tex.minFilter = THREE.NearestFilter;
      tex.magFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      return tex;
    };
    const rows = Math.max(1, Math.ceil((Math.max(1, packets) * PER) / TEX_W));
    this.data = new Float32Array(new ArrayBuffer(TEX_W * rows * 16));
    this.texture = texture(this.data, rows);
    const anchorRows = Math.max(1, Math.ceil(Math.max(1, anchors) / TEX_W));
    this.anchorData = new Float32Array(new ArrayBuffer(TEX_W * anchorRows * 16));
    this.anchorTexture = texture(this.anchorData, anchorRows);
    this.now = new Uint32Array(packets);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    this.geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.off = new Float32Array(Math.max(1, capacity) * 4);
    this.pk = new Float32Array(Math.max(1, capacity) * 2);
    this.anc = new Float32Array(Math.max(1, capacity) * 2);
    this.offAttr = new THREE.InstancedBufferAttribute(this.off, 4).setUsage(THREE.DynamicDrawUsage);
    this.pkAttr = new THREE.InstancedBufferAttribute(this.pk, 2).setUsage(THREE.DynamicDrawUsage);
    this.ancAttr = new THREE.InstancedBufferAttribute(this.anc, 2).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aOff', this.offAttr);
    this.geometry.setAttribute('aPk', this.pkAttr);
    this.geometry.setAttribute('aAnc', this.ancAttr);
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uData: { value: this.texture }, uAnch: { value: this.anchorTexture }, uViewport: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.05 },
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

  private fill(i: number, slot: Slot, seed: number, offsets: Float32Array, anchors: Float32Array | null): void {
    const r = this.randoms(seed, slot.size);
    for (let k = 0; k < slot.size; k++) {
      const at = slot.start + k;
      this.off[at * 4] = offsets[k * 3];
      this.off[at * 4 + 1] = offsets[k * 3 + 1];
      this.off[at * 4 + 2] = offsets[k * 3 + 2];
      this.off[at * 4 + 3] = r[k];
      this.pk[at * 2] = i;
      this.pk[at * 2 + 1] = k;
      this.anc[at * 2] = anchors?.[k * 2] ?? 0;
      this.anc[at * 2 + 1] = anchors?.[k * 2 + 1] ?? 0;
    }
    this.dirty.push([slot.start, slot.size]);
  }

  /** Glyph j's offset from its unit's centre this frame, render units. Unset anchors pull nothing. */
  setAnchor(j: number, x: number, y: number, z: number): void {
    if (j <= 0 || j >= this.anchors) return;
    const a = j * 4;
    this.anchorData[a] = x; this.anchorData[a + 1] = y; this.anchorData[a + 2] = z; this.anchorData[a + 3] = 1;
  }

  clearAnchors(): void {
    this.anchorData.fill(0);
  }

  /** Glyph j's offset from its unit's centre as last set, render units; false when unset. */
  anchorOffset(j: number, out: THREE.Vector3): boolean {
    const a = j * 4;
    if (j <= 0 || j >= this.anchors || !(this.anchorData[a + 3] > 0.5)) return false;
    out.set(this.anchorData[a], this.anchorData[a + 1], this.anchorData[a + 2]);
    return true;
  }

  /**
   * `now[i]` missiles of packet i are sampled this frame; `size(i)` is the most it will ever need at this ratio (its
   * launch count). Offsets and randoms stay attached to a missile for its whole flight, so scrubbing never reshuffles.
   */
  plan(
    now: Uint32Array, ratio: number, size: (i: number) => number, seeds: (i: number) => number, offsets: (i: number, n: number) => Float32Array,
    anchors?: (i: number, n: number) => Float32Array,
  ): void {
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
        this.claim(i, n, seeds, offsets, anchors);
      }
    } else {
      for (const i of need) this.claim(i, Math.min(size(i), this.capacity - this.used), seeds, offsets, anchors);
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
      this.ancAttr.clearUpdateRanges();
      for (const [start, n] of this.dirty) {
        this.offAttr.addUpdateRange(start * 4, n * 4);
        this.pkAttr.addUpdateRange(start * 2, n * 2);
        this.ancAttr.addUpdateRange(start * 2, n * 2);
      }
      this.offAttr.needsUpdate = true;
      this.pkAttr.needsUpdate = true;
      this.ancAttr.needsUpdate = true;
      this.dirty = [];
    }
  }

  private claim(
    i: number, n: number, seeds: (i: number) => number, offsets: (i: number, n: number) => Float32Array,
    anchors?: (i: number, n: number) => Float32Array,
  ): void {
    if (n <= 0) return;
    const slot = { start: this.used, size: n };
    this.slots.set(i, slot);
    this.used += n;
    this.fill(i, slot, seeds(i), offsets(i, n), anchors?.(i, n) ?? null);
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
    d[at++] = p.keep; d[at++] = p.ewShare; d[at++] = p.toArrival; d[at++] = this.now[i];
    d[at++] = p.launchOff.x; d[at++] = p.launchOff.y; d[at++] = p.launchOff.z; d[at++] = 0;
    d[at++] = p.aimOff.x; d[at++] = p.aimOff.y; d[at++] = p.aimOff.z; d[at++] = 0;
    d[at++] = p.headPull[0]; d[at++] = p.headPull[1]; d[at++] = p.tailPull[0]; d[at] = p.tailPull[1];
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
    this.anchorTexture.needsUpdate = true;
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

  /** CPU mirror of the vertex shader: a streak's head and tail for instance `n` of packet `i`. */
  private ends(n: number, i: number, head: Float64Array, tail: Float64Array): void {
    const d = this.data;
    const at = i * PER * 4;
    const ox = this.off[n * 4], oy = this.off[n * 4 + 1], oz = this.off[n * 4 + 2];
    const pull = (a: number, base: number, out: Float64Array) => {
      const j = Math.round(a) * 4;
      if (!(this.anchorData[j + 3] > 0.5)) return out.fill(0);
      out[0] = this.anchorData[j] - d[at + base];
      out[1] = this.anchorData[j + 1] - d[at + base + 1];
      out[2] = this.anchorData[j + 2] - d[at + base + 2];
      return out;
    };
    const cL = pull(this.anc[n * 2], 16, new Float64Array(3));
    const cT = pull(this.anc[n * 2 + 1], 20, new Float64Array(3));
    const w = at + 24;
    for (let c = 0; c < 3; c++) {
      const o = c === 0 ? ox : c === 1 ? oy : oz;
      head[c] = d[at + c] + o * d[at + 3] + d[w] * cL[c] + d[w + 1] * cT[c];
      tail[c] = d[at + 4 + c] + o * d[at + 7] + d[w + 2] * cL[c] + d[w + 3] * cT[c];
    }
  }

  /** CPU mirror of the vertex shader for inspection: [head xyz, tail xyz] of every streak drawn this frame. */
  segments(): Float32Array {
    const out: number[] = [];
    const head = new Float64Array(3), tail = new Float64Array(3);
    for (const [n, i] of this.sampled()) {
      if (!this.kept(n, i)) continue;
      this.ends(n, i, head, tail);
      const r = this.off[n * 4 + 3] * 31.7;
      const k = TRAIL_STAGGER + (1 - TRAIL_STAGGER) * (r - Math.floor(r));
      out.push(head[0], head[1], head[2], head[0] + (tail[0] - head[0]) * k, head[1] + (tail[1] - head[1]) * k, head[2] + (tail[2] - head[2]) * k);
    }
    return new Float32Array(out);
  }

  /** Head position of every sampled missile, drawn or thinned, in packet order. */
  heads(): Float32Array {
    const out: number[] = [];
    const head = new Float64Array(3), tail = new Float64Array(3);
    for (const [n, i] of this.sampled()) {
      this.ends(n, i, head, tail);
      out.push(head[0], head[1], head[2]);
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
    this.anchorTexture.dispose();
  }
}

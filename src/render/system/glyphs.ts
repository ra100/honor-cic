import * as THREE from 'three';

/** Glyph shapes (A report §4.5): wall diamond, carrier square, screen triangle, LAC disc, contact ring. */
export const GLYPH = { wall: 0, carrier: 1, screen: 2, lac: 3, contact: 4 } as const;
/** Wedge bar tints: none, Site A allied cyan, Site A hostile magenta. */
export const BARS = { none: 0, allied: 1, hostile: 2 } as const;

const VS = /* glsl */ `
uniform float pixelRatio;
attribute vec3 aCol; attribute vec3 aFwd; attribute vec3 aUp; attribute vec4 aMisc;
varying vec3 vCol; varying vec2 vF; varying vec2 vU; varying float vShape; varying float vAlpha; varying float vBars; varying float vR;
vec2 screenDir(vec4 mv, vec3 dirView, float asp) {
  float eps = max(-mv.z, 1e-6) * 0.01;
  vec4 a = projectionMatrix * mv;
  vec4 b = projectionMatrix * vec4(mv.xyz + dirView * eps, 1.0);
  vec2 d = b.xy / b.w - a.xy / a.w;
  return vec2(d.x * asp, d.y);
}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float asp = projectionMatrix[1][1] / projectionMatrix[0][0];
  vec2 f = screenDir(mv, normalize(mat3(modelViewMatrix) * aFwd), asp);
  vec2 u = screenDir(mv, normalize(mat3(modelViewMatrix) * aUp), asp);
  float m = max(max(length(f), length(u)), 1e-9);
  vF = f / m; vU = u / m;
  vCol = aCol; vShape = aMisc.y; vAlpha = aMisc.z; vBars = aMisc.w;
  vR = aMisc.x;
  gl_PointSize = aMisc.x * 2.0 * 2.6 * pixelRatio;
}`;

const FS = /* glsl */ `
varying vec3 vCol; varying vec2 vF; varying vec2 vU; varying float vShape; varying float vAlpha; varying float vBars; varying float vR;
float segD(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0); return length(pa - ba * h); }
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r; p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdBox(vec2 p, float b) { vec2 q = abs(p) - vec2(b); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.0 * 2.6;
  p.y = -p.y;
  float aa = 1.3 / max(vR, 0.5);
  float d;
  if (vShape < 0.5) d = (abs(p.x) + abs(p.y) - 1.0) * 0.7071;
  else if (vShape < 1.5) d = sdBox(p, 0.8);
  else if (vShape < 2.5) d = sdTri(p * vec2(1.0, -1.0) + vec2(0.0, 0.1), 0.95);
  else if (vShape < 3.5) d = length(p) - 0.9;
  else d = length(p) - 0.85;
  float lw = 0.11;
  float a = max(1.0 - smoothstep(0.0, aa, abs(d) - lw), (1.0 - smoothstep(0.0, aa, d)) * 0.22);
  if (vShape > 2.5 && vShape < 3.5) a = 1.0 - smoothstep(0.0, aa, d);
  vec3 col = vCol;
  if (vBars > 0.5) {
    vec2 o = vU * 1.45, e = vF * 1.55;
    float bar = min(segD(p, o - e, o + e), segD(p, -o - e, -o + e));
    float ba = (1.0 - smoothstep(0.0, aa, bar - 0.07)) * 0.85;
    vec3 wc = vBars < 1.5 ? vec3(0.0, 0.82, 1.0) : vec3(1.0, 0.25, 0.7);
    if (ba > a) col = wc;
    a = max(a, ba);
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * 0.9, a);
}`;

/**
 * Site A's tactical ship glyphs at system scale: screen-space icons with roof and floor wedge bars that follow each
 * ship's projected orientation, always drawn on top. Hundreds of them overlap into the cyan and magenta fleet blobs.
 */
export class GlyphCloud {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly fwd: Float32Array;
  private readonly up: Float32Array;
  private readonly misc: Float32Array;
  private n = 0;

  constructor(readonly capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.fwd = new Float32Array(capacity * 3);
    this.up = new Float32Array(capacity * 3);
    this.misc = new Float32Array(capacity * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aFwd', new THREE.BufferAttribute(this.fwd, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aUp', new THREE.BufferAttribute(this.up, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMisc', new THREE.BufferAttribute(this.misc, 4).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: { pixelRatio: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  get drawn(): number {
    return this.n;
  }

  begin(): void {
    this.n = 0;
  }

  /** radiusPx is Site A's glyph radius R in CSS px; the sprite spans 2.6 R either side. */
  push(p: THREE.Vector3, rgb: [number, number, number], fwd: ArrayLike<number>, up: ArrayLike<number>, radiusPx: number, shape: number, alpha: number, bars: number): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.col.set(rgb, i * 3);
    this.fwd[i * 3] = fwd[0]; this.fwd[i * 3 + 1] = fwd[1]; this.fwd[i * 3 + 2] = fwd[2];
    this.up[i * 3] = up[0]; this.up[i * 3 + 1] = up[1]; this.up[i * 3 + 2] = up[2];
    this.misc[i * 4] = radiusPx; this.misc[i * 4 + 1] = shape; this.misc[i * 4 + 2] = Math.max(0, Math.min(1, alpha)); this.misc[i * 4 + 3] = bars;
  }

  commit(): void {
    const g = this.points.geometry;
    for (const name of ['position', 'aCol', 'aFwd', 'aUp', 'aMisc']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.n);
  }
}

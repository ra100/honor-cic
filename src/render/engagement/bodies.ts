import * as THREE from 'three';
import { baseValue } from '../../core/evidence';
import type { CelestialBody } from '../../core/schema';
import { bodyPosition } from '../../core/solver/orbits';
import { kmToLm } from '../../core/units';
import type { Vec3 } from '../../core/vec';
import type { LabelSpec } from '../labels';
import { GLOW, GlowBatch } from './fx';
import { pxPerUnit } from './glsl';

/** Site A marker colours (A report §3.4): temperate planet, Junction violet. */
const PLANET_RGB: readonly number[] = [0.45, 0.8, 0.85];
const TERMINUS_RGB: readonly number[] = [0.65, 0.45, 1.0];
/** Site A star glow: tint (1, 0.95, 0.85), I 2.2, 26 px radius floor (A report §3.1). */
const STAR_RGB: readonly number[] = [1.0, 0.9, 0.74];
const STAR_GLOW_KM = 12_000_000;
const STAR_MIN_PX = 26;
const PLANET_MIN_PX = 9;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uPx;
uniform float uDpr;
attribute vec4 aC;
attribute vec4 aL;
varying vec3 vC;
varying vec3 vL;
varying float vKind;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = max(-mv.z, 1e-6);
  // Sprite radius in CSS px: the shaded disc fills 0.7 of it, so a close planet grows to its physical size.
  float px = max(aL.w * uPx / d / 0.7, aC.w);
  gl_PointSize = min(px, 512.0) * 2.0 * uDpr;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
  vC = aC.rgb;
  vL = normalize((viewMatrix * vec4(aL.xyz, 0.0)).xyz);
  vKind = aL.w > 0.0 ? 0.0 : 1.0;
}`;

const FRAG = /* glsl */ `
varying vec3 vC;
varying vec3 vL;
varying float vKind;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  float r = length(p);
  if (r > 1.0) discard;
  vec3 c;
  if (vKind < 0.5) {
    // A lit planet disc (Site B draws real spheres): diffuse from the star, a thin atmosphere rim, A's marker ring.
    float disc = 1.0 - smoothstep(0.66, 0.72, r);
    vec3 n = vec3(p / 0.7, sqrt(max(0.0, 1.0 - dot(p, p) / 0.49)));
    float lit = max(dot(n, vL), 0.0);
    float rim = smoothstep(0.55, 0.7, r) * disc;
    float ring = 1.0 - smoothstep(0.0, 0.06, abs(r - 0.88));
    c = vC * (0.04 + 0.62 * lit) * disc + vC * rim * (0.2 + 0.4 * lit) + vC * ring * 0.3;
  } else {
    // Site A MARK_FS: dot plus thin ring.
    float core = 1.0 - smoothstep(0.35, 0.55, r);
    float ring = 1.0 - smoothstep(0.0, 0.12, abs(r - 0.85));
    c = vC * (core * 1.3 + ring * 0.6);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Planet subtitle in Site A's form: "Manticore-A IV · 15.3 LM · HMSS Vulcan". */
export function planetSubtitle(body: CelestialBody, bodies: Map<string, CelestialBody>): string {
  const parts: string[] = [];
  const parent = body.parent_id ? bodies.get(body.parent_id) : undefined;
  if (parent && body.ordinal) parts.push(`${parent.name} ${ROMAN[body.ordinal] ?? body.ordinal}`);
  const orbit = baseValue(body.orbit?.radius);
  if (orbit !== null && orbit !== undefined) parts.push(`${Number(kmToLm(orbit).toFixed(1))} LM`);
  for (const s of bodies.values()) if (s.kind === 'station' && s.parent_id === body.id) parts.push(s.name);
  return parts.join(' · ');
}

/** Stars, planets and termini near the engagement: Site A glows and markers, shaded discs for planets. */
export class BodyLayer {
  readonly points: THREE.Points;
  readonly glows = new GlowBatch(8, 9);
  private readonly material: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly light: Float32Array;
  private readonly list: CelestialBody[];
  private n = 0;
  private readonly v = new THREE.Vector3();

  constructor(private readonly bodies: Map<string, CelestialBody>) {
    this.list = [...bodies.values()].filter((b) => b.kind === 'planet' || b.kind === 'terminus');
    const cap = Math.max(1, this.list.length);
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.light = new Float32Array(cap * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aC', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aL', new THREE.BufferAttribute(this.light, 4).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uPx: { value: 1000 }, uDpr: { value: 1 } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  get drawn(): number {
    return this.n + this.glows.drawn;
  }

  /**
   * Draw bodies within `reachKm` of the ring centre and every star. Labels only within `labelKm`, so the far system
   * stays as quiet markers. `toRender` maps km into the view's floating-origin units.
   */
  update(t: number, centre: Vec3, reachKm: number, labelKm: number, kmPerUnit: number, toRender: (km: Vec3) => THREE.Vector3,
    heightPx: number, fovDeg: number, zoom: number, dpr: number, labels: LabelSpec[], on: boolean): void {
    this.n = 0;
    this.glows.begin(heightPx, fovDeg, zoom);
    this.material.uniforms.uPx.value = pxPerUnit(heightPx, fovDeg, zoom);
    this.material.uniforms.uDpr.value = dpr;
    if (on) {
      for (const b of this.bodies.values()) {
        if (b.kind !== 'star') continue;
        const p = bodyPosition(this.bodies, b.id, t);
        this.glows.push(toRender(p), STAR_GLOW_KM / kmPerUnit, STAR_MIN_PX, STAR_RGB, 2.2, GLOW.blast);
        if (Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]) < labelKm * 3) {
          const mass = baseValue(b.mass);
          labels.push({ key: `body:${b.id}`, cls: 'star', text: b.name, sub: mass ? `${mass} solar masses` : undefined, pos: toRender(p).clone() });
        }
      }
      for (const b of this.list) {
        const p = bodyPosition(this.bodies, b.id, t);
        const km = Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
        if (km > reachKm) continue;
        const r = toRender(p);
        const i = this.n++;
        this.pos[i * 3] = r.x; this.pos[i * 3 + 1] = r.y; this.pos[i * 3 + 2] = r.z;
        const terminus = b.kind === 'terminus';
        const rgb = terminus ? TERMINUS_RGB : PLANET_RGB;
        this.col[i * 4] = rgb[0]; this.col[i * 4 + 1] = rgb[1]; this.col[i * 4 + 2] = rgb[2];
        this.col[i * 4 + 3] = terminus ? 7 : PLANET_MIN_PX;
        const star = b.parent_id ? this.starOf(b.id) : null;
        const sp = star ? bodyPosition(this.bodies, star, t) : p;
        const lx = sp[0] - p[0], ly = sp[1] - p[1], lz = sp[2] - p[2];
        const ll = Math.hypot(lx, ly, lz) || 1;
        const radius = terminus ? 0 : (baseValue(b.radius) ?? 6_000) / kmPerUnit;
        this.light[i * 4] = lx / ll; this.light[i * 4 + 1] = ly / ll; this.light[i * 4 + 2] = lz / ll; this.light[i * 4 + 3] = radius;
        if (km <= labelKm) {
          labels.push({
            key: `body:${b.id}`, cls: terminus ? 'junction' : 'planet', text: b.name,
            sub: terminus ? 'Junction terminus' : planetSubtitle(b, this.bodies) || undefined, pos: this.v.copy(r).clone(),
          });
        }
      }
    }
    const g = this.points.geometry;
    for (const name of ['position', 'aC', 'aL']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.n);
    this.glows.commit();
  }

  private starOf(id: string): string | null {
    let b = this.bodies.get(id);
    while (b && b.parent_id) {
      const parent = this.bodies.get(b.parent_id);
      if (!parent) return null;
      if (parent.kind === 'star') return parent.id;
      b = parent;
    }
    return null;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
    this.glows.dispose();
  }
}

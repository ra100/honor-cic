import * as THREE from 'three';
import type { ConeExclusion, Exclusion, SphereExclusion } from '../../core/solver/orbits';
import { add, cross, dot, len, norm, scale, sub, type Vec3 } from '../../core/vec';
import type { RingPlan } from './focus';

/** Site A's grid colour (A report §4.1), a raw linear value like every ported shader colour. */
const GRID_RGB = new THREE.Vector3(0.0, 0.5, 0.8);
/** Site B's hyper-limit arc, 0xb39a6b at 0.65 (B report §3.1), linearised. */
const LIMIT_RGB = new THREE.Vector3(0.45, 0.32, 0.15).multiplyScalar(0.65);
/** Site A's Resonant Zone violet (A report §3.8). */
const ZONE_RGB = new THREE.Vector3(0.45, 0.25, 0.85);
/** Boundaries are drawn out to this many disc radii from the ring centre. */
export const BOUNDARY_REACH = 5;
const MAX_SPHERES = 2;
const MAX_CONES = 2;

const VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uHalf;
varying vec2 vP;
varying vec3 vView;
varying vec3 vNrm;
void main() {
  vec3 local = vec3(position.xy * uHalf, 0.0);
  vP = local.xy;
  vec4 mv = modelViewMatrix * vec4(local, 1.0);
  vView = mv.xyz;
  vNrm = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uHalf;
uniform float uR;
uniform float uRing;
uniform float uRing2;
uniform float uMix;
uniform float uFade;
uniform float uBFade;
uniform vec2 uBear;
uniform vec3 uCol;
uniform vec3 uLimitCol;
uniform vec3 uZoneCol;
uniform int uNH;
uniform vec4 uHyper[${MAX_SPHERES}];
uniform int uNC;
uniform vec3 uConeB[${MAX_CONES}];
uniform vec3 uConeA[${MAX_CONES}];
uniform float uConeR[${MAX_CONES}];
varying vec2 vP;
varying vec3 vView;
varying vec3 vNrm;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vP);
  if (r > uHalf) discard;
  vec3 c = vec3(0.0);
  float w = max(fwidth(r), 1e-6);
  // Seen edge-on the plane only produces moire, so it fades as the view grazes it.
  float graze = smoothstep(0.03, 0.14, abs(dot(normalize(-vView), vNrm)));
  if (r < uR && uFade > 0.0) {
    // Site A GRID_FS: minor rings, majors on every second ring, 24 spokes; one spoke lies on the bearing to the enemy.
    // Next to a switch between spacings both sets are drawn, crossfaded by uMix, so the grid never snaps.
    float dR = abs(fract(r / uRing + 0.5) - 0.5) * uRing;
    float dM = abs(fract(r / (uRing * 2.0) + 0.5) - 0.5) * uRing * 2.0;
    float dR2 = abs(fract(r / uRing2 + 0.5) - 0.5) * uRing2;
    float dM2 = abs(fract(r / (uRing2 * 2.0) + 0.5) - 0.5) * uRing2 * 2.0;
    float minor1 = (1.0 - smoothstep(0.0, w * 1.3, dR)) * 0.32 + (1.0 - smoothstep(0.0, w * 1.6, dM)) * 0.55;
    float minor2 = (1.0 - smoothstep(0.0, w * 1.3, dR2)) * 0.32 + (1.0 - smoothstep(0.0, w * 1.6, dM2)) * 0.55;
    float moire1 = 1.0 - smoothstep(0.22, 0.5, w / uRing);
    float moire2 = 1.0 - smoothstep(0.22, 0.5, w / uRing2);
    float rings = mix(minor1 * moire1, minor2 * moire2, uMix);
    mat2 toQ = mat2(uBear.x, -uBear.y, uBear.y, uBear.x);
    vec2 q = toQ * vP;
    float th = atan(q.y, q.x), st = 3.14159265 / 12.0;
    float ang = floor(th / st + 0.5) * st;
    vec2 sn = vec2(sin(ang), -cos(ang));
    // Perpendicular distance to the nearest spoke with its own screen derivative, so spokes stay one pixel wide.
    float sd = abs(dot(q, sn));
    float sw = max(length(vec2(dot(toQ * dFdx(vP), sn), dot(toQ * dFdy(vP), sn))), 1e-6);
    float spoke = (1.0 - smoothstep(0.0, sw * 1.2, sd)) * smoothstep(uRing * 0.3, uRing, r) * step(0.0, dot(q, vec2(cos(ang), sin(ang))));
    float fade = 1.0 - smoothstep(uR * 0.6, uR, r);
    c += uCol * (rings + spoke * 0.22) * fade * graze * uFade * 0.3;
  }
  float bf = uBFade * (1.0 - smoothstep(uHalf * 0.55, uHalf * 0.95, r));
  if (bf > 0.0) {
    vec3 p3 = vec3(vP, 0.0);
    // The zone only matters outside the hyper limits: inside them nothing translates anyway.
    float outside = 1.0;
    for (int i = 0; i < ${MAX_SPHERES}; i++) {
      if (i >= uNH) break;
      float d = length(p3 - uHyper[i].xyz) - uHyper[i].w;
      outside *= smoothstep(0.0, max(fwidth(d), 1e-6) * 2.0, d);
      float wd = max(fwidth(d), 1e-6);
      float line = 1.0 - smoothstep(0.0, wd * 1.4, abs(d));
      float glow = exp(-abs(d) / (wd * 5.0)) * 0.08;
      c += uLimitCol * (line + glow) * bf;
    }
    for (int i = 0; i < ${MAX_CONES}; i++) {
      if (i >= uNC) break;
      vec3 ax = uConeA[i] - uConeB[i];
      float L = length(ax);
      ax /= L;
      vec3 rel = p3 - uConeB[i];
      float s = dot(rel, ax);
      float rho = length(rel - ax * s);
      // Lateral surface only: the base disc at the star lies inside its hyper limit, where nothing translates anyway.
      float e = rho - uConeR[i] * (1.0 - s / L);
      float span = step(0.0, s) * step(s, L) * smoothstep(0.0, uRing * 0.5, s);
      float we = max(fwidth(e), 1e-6);
      float edge = 1.0 - smoothstep(0.0, we * 1.5, abs(e));
      float inside = 1.0 - smoothstep(-we, we, e);
      float rim = exp(min(e, 0.0) / (we * 12.0)) * inside;
      c += uZoneCol * (edge * 0.7 + rim * 0.22 + inside * 0.03 * graze) * bf * span * outside;
    }
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export interface LimitSphere { body: string; name: string; centre: Vec3; radius: number }
export interface ZoneCone { body: string; name: string; base: Vec3; apex: Vec3; radius: number }

/** Signed distance (km) from p to a sphere's surface; negative inside. */
export const sphereGap = (s: LimitSphere, p: Vec3): number => len(sub(p, s.centre)) - s.radius;

/**
 * Closest point on the cone's lateral surface to p, from the (axial, radial) half-plane through p, and the signed gap.
 * The gap is negative inside the zone (MTS §2.6 cone from the star to the terminus).
 */
export function coneSurfacePoint(c: ZoneCone, p: Vec3): { point: Vec3; gap: number } {
  const axis = sub(c.apex, c.base);
  const L = len(axis);
  const ax = scale(axis, 1 / L);
  const rel = sub(p, c.base);
  const s = dot(rel, ax);
  const radial = sub(rel, scale(ax, s));
  const rho = len(radial);
  const out: Vec3 = rho > 1e-9 ? scale(radial, 1 / rho) : norm(Math.abs(ax[2]) < 0.9 ? cross(ax, [0, 0, 1]) : cross(ax, [1, 0, 0]));
  // Generatrix from (0, R) to (L, 0) in (s, rho).
  const gx = L, gy = -c.radius;
  const g2 = gx * gx + gy * gy;
  const k = Math.min(1, Math.max(0, (s * gx + (rho - c.radius) * gy) / g2));
  const ss = k * gx, rr = c.radius + k * gy;
  const point = add(add(c.base, scale(ax, ss)), scale(out, rr));
  const gap = Math.max(rho - c.radius * (1 - s / L), -s);
  return { point, gap };
}

/** True when the zone's flank comes within reach of the point. */
export function zoneNear(c: ZoneCone, p: Vec3, reachKm: number): boolean {
  const { point } = coneSurfacePoint(c, p);
  return len(sub(point, p)) <= reachKm;
}

/** Where to label a hyper limit: the first crossing ahead along the bearing, else the surface point nearest the centre. */
export function limitAnchor(s: LimitSphere, from: Vec3, bearing: Vec3, reachKm: number): Vec3 {
  const oc = sub(from, s.centre);
  const b = dot(oc, bearing);
  const cc = dot(oc, oc) - s.radius * s.radius;
  const disc = b * b - cc;
  if (disc >= 0) {
    const root = Math.sqrt(disc);
    for (const t of [-b - root, -b + root]) if (t > 0 && t <= reachKm) return add(from, scale(bearing, t));
  }
  const d = len(oc);
  return d > 1e-9 ? add(s.centre, scale(oc, s.radius / d)) : add(s.centre, [s.radius, 0, 0]);
}

/** Signed gap to a resonance zone's lateral surface, positive outside, and the axial position along it (km). */
export function zoneGap(c: ZoneCone, p: Vec3): { gap: number; s: number; length: number } {
  const axis = sub(c.apex, c.base);
  const L = len(axis);
  const ax = scale(axis, 1 / L);
  const rel = sub(p, c.base);
  const s = dot(rel, ax);
  const rho = len(sub(rel, scale(ax, s)));
  return { gap: rho - c.radius * (1 - s / L), s, length: L };
}

/**
 * Points where the zone's flank (the drawn lateral surface) crosses the ring plane, for label anchors. The flank is
 * only drawn outside the hyper limits, so points inside any of `limits` are dropped.
 */
export function zoneFlankCrossings(c: ZoneCone, centre: Vec3, reachKm: number, limits: LimitSphere[] = []): Vec3[] {
  const field = (p: Vec3): number => {
    const z = zoneGap(c, p);
    return z.s < 0 || z.s > z.length ? Math.abs(z.gap) + 1 : z.gap;
  };
  return boundaryCrossings(field, centre, reachKm, 96).filter((p) => {
    const z = zoneGap(c, p);
    return z.s > 0 && z.s < z.length && Math.abs(z.gap) < reachKm * 0.01 && limits.every((s) => sphereGap(s, p) > 0);
  });
}

/**
 * Where a boundary crosses the ring plane: the first sign change of `gap` along rays from the centre, one ray every
 * 360 / rays degrees, out to `reachKm`. Label anchors are chosen from these points.
 */
export function boundaryCrossings(gap: (p: Vec3) => number, centre: Vec3, reachKm: number, rays = 48, steps = 64): Vec3[] {
  const out: Vec3[] = [];
  const at = (dir: Vec3, s: number): Vec3 => [centre[0] + dir[0] * s, centre[1] + dir[1] * s, centre[2]];
  for (let k = 0; k < rays; k++) {
    const a = (2 * Math.PI * k) / rays;
    const dir: Vec3 = [Math.cos(a), Math.sin(a), 0];
    let prev = gap(at(dir, 0));
    for (let i = 1; i <= steps; i++) {
      const s = (reachKm * i) / steps;
      const g = gap(at(dir, s));
      if (Math.sign(g) !== Math.sign(prev)) {
        let lo = (reachKm * (i - 1)) / steps;
        let hi = s;
        for (let j = 0; j < 24; j++) {
          const mid = (lo + hi) / 2;
          if (Math.sign(gap(at(dir, mid))) === Math.sign(prev)) lo = mid;
          else hi = mid;
        }
        out.push(at(dir, (lo + hi) / 2));
        break;
      }
      prev = g;
    }
  }
  return out;
}

/** Hyper limits and resonance zones from the pack's exclusions; terminus spheres stay with the system view. */
export function boundariesOf(exclusions: Exclusion[]): { spheres: LimitSphere[]; cones: ZoneCone[] } {
  const spheres = exclusions.filter((e): e is SphereExclusion => e.kind === 'hyper-limit')
    .map((e) => ({ body: e.body, name: e.name, centre: e.center, radius: e.radius }));
  const cones = exclusions.filter((e): e is ConeExclusion => e.kind === 'resonance-zone')
    .map((e) => ({ body: e.body, name: e.name, base: e.base, apex: e.apex, radius: e.radius }));
  return { spheres, cones };
}

/** One additive shader plane in the ring centre's ecliptic: Site A range rings plus hyper limits and the resonance zone. */
export class TacticalPlane {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  shownSpheres = 0;
  shownCones = 0;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uHalf: { value: 1 }, uR: { value: 1 }, uRing: { value: 1 }, uRing2: { value: 1 }, uMix: { value: 0 }, uFade: { value: 0 }, uBFade: { value: 0 },
        uBear: { value: new THREE.Vector2(1, 0) }, uCol: { value: GRID_RGB.clone() },
        uLimitCol: { value: LIMIT_RGB.clone() }, uZoneCol: { value: ZONE_RGB.clone() },
        uNH: { value: 0 }, uHyper: { value: Array.from({ length: MAX_SPHERES }, () => new THREE.Vector4()) },
        uNC: { value: 0 }, uConeB: { value: Array.from({ length: MAX_CONES }, () => new THREE.Vector3()) },
        uConeA: { value: Array.from({ length: MAX_CONES }, () => new THREE.Vector3()) },
        uConeR: { value: Array.from({ length: MAX_CONES }, () => 0) },
      },
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  /**
   * `toRender` maps km to render units around the floating origin. Positions handed to the shader are relative to the
   * ring centre so the plane's large extent never meets large absolute coordinates.
   */
  update(plan: RingPlan | null, kmPerUnit: number, toRender: (km: Vec3) => THREE.Vector3, fade: number, boundaryFade: number,
    spheres: LimitSphere[], cones: ZoneCone[]): void {
    this.shownSpheres = 0;
    this.shownCones = 0;
    if (!plan || (fade <= 0 && boundaryFade <= 0)) {
      this.mesh.visible = false;
      return;
    }
    const u = this.material.uniforms;
    const reach = plan.radius * BOUNDARY_REACH;
    const c = plan.centre;
    this.mesh.position.copy(toRender(c));
    u.uHalf.value = reach / kmPerUnit;
    u.uR.value = plan.radius / kmPerUnit;
    u.uRing.value = plan.step / kmPerUnit;
    u.uRing2.value = plan.next / kmPerUnit;
    u.uMix.value = plan.mix;
    u.uFade.value = fade;
    u.uBFade.value = boundaryFade;
    (u.uBear.value as THREE.Vector2).set(plan.bearing[0], plan.bearing[1]).normalize();
    let nh = 0;
    for (const s of spheres) {
      if (nh >= MAX_SPHERES || Math.abs(sphereGap(s, c)) > reach) continue;
      (u.uHyper.value as THREE.Vector4[])[nh++].set((s.centre[0] - c[0]) / kmPerUnit, (s.centre[1] - c[1]) / kmPerUnit, (s.centre[2] - c[2]) / kmPerUnit, s.radius / kmPerUnit);
    }
    let nc = 0;
    for (const z of cones) {
      if (nc >= MAX_CONES || !zoneNear(z, c, reach)) continue;
      (u.uConeB.value as THREE.Vector3[])[nc].set((z.base[0] - c[0]) / kmPerUnit, (z.base[1] - c[1]) / kmPerUnit, (z.base[2] - c[2]) / kmPerUnit);
      (u.uConeA.value as THREE.Vector3[])[nc].set((z.apex[0] - c[0]) / kmPerUnit, (z.apex[1] - c[1]) / kmPerUnit, (z.apex[2] - c[2]) / kmPerUnit);
      (u.uConeR.value as number[])[nc++] = z.radius / kmPerUnit;
    }
    u.uNH.value = nh;
    u.uNC.value = nc;
    this.shownSpheres = boundaryFade > 0 ? nh : 0;
    this.shownCones = boundaryFade > 0 ? nc : 0;
    this.mesh.visible = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

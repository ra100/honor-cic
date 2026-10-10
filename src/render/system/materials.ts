import * as THREE from 'three';

/*
 * System-scale materials ported from Site A (A report §3) and Site B (B report §2.4-2.5).
 * Site A ran three r147 in legacy colour mode, so its shader colours are raw linear floats and stay so here.
 * Every material that depth-tests carries the log-depth chunks: the renderer uses a logarithmic depth buffer.
 */

const HASH = /* glsl */ `
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0)), n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1)), n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

const LOG_VS_PARS = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
`;

/** Site A's additive overlay preset (A report §1.8). */
const ADD = { transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending } as const;

/* ---------- stars (A §3.1) ---------- */

const SUN_VS = /* glsl */ `${LOG_VS_PARS}
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz; vP = position;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const SUN_FS = /* glsl */ `
uniform vec3 uCol; uniform float uRtime;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
#include <logdepthbuf_pars_fragment>
${HASH}
void main() {
  #include <logdepthbuf_fragment>
  float mu = max(dot(normalize(vN), normalize(vV)), 0.0);
  float limb = 0.3 + 0.7 * pow(mu, 0.45);
  float g = fbm(vP * 9.0 + vec3(uRtime * 0.03));
  gl_FragColor = vec4(uCol * limb * (0.8 + 0.4 * g) * 7.0, 1.0);
}`;

/** Opaque HDR star core; colour ×7 so bloom always picks it up. */
export function sunMaterial(col: [number, number, number], rtime: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ vertexShader: SUN_VS, fragmentShader: SUN_FS, uniforms: { uCol: { value: new THREE.Vector3(...col) }, uRtime: rtime } });
}

const GLOW_VS = /* glsl */ `${LOG_VS_PARS}
uniform float uSize; uniform float uMinPx; uniform float uPx;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float d = max(-mv.z, 1e-6);
  float r = uSize;
  if (r * uPx / d < uMinPx) r = uMinPx * d / uPx;
  mv.xy += position.xy * r;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy;
  #include <logdepthbuf_vertex>
}`;
const GLOW_FS = /* glsl */ `
uniform vec3 uCol; uniform float uI; uniform float uStreak;
varying vec2 vUv;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float d = length(vUv);
  float g = exp(-d * d * 10.0) * 1.4 + exp(-d * 4.0) * 0.35;
  float streak = exp(-abs(vUv.y) * 70.0) * exp(-abs(vUv.x) * 2.2) * uStreak;
  gl_FragColor = vec4(uCol * (g + streak) * uI * (1.0 - smoothstep(0.8, 1.0, d)), 1.0);
}`;

export interface GlowOptions { col: [number, number, number]; sizeUnits: number; minPx: number; intensity: number; streak: number }

/** Billboard glow with a pixel floor: at system range the glow is the star (A §3.1). uPx is CSS px per unit at unit distance. */
export function glowMesh(o: GlowOptions, px: { value: number }): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const m = new THREE.ShaderMaterial({
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS, ...ADD,
    uniforms: {
      uSize: { value: o.sizeUnits }, uMinPx: { value: o.minPx }, uPx: px,
      uCol: { value: new THREE.Vector3(...o.col) }, uI: { value: o.intensity }, uStreak: { value: o.streak },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  return mesh;
}

/* ---------- hyper-limit globe and resonance cone (A §3.2, §3.8) ---------- */

const SHELL_VS = /* glsl */ `${LOG_VS_PARS}
varying vec3 vObj; varying vec3 vN; varying vec3 vVp;
void main() {
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vVp = mv.xyz; vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
// Z is up here, so latitude comes from p.z where Site A used p.y.
const SHELL_FS = /* glsl */ `
uniform vec3 uCol; uniform float uA; uniform float uStep;
varying vec3 vObj; varying vec3 vN; varying vec3 vVp;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vObj);
  float lat = asin(clamp(p.z, -1.0, 1.0)) * 57.29578, lon = atan(p.y, p.x) * 57.29578;
  vec2 g = vec2(lat, lon) / uStep;
  vec2 fw = max(fwidth(g), vec2(1e-5));
  vec2 gl = abs(fract(g - 0.5) - 0.5) / fw;
  float line = 1.0 - min(min(gl.x, gl.y), 1.0);
  float eq = 1.0 - min(abs(lat) / max(fwidth(lat) * 1.6, 1e-5), 1.0);
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(-vVp))), 4.0);
  gl_FragColor = vec4(uCol * (line * 0.3 + eq * 0.9 + fres * 0.3 + 0.012) * uA, 1.0);
}`;

/** Unit sphere drawn as Site A's 10° lat/long grid with a brighter equator; scale it to the limit. */
export function shellMesh(col: [number, number, number] = [0.0, 0.55, 0.85]): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const g = new THREE.SphereGeometry(1, 96, 48);
  g.rotateX(Math.PI / 2);
  const m = new THREE.ShaderMaterial({
    vertexShader: SHELL_VS, fragmentShader: SHELL_FS, ...ADD, side: THREE.DoubleSide,
    uniforms: { uCol: { value: new THREE.Vector3(...col) }, uA: { value: 0.42 }, uStep: { value: 10 } },
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 1;
  return mesh;
}

const CONE_FS = /* glsl */ `
uniform vec3 uCol; uniform float uA; uniform float uHalf; uniform float uBaseFade;
varying vec3 vObj; varying vec3 vN; varying vec3 vVp;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(-vVp))), 2.0);
  float rings = 1.0 - min(abs(fract(vObj.y * 12.0 - 0.5) - 0.5) / max(fwidth(vObj.y * 12.0), 1e-5), 1.0);
  // The base sits on the star, where the wall hugs the hyper sphere: fade it in so the zone grows out of the globe.
  float base = smoothstep(0.0, uBaseFade, vObj.y + uHalf);
  gl_FragColor = vec4(uCol * (fres * 0.5 + rings * 0.25 + 0.02) * uA * base, 1.0);
}`;

/** Open cone, apex +Y, height and base radius in render units (A §3.8); the wall fades in over `baseFade` from the base. */
export function coneMesh(baseRadius: number, height: number, baseFade = 0): THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial> {
  const m = new THREE.ShaderMaterial({
    vertexShader: SHELL_VS, fragmentShader: CONE_FS, ...ADD, side: THREE.DoubleSide,
    uniforms: {
      uCol: { value: new THREE.Vector3(0.45, 0.25, 0.85) }, uA: { value: 0.3 },
      uHalf: { value: height / 2 }, uBaseFade: { value: Math.max(1e-6, baseFade) },
    },
  });
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(baseRadius, height, 64, 1, true), m);
  mesh.renderOrder = 1;
  return mesh;
}

/* ---------- planets (B §2.4 shading, lit by their star as in A §3.3) ---------- */

/** Scale a body about its centre so it never shrinks below uMinPx on screen; uPx is CSS px per unit at unit distance. */
const FLOOR_VS = /* glsl */ `
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float rTrue = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 1.0)).xyz - c.xyz);
  float k = max(1.0, uMinPx * max(-c.z, 1e-6) / uPx / max(rTrue, 1e-12));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz = c.xyz + (mv.xyz - c.xyz) * k;
`;

const PLANET_VS = /* glsl */ `${LOG_VS_PARS}
uniform float uPx; uniform float uMinPx;
varying vec3 vObj; varying vec3 vN; varying vec3 vVp;
void main() {
  ${FLOOR_VS}
  vObj = position; vVp = mv.xyz; vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const PLANET_FS = /* glsl */ `
uniform vec3 uBase; uniform float uSeed; uniform float uKind; uniform vec3 uLightV; uniform float uGain;
varying vec3 vObj; varying vec3 vN; varying vec3 vVp;
#include <logdepthbuf_pars_fragment>
float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1, 0, 0)), f.x), mix(h(i + vec3(0, 1, 0)), h(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h(i + vec3(0, 0, 1)), h(i + vec3(1, 0, 1)), f.x), mix(h(i + vec3(0, 1, 1)), h(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vObj);
  float n = noise(p * 5.0 + uSeed) * 0.55 + noise(p * 12.0 + uSeed) * 0.3 + noise(p * 27.0 + uSeed) * 0.15;
  vec3 col = uBase;
  if (uKind > 0.5 && uKind < 1.5) {
    col = mix(uBase * 0.52, vec3(0.16, 0.29, 0.24), smoothstep(0.49, 0.53, n));
    float cloud = smoothstep(0.63, 0.79, noise(p * 9.0 + uSeed + 7.0));
    col = mix(col, vec3(0.72, 0.84, 0.86), cloud * 0.75);
    col = mix(col, vec3(0.8, 0.86, 0.88), smoothstep(0.84, 0.98, abs(p.y)));
  } else if (uKind > 1.5 && uKind < 2.5) {
    col *= 0.65 + 0.35 * sin(p.y * 45.0 + n * 7.0);
  } else if (uKind > 2.5) {
    col *= 0.8 + 0.2 * sin(p.y * 24.0 + n * 4.0);
  } else {
    col *= 0.55 + n * 0.7;
  }
  vec3 nn = normalize(vN), v = normalize(-vVp);
  float l = max(0.07, dot(nn, uLightV));
  float rim = pow(1.0 - max(0.0, dot(nn, v)), 3.0);
  gl_FragColor = vec4((col * l + uBase * rim * 0.18) * uGain, 1.0);
}`;

export const LOOK_KIND = { rocky: 0, terrestrial: 1, 'gas-giant': 2, 'ice-giant': 3 } as const;

export function planetMaterial(base: number, kind: number, seed: number, px: { value: number }, minPx: number): THREE.ShaderMaterial {
  const c = new THREE.Color(base);
  return new THREE.ShaderMaterial({
    vertexShader: PLANET_VS, fragmentShader: PLANET_FS,
    uniforms: {
      uBase: { value: new THREE.Vector3(c.r, c.g, c.b) }, uSeed: { value: seed }, uKind: { value: kind },
      uLightV: { value: new THREE.Vector3(1, 0, 0) }, uGain: { value: 0.8 }, uPx: px, uMinPx: { value: minPx },
    },
  });
}

const FLAT_VS = /* glsl */ `${LOG_VS_PARS}
uniform float uPx; uniform float uMinPx;
void main() {
  ${FLOOR_VS}
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const FLAT_FS = /* glsl */ `
uniform vec3 uCol;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(uCol, 1.0);
}`;

/** Site B's station ring: a hard six-sided torus round the planet, tilted 0.65 rad (B §2.5). Geometry in planet radii. */
export function stationRing(px: { value: number }, minPx: number): THREE.Mesh<THREE.TorusGeometry, THREE.ShaderMaterial> {
  const c = new THREE.Color(0x85cdd7);
  const m = new THREE.ShaderMaterial({
    vertexShader: FLAT_VS, fragmentShader: FLAT_FS,
    uniforms: { uCol: { value: new THREE.Vector3(c.r, c.g, c.b) }, uPx: px, uMinPx: { value: minPx } },
  });
  return new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.075, 6, 32), m);
}

/* ---------- markers (A §3.4) ---------- */

const MARK_VS = /* glsl */ `${LOG_VS_PARS}
attribute vec4 aC; attribute float aR; attribute float aFloor;
uniform float uPx; uniform float pixelRatio;
varying vec3 vC; varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 1e-6);
  float rpx = aR * uPx / d;
  // Fade once the true sphere outgrows its pixel floor, as Site A fades markers at 2-5 px.
  vA = 1.0 - smoothstep(aFloor + 1.0, aFloor + 6.0, rpx);
  gl_PointSize = aC.w * pixelRatio;
  vC = aC.rgb;
  #include <logdepthbuf_vertex>
}`;
const MARK_FS = /* glsl */ `
uniform float uCore;
varying vec3 vC; varying float vA;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard;
  float core = (1.0 - smoothstep(0.35, 0.55, r)) * uCore;
  float ring = 1.0 - smoothstep(0.0, 0.12, abs(r - 0.85));
  gl_FragColor = vec4(vC * (core * 1.3 + ring * 0.6) * vA, 1.0);
}`;

/** Fixed point list: aC = linear rgb + size px, aR = true radius in units, aFloor = the sphere's pixel floor. */
export function markerPoints(pos: number[], aC: number[], aR: number[], aFloor: number[], px: { value: number }, core = 1): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(aC, 4));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(aR, 1));
  g.setAttribute('aFloor', new THREE.Float32BufferAttribute(aFloor, 1));
  const points = new THREE.Points(g, new THREE.ShaderMaterial({
    vertexShader: MARK_VS, fragmentShader: MARK_FS, ...ADD,
    uniforms: { uPx: px, pixelRatio: { value: 1 }, uCore: { value: core } },
  }));
  points.frustumCulled = false;
  points.renderOrder = 10;
  return points;
}

/* ---------- belts (A §3.6 points with the sky shader) ---------- */

const DUST_VS = /* glsl */ `${LOG_VS_PARS}
attribute vec4 aC;
uniform float pixelRatio;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aC.w * pixelRatio;
  vC = aC.rgb;
  #include <logdepthbuf_vertex>
}`;
const DUST_FS = /* glsl */ `
varying vec3 vC;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0; if (r2 > 1.0) discard;
  gl_FragColor = vec4(vC * exp(-r2 * 3.5), 1.0);
}`;

export function dustPoints(pos: number[], aC: number[]): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(aC, 4));
  const points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: DUST_VS, fragmentShader: DUST_FS, ...ADD, uniforms: { pixelRatio: { value: 1 } } }));
  points.frustumCulled = false;
  return points;
}

/* ---------- the terminus vortex (A §3.7) ---------- */

const PLANE_VS = /* glsl */ `${LOG_VS_PARS}
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const VORTEX_FS = /* glsl */ `
uniform float uRtime; uniform float uA;
varying vec2 vUv;
#include <logdepthbuf_pars_fragment>
${HASH}
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float sw = fbm(vec3(cos(a * 3.0 + r * 9.0 - uRtime * 0.6), sin(a * 3.0 + r * 9.0 - uRtime * 0.6), r * 4.0));
  float core = exp(-r * r * 22.0) * 2.5;
  float arms = smoothstep(0.45, 0.75, sw) * (1.0 - r) * 1.3;
  float rim = exp(-pow((r - 0.92) * 18.0, 2.0)) * 0.6;
  vec3 c = vec3(0.45, 0.3, 1.0) * (arms + rim) + vec3(0.8, 0.75, 1.0) * core;
  gl_FragColor = vec4(c * uA, 1.0);
}`;

export function vortexMesh(rtime: { value: number }): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const m = new THREE.ShaderMaterial({ vertexShader: PLANE_VS, fragmentShader: VORTEX_FS, ...ADD, side: THREE.DoubleSide, uniforms: { uRtime: rtime, uA: { value: 1 } } });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
}

/* ---------- lines (A §3.5, §3.6; B §2.9) ---------- */

/** Native 1 px additive line; Site A's darkness comes from the colour, not from opacity. */
export function additiveLine(points: THREE.Vector3[], col: [number, number, number], loop: boolean): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const m = new THREE.LineBasicMaterial({ color: new THREE.Color(col[0], col[1], col[2]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  return loop ? new THREE.LineLoop(g, m) : new THREE.Line(g, m);
}

/** Site B's dashed context line; dash and gap are in render units. */
export function dashedLine(points: THREE.Vector3[], hex: number, opacity: number, dash: number, gap: number): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: hex, transparent: true, opacity, depthWrite: false, dashSize: dash, gapSize: gap }));
  line.computeLineDistances();
  return line;
}

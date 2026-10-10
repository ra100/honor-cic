import * as THREE from 'three';

/** Site A sky (A report §2): 9,000 seeded stars, 35 % pulled toward a galactic band, plus a faint dusty band. */
export const SKY_STARS = 9000;
// Site A's band normal (0.32, 0.88, -0.35) in its Y-up frame, mapped to this app's Z-up frame (x, -z, y).
export const BAND_NORMAL: [number, number, number] = (() => {
  const v = [0.32, 0.35, 0.88];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

export interface SkyStar { dir: [number, number, number]; color: [number, number, number]; sizePx: number }

/** Deterministic star list: Lehmer generator, seed 7, multiplier 16807, as Site A. */
export function skyStars(count = SKY_STARS): SkyStar[] {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out: SkyStar[] = [];
  const n = BAND_NORMAL;
  for (let i = 0; i < count; i++) {
    const z = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    let x = r * Math.cos(a), y = r * Math.sin(a), w = z;
    if (rnd() < 0.35) {
      const d = x * n[0] + y * n[1] + w * n[2];
      const k = d * (0.85 + rnd() * 0.15);
      x -= n[0] * k; y -= n[1] * k; w -= n[2] * k;
      const l = Math.hypot(x, y, w) || 1;
      x /= l; y /= l; w /= l;
    }
    const m = Math.pow(rnd(), 9);
    const temp = rnd();
    const c = temp < 0.12 ? [1.0, 0.72, 0.5] : temp < 0.3 ? [1.0, 0.9, 0.75] : temp < 0.85 ? [0.92, 0.95, 1.0] : [0.7, 0.8, 1.0];
    const intensity = 0.18 + m * 1.9;
    out.push({ dir: [x, y, w], color: [c[0] * intensity, c[1] * intensity, c[2] * intensity], sizePx: 1.1 + m * 2.4 });
  }
  return out;
}

const STAR_VS = /* glsl */ `
attribute vec4 aC;
uniform float uDpr;
varying vec3 vC;
void main() {
  vC = aC.rgb;
  gl_PointSize = aC.w * uDpr;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const STAR_FS = /* glsl */ `
varying vec3 vC;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vC * exp(-r2 * 3.5), 1.0);
}`;
const BAND_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const BAND_FS = /* glsl */ `
uniform vec3 uN;
varying vec3 vDir;
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = dot(d, uN);
  float band = exp(-h * h / 0.035);
  float dust = fbm(d * 5.0);
  float lanes = smoothstep(0.42, 0.62, fbm(d * 11.0 + 3.0));
  vec3 c = mix(vec3(0.05, 0.06, 0.1), vec3(0.11, 0.09, 0.12), dust) * band * (0.6 + 0.8 * dust) * (1.0 - lanes * 0.6);
  c += vec3(0.02, 0.025, 0.05) * exp(-h * h / 0.4) * dust;
  gl_FragColor = vec4(c * 0.16, 1.0);
}`;

/** Rendered first, from the origin, with the main camera's rotation and field of view: it never translates. */
export class Sky {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  private readonly starMaterial: THREE.ShaderMaterial;
  private viewKey = '';

  constructor() {
    const stars = skyStars();
    const pos = new Float32Array(stars.length * 3);
    const col = new Float32Array(stars.length * 4);
    stars.forEach((s, i) => {
      pos.set(s.dir.map((v) => v * 100), i * 3);
      col.set([...s.color, s.sizePx], i * 4);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('aC', new THREE.BufferAttribute(col, 4));
    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: { uDpr: { value: 1 } },
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, this.starMaterial);
    points.frustumCulled = false;
    points.renderOrder = 1;
    const band = new THREE.Mesh(new THREE.SphereGeometry(120, 48, 24), new THREE.ShaderMaterial({
      vertexShader: BAND_VS, fragmentShader: BAND_FS, uniforms: { uN: { value: new THREE.Vector3(...BAND_NORMAL) } },
      side: THREE.BackSide, depthTest: false, depthWrite: false,
    }));
    band.renderOrder = 0;
    band.frustumCulled = false;
    this.scene.add(band, points);
  }

  /** Follow the main camera's orientation and lens only. */
  sync(main: THREE.PerspectiveCamera, pixelRatio: number): void {
    main.updateMatrixWorld();
    this.camera.quaternion.copy(main.getWorldQuaternion(new THREE.Quaternion()));
    this.camera.up.copy(main.up);
    const view = main.view;
    const viewKey = view?.enabled ? `${view.fullWidth},${view.fullHeight},${view.offsetX},${view.offsetY},${view.width},${view.height}` : '';
    if (this.camera.fov !== main.fov || this.camera.aspect !== main.aspect || this.viewKey !== viewKey) {
      this.camera.fov = main.fov;
      this.camera.aspect = main.aspect;
      if (view?.enabled) this.camera.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height);
      else this.camera.clearViewOffset();
      this.viewKey = viewKey;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    this.starMaterial.uniforms.uDpr.value = pixelRatio;
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
  }
}

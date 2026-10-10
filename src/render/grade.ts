import * as THREE from 'three';

/** How a view is developed: Site A's HDR bloom feeding one filmic grade pass (A report §1.3). */
export interface GradeProfile {
  exposure: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  vignette: number;
}

/** Site A: only genuinely hot pixels (star cores, blasts, terminal heads, beams) bloom. */
export const GRADE_CINEMATIC: GradeProfile = { exposure: 1.1, bloomStrength: 0.45, bloomRadius: 0.4, bloomThreshold: 1.1, vignette: 0.32 };
/** Site B's ship display: lit metal and faint additive fields, no bloom. Exposure folds in three's ACES 1/0.6 scale. */
export const GRADE_TECHNICAL: GradeProfile = { exposure: 1.9, bloomStrength: 0.2, bloomRadius: 0.3, bloomThreshold: 1.6, vignette: 0.18 };

export const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: GRADE_CINEMATIC.exposure },
    uVignette: { value: GRADE_CINEMATIC.vignette },
    uRes: { value: new THREE.Vector2(1, 1) },
    uT: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform float uVignette;
uniform vec2 uRes;
uniform float uT;
varying vec2 vUv;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
  vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(64.0)) * uExposure;
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  vec2 q = vUv - 0.5;
  float aspect = uRes.x / uRes.y;
  c *= 1.0 - uVignette * smoothstep(0.32, 0.78, length(q * vec2(aspect, 1.0) / max(1.0, aspect) * 1.4));
  c += (h12(vUv * uRes + fract(uT) * 917.0) - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(c, 1.0);
}`,
};

/** Site A clamps the bloom high-pass input so a single hot pixel cannot flare the frame. */
export function clampBloomHighPass(fragmentShader: string, limit = 6): string {
  const target = 'vec4 texel = texture2D( tDiffuse, vUv );';
  if (!fragmentShader.includes(target)) return fragmentShader;
  return fragmentShader.replace(target, `vec4 texel = min( texture2D( tDiffuse, vUv ), vec4( ${limit.toFixed(1)} ) );`);
}

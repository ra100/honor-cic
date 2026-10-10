/** Site A's screen-space ribbon helpers (A report §4.7, JS:3516-3543). `uViewport` is in the same pixels as the widths. */
export const RIBBON_GLSL = /* glsl */ `
uniform vec2 uViewport;
uniform float uNear;
bool clipSeg(inout vec3 a, inout vec3 b) {
  float nz = -uNear * 1.001;
  if (a.z > nz && b.z > nz) return false;
  if (a.z > nz) a = mix(a, b, (a.z - nz) / (a.z - b.z));
  if (b.z > nz) b = mix(b, a, (b.z - nz) / (b.z - a.z));
  return true;
}
vec4 ribbonProj(vec3 a, vec3 b, float s, float side, float wA, float wB, float capA, float capB) {
  vec4 ca = projectionMatrix * vec4(a, 1.0);
  vec4 cb = projectionMatrix * vec4(b, 1.0);
  vec2 sa = ca.xy / ca.w * 0.5 * uViewport, sb = cb.xy / cb.w * 0.5 * uViewport;
  vec2 d = sb - sa;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = s < 0.5 ? ca : cb;
  float w = s < 0.5 ? wA : wB;
  vec2 off = nrm * side * w + dir * (s < 0.5 ? -capA : capB);
  c.xy += off / (0.5 * uViewport) * c.w;
  return c;
}
`;

export const CULL_GLSL = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0);';

/** Pixels per render unit at unit distance for a perspective camera, in the pixels the viewport is given in. */
export const pxPerUnit = (heightPx: number, fovDeg: number, zoom: number): number =>
  heightPx / ((2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1e-6, zoom));

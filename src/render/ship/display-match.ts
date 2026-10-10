import * as THREE from 'three';
import { GRADE_TECHNICAL } from '../grade';

type RGB = [number, number, number];

/**
 * Site B tone-maps every fragment before blending, so its 4% fields add 4% of a displayed colour (B report §1.1).
 * Our engine blends linear HDR and grades once, which would show the same constants several times brighter.
 * These helpers return the linear colour that lands on Site B's displayed result over its clear colour.
 */
const SITE_B_CLEAR = 0x03080e;

const toLinear = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const toSrgb = (v: number): number => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
const rrt = (v: number): number => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
const ACES_IN = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]];
const ACES_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul = (m: number[][], v: number[]): RGB => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) as RGB;
const channels = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => v / 255) as RGB;

/** Site B's displayed value of a linear colour: three's ACES filmic at exposure 1.2, then sRGB. */
export function siteBDisplay(linear: RGB): RGB {
  const mapped = mul(ACES_OUT, mul(ACES_IN, linear.map((v) => v * 1.2 / 0.6)).map(rrt));
  return mapped.map((v) => toSrgb(Math.min(1, Math.max(0, v)))) as RGB;
}

/** Linear input that our grade (exposure, ACES fit, 2.2 gamma) shows as display value d. */
export function gradeInverse(d: number, exposure = GRADE_TECHNICAL.exposure): number {
  const y = Math.min(0.999, Math.max(0, d)) ** 2.2;
  if (y === 0) return 0;
  const a = 2.43 * y - 2.51, b = 0.59 * y - 0.03, c = 0.14 * y;
  return Math.max(0, (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a)) / exposure;
}

const BG = channels(SITE_B_CLEAR);

/**
 * Linear colour to draw at `opacity` so it lands where Site B's `linear` colour lands at the same opacity over
 * Site B's clear colour. Site B mixes `normal` fields and adds `additive` ones; here both are drawn additively
 * (`overSky`) so a field never darkens the sky behind it, or with normal blending for solid marks.
 * `raw` skips the tone map (Site B's grid). `layers` matches a stack of coincident additive copies as a whole.
 */
export function matchLinear(linear: RGB, opacity: number, additive: boolean, raw = false, layers = 1, overSky = additive): RGB {
  const fg = raw ? linear.map(toSrgb) as RGB : siteBDisplay(linear);
  const a = Math.max(1e-6, opacity);
  const n = additive ? Math.max(1, layers) : 1;
  return [0, 1, 2].map((i) => {
    const target = additive ? BG[i] + n * a * fg[i] : a * fg[i] + (1 - a) * BG[i];
    const under = gradeInverse(BG[i]) * (overSky ? 1 : 1 - a);
    return Math.max(0, (gradeInverse(target) - under) / (n * a));
  }) as RGB;
}

export function siteBColor(hex: number, opacity = 1, additive = false, raw = false, layers = 1, overSky = additive): THREE.Color {
  const [r, g, b] = matchLinear(channels(hex).map(toLinear) as RGB, opacity, additive, raw, layers, overSky);
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

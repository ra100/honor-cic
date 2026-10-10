import * as THREE from 'three';
import type { MountKey, ShipClass } from '../../core/tech';

/**
 * Site B's ship detail constants (B report §4), kept in Site B's own frame: +X bow, +Y dorsal, +Z starboard,
 * with a hull 10.237 units long. The view maps that frame onto the true-scale hull, so every field keeps
 * Site B's proportions to the hull length.
 */
export type V3 = [number, number, number];

export const B_HULL_LENGTH = 10.237;
/** Site B's hull runs −5.08…+5.16; centring it on ours keeps the 1.08 stern and 1.56 bow overhangs of the bands. */
export const B_HULL_CENTRE = 0.04;

export const B_COLOR = { friendly: 0x5ae0f3, hostile: 0xff4e6f, allied: 0x73efb0, amber: 0xffc575, violet: 0xb08aff } as const;

/** Site B units per hull unit: our hull length over Site B's. */
export const frameScale = (hullLengthU: number): number => hullLengthU / B_HULL_LENGTH;

/** Site B frame → ours: (x, y, z) → (x, −z, y), a +90° turn about the hull axis, then scale and centre. */
export function placeFrame(object: THREE.Object3D, k: number): void {
  object.position.set(-B_HULL_CENTRE * k, 0, 0);
  object.rotation.set(Math.PI / 2, 0, 0);
  object.scale.setScalar(k);
}

/** A point of the true-scale hull (our frame) in Site B units. */
export function toB(p: THREE.Vector3, k: number): V3 {
  return [p.x / k + B_HULL_CENTRE, p.z / k, -p.y / k];
}

export function fromB(p: V3, k: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set((p[0] - B_HULL_CENTRE) * k, -p[2] * k, p[1] * k);
}

// §4.5 The wedge: two finite stress bands, dorsal and ventral, each drawn twice (outer and the 0.94 inner copy).
export const WEDGE_SCALE: V3 = [1.4, 1.6, 1.35];

export function wedgeVertices(sign = 1, band = 1): V3[] {
  return [
    [-4.4, sign * 0.75 * band, -2],
    [-4.4, sign * 0.75 * band, 2],
    [4.8, sign * 2.5 * band, 3.3],
    [4.8, sign * 2.5 * band, -3.3],
  ];
}

/** Band corners after Site B's (1.4, 1.6, 1.35) scale, in Site B units. */
export const bandCorners = (sign: number, band: number): V3[] =>
  wedgeVertices(sign, band).map((p) => p.map((v, i) => v * WEDGE_SCALE[i]) as V3);

export const BANDS: ReadonlyArray<{ sign: number; band: number }> = [-1, 1].flatMap((sign) => [1, 0.94].map((band) => ({ sign, band })));

/** Stern (kilt) and bow (throat) edges of the outer bands: x, half-height, half-width. */
export const STERN_EDGE = { x: -4.4 * WEDGE_SCALE[0], half: 0.75 * WEDGE_SCALE[1], wide: 2 * WEDGE_SCALE[2] };
export const BOW_EDGE = { x: 4.8 * WEDGE_SCALE[0], half: 2.5 * WEDGE_SCALE[1], wide: 3.3 * WEDGE_SCALE[2] };

/** §4.6 Sidewalls join the outer band edges on each broadside; sign +1 is starboard. */
export function sidewallVertices(sign: number): V3[] {
  return [
    [STERN_EDGE.x, -STERN_EDGE.half, sign * STERN_EDGE.wide],
    [STERN_EDGE.x, STERN_EDGE.half, sign * STERN_EDGE.wide],
    [BOW_EDGE.x, BOW_EDGE.half, sign * BOW_EDGE.wide],
    [BOW_EDGE.x, -BOW_EDGE.half, sign * BOW_EDGE.wide],
  ];
}

/** §4.7 End apertures: buckler rings and walls sit on the throat (bow) and kilt (stern) edges. */
export const THROAT_RADIUS = 3.7;
export const KILT_RADIUS = 1.2;
export const APERTURE_INNER = 0.7;

export const SIDEWALL_COLOR = 0x44858e;
export const SAIL = { fill: 0x84b9ff, ring: 0x9bbdff, x: 4.3, radius: 7 } as const;

// §8.3 wedgeHit: Möller–Trumbore against the four band quads, in the rolled ship frame.
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Roll about the hull axis, as Site B's shipRoot.rotation.x. */
export function rollPoint(p: V3, roll: number): V3 {
  const c = Math.cos(roll), s = Math.sin(roll);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

function triangleFraction(a: V3, b: V3, p0: V3, p1: V3, p2: V3): number | null {
  const d = sub(b, a), e1 = sub(p1, p0), e2 = sub(p2, p0), h = cross(d, e2), det = dot(e1, h);
  if (Math.abs(det) < 1e-12) return null;
  const s = sub(a, p0), u = dot(s, h) / det;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1), v = dot(d, q) / det;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, q) / det;
  return t > 1e-8 && t < 1 - 1e-8 ? t : null;
}

/** First point where segment a→b crosses a stress band of the ship rolled by `roll`, or null when the path is clear. */
export function wedgeHit(a: V3, b: V3, roll: number, scale: V3 = WEDGE_SCALE): V3 | null {
  const aa = rollPoint(a, -roll).map((x, i) => x / scale[i]) as V3;
  const bb = rollPoint(b, -roll).map((x, i) => x / scale[i]) as V3;
  let first: number | null = null;
  for (const { sign, band } of BANDS) {
    const p = wedgeVertices(sign, band);
    for (const [i, j, l] of [[0, 1, 2], [0, 2, 3]]) {
      const t = triangleFraction(aa, bb, p[i], p[j], p[l]);
      if (t !== null && (first === null || t < first)) first = t;
    }
  }
  if (first === null) return null;
  const f = first;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// §4.9 Pods: three per stern rail, tethered and sliding two units aft over each ejection cycle.
export const POD_ROWS = 3;
export const POD_BOX: V3 = [0.25, 0.12, 0.2];
export const EXTERNAL_POD_BOX: V3 = [0.14, 0.08, 0.12];
export const TETHER_X: [number, number] = [-4.8, -6.6];
export const MAX_EXTERNAL_PODS = 40;
export const POD_COLOR = { body: 0x89978e, glow: 0x8d5927 } as const;

/** Rail i of n as [dorsal, starboard] offsets: a two-row lane matrix centred on the hull axis. */
export function railOffset(i: number, rails: number): [number, number] {
  return [((i % 2) - 0.5) * 0.38, (Math.floor(i / 2) - (Math.ceil(rails / 2) - 1) / 2) * 0.43];
}

export function podX(row: number, clock: number, cycle: number): number {
  const c = cycle > 0 ? cycle : 12;
  return -6.4 - row * 0.73 - ((((clock % c) + c) % c) / c) * 2;
}

/** The farthest any pod drifts aft, for framing. */
export const POD_FAR_X = podX(POD_ROWS - 1, 0, 12) - 2;

export function externalPodPosition(i: number): V3 {
  return [-3.4 + Math.floor(i / 4) * 0.65, -0.85, ((i % 4) - 1.5) * 0.21];
}

// §4.8 Keyhole platforms hold station abeam the stern and do not roll with the hull.
export const KEYHOLE_Z = [-7, 7] as const;
export const keyholePosition = (z: number): V3 => [-7.5, 0, z];
export const KEYHOLE_LINK_TO: V3 = [-7, 0, 0];

// §4.11 Grid, §4.12 labels.
export const GRID = { size: 44, divisions: 44, centre: 0x193949, lines: 0x0d2534, y: -5, opacity: 0.48 } as const;
export const LABEL_COLOR = { bow: '#8ac8d3', stern: '#d7b47d', bands: '#5ae0f3', keyhole: '#af92e7', damage: '#ff8597' } as const;
export const LABEL_ANCHOR = { bow: [8, 0.1, 0] as V3, stern: [-8, -1.6, 0] as V3, bands: [0, 5, 0] as V3, keyholeY: 0.8 };
/** Site B pins this note to the grid, where it hides behind the demo buttons; the HUD shows it under the readout instead. */
export const CAPTION = 'SCHEMATIC · FIELDS / HULL / EVENT DURATION ENLARGED';

export function bowText(cls: Pick<ShipClass, 'bow_wall'>, fields: boolean): string {
  if (!fields) return 'BOW';
  return cls.bow_wall === 'full' ? 'BOW WALL / CLOSED THROAT' : cls.bow_wall === 'buckler' ? 'BOW BUCKLER / DRIVE APERTURE' : 'BOW / DEEPER THROAT';
}

export function sternText(cls: Pick<ShipClass, 'stern_wall'>, rails: number, fields: boolean): string {
  if (rails > 0) return `STERN / ${rails} POD LANES`;
  if (!fields) return 'STERN';
  return cls.stern_wall === 'full' ? 'STERN WALL / CLOSED KILT' : cls.stern_wall === 'buckler' ? 'STERN BUCKLER / KILT APERTURE' : 'STERN / SHALLOWER KILT';
}

export const bandsText = (sails: boolean): string => sails ? 'SAIL FIELDS NORMAL TO HULL AXIS' : 'DORSAL / VENTRAL DOUBLE STRESS BANDS';
export const keyholeText = (mark: 1 | 2): string => mark === 2 ? 'KEYHOLE II / APOLLO' : 'KEYHOLE I / DEFENSE';

// §4.4 Mount palette, the source of "amber tubes · mint CM · pale PD · cyan grasers".
export const MOUNT_COLOR: Record<MountKey, number> = {
  missile: 0xffc575, graser: 0x7de9d4, laser: 0x91b6ff, energy_torpedo: 0xff9259, cm: 0x73efb0, pd: 0xe1ffdc, pod_lanes: 0xffc575,
};
/** Dot radius in Site B units; grasers and pod lanes read larger. */
export const mountRadius = (kind: MountKey): number => kind === 'graser' || kind === 'pod_lanes' ? 0.042 : 0.025;
export const MOUNT_LEGEND = 'Mount colors: amber tubes · mint CM · pale PD · cyan grasers.';

// §4.15 Camera preset: bow lower right, stern and pods upper left.
export const CAMERA_EYE: V3 = [14, 12, 21];
export const CAMERA_EYE_NARROW: V3 = [18, 17, 31];
export const CAMERA_TARGET: V3 = [-1, 0, 0];
export const ZOOM_LIMITS: [number, number] = [7, 75];

/** §4.14 Belly-up roll: exponential damping toward 90° at rate 5 per second. */
export const ROLL_RATE = 5;
export const rollTarget = (roll: boolean): number => roll ? Math.PI / 2 : 0;

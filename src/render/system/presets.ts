import { baseValue } from '../../core/evidence';
import type { CelestialBody } from '../../core/schema';
import { bodyPosition } from '../../core/solver/orbits';
import { dist, type Vec3 } from '../../core/vec';
import type { SystemFocus } from '../scales/types';
import type { SystemCatalog } from './catalog';

export interface SystemPose { eye: Vec3; target: Vec3 }

export interface PresetInput {
  index: Map<string, CelestialBody>;
  catalog: SystemCatalog;
  t: number;
  /** Fleets present now, physical km. The primary preset keeps the ones near the origin star in frame. */
  fleets: Vec3[];
  fovDeg: number;
}

const DEG = Math.PI / 180;
/**
 * Site A's establishing angle (user-1, A shot 1.1): the camera stands about 80° round from the terminus bearing, so
 * the resonance zone runs off to the left of the hyper globe, its near side slightly toward the viewer.
 */
const CONE_SWING = 80 * DEG;

export interface PresetFrame { target: Vec3; radius: number; azimuth: number; elevation: number; pad: number }

const limitOf = (b: CelestialBody | null): number => (b ? baseValue(b.hyper_limit) ?? 0 : 0);
const azimuthTo = (from: Vec3, to: Vec3): number => Math.atan2(to[1] - from[1], to[0] - from[0]);

function orbitsAround(star: CelestialBody, input: PresetInput): number[] {
  return [...input.index.values()]
    .filter((b) => b.parent_id === star.id && (b.kind === 'planet' || b.kind === 'belt'))
    .map((b) => baseValue(b.orbit?.radius) ?? 0);
}

/** Look direction and the sphere to keep in view for each Site B preset (B report §2.13), from pack bodies only. */
export function presetFrame(focus: SystemFocus, input: PresetInput): PresetFrame {
  const { catalog, index, t } = input;
  const origin = catalog.origin;
  const s0 = bodyPosition(index, origin.id, t);
  const terminus = catalog.termini[0] ?? null;
  const j = terminus ? bodyPosition(index, terminus.id, t) : null;
  const star = focus === 'secondary' && catalog.companion ? catalog.companion : origin;
  const centre = bodyPosition(index, star.id, t);
  const swing = (j ? azimuthTo(centre, j) : 0) + CONE_SWING;

  if (focus === 'binary' && (catalog.companion || j)) {
    const s1 = catalog.companion ? bodyPosition(index, catalog.companion.id, t) : null;
    const spheres: Array<[Vec3, number]> = [[s0, limitOf(origin)]];
    if (s1) spheres.push([s1, limitOf(catalog.companion)]);
    if (j) spheres.push([j, 0]);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const [p, r] of spheres) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - r); hi[k] = Math.max(hi[k], p[k] + r); }
    const target: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    const radius = Math.max(...spheres.map(([p, r]) => dist(p, target) + r));
    const far = s1 ?? j!;
    let azimuth = Math.atan2(far[1] - s0[1], far[0] - s0[0]) - Math.PI / 2;
    // Look across the stars' axis toward the terminus, as Site B's "Binary & junction" view does.
    if (j && Math.cos(azimuth) * (j[0] - target[0]) + Math.sin(azimuth) * (j[1] - target[1]) > 0) azimuth += Math.PI;
    return { target, radius, azimuth, elevation: 38 * DEG, pad: 1.25 };
  }

  const limit = limitOf(star);
  const orbits = orbitsAround(star, input);
  if (focus === 'outer') {
    const radius = Math.max(limit * 2.5, ...orbits);
    return { target: centre, radius, azimuth: swing, elevation: 30 * DEG, pad: 1.05 };
  }
  // Primary or secondary: the hyper sphere, the planets inside it and the fleets fighting near it.
  const inner = orbits.filter((r) => limit <= 0 || r <= limit);
  let radius = Math.max(limit, ...inner);
  if (focus === 'primary') for (const f of input.fleets) {
    const d = dist(f, centre);
    if (d <= Math.max(radius, 1) * 1.6) radius = Math.max(radius, d);
  }
  if (radius <= 0) radius = Math.max(...orbits, 1e6);
  return { target: centre, radius, azimuth: swing, elevation: 33 * DEG, pad: 2.1 };
}

/** Camera distance for a full-height square plot; the view scales it for its safe area as it does director poses. */
export function framingDistance(radius: number, fovDeg: number, pad: number): number {
  return (radius * pad) / Math.sin((fovDeg * DEG) / 2);
}

export function presetPose(focus: SystemFocus, input: PresetInput): SystemPose {
  const f = presetFrame(focus, input);
  const d = framingDistance(f.radius, input.fovDeg, f.pad);
  const c = Math.cos(f.elevation);
  return {
    target: f.target,
    eye: [f.target[0] + d * c * Math.cos(f.azimuth), f.target[1] + d * c * Math.sin(f.azimuth), f.target[2] + d * Math.sin(f.elevation)],
  };
}

export interface TweenPose { eye: [number, number, number]; target: [number, number, number] }

const smooth = (x: number): number => x * x * (3 - 2 * x);

/**
 * Site B's preset tween, made frame-rate independent: the look-at point glides, the viewing direction turns on a great
 * circle and the distance changes geometrically, so a 60 LM to 1,500 LM move does not rush through the near part.
 */
export class CameraTween {
  private readonly dir0: Vec3;
  private readonly dir1: Vec3;
  private readonly d0: number;
  private readonly d1: number;
  private readonly angle: number;

  constructor(private readonly from: TweenPose, private readonly to: TweenPose, readonly duration = 1.4) {
    const o0: Vec3 = [from.eye[0] - from.target[0], from.eye[1] - from.target[1], from.eye[2] - from.target[2]];
    const o1: Vec3 = [to.eye[0] - to.target[0], to.eye[1] - to.target[1], to.eye[2] - to.target[2]];
    this.d0 = Math.max(1e-9, Math.hypot(...o0));
    this.d1 = Math.max(1e-9, Math.hypot(...o1));
    this.dir0 = [o0[0] / this.d0, o0[1] / this.d0, o0[2] / this.d0];
    this.dir1 = [o1[0] / this.d1, o1[1] / this.d1, o1[2] / this.d1];
    this.angle = Math.acos(Math.max(-1, Math.min(1, this.dir0[0] * this.dir1[0] + this.dir0[1] * this.dir1[1] + this.dir0[2] * this.dir1[2])));
  }

  /** Pose after `elapsed` seconds; done once the duration has passed. */
  at(elapsed: number): TweenPose & { done: boolean } {
    const u = Math.max(0, Math.min(1, elapsed / this.duration));
    const k = smooth(u);
    const target: Vec3 = [0, 1, 2].map((i) => this.from.target[i] + (this.to.target[i] - this.from.target[i]) * k) as Vec3;
    let dir: Vec3;
    if (this.angle < 1e-4) dir = this.dir1;
    else {
      const s = Math.sin(this.angle);
      const a = Math.sin((1 - k) * this.angle) / s, b = Math.sin(k * this.angle) / s;
      dir = [0, 1, 2].map((i) => this.dir0[i] * a + this.dir1[i] * b) as Vec3;
    }
    const d = Math.exp(Math.log(this.d0) + (Math.log(this.d1) - Math.log(this.d0)) * k);
    return { target, eye: [target[0] + dir[0] * d, target[1] + dir[1] * d, target[2] + dir[2] * d], done: u >= 1 };
  }
}

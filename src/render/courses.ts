import * as THREE from 'three';
import { CourseModel, type CoursePlot } from '../core/projection';
import { unitAccel, unitPosition, unitPresent, unitVelocity, type Replay, type UnitTrack } from '../core/replay';
import type { CelestialBody } from '../core/schema';
import { fmtDuration } from '../core/units';
import { len, type Vec3 } from '../core/vec';
import type { LabelSpec } from './labels';
import { LineBatch } from './lines';
import { PALETTE, rgbOf } from './palette';

/** Screen-space dotting of the projected path, CSS px. */
const DASH_PX = 5;
const GAP_PX = 4;
const TICK_PX = 5;
const MARK_PX = 7;
const RING_SEGMENTS = 40;
/** A course shorter than this on screen is drawn as its dotted path alone, so wide views stay clean. */
const DETAIL_PX = 60;
/** Cone edges are drawn through every this many samples. */
const EDGE_STRIDE = 3;
/** Nice tick intervals, s; about ten ticks per course. */
const TICKS_S = [60, 120, 300, 600, 900, 1800, 3600];
const TURN_RGB = rgbOf(PALETTE.amber, 1.1);

export function tickInterval(span: number): number {
  return TICKS_S.find((s) => s >= span / 10) ?? TICKS_S[TICKS_S.length - 1];
}

export interface FleetCourse { unit: UnitTrack; plot: CoursePlot }

/** Every moving fleet's projected course at t, kept until t or the scope changes. */
export class FleetCourses {
  private readonly model: CourseModel;
  private key = '';
  private list: FleetCourse[] = [];

  constructor(bodies: CelestialBody[], private readonly replay: Replay) {
    this.model = new CourseModel(bodies);
  }

  /** `include` picks the fleets drawn; they are also the forces a course can be heading for. */
  at(t: number, scope: string, include: (u: UnitTrack) => boolean): FleetCourse[] {
    const key = `${t}|${scope}`;
    if (key === this.key) return this.list;
    const fleets = this.replay.units.filter((u) => u.kind === 'fleet' && unitPresent(u, t) && include(u));
    const movers = fleets.map((u) => ({ id: u.id, name: u.name, p: unitPosition(u, t), v: unitVelocity(u, t) }));
    this.list = fleets.flatMap((unit, i) => {
      const a = unitAccel(unit, t);
      if (len(movers[i].v) < 1 && len(a) === 0) return [];
      return [{ unit, plot: this.model.project(t, movers[i].p, movers[i].v, a, movers.filter((_, j) => j !== i)) }];
    });
    this.key = key;
    return this.list;
  }
}

export interface CourseStyle {
  /** Side colour, linear. */
  rgb: [number, number, number];
  /** CSS colour for the labels. */
  ink: string;
}

/**
 * Projected courses in the style of an Expanse plot: a dotted path with time ticks, an amber flip marker where braking
 * starts, a reticle on the estimated arrival or translation point, and a cone of cross-track uncertainty around it.
 */
export class CourseLayer {
  readonly lines: LineBatch;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Vector3();
  private count = 0;

  constructor(capacity: number, private readonly kmPerUnit: number) {
    this.lines = new LineBatch(capacity, true, 1);
    this.lines.lines.renderOrder = 3;
  }

  /** Courses drawn this frame. */
  get drawn(): number {
    return this.count;
  }

  begin(): void {
    this.lines.begin();
    this.count = 0;
  }

  commit(): void {
    this.lines.commit();
  }

  draw(
    key: string, plot: CoursePlot, style: CourseStyle, toRender: (km: Vec3) => THREE.Vector3,
    camera: THREE.PerspectiveCamera, width: number, height: number, labels: LabelSpec[],
  ): void {
    const n = plot.points.length;
    if (n < 2) return;
    camera.updateMatrixWorld();
    const pts = plot.points.map(toRender);
    const span = plot.times[n - 1];
    const unitsPerPx = (p: THREE.Vector3) => camera.position.distanceTo(p) * 2 * Math.tan((camera.fov * Math.PI) / 360) / (height * camera.zoom);
    const screen = pts.map((p) => {
      const q = this.s.copy(p).project(camera);
      return q.z < -1 || q.z > 1 ? null : [(q.x + 1) * width / 2, (1 - q.y) * height / 2] as const;
    });
    const fade = (i: number): [number, number, number] => {
      const k = 0.9 - 0.55 * (plot.times[i] / Math.max(span, 1));
      return [style.rgb[0] * k, style.rgb[1] * k, style.rgb[2] * k];
    };

    // Dotted path: dashes walk the projected length so the dotting reads the same at every zoom.
    let phase = 0;
    let drawnPx = 0;
    for (let i = 0; i < n - 1; i++) {
      const sa = screen[i], sb = screen[i + 1];
      if (!sa || !sb) continue;
      const px = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
      if (px === 0) continue;
      drawnPx += px;
      let at = 0;
      while (at < px) {
        const period = DASH_PX + GAP_PX;
        const inDash = phase < DASH_PX;
        const step = Math.min(px - at, inDash ? DASH_PX - phase : period - phase);
        if (inDash) {
          this.a.lerpVectors(pts[i], pts[i + 1], at / px);
          this.b.lerpVectors(pts[i], pts[i + 1], (at + step) / px);
          this.lines.seg(this.a, this.b, fade(i));
        }
        at += step;
        phase = (phase + step) % period;
      }
    }

    if (drawnPx < DETAIL_PX) {
      this.count++;
      return;
    }

    // Time ticks across the path, and the uncertainty cone: rings at the ticks, edges along the sides.
    const tick = tickInterval(span);
    const sideOf = (i: number) => {
      const j = Math.min(i + 1, n - 1), h = Math.max(i - 1, 0);
      const fwd = this.e.subVectors(pts[j], pts[h]);
      if (fwd.lengthSq() === 0) return null;
      fwd.normalize();
      const lateral = new THREE.Vector3(-fwd.y, fwd.x, 0);
      if (lateral.lengthSq() < 1e-12) lateral.set(1, 0, 0);
      lateral.normalize();
      const normal = new THREE.Vector3().crossVectors(fwd, lateral).normalize();
      return { lateral, normal };
    };
    const coneRgb = (i: number): [number, number, number] => fade(i).map((c) => c * 0.32) as [number, number, number];
    const sigmaU = (i: number) => plot.sigma[i] / this.kmPerUnit;
    for (let i = 1; i < n; i++) {
      const due = Math.floor(plot.times[i] / tick) > Math.floor(plot.times[i - 1] / tick);
      if (!due && i !== n - 1) continue;
      const axes = sideOf(i);
      if (!axes || !screen[i]) continue;
      const half = TICK_PX * unitsPerPx(pts[i]);
      if (due) {
        this.a.copy(pts[i]).addScaledVector(axes.lateral, half);
        this.b.copy(pts[i]).addScaledVector(axes.lateral, -half);
        this.lines.seg(this.a, this.b, fade(i));
      }
      const r = sigmaU(i);
      if (r < 1.5 * unitsPerPx(pts[i])) continue;
      for (let s = 0; s < RING_SEGMENTS; s++) {
        const a0 = (2 * Math.PI * s) / RING_SEGMENTS, a1 = (2 * Math.PI * (s + 1)) / RING_SEGMENTS;
        this.a.copy(pts[i]).addScaledVector(axes.lateral, r * Math.cos(a0)).addScaledVector(axes.normal, r * Math.sin(a0));
        this.b.copy(pts[i]).addScaledVector(axes.lateral, r * Math.cos(a1)).addScaledVector(axes.normal, r * Math.sin(a1));
        this.lines.seg(this.a, this.b, coneRgb(i));
      }
    }
    for (const sign of [1, -1]) {
      for (const axis of ['lateral', 'normal'] as const) {
        let prev: THREE.Vector3 | null = null;
        for (let i = 0; i < n; i += EDGE_STRIDE) {
          const j = Math.min(i, n - 1);
          const axes = sideOf(j);
          if (!axes) continue;
          const at = pts[j].clone().addScaledVector(axes[axis], sign * sigmaU(j));
          if (prev) this.lines.seg(prev, at, axis === 'lateral' ? coneRgb(j) : coneRgb(j).map((c) => c * 0.5) as [number, number, number]);
          prev = at;
        }
        const axes = sideOf(n - 1);
        if (prev && axes) this.lines.seg(prev, pts[n - 1].clone().addScaledVector(axes[axis], sign * sigmaU(n - 1)), coneRgb(n - 1));
      }
    }

    // Flip marker where braking starts.
    if (plot.turnover !== null && plot.turnover > 0 && screen[plot.turnover]) {
      const p = pts[plot.turnover];
      this.diamond(p, MARK_PX * unitsPerPx(p), TURN_RGB);
      labels.push({ key: `course-turn:${key}`, cls: 'course turn', text: 'Turnover', sub: `T+${fmtDuration(plot.t0 + plot.times[plot.turnover])}`, pos: p.clone() });
    }
    // Reticle on the estimated end point.
    const end = pts[n - 1];
    if (plot.end !== 'horizon' && screen[n - 1]) {
      const u = unitsPerPx(end);
      this.reticle(end, MARK_PX * u, fade(0));
      const eta = `T+${fmtDuration(plot.t0 + span)}`;
      const text = plot.end === 'limit' ? 'Est. translation' : plot.target?.kind === 'unit' ? 'Est. intercept' : 'Est. arrival';
      const where = plot.end === 'limit' ? `${plot.limit} hyper limit` : plot.target?.name ?? '';
      labels.push({ key: `course-end:${key}`, cls: 'course', color: style.ink, text, sub: `${where} · ${eta}`, pos: end.clone() });
    }
    this.count++;
  }

  private diamond(c: THREE.Vector3, r: number, rgb: [number, number, number]): void {
    const q = [[r, 0], [0, r], [-r, 0], [0, -r]].map(([x, y]) => new THREE.Vector3(c.x + x, c.y + y, c.z));
    this.lines.loop(q, rgb);
  }

  private reticle(c: THREE.Vector3, r: number, rgb: [number, number, number]): void {
    let prev = new THREE.Vector3(c.x + r, c.y, c.z);
    for (let s = 1; s <= 24; s++) {
      const a = (2 * Math.PI * s) / 24;
      const next = new THREE.Vector3(c.x + r * Math.cos(a), c.y + r * Math.sin(a), c.z);
      this.lines.seg(prev, next, rgb);
      prev = next;
    }
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.a.set(c.x + x * r * 0.55, c.y + y * r * 0.55, c.z);
      this.b.set(c.x + x * r * 1.6, c.y + y * r * 1.6, c.z);
      this.lines.seg(this.a, this.b, rgb);
    }
  }
}

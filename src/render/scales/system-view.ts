import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { baseValue } from '../../core/evidence';
import { commanderPicture, replayTrackables, type CommanderPicture } from '../../core/perceived';
import { unitPresent, type Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { Trackable } from '../../core/sensors';
import { bodyPosition, indexBodies, orbitPolyline } from '../../core/solver/orbits';
import { fmtCount, fmtDistance, LM_KM } from '../../core/units';
import type { Vec3 } from '../../core/vec';
import type { LabelSpec } from '../labels';
import { FloatingOrigin } from '../origin';
import { PALETTE, rgbOf, sideColor } from '../palette';
import { PointCloud } from '../points';
import { ageText } from './engagement-view';
import type { ScaleView, ViewContext, ViewStatus } from './types';

/** One render unit is one Mkm. */
const KM_PER_UNIT = 1e6;

export class SystemView implements ScaleView {
  readonly id = 'system' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5e6);
  readonly controls: OrbitControls | null;
  private readonly origin = new FloatingOrigin(KM_PER_UNIT);
  private readonly index;
  private readonly bodyCloud = new PointCloud(128, true);
  private readonly unitCloud = new PointCloud(128);
  private readonly staticLines = new THREE.Group();
  private staticLabels: LabelSpec[] = [];
  private specs: LabelSpec[] = [];
  private framed = false;
  private tracks: Trackable[] = [];
  private tracksTheater: string | null = null;
  private picture: CommanderPicture = { observer: null, contacts: [] };
  private pictureKey = '';
  private notice: string | null = null;

  constructor(private readonly pack: ScenarioPack, private readonly replay: Replay, dom: HTMLElement | null) {
    this.index = indexBodies(pack.bodies);
    this.camera.up.set(0, 0, 1);
    this.scene.add(this.staticLines, this.bodyCloud.points, this.unitCloud.points);
    this.controls = dom ? new OrbitControls(this.camera, dom) : null;
    if (this.controls) this.controls.enableDamping = true;
    this.buildStatic();
  }

  private ring(points: THREE.Vector3[], color: number, opacity: number, dashed: boolean): THREE.LineLoop {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = dashed
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 6, gapSize: 4 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    const line = new THREE.LineLoop(geometry, material);
    if (dashed) line.computeLineDistances();
    return line;
  }

  /** Orbits, limits, exclusions and the resonance hazard axis. Built once: stars and orbit paths do not move visibly during a battle. */
  private buildStatic(): void {
    for (const b of this.pack.bodies) {
      if (b.orbit && b.parent_id) {
        const pts = orbitPolyline(this.index, b.id, 0, 256).map((p) => this.origin.point(p));
        this.staticLines.add(this.ring(pts, b.kind === 'belt' ? PALETTE.inkFaint : PALETTE.inkDim, b.kind === 'belt' ? 0.5 : 0.35, b.kind === 'belt'));
      }
      const limit = baseValue(b.hyper_limit);
      if (limit !== null) {
        const c = bodyPosition(this.index, b.id, 0);
        const pts = Array.from({ length: 256 }, (_, i) => {
          const a = (2 * Math.PI * i) / 256;
          return this.origin.point([c[0] + limit * Math.cos(a), c[1] + limit * Math.sin(a), c[2]]);
        });
        this.staticLines.add(this.ring(pts, PALETTE.wedge, 0.55, false));
        this.staticLabels.push({
          key: `limit:${b.id}`, cls: 'ring limit', text: `${b.name} hyper limit ${fmtDistance(limit)}`,
          sub: b.hyper_limit?.evidence === 'S' ? 'speculative' : undefined,
          pos: this.origin.point([c[0], c[1] + limit, c[2]]),
        });
      }
      const exclusion = baseValue(b.exclusion);
      if (exclusion !== null) {
        const c = bodyPosition(this.index, b.id, 0);
        const pts = Array.from({ length: 96 }, (_, i) => {
          const a = (2 * Math.PI * i) / 96;
          return this.origin.point([c[0] + exclusion * Math.cos(a), c[1] + exclusion * Math.sin(a), c[2]]);
        });
        this.staticLines.add(this.ring(pts, PALETTE.amber, 0.6, true));
      }
    }
    const terminus = this.pack.bodies.find((b) => b.kind === 'terminus');
    const star = terminus?.parent_id ? this.index.get(terminus.parent_id) : undefined;
    if (terminus && star) {
      // MTS §2.6: the volume is "roughly conical" with spurs and its width is not mapped, so only its axis is drawn.
      const j = this.origin.point(bodyPosition(this.index, terminus.id, 0));
      const a = this.origin.point(bodyPosition(this.index, star.id, 0));
      const geometry = new THREE.BufferGeometry().setFromPoints([j, a]);
      const axis = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.45, dashSize: 8, gapSize: 6 }));
      axis.computeLineDistances();
      this.staticLines.add(axis);
      this.staticLabels.push({ key: 'rz', cls: 'ring hazard', text: 'Resonance hazard direction', sub: 'roughly conical, width not mapped (MTS §2.6)', pos: j.clone().lerp(a, 0.5) });
    }
  }

  update(ctx: ViewContext): void {
    const t = ctx.frame.t;
    this.staticLines.visible = ctx.layers.celestial;
    this.bodyCloud.begin();
    this.unitCloud.begin();
    const specs: LabelSpec[] = ctx.layers.celestial ? [...this.staticLabels] : [];

    if (ctx.layers.celestial) {
      for (const b of this.pack.bodies) {
        if (b.kind === 'belt') continue;
        const p = this.origin.point(bodyPosition(this.index, b.id, t));
        const look = b.kind === 'star'
          ? { color: PALETTE.flash, k: 1.8, size: 14, cls: 'star' }
          : b.kind === 'terminus'
            ? { color: PALETTE.violet, k: 1.2, size: 10, cls: 'junction' }
            : { color: PALETTE.ink, k: 0.9, size: b.kind === 'station' ? 4 : 7, cls: 'planet' };
        this.bodyCloud.push(p.x, p.y, p.z, rgbOf(look.color, look.k), look.size, b.kind === 'station' ? 3 : 0);
        if (b.kind !== 'station') specs.push({ key: `body:${b.id}`, cls: look.cls, text: b.name, sub: b.designation, pos: p });
      }
    }

    this.notice = null;
    if (ctx.layers.truth && !ctx.perceived.enabled) {
      this.replay.units.forEach((u, i) => {
        if (!unitPresent(u, t) || ctx.frame.unitCount[i] === 0) return;
        const pv = this.origin.point(ctx.frame.unitPos.subarray(i * 3, i * 3 + 3));
        const n = ctx.frame.unitCount[i];
        this.unitCloud.push(pv.x, pv.y, pv.z, rgbOf(sideColor(this.replay, u.side), 1), 8 + Math.log2(1 + n), u.kind === 'fleet' ? 1 : 0);
        const ally = u.side === this.replay.sides[0].id;
        specs.push({ key: `unit:${u.id}`, cls: `fleet ${ally ? 'allied' : 'hostile'}`, text: u.name, sub: `${fmtCount(n)} ${u.kind === 'lac' ? 'LACs' : 'ships'}`, pos: pv });
      });
    }
    if (ctx.perceived.enabled || ctx.layers.commander) this.drawContacts(ctx, specs);

    this.bodyCloud.commit();
    this.unitCloud.commit();
    this.specs = specs;

    if (!this.framed) {
      this.framed = true;
      const anchor = ctx.pack.meta.theaters.find((th) => th.id === ctx.theater)?.anchor_body ?? ctx.pack.meta.frame.origin_body;
      const target = bodyPosition(this.index, anchor, t);
      const d = 45 * LM_KM;
      this.setPose([target[0] - d * 0.35, target[1] - d, target[2] + d * 0.55], target);
    }
    this.controls?.update();
  }

  /** Fleets as one commander knows them: delayed by light or the FTL sensor preset (MTS §7); packets are left to the engagement view. */
  private drawContacts(ctx: ViewContext, specs: LabelSpec[]): void {
    if (this.tracksTheater !== ctx.theater) {
      this.tracks = replayTrackables(this.replay, ctx.theater).filter((o) => o.kind !== 'packet');
      this.tracksTheater = ctx.theater;
      this.pictureKey = '';
    }
    const tq = Math.round(ctx.frame.t * 4) / 4;
    const key = `${ctx.perceived.side}|${tq}`;
    if (key !== this.pictureKey) {
      this.picture = commanderPicture(this.replay, this.tracks, ctx.perceived.side, ctx.theater, tq, this.pack.meta.ftl_speed_c.value ?? 1);
      this.pictureKey = key;
    }
    const sideName = this.replay.sides.find((x) => x.id === ctx.perceived.side)?.name ?? ctx.perceived.side;
    if (ctx.perceived.enabled && this.picture.observer === null) this.notice = `No ${sideName} fleet is present in this theater`;
    const ghost = !ctx.perceived.enabled;
    for (const c of this.picture.contacts) {
      const p = this.origin.point(c.observed);
      const color = c.identity === 'unknown' ? PALETTE.inkDim : sideColor(this.replay, c.side);
      this.unitCloud.push(p.x, p.y, p.z, rgbOf(color, ghost ? 0.55 : 1), 9, c.kind === 'fleet' ? 1 : 0);
      const ally = c.side === this.replay.sides[0].id;
      specs.push({ key: `contact:${c.id}`, cls: `contact ${ally ? 'allied' : 'hostile'}${ghost ? ' ghost' : ''}`, text: c.label, sub: `${ageText(c.age)}, ${c.identity}`, pos: p });
    }
  }

  followTarget(targetKm: Vec3): void {
    const look = this.controls?.target ?? new THREE.Vector3();
    const offset = this.camera.position.clone().sub(look);
    const target = this.origin.point(targetKm);
    this.camera.position.copy(target).add(offset);
    this.controls?.target.copy(target);
  }

  setPose(eyeKm: Vec3, targetKm: Vec3): void {
    const target = this.origin.point(targetKm);
    this.camera.position.copy(this.origin.point(eyeKm));
    this.camera.lookAt(target);
    this.controls?.target.copy(target);
  }

  labels(): LabelSpec[] {
    return this.specs;
  }

  pick(): number | null {
    return null;
  }

  status(): ViewStatus {
    return { samplingText: null, scaleNote: 'Symbols are drawn at a fixed size. Orbits, limits and exclusions are to scale.', notice: this.notice };
  }

  dispose(): void {
    this.controls?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((mat) => mat.dispose());
    });
  }
}

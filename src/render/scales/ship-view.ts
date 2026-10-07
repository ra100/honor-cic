import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { baseValue, formatLabelled } from '../../core/evidence';
import { shipStatusAt, STATUS_TEXT, subsystemsAt, type Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import { ASPECT_FACTOR, endwallFactor } from '../../core/solver/geometry';
import type { Mounts, ShipClass, TechRegistry } from '../../core/tech';
import type { Vec3 } from '../../core/vec';
import type { LabelSpec } from '../labels';
import { LineBatch } from '../lines';
import { PALETTE, rgbOf } from '../palette';
import { PointCloud } from '../points';
import type { ScaleView, ViewContext, ViewStatus } from './types';

/** One render unit is 10 m. Axes: +X bow, +Z up, -Y starboard (s = f × u, MTS §6.1). */
const KM_PER_UNIT = 0.01;
const POD_TRAVEL_KM = 3;
const toU = (km: number): number => km / KM_PER_UNIT;

export type ShipDemo = 'none' | 'roll' | 'pods' | 'broadside';

interface Anchor { key: string; cls: string; text: string; sub?: string; local: THREE.Vector3 }

export class ShipView implements ScaleView {
  readonly id = 'ship' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.5, 1e7);
  readonly controls: OrbitControls | null;
  private readonly rig = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly mounts = new PointCloud(1024, true);
  private readonly pods = new PointCloud(512);
  private readonly fire = new LineBatch(256, true);
  private stbdMounts: THREE.Vector3[] = [];
  private firing = 0;
  private bands: THREE.Object3D[] = [];
  private walls: { stbd: THREE.Object3D; port: THREE.Object3D } | null = null;
  private anchors: Anchor[] = [];
  private specs: LabelSpec[] = [];
  private classId: string | null = null;
  private dims: [number, number, number] = [1, 0.1, 0.1];
  private sidewallU = 0;
  private mountTotals = { missile: 0, graser: 0 };
  private podCount = 0;
  private podsMoved = 0;
  private demo: ShipDemo = 'none';
  private progress = 0;

  constructor(_pack: ScenarioPack, private readonly replay: Replay, dom: HTMLElement | null) {
    this.camera.up.set(0, 0, 1);
    this.rig.add(this.model, this.mounts.points, this.pods.points, this.fire.lines);
    this.scene.add(this.rig);
    this.controls = dom ? new OrbitControls(this.camera, dom) : null;
    if (this.controls) this.controls.enableDamping = true;
  }

  setDemo(kind: ShipDemo, progress: number): void {
    this.demo = kind;
    this.progress = Math.min(1, Math.max(0, progress));
  }

  currentClass(): string | null {
    return this.classId;
  }

  hullKm(): [number, number, number] {
    return [...this.dims];
  }

  mountCount(): { missile: number; graser: number } {
    return { ...this.mountTotals };
  }

  podsOut(): number {
    return this.podsMoved;
  }

  wedgeVisible(): boolean {
    return this.bands.length > 0 && this.bands.every((b) => b.visible) && !!this.walls?.stbd.visible && !!this.walls?.port.visible;
  }

  shotsFiring(): number {
    return this.firing;
  }

  private defaultClass(tech: TechRegistry): string {
    const r = this.replay;
    const flag = r.ships.find((s) => s.flagship && s.side === r.sides[0]?.id) ?? r.ships[0];
    return flag?.classId ?? Object.keys(tech.classes)[0];
  }

  update(ctx: ViewContext): void {
    const ship = ctx.selectedShip !== null ? this.replay.ships[ctx.selectedShip] ?? null : null;
    const id = ctx.selectedClass ?? ship?.classId ?? this.defaultClass(ctx.tech);
    const cls = ctx.tech.classes[id];
    if (cls && id !== this.classId) this.build(cls);
    const sub = ship && ship.classId === this.classId ? subsystemsAt(ship, ctx.frame.t) : null;
    // The wedge is the subject of the class view, so it ignores the global protection layer; only damage removes it.
    const protection = true;
    for (const b of this.bands) b.visible = protection && (!sub || sub.drive_fore > 0 || sub.drive_aft > 0);
    if (this.walls) {
      this.walls.stbd.visible = protection && (!sub || sub.wall_stbd > 0);
      this.walls.port.visible = protection && (!sub || sub.wall_port > 0);
    }
    // Rolling about the bow axis turns the upper band toward the threat on the starboard side (MTS §6.1).
    this.rig.rotation.x = this.demo === 'roll' ? (Math.PI / 2) * this.progress : 0;
    this.drawPods();
    this.drawBroadside();
    this.rig.updateMatrixWorld(true);
    const at = (v: THREE.Vector3) => v.clone().applyMatrix4(this.rig.matrixWorld);
    const specs: LabelSpec[] = this.anchors.map((a) => ({ key: a.key, cls: a.cls, text: a.text, sub: a.sub, pos: at(a.local) }));
    if (ship) {
      specs.push({ key: 'ship', cls: 'title ship', text: ship.name, sub: STATUS_TEXT[shipStatusAt(this.replay, ship, ctx.frame.t)], pos: at(new THREE.Vector3(0, 0, 0)) });
    }
    if (sub && sub.wall_stbd === 0) specs.push({ key: 'dmg-stbd', cls: 'damage', text: 'Starboard sidewall down', pos: at(new THREE.Vector3(0, -this.sidewallU, 0)) });
    if (sub && sub.wall_port === 0) specs.push({ key: 'dmg-port', cls: 'damage', text: 'Port sidewall down', pos: at(new THREE.Vector3(0, this.sidewallU, 0)) });
    if (sub && sub.drive_fore === 0 && sub.drive_aft === 0) specs.push({ key: 'dmg-drive', cls: 'damage', text: 'Both impeller rings lost, no wedge', pos: at(new THREE.Vector3(0, 0, 0)) });
    if (this.demo === 'broadside') specs.push({ key: 'demo', cls: 'demo', text: `Broadside: ${this.mountTotals.missile / 2} tubes and ${this.mountTotals.graser / 2} grasers to starboard`, sub: 'fired through the sidewall gunports', pos: at(new THREE.Vector3(0, -this.sidewallU * 1.6, 0)) });
    if (this.demo === 'roll') specs.push({ key: 'demo', cls: 'demo', text: `Rolled ${Math.round(90 * this.progress)}°`, sub: 'the stress band turns toward the threat', pos: at(new THREE.Vector3(0, -this.sidewallU * 1.6, 0)) });
    this.specs = specs;
    this.controls?.update();
  }

  private panel(w: number, h: number, color: number, opacity: number): THREE.Group {
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(w, h);
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 })));
    return g;
  }

  private row(n: number, y: number, z: number, lengthU: number, rgb: [number, number, number], shape: number): void {
    for (let k = 0; k < n; k++) {
      const x = -0.35 * lengthU + (0.7 * lengthU * (k + 0.5)) / n;
      this.mounts.push(x, y, z, rgb, 4, shape);
      if (y < 0) this.stbdMounts.push(new THREE.Vector3(x, y, z));
    }
  }

  private build(cls: ShipClass): void {
    this.classId = cls.id;
    this.disposeModel();
    this.anchors = [];
    const L = baseValue(cls.length);
    const B = baseValue(cls.beam);
    const H = baseValue(cls.height);
    const placeholder = L === null || B === null || H === null;
    this.dims = [L ?? 1, B ?? 0.1, H ?? 0.1];
    const [l, b, h] = this.dims.map(toU);

    const box = new THREE.BoxGeometry(l, b, h);
    this.model.add(
      new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: PALETTE.void, transparent: true, opacity: 0.85 })),
      new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: placeholder ? PALETTE.inkFaint : PALETTE.ink })),
    );

    const off = toU(baseValue(cls.wedge.band_offset) ?? 0);
    const len = toU(baseValue(cls.wedge.band_length) ?? 0);
    const wid = toU(baseValue(cls.wedge.band_width) ?? 0);
    this.sidewallU = toU(baseValue(cls.wedge.sidewall_offset) ?? 0);
    this.bands = [off, -off].map((z) => {
      const band = this.panel(len, wid, PALETTE.wedge, 0.1);
      band.position.z = z;
      this.model.add(band);
      return band;
    });
    const stbd = this.panel(len, 2 * off, PALETTE.wedge, 0.06);
    stbd.rotation.x = Math.PI / 2;
    stbd.position.y = -this.sidewallU;
    const port = this.panel(len, 2 * off, PALETTE.wedge, 0.06);
    port.rotation.x = Math.PI / 2;
    port.position.y = this.sidewallU;
    this.model.add(stbd, port);
    this.walls = { stbd, port };

    const n = (m: Mounts, k: keyof Mounts) => m[k].value ?? 0;
    this.stbdMounts = [];
    this.mounts.begin();
    for (const ys of [-1, 1]) {
      this.row(n(cls.broadside, 'missile'), (ys * b) / 2, h / 4, l, rgbOf(PALETTE.ink, 1), 0);
      this.row(n(cls.broadside, 'graser') + n(cls.broadside, 'laser'), (ys * b) / 2, -h / 4, l, rgbOf(PALETTE.flash, 1.4), 1);
    }
    for (const [m, x] of [[cls.fore, l / 2], [cls.aft, -l / 2]] as const) {
      const c = n(m, 'missile') + n(m, 'graser') + n(m, 'laser');
      for (let k = 0; k < c; k++) this.mounts.push(x, ((k + 0.5) / c - 0.5) * b, 0, rgbOf(PALETTE.flash, 1.4), 4, 1);
    }
    this.mounts.commit();
    this.mountTotals = { missile: 2 * n(cls.broadside, 'missile'), graser: 2 * n(cls.broadside, 'graser') };
    this.podCount = cls.pod_eject_count.value ?? 0;

    const spec = (key: string, text: string, sub: string, local: THREE.Vector3) => this.anchors.push({ key, cls: 'spec', text, sub, local });
    this.anchors.push({ key: 'title', cls: 'title', text: cls.name, sub: `${cls.hull}, ${cls.navy}${placeholder ? ', dimensions unknown: placeholder hull' : ''}`, local: new THREE.Vector3(-0.5 * len, 0, 1.5 * off) });
    spec('hull', `Length ${formatLabelled(cls.length)}`, `Beam ${formatLabelled(cls.beam)}, height ${formatLabelled(cls.height)}`, new THREE.Vector3(-0.5 * len, 0, 1.0 * off));
    spec('mass', `Mass ${formatLabelled(cls.mass)}`, `Maximum ${formatLabelled(cls.accel_max)}, normal ${formatLabelled(cls.accel_normal)}`, new THREE.Vector3(-0.5 * len, 0, 0.5 * off));
    spec('broadside', 'Broadside, each side', `${formatLabelled(cls.broadside.missile)} tubes, ${formatLabelled(cls.broadside.graser)} grasers, ${formatLabelled(cls.broadside.cm)} CM, ${formatLabelled(cls.broadside.pd)} PD`, new THREE.Vector3(-0.5 * len, 0, 0));
    spec('band', `Stress band, damage ×${ASPECT_FACTOR.wedge} [S]`, `${formatLabelled(cls.wedge.band_offset)} off the hull, ${formatLabelled(cls.wedge.band_length)} long`, new THREE.Vector3(0, 0, off));
    spec('sidewall', `Sidewall, damage ×${ASPECT_FACTOR.sidewall} [S]`, `${formatLabelled(cls.wedge.sidewall_offset)} out`, new THREE.Vector3(0, -this.sidewallU, -off / 2));
    spec('throat', `Throat (bow), damage ×${endwallFactor(cls.bow_wall)} [S]`, cls.bow_wall === 'none' ? 'open' : `${cls.bow_wall} bow wall`, new THREE.Vector3(len / 2, 0, 0));
    spec('kilt', `Kilt (stern), damage ×${endwallFactor(cls.stern_wall)} [S]`, cls.stern_wall === 'none' ? 'open' : `${cls.stern_wall} stern wall`, new THREE.Vector3(-len / 2, 0, -1.0 * off));
    spec('pods', `Pods ${formatLabelled(cls.pod_eject_count)} per cycle`, `cycle ${formatLabelled(cls.pod_eject_cycle)}`, new THREE.Vector3(-0.5 * len, 0, -0.5 * off));

    const d = Math.max(l, len) * 1.4;
    this.setPose([-0.6 * d * KM_PER_UNIT, -0.9 * d * KM_PER_UNIT, 0.5 * d * KM_PER_UNIT], [0, 0, 0]);
  }

  private drawPods(): void {
    this.pods.begin();
    this.podsMoved = 0;
    if (this.demo === 'pods') {
      const [l, b, h] = this.dims.map(toU);
      for (let k = 0; k < this.podCount; k++) {
        const q = Math.min(1, Math.max(0, (this.progress - (k / this.podCount) * 0.6) / 0.4));
        if (q <= 0) continue;
        this.pods.push(-l / 2 - q * toU(POD_TRAVEL_KM), ((k % 4) - 1.5) * (b / 4), ((Math.floor(k / 4) % 3) - 1) * (h / 3), rgbOf(PALETTE.amber, 1), 5, 3);
        this.podsMoved++;
      }
    }
    this.pods.commit();
  }

  /** Staggered fire from the starboard mounts out past the sidewall (display of mount count and side, not of timing). */
  private drawBroadside(): void {
    this.fire.begin();
    this.firing = 0;
    if (this.demo === 'broadside') {
      const reach = this.sidewallU * 2 + toU(2);
      const n = this.stbdMounts.length;
      this.stbdMounts.forEach((m, k) => {
        const phase = (this.progress * 3 + k / Math.max(1, n)) % 1;
        if (phase > 0.3) return;
        const end = new THREE.Vector3(m.x, m.y - reach * (phase / 0.3), m.z);
        this.fire.seg(m, end, rgbOf(PALETTE.flash, 1.8), rgbOf(PALETTE.flash, 0.4));
        this.firing++;
      });
    }
    this.fire.commit();
  }

  /** The ship view is a local model, so only the eye offset from the target matters. */
  setPose(eyeKm: Vec3, targetKm: Vec3): void {
    this.camera.position.set(toU(eyeKm[0] - targetKm[0]), toU(eyeKm[1] - targetKm[1]), toU(eyeKm[2] - targetKm[2]));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.controls?.target.set(0, 0, 0);
  }

  labels(): LabelSpec[] {
    return this.specs;
  }

  pick(): number | null {
    return null;
  }

  status(): ViewStatus {
    return { samplingText: null, scaleNote: 'Hull, stress bands and sidewalls are to scale. Mount markers are schematic positions along the hull.', notice: null };
  }

  private disposeModel(): void {
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((mat) => mat.dispose());
    });
    this.model.clear();
  }

  dispose(): void {
    this.controls?.dispose();
    this.disposeModel();
    this.mounts.points.geometry.dispose();
    this.pods.points.geometry.dispose();
    this.fire.lines.geometry.dispose();
  }
}

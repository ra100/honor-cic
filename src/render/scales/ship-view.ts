import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { baseValue, formatLabelled } from '../../core/evidence';
import { shipStatusAt, STATUS_TEXT, subsystemsAt, type Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import { ASPECT_FACTOR, endwallFactor } from '../../core/solver/geometry';
import type { MountKey, ShipClass, TechRegistry } from '../../core/tech';
import type { Vec3 } from '../../core/vec';
import { applyPlotInsets, fitPlotRadius, plotDistanceScale, plotSize, safePlotRect, type ShipFraming } from '../framing';
import type { LabelSpec } from '../labels';
import { LineBatch } from '../lines';
import { PALETTE, rgbOf } from '../palette';
import { PointCloud } from '../points';
import { buildHullSchematic, HULL_KM_PER_UNIT, hullRing, sectionAt, type HullSchematic, type SchematicMount } from '../ship-schematic';
import type { ScaleView, ViewContext, ViewStatus } from './types';

const POD_TRAVEL_KM = 3;
const toU = (km: number): number => km / HULL_KM_PER_UNIT;
const OFFENSIVE = new Set<MountKey>(['missile', 'graser', 'laser', 'energy_torpedo']);
const MOUNT_STYLE: Record<MountKey, { color: number; size: number; shape: number }> = {
  missile: { color: PALETTE.ink, size: 3.4, shape: 0 },
  graser: { color: PALETTE.flash, size: 4.2, shape: 1 },
  laser: { color: PALETTE.flash, size: 3.2, shape: 2 },
  energy_torpedo: { color: PALETTE.flash, size: 3.2, shape: 3 },
  cm: { color: PALETTE.inkDim, size: 2.8, shape: 4 },
  pd: { color: PALETTE.ink, size: 2.8, shape: 6 },
  pod_lanes: { color: PALETTE.amber, size: 4.2, shape: 3 },
};

export type ShipDemo = 'none' | 'roll' | 'pods' | 'broadside';
interface Anchor { key: string; cls: string; text: string; sub?: string; local: THREE.Vector3; framing?: ShipFraming }

export class ShipView implements ScaleView {
  readonly id = 'ship' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1e7);
  readonly controls: OrbitControls | null;
  private readonly rig = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly envelope = new THREE.Group();
  private readonly mounts = new PointCloud(1024);
  private readonly pods = new PointCloud(512);
  private readonly fire = new LineBatch(256, false, 0.85);
  private readonly raycaster = new THREE.Raycaster();
  private hull: THREE.Mesh | null = null;
  private schematic: HullSchematic | null = null;
  private stbdMounts: THREE.Vector3[] = [];
  private firing = 0;
  private bands: THREE.Object3D[] = [];
  private walls: { stbd: THREE.Object3D; port: THREE.Object3D } | null = null;
  private rings: THREE.Object3D[] = [];
  private anchors: Anchor[] = [];
  private specs: LabelSpec[] = [];
  private classId: string | null = null;
  private cls: ShipClass | null = null;
  private dims: [number, number, number] = [1, 0.15, 0.14];
  private sidewallU = 0;
  private mountTotals = { missile: 0, graser: 0 };
  private podCount = 0;
  private podsMoved = 0;
  private demo: ShipDemo = 'none';
  private progress = 0;
  private framing: ShipFraming = 'hull';
  private frameKey = '';
  private fittedDistance = 0;
  private selectedShip: number | null = null;
  private posePending = false;

  constructor(_pack: ScenarioPack, private readonly replay: Replay, private readonly dom: HTMLElement | null) {
    this.scene.background = new THREE.Color(PALETTE.void);
    this.camera.up.set(0, 0, 1);
    this.rig.add(this.model, this.envelope, this.mounts.points, this.pods.points, this.fire.lines);
    const key = new THREE.DirectionalLight(0xfff4de, 2.1);
    key.position.set(-1, -1.6, 2);
    const fill = new THREE.DirectionalLight(0xc8d7e6, 0.8);
    fill.position.set(0.8, 1, 0.5);
    this.scene.add(this.rig, new THREE.HemisphereLight(0xd6e6f3, 0x222a35, 1.2), key, fill);
    this.controls = dom ? new OrbitControls(this.camera, dom) : null;
    if (this.controls) this.controls.enableDamping = true;
  }

  setDemo(kind: ShipDemo, progress: number): void {
    this.demo = kind;
    this.progress = Math.min(1, Math.max(0, progress));
  }

  currentClass(): string | null { return this.classId; }
  hullKm(): [number, number, number] { return [...this.dims]; }
  mountCount(): { missile: number; graser: number } { return { ...this.mountTotals }; }
  mountLayout(): SchematicMount[] { return this.schematic?.mounts.map((m) => ({ ...m, position: m.position.clone() })) ?? []; }
  podsOut(): number { return this.podsMoved; }
  shotsFiring(): number { return this.firing; }
  wedgeVisible(): boolean {
    return this.bands.length > 0 && this.bands.every((b) => b.visible) && !!this.walls?.stbd.visible && !!this.walls?.port.visible;
  }

  private defaultClass(tech: TechRegistry): string {
    const flag = this.replay.ships.find((s) => s.flagship && s.side === this.replay.sides[0]?.id) ?? this.replay.ships[0];
    return flag?.classId ?? Object.keys(tech.classes)[0];
  }

  update(ctx: ViewContext): void {
    const selected = ctx.selectedShip !== null ? this.replay.ships[ctx.selectedShip] ?? null : null;
    const ship = selected && (!ctx.perceived.enabled || selected.side === ctx.perceived.side) ? selected : null;
    const id = ctx.selectedClass ?? ship?.classId ?? this.defaultClass(ctx.tech);
    const cls = ctx.tech.classes[id];
    const classChanged = !!cls && id !== this.classId;
    if (classChanged) this.build(cls);
    this.framing = ctx.shipFraming ?? 'hull';
    this.selectedShip = ship?.classId === this.classId ? ctx.selectedShip : null;
    const sub = this.selectedShip !== null && ship ? subsystemsAt(ship, ctx.frame.t) : null;
    const protection = this.framing === 'defenses' && ctx.layers.protection;
    for (const band of this.bands) band.visible = protection && (!sub || sub.drive_fore > 0 || sub.drive_aft > 0);
    if (this.walls) {
      this.walls.stbd.visible = protection && (!sub || sub.wall_stbd > 0);
      this.walls.port.visible = protection && (!sub || sub.wall_port > 0);
    }
    this.rings.forEach((ring, i) => {
      (ring as THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>).material.opacity = ctx.layers.damage && sub && sub[i ? 'drive_fore' : 'drive_aft'] === 0 ? 0.18 : 0.8;
    });
    this.reframe(ctx, classChanged);
    this.rig.rotation.x = this.demo === 'roll' ? Math.PI / 2 * this.progress : 0;
    this.drawPods();
    this.drawBroadside();
    this.rig.updateMatrixWorld(true);
    const at = (v: THREE.Vector3) => v.clone().applyMatrix4(this.rig.matrixWorld);
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    const safe = safePlotRect(width, height, ctx.plotInsets);
    const compact = safe.width < 640 || safe.height < 320;
    const specs: LabelSpec[] = this.anchors
      .filter((a) => !a.framing || a.framing === this.framing)
      .filter((a) => !compact || ['title', 'hull', 'band', 'sidewall'].includes(a.key))
      .map((a) => ({ key: a.key, cls: a.cls, text: a.text, sub: a.sub, pos: at(a.local) }));
    const [l, b, h] = this.dims.map(toU);
    if (this.selectedShip !== null && ship) {
      specs.push({ key: 'ship', cls: 'title ship', text: ship.name, sub: STATUS_TEXT[shipStatusAt(this.replay, ship, ctx.frame.t)], pos: at(new THREE.Vector3(0, b, h)) });
      if (ship.equipment.length) specs.push({ key: 'equipment', cls: 'spec', text: ship.equipment.includes('keyhole-ii') ? 'Keyhole II fitted' : 'Keyhole fitted', sub: 'Scenario ship fit; platform positions not inferred [S]', pos: at(new THREE.Vector3(l * 0.25, b, h)) });
    }
    if (ctx.layers.damage && sub) {
      if (sub.wall_stbd === 0) specs.push({ key: 'dmg-stbd', cls: 'damage', text: 'Starboard sidewall down', pos: at(new THREE.Vector3(0, this.framing === 'hull' ? -b : -this.sidewallU, 0)) });
      if (sub.wall_port === 0) specs.push({ key: 'dmg-port', cls: 'damage', text: 'Port sidewall down', pos: at(new THREE.Vector3(0, this.framing === 'hull' ? b : this.sidewallU, 0)) });
      if (sub.drive_fore === 0 && sub.drive_aft === 0) specs.push({ key: 'dmg-drive', cls: 'damage', text: 'Both impeller rings lost, no wedge', pos: at(new THREE.Vector3(0, 0, h)) });
    }
    if (this.demo === 'broadside') specs.push({
      key: 'demo', cls: 'demo',
      text: compact ? 'Starboard broadside [S]' : `Broadside: ${this.mountTotals.missile / 2} tubes and ${this.mountTotals.graser / 2} grasers to starboard`,
      sub: compact ? 'Illustrative firing vectors' : 'Schematic firing vectors [S], not weapon range or salvo timing', pos: at(new THREE.Vector3(0, -b, -h)),
    });
    if (this.demo === 'roll') specs.push({
      key: 'demo', cls: 'demo', text: `Rolled ${Math.round(90 * this.progress)}°`,
      sub: this.framing === 'defenses' ? 'The stress band turns toward the threat [S]' : compact ? 'Hull attitude [S]' : 'Hull attitude [S]; choose Defenses to inspect the physical stress bands',
      pos: at(new THREE.Vector3(0, -b, -h)),
    });
    if (this.demo === 'pods') specs.push({
      key: 'demo', cls: 'demo', text: `${this.podsMoved} pods${compact ? ' released [S]' : ' released in this schematic cycle [S]'}`,
      sub: this.schematic?.mounts.some((m) => m.kind === 'pod_lanes') ? 'Astern ejection, motion timing is illustrative' : 'External flatpack release, positions and timing are schematic',
      pos: at(new THREE.Vector3(-l / 2 - toU(POD_TRAVEL_KM) * 0.5, 0, h)),
    });
    const box = this.schematic?.geometry.boundingBox;
    const avoid = box ? [box.min.x, box.max.x].flatMap((x) =>
      [box.min.y, box.max.y].flatMap((y) =>
        [box.min.z, box.max.z].map((z) => at(new THREE.Vector3(x, y, z))))) : [];
    this.specs = specs.map((spec) => ({ ...spec, avoid }));
    if (this.controls) this.controls.enableDamping = !ctx.reducedMotion;
    this.controls?.update();
    this.camera.updateMatrixWorld();
    this.posePending = false;
  }

  private reframe(ctx: ViewContext, classChanged: boolean): void {
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    const safe = applyPlotInsets(this.camera, width, height, ctx.plotInsets);
    const key = `${this.classId}|${this.framing}|${this.demo === 'pods'}|${width}|${height}|${safe.x}|${safe.y}|${safe.width}|${safe.height}`;
    if (!this.cls) return;
    if (this.posePending) {
      this.camera.position.multiplyScalar(plotDistanceScale(this.camera, width, height, ctx.plotInsets));
      this.frameKey = key;
      return;
    }
    if (key === this.frameKey) return;
    const extent = this.dims.map(toU);
    if (this.framing === 'defenses') {
      extent[0] = Math.max(extent[0], toU(baseValue(this.cls.wedge.band_length) ?? 0));
      extent[1] = Math.max(extent[1], toU(baseValue(this.cls.wedge.band_width) ?? 0), 2 * this.sidewallU);
      extent[2] = Math.max(extent[2], 2 * toU(baseValue(this.cls.wedge.band_offset) ?? 0));
    }
    const target = new THREE.Vector3();
    if (this.demo === 'pods' && this.podCount > 0 && this.framing === 'hull') {
      extent[0] += toU(POD_TRAVEL_KM);
      target.x = -toU(POD_TRAVEL_KM) / 2;
    }
    const distance = fitPlotRadius(this.camera, Math.hypot(...extent) / 2, width, height, ctx.plotInsets, 1.08);
    const oldTarget = this.controls?.target ?? new THREE.Vector3();
    const offset = this.camera.position.clone().sub(oldTarget);
    if (classChanged || !this.fittedDistance || !offset.lengthSq()) {
      offset.set(-0.55, -1, 0.6).normalize().multiplyScalar(distance);
    } else {
      offset.multiplyScalar(distance / this.fittedDistance);
    }
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.controls?.target.copy(target);
    this.fittedDistance = distance;
    this.frameKey = key;
  }

  private panel(width: number, height: number, opacity: number): THREE.Group {
    const group = new THREE.Group();
    const geometry = new THREE.PlaneGeometry(width, height);
    group.add(
      new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: PALETTE.wedge, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })),
      new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: PALETTE.wedge, transparent: true, opacity: 0.5 })),
    );
    return group;
  }

  private build(cls: ShipClass): void {
    this.disposeModel();
    this.classId = cls.id;
    this.cls = cls;
    const schematic = buildHullSchematic(cls);
    this.schematic = schematic;
    this.dims = schematic.dimensionsKm;
    const [l, b, h] = this.dims.map(toU);
    this.hull = new THREE.Mesh(schematic.geometry, new THREE.MeshStandardMaterial({ color: PALETTE.inkDim, roughness: 0.85, metalness: 0.25 }));
    this.hull.name = 'physical-hull';
    this.model.add(this.hull, new THREE.LineSegments(new THREE.EdgesGeometry(schematic.geometry, 25), new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.28 })));
    this.rings = [-0.31, 0.31].map((x) => {
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hullRing(sectionAt(schematic.sections, x), [l, b * 1.01, h * 1.01])), new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.8 }));
      this.model.add(ring);
      return ring;
    });
    this.stbdMounts = [];
    this.mounts.begin();
    for (const mount of schematic.mounts) {
      const style = MOUNT_STYLE[mount.kind];
      this.mounts.push(mount.position.x, mount.position.y, mount.position.z, rgbOf(style.color, 0.9), style.size, style.shape);
      if (mount.aspect === 'starboard' && OFFENSIVE.has(mount.kind)) this.stbdMounts.push(mount.position.clone());
      if (mount.kind === 'pod_lanes') {
        const door = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.12, b * 0.08), new THREE.MeshStandardMaterial({ color: 0x16202d, roughness: 0.95, side: THREE.DoubleSide }));
        door.rotation.y = Math.PI / 2;
        door.position.copy(mount.position);
        door.position.x += 0.002;
        this.model.add(door);
      }
    }
    for (const bay of schematic.bays) {
      const recess = new THREE.Mesh(new THREE.PlaneGeometry(l * 0.7 / Math.max(1, schematic.bays.length), h * 0.18), new THREE.MeshStandardMaterial({ color: 0x121b27, roughness: 0.95, side: THREE.DoubleSide }));
      recess.rotation.x = Math.PI / 2;
      recess.position.copy(bay);
      recess.position.y += Math.sign(bay.y) * 0.005;
      this.model.add(recess);
    }
    this.mounts.commit();
    this.mountTotals = { missile: 2 * (cls.broadside.missile.value ?? 0), graser: 2 * (cls.broadside.graser.value ?? 0) };
    this.podCount = cls.pod_eject_count.value ?? 0;
    const off = toU(baseValue(cls.wedge.band_offset) ?? 0);
    const length = toU(baseValue(cls.wedge.band_length) ?? 0);
    const width = toU(baseValue(cls.wedge.band_width) ?? 0);
    this.sidewallU = toU(baseValue(cls.wedge.sidewall_offset) ?? 0);
    this.bands = [off, -off].map((z) => {
      const band = this.panel(length, width, 0.025);
      band.position.z = z;
      this.envelope.add(band);
      return band;
    });
    const stbd = this.panel(length, off * 2, 0.015);
    stbd.rotation.x = Math.PI / 2;
    stbd.position.y = -this.sidewallU;
    const port = this.panel(length, off * 2, 0.015);
    port.rotation.x = Math.PI / 2;
    port.position.y = this.sidewallU;
    this.envelope.add(stbd, port);
    this.walls = { stbd, port };

    this.anchors = [{
      key: 'title', cls: 'title', text: cls.name,
      sub: `${cls.hull}, ${cls.navy}${schematic.placeholder ? ', dimensions unknown: placeholder hull' : ', technical schematic [S]'}`,
      local: new THREE.Vector3(-l * 0.5, 0, h),
    }];
    const spec = (key: string, text: string, sub: string, local: THREE.Vector3, framing?: ShipFraming) => this.anchors.push({ key, cls: 'spec', text, sub, local, framing });
    spec('hull', `Length ${formatLabelled(cls.length)}`, `Beam ${formatLabelled(cls.beam)}, height ${formatLabelled(cls.height)}`, new THREE.Vector3(-l * 0.2, b, h), 'hull');
    spec('mass', `Mass ${formatLabelled(cls.mass)}`, `Maximum ${formatLabelled(cls.accel_max)}, normal ${formatLabelled(cls.accel_normal)}`, new THREE.Vector3(l * 0.25, b, h), 'hull');
    spec('broadside', 'Broadside, each side; placement [S]', broadsideText(cls), new THREE.Vector3(-l * 0.15, -b / 2, h * 0.6), 'hull');
    spec('fore', 'Bow mounts; placement [S]', chaseText(cls, 'fore'), new THREE.Vector3(l / 2, 0, 0), 'hull');
    spec('aft', 'Stern mounts; placement [S]', chaseText(cls, 'aft'), new THREE.Vector3(-l / 2, 0, 0), 'hull');
    spec('rings', 'Fore and aft impeller rings; placement [S]', 'Hammerheads, armor and apertures are schematic, not canon artwork', new THREE.Vector3(l * 0.31, 0, h / 2), 'hull');
    if (this.podCount) spec('pods', `Pods ${formatLabelled(cls.pod_eject_count)} per cycle`, `Cycle ${formatLabelled(cls.pod_eject_cycle)}, capacity ${formatLabelled(cls.pod_capacity)}`, new THREE.Vector3(-l * 0.4, -b, -h), 'hull');
    if (schematic.bays.length) spec('bays', `LAC bays ${formatLabelled(cls.lac_bays)}`, 'Recess locations and sizes are schematic [S]', new THREE.Vector3(0, -b * 0.5, 0), 'hull');
    spec('band', `Stress band, damage ×${ASPECT_FACTOR.wedge} [S]`, `${formatLabelled(cls.wedge.band_offset)} off the hull, ${formatLabelled(cls.wedge.band_length)} long`, new THREE.Vector3(0, 0, off), 'defenses');
    spec('sidewall', `Sidewall, damage ×${ASPECT_FACTOR.sidewall} [S]`, `${formatLabelled(cls.wedge.sidewall_offset)} out`, new THREE.Vector3(0, -this.sidewallU, -off / 2), 'defenses');
    spec('throat', `Throat (bow), damage ×${endwallFactor(cls.bow_wall)} [S]`, cls.bow_wall === 'none' ? 'Open' : `${cls.bow_wall} bow wall`, new THREE.Vector3(length / 2, 0, 0), 'defenses');
    spec('kilt', `Kilt (stern), damage ×${endwallFactor(cls.stern_wall)} [S]`, cls.stern_wall === 'none' ? 'Open' : `${cls.stern_wall} stern wall`, new THREE.Vector3(-length / 2, 0, -off), 'defenses');
  }

  private drawPods(): void {
    this.pods.begin();
    this.podsMoved = 0;
    if (this.demo === 'pods') {
      const [l, b, h] = this.dims.map(toU);
      const lanes = this.schematic?.mounts.filter((m) => m.kind === 'pod_lanes') ?? [];
      for (let k = 0; k < this.podCount; k++) {
        const q = Math.min(1, Math.max(0, (this.progress - k / this.podCount * 0.6) / 0.4));
        if (!q) continue;
        const start = lanes.length ? lanes[k % lanes.length].position : new THREE.Vector3(-l / 2, (k % 2 ? 1 : -1) * b / 2, ((k % 5) - 2) * h / 6);
        this.pods.push(start.x - q * toU(POD_TRAVEL_KM), start.y, start.z, rgbOf(PALETTE.amber, 1), 4.5, 3);
        this.podsMoved++;
      }
    }
    this.pods.commit();
  }

  private drawBroadside(): void {
    this.fire.begin();
    this.firing = 0;
    if (this.demo === 'broadside') {
      const reach = this.sidewallU * 2 + toU(2);
      this.stbdMounts.forEach((mount, k) => {
        const phase = (this.progress * 3 + k / Math.max(1, this.stbdMounts.length)) % 1;
        if (phase > 0.3) return;
        this.fire.seg(mount, new THREE.Vector3(mount.x, mount.y - reach * phase / 0.3, mount.z), rgbOf(PALETTE.flash, 1.4), rgbOf(PALETTE.flash, 0.12));
        this.firing++;
      });
    }
    this.fire.commit();
  }

  followTarget(): void {}

  setPose(eyeKm: Vec3, targetKm: Vec3): void {
    this.camera.position.set(toU(eyeKm[0] - targetKm[0]), toU(eyeKm[1] - targetKm[1]), toU(eyeKm[2] - targetKm[2]));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.controls?.target.set(0, 0, 0);
    this.posePending = true;
  }

  labels(): LabelSpec[] { return this.specs; }

  pick(ndcX: number, ndcY: number): number | null {
    if (this.selectedShip === null || !this.hull) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return this.raycaster.intersectObject(this.hull).length ? this.selectedShip : null;
  }

  status(): ViewStatus {
    return {
      samplingText: null,
      scaleNote: `${this.schematic?.placeholder ? 'Unknown hull dimensions: labelled placeholder, not a measurement.' : 'Hull dimensions are physical.'} ${this.framing === 'hull' ? 'Defensive envelope hidden in Hull framing.' : 'Stress bands and sidewalls remain at true scale.'} Silhouette, mount/bay locations and marker sizes are schematic [S].`,
      notice: null,
    };
  }

  private disposeModel(): void {
    for (const group of [this.model, this.envelope]) {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        (Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []).forEach((material) => material.dispose());
      });
      group.clear();
    }
  }

  dispose(): void {
    this.controls?.dispose();
    this.disposeModel();
    for (const object of [this.mounts.points, this.pods.points, this.fire.lines]) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  }
}

function broadsideText(cls: ShipClass): string {
  return `${formatLabelled(cls.broadside.missile)} tubes, ${formatLabelled(cls.broadside.graser)} G, ${formatLabelled(cls.broadside.laser)} L, ${formatLabelled(cls.broadside.energy_torpedo)} ET, ${formatLabelled(cls.broadside.cm)} CM, ${formatLabelled(cls.broadside.pd)} PD`;
}

function chaseText(cls: ShipClass, aspect: 'fore' | 'aft'): string {
  const mounts = cls[aspect];
  return `${formatLabelled(mounts.missile)} tubes, ${formatLabelled(mounts.graser)} G, ${formatLabelled(mounts.laser)} L, ${formatLabelled(mounts.energy_torpedo)} ET, ${formatLabelled(mounts.cm)} CM, ${formatLabelled(mounts.pd)} PD${mounts.pod_lanes.value ? `, ${formatLabelled(mounts.pod_lanes)} pod lanes` : ''}`;
}

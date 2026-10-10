import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { subsystemsAt, type Replay, type ShipTrack } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { MountKey, ShipClass, TechRegistry } from '../../core/tech';
import type { Vec3 } from '../../core/vec';
import { applyPlotInsets, plotDistanceScale, plotSize, type PlotRect } from '../framing';
import { GRADE_TECHNICAL } from '../grade';
import type { LabelSpec } from '../labels';
import { LineBatch } from '../lines';
import { PointCloud } from '../points';
import { buildHullSchematic, HULL_KM_PER_UNIT, hullRing, type HullSchematic, type SchematicMount } from '../ship-schematic';
import { matchLinear, siteBColor } from '../ship/display-match';
import { fireDemoFrame, type DemoMount, type DemoMountType, type DemoSpec } from '../ship/fire-demo';
import { glowTexture } from '../ship/glow';
import * as B from '../ship/site-b';
import { FIRE_DEMO_S, type ScaleView, type ViewContext, type ViewStatus } from './types';

const toU = (km: number): number => km / HULL_KM_PER_UNIT;
const DEMO_TYPE: Partial<Record<MountKey, DemoMountType>> = { missile: 'M', graser: 'G', laser: 'L', energy_torpedo: 'ET', cm: 'CM', pd: 'PD' };
const OFFENSIVE: MountKey[] = ['missile', 'graser', 'laser', 'energy_torpedo'];

function quad(points: B.V3[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function line(points: B.V3[], color: THREE.Color, opacity: number, dashed = false): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
  const m = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 1, gapSize: 0.8 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const l = new THREE.Line(g, m);
  if (dashed) l.computeLineDistances();
  return l;
}

/** A Site B field: its colour and opacity matched to how Site B displays them (display-match.ts), added over the sky. */
const field = (hex: number, opacity: number, additive: boolean, layers = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color: siteBColor(hex, opacity, additive, false, layers, true), transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const outline = (hex: number, opacity: number): THREE.LineBasicMaterial => new THREE.LineBasicMaterial({ color: siteBColor(hex, opacity), transparent: true, opacity });
const linearOf = (hex: number, k = 1): [number, number, number] => new THREE.Color(hex).multiplyScalar(k).toArray() as [number, number, number];

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    (Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []).forEach((m) => m.dispose());
  });
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    disposeTree(child);
    group.remove(child);
  }
}

/**
 * Ship detail (B report §4): the true-scale class hull lit as Site B's metal, inside Site B's schematic wedge:
 * double dorsal and ventral stress bands flaring from a shallow stern kilt to a deep bow throat, sidewalls,
 * end apertures, Keyhole platforms, pods trailing on tethers, transit sails, a grid floor and the fire / defense demo.
 * Fields keep Site B's proportions to the hull length; they are a schematic, not the physical band geometry.
 */
export class ShipView implements ScaleView {
  readonly id = 'ship' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 1, 0.05, 1e6);
  readonly controls: OrbitControls | null;
  readonly grade = GRADE_TECHNICAL;
  readonly kmPerUnit = HULL_KM_PER_UNIT;
  /** Our frame (X bow, Y port, Z dorsal); rolls about the hull axis. */
  private readonly shipRoot = new THREE.Group();
  private readonly hullParts = new THREE.Group();
  /** Site B's frame rolling with the hull: bands, sidewalls, end apertures, sails, pods. */
  private readonly rollFrame = new THREE.Group();
  /** Site B's frame that holds still: Keyholes, grid and the demo tracks. */
  private readonly fixedFrame = new THREE.Group();
  private readonly bands = new THREE.Group();
  private readonly sidewalls: { port: THREE.Mesh; stbd: THREE.Mesh };
  private readonly endwalls = new THREE.Group();
  private readonly sails = new THREE.Group();
  private readonly podGroup = new THREE.Group();
  private readonly keyholes = new THREE.Group();
  private readonly grid: THREE.GridHelper;
  private readonly tracks = new LineBatch(1600, true, 0.64);
  private readonly heads = new PointCloud(1600);
  private readonly flash: THREE.Sprite;
  private readonly raycaster = new THREE.Raycaster();
  private hull: THREE.Mesh | null = null;
  private impellers: Array<THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>> = [];
  private schematic: HullSchematic | null = null;
  private classId: string | null = null;
  private cls: ShipClass | null = null;
  private dims: [number, number, number] = [1, 0.15, 0.14];
  private k = 1;
  private mountTotals = { missile: 0, graser: 0 };
  private rails: Array<[number, number]> = [];
  private externalPods = 0;
  private podCycle = 12;
  private pods: Array<{ mesh: THREE.Mesh; row: number }> = [];
  private demoSpec: DemoSpec = { mounts: [], carrier: false, rails: 0, externalPods: 0, podLoad: 10, apollo: false, spinal: null };
  private defaultStatus = B.MOUNT_LEGEND;
  private statusText = B.MOUNT_LEGEND;
  private keyholeMark: 0 | 1 | 2 = 0;
  private refKey = '';
  private roll = 0;
  private lastTime: number | null = null;
  private clockS = 0;
  private lastFireT: number | null = null;
  private demoPose = 0;
  private rollMoving = false;
  private drifting = false;
  private demoRunning = false;
  private podsShown = 0;
  private firing = 0;
  private specs: LabelSpec[] = [];
  private readonly trackPalette = new Map<string, Array<[number, number, number]>>();
  private frameKey = '';
  private fittedDistance = 0;
  private readonly orbit = new THREE.Vector3();
  private selectedShip: number | null = null;
  private posePending = false;

  constructor(
    _pack: ScenarioPack,
    private readonly replay: Replay,
    private readonly dom: HTMLElement | null,
    private readonly clock: () => number = () => performance.now() / 1000,
  ) {
    this.camera.up.set(0, 0, 1);
    // §1.2 Site B's lights, in our frame: (x, y, z)B → (x, −z, y).
    const sun = new THREE.DirectionalLight(0xe5f6ff, 3.5);
    sun.position.set(-20, -25, 35);
    const rim = new THREE.DirectionalLight(0x2889b5, 2);
    rim.position.set(10, 30, -5);
    this.scene.add(new THREE.AmbientLight(0x9dbce4, 2), sun, rim, this.shipRoot, this.fixedFrame);
    this.shipRoot.add(this.hullParts, this.rollFrame);

    for (const { sign, band } of B.BANDS) {
      const g = quad(B.wedgeVertices(sign, band));
      const fill = new THREE.Mesh(g, field(B.B_COLOR.friendly, 0.04, true, 2));
      fill.name = 'band-fill';
      fill.scale.set(...B.WEDGE_SCALE);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(g), outline(B.B_COLOR.friendly, 0.5));
      edge.name = 'band-edge';
      edge.scale.copy(fill.scale);
      this.bands.add(fill, edge);
    }
    const wall = (sign: number) => Object.assign(new THREE.Mesh(quad(B.sidewallVertices(sign)), field(B.SIDEWALL_COLOR, 0.065, false)), { name: 'sidewall' });
    this.sidewalls = { port: wall(-1), stbd: wall(1) };
    this.bands.name = 'bands';
    this.endwalls.name = 'endwalls';
    this.sails.name = 'sails';
    this.podGroup.name = 'pods';
    this.keyholes.name = 'keyholes';
    for (const x of [-B.SAIL.x, B.SAIL.x]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(B.SAIL.radius, 96), field(B.SAIL.fill, 0.045, true));
      disc.rotation.y = Math.PI / 2;
      disc.position.x = x;
      const ring = line(Array.from({ length: 161 }, (_, i) => [0, Math.cos(i / 80 * Math.PI) * B.SAIL.radius, Math.sin(i / 80 * Math.PI) * B.SAIL.radius] as B.V3), siteBColor(B.SAIL.ring, 0.65), 0.65);
      ring.position.x = x;
      this.sails.add(disc, ring);
    }
    this.rollFrame.add(this.bands, this.sidewalls.port, this.sidewalls.stbd, this.endwalls, this.sails, this.podGroup);

    for (const z of B.KEYHOLE_Z) {
      const platform = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshStandardMaterial({ color: B.B_COLOR.violet, emissive: B.B_COLOR.violet, emissiveIntensity: 0.8 }));
      platform.position.set(...B.keyholePosition(z));
      this.keyholes.add(platform, line([B.keyholePosition(z), B.KEYHOLE_LINK_TO], siteBColor(B.B_COLOR.violet, 0.25), 0.25, true));
    }
    this.grid = new THREE.GridHelper(B.GRID.size, B.GRID.divisions, siteBColor(B.GRID.centre, B.GRID.opacity, false, true), siteBColor(B.GRID.lines, B.GRID.opacity, false, true));
    this.grid.position.y = B.GRID.y;
    const gridMaterial = this.grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = B.GRID.opacity;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd1a0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.flash.visible = false;
    this.fixedFrame.add(this.keyholes, this.grid, this.tracks.lines, this.heads.points, this.flash);

    this.controls = dom ? new OrbitControls(this.camera, dom) : null;
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.maxPolarAngle = Math.PI * 0.94;
    }
  }

  currentClass(): string | null { return this.classId; }
  hullKm(): [number, number, number] { return [...this.dims]; }
  mountCount(): { missile: number; graser: number } { return { ...this.mountTotals }; }
  mountLayout(): SchematicMount[] { return this.schematic?.mounts.map((m) => ({ ...m, position: m.position.clone() })) ?? []; }
  /** Pods shown outside the hull: trailing on their rails, or racked externally. */
  podsOut(): number { return this.podsShown; }
  /** Beams and launch tracks drawn by the fire / defense demo this frame. */
  shotsFiring(): number { return this.firing; }
  wedgeVisible(): boolean { return this.bands.visible && this.sidewalls.port.visible && this.sidewalls.stbd.visible; }
  /** Current roll about the hull axis, radians. */
  rollAngle(): number { return this.roll; }
  keyholeFit(): 0 | 1 | 2 { return this.keyholeMark; }

  animating(): boolean { return this.rollMoving || this.drifting || this.demoRunning; }

  private defaultClass(tech: TechRegistry): string {
    const flag = this.replay.ships.find((s) => s.flagship && s.side === this.replay.sides[0]?.id) ?? this.replay.ships[0];
    return flag?.classId ?? Object.keys(tech.classes)[0];
  }

  /**
   * Keyhole platforms are fitted per ship, never per class: the selected ship when it is the one shown,
   * else this class's ship in the scenario (flagships first) on the side the viewer may see.
   */
  private referenceShip(ctx: ViewContext, selected: ShipTrack | null): ShipTrack | null {
    if (selected && selected.classId === this.classId) return selected;
    const side = ctx.perceived.enabled ? ctx.perceived.side : null;
    const ships = this.replay.ships.filter((s) => s.classId === this.classId && (side === null || s.side === side));
    return ships.find((s) => s.flagship && s.side === this.replay.sides[0]?.id) ?? ships.find((s) => s.flagship) ?? ships[0] ?? null;
  }

  update(ctx: ViewContext): void {
    const now = this.clock();
    const first = this.lastTime === null;
    const dt = first ? 0 : Math.min(0.1, Math.max(0, now - this.lastTime!));
    this.lastTime = now;
    this.clockS += dt;
    const picked = ctx.selectedShip !== null ? this.replay.ships[ctx.selectedShip] ?? null : null;
    const ship = picked && (!ctx.perceived.enabled || picked.side === ctx.perceived.side) ? picked : null;
    const id = ctx.selectedClass ?? ship?.classId ?? this.defaultClass(ctx.tech);
    const cls = ctx.tech.classes[id];
    const classChanged = !!cls && id !== this.classId;
    if (classChanged) this.build(cls, ctx.tech);
    if (!this.cls) return;
    this.selectedShip = ship?.classId === this.classId ? ctx.selectedShip : null;
    const sub = this.selectedShip !== null && ship ? subsystemsAt(ship, ctx.frame.t) : null;
    const refKey = `${this.classId}|${this.selectedShip}|${ctx.perceived.enabled ? ctx.perceived.side : '*'}`;
    if (refKey !== this.refKey) {
      this.refKey = refKey;
      const ref = this.referenceShip(ctx, this.selectedShip !== null ? ship : null);
      this.keyholeMark = ref?.equipment.includes('keyhole-ii') ? 2 : ref?.equipment.includes('keyhole') ? 1 : 0;
      this.demoSpec.apollo = this.keyholeMark === 2;
      this.demoSpec.podLoad = this.podLoad(ctx.tech);
    }

    const target = B.rollTarget(ctx.ship.roll);
    this.roll = first || ctx.reducedMotion ? target : THREE.MathUtils.damp(this.roll, target, B.ROLL_RATE, dt);
    if (Math.abs(this.roll - target) < 1e-3) this.roll = target;
    this.rollMoving = this.roll !== target;
    this.shipRoot.rotation.x = this.roll;

    const sails = ctx.ship.sails && this.cls.hull !== 'LAC';
    const fields = ctx.layers.protection && !sails;
    const drive = !sub || sub.drive_fore > 0 || sub.drive_aft > 0;
    this.bands.visible = fields && drive;
    this.sidewalls.port.visible = fields && drive && (!sub || sub.wall_port > 0);
    this.sidewalls.stbd.visible = fields && drive && (!sub || sub.wall_stbd > 0);
    this.endwalls.visible = fields && drive;
    this.sails.visible = sails;
    const hasPods = this.rails.length > 0 || this.externalPods > 0;
    this.podGroup.visible = ctx.ship.pods && !sails && hasPods;
    this.podsShown = this.podGroup.visible ? this.pods.length : 0;
    this.keyholes.visible = ctx.layers.comms && !sails && this.keyholeMark > 0;
    this.drifting = this.podGroup.visible && this.rails.length > 0 && !ctx.reducedMotion;
    for (const pod of this.pods) if (pod.row >= 0) pod.mesh.position.x = B.podX(pod.row, ctx.reducedMotion ? 0 : this.clockS, this.podCycle);
    this.impellers.forEach((ring, i) => {
      ring.material.opacity = ctx.layers.damage && sub && sub[i ? 'drive_fore' : 'drive_aft'] === 0 ? 0.08 : 0.42;
    });

    this.runDemo(ctx, sails);
    this.scene.updateMatrixWorld(true);
    this.frameCamera(ctx, classChanged);
    this.specs = this.labelSpecs(ctx, sub, fields, sails);
    if (this.controls) this.controls.enableDamping = !ctx.reducedMotion;
    this.controls?.update();
    this.camera.updateMatrixWorld();
    this.posePending = false;
  }

  private podLoad(tech: TechRegistry): number {
    const load = this.keyholeMark === 2 ? tech.podLoads.apollo
      : this.classId === 'agamemnon' ? tech.podLoads['agamemnon-mk16']
        : this.cls?.navy === 'RHN' ? tech.podLoads['rhn-mdm-10'] : tech.podLoads['mk17-mk23'];
    return load?.attack_ew ?? 10;
  }

  private runDemo(ctx: ViewContext, sails: boolean): void {
    const t = ctx.ship.fireT;
    if (t !== null && (this.lastFireT === null || t < this.lastFireT)) this.demoPose = this.roll;
    this.lastFireT = t;
    this.tracks.begin();
    this.heads.begin();
    this.flash.visible = false;
    this.firing = 0;
    this.demoRunning = t !== null && t <= FIRE_DEMO_S;
    if (this.demoRunning && !sails) {
      const frame = fireDemoFrame(this.demoSpec, {
        t: t!, roll: this.roll, pose: this.demoPose, pods: ctx.ship.pods,
        missiles: ctx.layers.engagement, defense: ctx.layers.engagement, links: ctx.layers.comms,
      });
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      for (const track of frame.tracks) {
        const [tail, head, dot] = this.trackColors(track.color, track.brightness);
        this.tracks.seg(a.set(...track.a), b.set(...track.b), tail, head);
        this.heads.push(...track.b, dot, 5, 0, 0.95);
      }
      this.firing = frame.tracks.length;
      if (frame.flash) {
        const f = frame.flash;
        this.flash.visible = true;
        this.flash.position.set(...f.point);
        this.flash.scale.setScalar(f.size);
        (this.flash.material as THREE.SpriteMaterial).color.setRGB(...matchLinear(linearOf(f.color), 1, true), THREE.LinearSRGBColorSpace);
        (this.flash.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - f.age);
      }
      this.statusText = frame.status;
    } else if (!this.demoRunning) {
      this.statusText = this.defaultStatus;
    }
    this.tracks.commit();
    this.heads.commit();
  }

  /** Site B's track colours (§3.5): tail at 15% and head at full brightness, additive at 0.64, plus the head dot. */
  private trackColors(hex: number, brightness: number): Array<[number, number, number]> {
    const key = `${hex}:${brightness}`;
    let colors = this.trackPalette.get(key);
    if (!colors) {
      colors = [matchLinear(linearOf(hex, 0.15 * brightness), 0.64, true), matchLinear(linearOf(hex, brightness), 0.64, true), matchLinear(linearOf(hex, brightness), 0.95, false)];
      this.trackPalette.set(key, colors);
    }
    return colors;
  }

  private labelSpecs(ctx: ViewContext, sub: ReturnType<typeof subsystemsAt> | null, fields: boolean, sails: boolean): LabelSpec[] {
    const cls = this.cls!;
    const specs: LabelSpec[] = [];
    const rolled = (p: B.V3) => this.rollFrame.localToWorld(new THREE.Vector3(...p));
    const fixed = (p: B.V3) => this.fixedFrame.localToWorld(new THREE.Vector3(...p));
    const note = (key: string, text: string, pos: THREE.Vector3, color: string, css = 'note') => {
      specs.push({ key, cls: css, text, pos, color, offset: [0, 0] });
    };
    note('bow', B.bowText(cls, this.bands.visible), rolled(B.LABEL_ANCHOR.bow), B.LABEL_COLOR.bow);
    note('stern', B.sternText(cls, this.rails.length, this.bands.visible), rolled(B.LABEL_ANCHOR.stern), B.LABEL_COLOR.stern);
    if (this.bands.visible || sails) note('bands', B.bandsText(sails), rolled(B.LABEL_ANCHOR.bands), B.LABEL_COLOR.bands);
    if (this.keyholes.visible && this.keyholeMark) {
      for (const z of B.KEYHOLE_Z) note(`keyhole${z}`, B.keyholeText(this.keyholeMark), fixed([B.keyholePosition(z)[0], B.LABEL_ANCHOR.keyholeY, z]), B.LABEL_COLOR.keyhole);
    }
    if (ctx.layers.damage && sub) {
      if (sub.drive_fore === 0 && sub.drive_aft === 0) note('damage-drive', 'IMPELLER RINGS LOST · NO WEDGE', rolled([0, 2.4, 0]), B.LABEL_COLOR.damage, 'note damage');
      else if (fields) {
        if (sub.wall_stbd === 0) note('damage-stbd', 'STARBOARD SIDEWALL DOWN', rolled([1.5, 0, 3.9]), B.LABEL_COLOR.damage, 'note damage');
        if (sub.wall_port === 0) note('damage-port', 'PORT SIDEWALL DOWN', rolled([1.5, 0, -3.9]), B.LABEL_COLOR.damage, 'note damage');
      }
    }
    return specs;
  }

  /**
   * World points the default framing keeps in the plot: band corners, the drifting pod matrix and the ship labels.
   * Keyhole platforms hold station far abeam; as in Site B, the far one may leave the frame.
   */
  private framePoints(): THREE.Vector3[] {
    const points: B.V3[] = [...B.bandCorners(1, 1), ...B.bandCorners(-1, 1), B.LABEL_ANCHOR.bow, B.LABEL_ANCHOR.stern, B.LABEL_ANCHOR.bands];
    if (this.rails.length) {
      const wide = Math.max(...this.rails.map(([, z]) => Math.abs(z))) + 0.15;
      for (const y of [-0.3, 0.3]) for (const z of [-wide, wide]) points.push([B.POD_FAR_X, y, z]);
    }
    return points.map((p) => this.fixedFrame.localToWorld(new THREE.Vector3(...p)));
  }

  private place(dir: THREE.Vector3, target: THREE.Vector3, distance: number): void {
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld(true);
  }

  /** Smallest distance along dir at which every point projects inside the safe plot, with a margin. */
  private fitDistance(dir: THREE.Vector3, target: THREE.Vector3, points: THREE.Vector3[], ndc: PlotRect): number {
    const v = new THREE.Vector3();
    const radius = Math.max(1e-6, ...points.map((p) => p.distanceTo(target)));
    const inside = (d: number) => {
      this.place(dir, target, d);
      return points.every((p) => {
        v.copy(p).project(this.camera);
        return v.z > -1 && v.z < 1 && v.x >= ndc.x && v.x <= ndc.x + ndc.width && v.y >= ndc.y && v.y <= ndc.y + ndc.height;
      });
    };
    let lo = radius * 0.2, hi = radius * 60;
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      if (inside(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** Site B's preset angle (§4.15), fitted so the whole wedge and pod matrix fill the safe plot, then centred in it. */
  private fit(dir: THREE.Vector3, width: number, height: number, safe: PlotRect): { target: THREE.Vector3; distance: number } {
    const points = this.framePoints();
    const target = B.fromB(B.CAMERA_TARGET, this.k);
    const margin = 0.04;
    const ndc = {
      x: (2 * safe.x) / width - 1, y: 1 - (2 * (safe.y + safe.height)) / height,
      width: (2 * safe.width) / width, height: (2 * safe.height) / height,
    };
    const inner = { x: ndc.x + ndc.width * margin, y: ndc.y + ndc.height * margin, width: ndc.width * (1 - 2 * margin), height: ndc.height * (1 - 2 * margin) };
    const centre = { x: ndc.x + ndc.width / 2, y: ndc.y + ndc.height / 2 };
    const v = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
    let distance = this.fitDistance(dir, target, points, inner);
    for (let pass = 0; pass < 3; pass++) {
      this.place(dir, target, distance);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of points) {
        v.copy(p).project(this.camera);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
      const halfH = distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / this.camera.zoom;
      right.setFromMatrixColumn(this.camera.matrixWorld, 0);
      up.setFromMatrixColumn(this.camera.matrixWorld, 1);
      target.addScaledVector(right, ((x0 + x1) / 2 - centre.x) * halfH * this.camera.aspect).addScaledVector(up, ((y0 + y1) / 2 - centre.y) * halfH);
      distance = this.fitDistance(dir, target, points, inner);
    }
    return { target, distance };
  }

  private frameCamera(ctx: ViewContext, classChanged: boolean): void {
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    if (this.dom && this.camera.aspect !== width / height) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    const safe = applyPlotInsets(this.camera, width, height, ctx.plotInsets);
    const key = `${this.classId}|${width}|${height}|${safe.x}|${safe.y}|${safe.width}|${safe.height}`;
    if (this.posePending) {
      this.camera.position.multiplyScalar(plotDistanceScale(this.camera, width, height, ctx.plotInsets));
      this.frameKey = key;
      return;
    }
    if (key === this.frameKey && !classChanged) return;
    const offset = this.camera.position.clone().sub(this.controls?.target ?? this.orbit);
    // Fields scale with the hull, so like Site B the camera keeps its angle and zoom across classes and resizes.
    const keep = this.fittedDistance > 0 && offset.lengthSq() > 0;
    const dir = keep
      ? offset.clone().normalize()
      : B.fromB(safe.width < 650 ? B.CAMERA_EYE_NARROW : B.CAMERA_EYE, this.k).sub(B.fromB(B.CAMERA_TARGET, this.k)).normalize();
    const zoom = keep ? offset.length() / this.fittedDistance : 1;
    const { target, distance } = this.fit(dir, width, height, safe);
    this.place(dir, target, distance * zoom);
    this.orbit.copy(target);
    this.controls?.target.copy(target);
    if (this.controls) {
      this.controls.minDistance = Math.min(B.ZOOM_LIMITS[0] * this.k, distance * 0.5);
      this.controls.maxDistance = Math.max(B.ZOOM_LIMITS[1] * this.k, distance * 2);
    }
    this.fittedDistance = distance;
    this.frameKey = key;
  }

  private build(cls: ShipClass, tech: TechRegistry): void {
    clearGroup(this.hullParts);
    clearGroup(this.endwalls);
    clearGroup(this.podGroup);
    this.hull = null;
    this.impellers = [];
    this.classId = cls.id;
    this.cls = cls;
    this.refKey = '';
    this.lastFireT = null;
    const schematic = buildHullSchematic(cls);
    this.schematic = schematic;
    this.dims = schematic.dimensionsKm;
    const [l, b, h] = this.dims.map(toU);
    const k = this.k = B.frameScale(l);
    B.placeFrame(this.rollFrame, k);
    B.placeFrame(this.fixedFrame, k);
    this.camera.near = 0.01 * k;
    this.camera.updateProjectionMatrix();

    // §4.2 Site B's glossy metal on our true-scale hull; section outlines stay faint.
    this.hull = new THREE.Mesh(schematic.geometry, new THREE.MeshStandardMaterial({ color: 0x758994, metalness: 0.75, roughness: 0.43 }));
    this.hull.name = 'physical-hull';
    this.hullParts.add(this.hull);
    const n = schematic.sections.length;
    const necks = [schematic.sections[Math.floor((n - 1) / 2)], schematic.sections[Math.ceil((n - 1) / 2)]];
    for (const section of schematic.sections) {
      if (necks.includes(section)) continue;
      this.hullParts.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hullRing(section, [l, b * 1.004, h * 1.004])), outline(0xcfe2ec, 0.16)));
    }
    this.impellers = necks.map((section) => {
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(hullRing(section, [l, b * 1.012, h * 1.012])), outline(B.B_COLOR.friendly, 0.42));
      this.hullParts.add(ring);
      return ring;
    });

    // §4.4 Mount dots in Site B's palette, at the schematic's exact counts.
    const dot = new THREE.SphereGeometry(1, 8, 6);
    const byKind = new Map<MountKey, SchematicMount[]>();
    for (const m of schematic.mounts) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
    const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (const [kind, mounts] of byKind) {
      const mesh = new THREE.InstancedMesh(dot.clone(), new THREE.MeshBasicMaterial({ color: siteBColor(B.MOUNT_COLOR[kind]) }), mounts.length);
      scale.setScalar(B.mountRadius(kind) * k);
      mounts.forEach((m, i) => mesh.setMatrixAt(i, matrix.compose(m.position, quat, scale)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = `mounts-${kind}`;
      this.hullParts.add(mesh);
    }
    dot.dispose();
    // Site B draws a lone forward graser as a spinal barrel (§4.4); the honor-cic class note gives a 1.5 m aperture.
    const barrelMount = cls.fore.graser.value === 1 ? schematic.mounts.find((m) => m.kind === 'graser' && m.aspect === 'fore') : undefined;
    if (barrelMount) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(toU(0.00075), toU(0.00075), 0.35 * k, 16), new THREE.MeshBasicMaterial({ color: siteBColor(B.MOUNT_COLOR.graser) }));
      barrel.rotation.z = -Math.PI / 2;
      barrel.position.copy(barrelMount.position);
      this.hullParts.add(barrel);
    }
    const lanes = schematic.mounts.filter((m) => m.kind === 'pod_lanes');
    for (const lane of lanes) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(B.POD_BOX[2] * k, B.POD_BOX[1] * k), new THREE.MeshStandardMaterial({ color: 0x16202d, roughness: 0.9, side: THREE.DoubleSide }));
      door.rotation.y = Math.PI / 2;
      door.position.copy(lane.position);
      door.position.x -= 0.002 * k;
      this.hullParts.add(door);
    }
    for (const bay of schematic.bays) {
      const recess = new THREE.Mesh(new THREE.PlaneGeometry(l * 0.7 / Math.max(1, schematic.bays.length), h * 0.18), new THREE.MeshStandardMaterial({ color: 0x121b27, roughness: 0.95, side: THREE.DoubleSide }));
      recess.rotation.x = Math.PI / 2;
      recess.position.copy(bay);
      recess.position.y += Math.sign(bay.y) * 0.005 * k;
      this.hullParts.add(recess);
    }
    this.mountTotals = { missile: 2 * (cls.broadside.missile.value ?? 0), graser: 2 * (cls.broadside.graser.value ?? 0) };

    // §4.9 Pods: three per stern lane on amber tethers; a cruiser's external flatpacks rack under the hull.
    this.rails = lanes.map((lane) => {
      const [, y, z] = B.toB(lane.position, k);
      return [y, z];
    });
    this.podCycle = cls.pod_eject_cycle.value ?? 12;
    const ejected = cls.pod_eject_count.value ?? 0;
    this.externalPods = lanes.length === 0 && ejected > 0 ? Math.min(B.MAX_EXTERNAL_PODS, cls.pod_capacity.value ?? ejected) : 0;
    this.pods = [];
    const podMaterial = () => new THREE.MeshStandardMaterial({ color: B.POD_COLOR.body, emissive: B.POD_COLOR.glow, emissiveIntensity: 0.22, metalness: 0.55, roughness: 0.5 });
    for (const [y, z] of this.rails) {
      this.podGroup.add(line([[B.TETHER_X[0], y, z], [B.TETHER_X[1], y, z]], siteBColor(B.B_COLOR.amber, 0.5), 0.5));
      for (let row = 0; row < B.POD_ROWS; row++) {
        const pod = new THREE.Mesh(new THREE.BoxGeometry(...B.POD_BOX), podMaterial());
        pod.name = 'pod';
        pod.position.set(B.podX(row, 0, this.podCycle), y, z);
        this.podGroup.add(pod);
        this.pods.push({ mesh: pod, row });
      }
    }
    for (let i = 0; i < this.externalPods; i++) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(...B.EXTERNAL_POD_BOX), new THREE.MeshStandardMaterial({ color: B.POD_COLOR.body, metalness: 0.55, roughness: 0.5 }));
      pod.name = 'pod';
      pod.position.set(...B.externalPodPosition(i));
      this.podGroup.add(pod);
      this.pods.push({ mesh: pod, row: -1 });
    }

    // §4.7 End apertures from the class's bow and stern walls: Site B's buckler rings, and full walls that close the opening.
    for (const [wall, edge, outer] of [[cls.bow_wall, B.BOW_EDGE, B.THROAT_RADIUS], [cls.stern_wall, B.STERN_EDGE, B.KILT_RADIUS]] as const) {
      if (wall === 'none') continue;
      const geometry = wall === 'buckler' ? new THREE.RingGeometry(B.APERTURE_INNER, outer, 48) : new THREE.CircleGeometry(1, 64);
      const mesh = new THREE.Mesh(geometry, field(B.B_COLOR.friendly, 0.075, false));
      mesh.rotation.y = Math.PI / 2;
      mesh.position.x = edge.x;
      if (wall === 'full') mesh.scale.set(edge.wide, edge.half, 1);
      this.endwalls.add(mesh);
    }

    // §4.14 Demo inputs in Site B's frame.
    const demoMounts: DemoMount[] = schematic.mounts.flatMap((m) => {
      const type = DEMO_TYPE[m.kind];
      return type ? [{ type, point: B.toB(m.position, k), aspect: m.aspect }] : [];
    });
    const broadsideEnergy = (cls.broadside.graser.value ?? 0) + (cls.broadside.laser.value ?? 0) > 0;
    const spinal = !broadsideEnergy && cls.fore.graser.value === 1 ? demoMounts.find((m) => m.type === 'G' && m.aspect === 'fore')?.point ?? null : null;
    const bays = cls.lac_bays.value ?? 0;
    this.demoSpec = { mounts: demoMounts, carrier: bays > 0, rails: this.rails.length, externalPods: this.externalPods, podLoad: 10, apollo: false, spinal };
    this.demoSpec.podLoad = this.podLoad(tech);
    const offensive = OFFENSIVE.some((kind) => (cls.broadside[kind].value ?? 0) > 0);
    this.defaultStatus = schematic.placeholder
      ? 'Unknown hull dimensions: placeholder proportions, not a measurement.'
      : bays > 0 && !offensive ? `${bays} LAC bays; offensive hardpoints not established.` : B.MOUNT_LEGEND;
    this.statusText = this.defaultStatus;
  }

  followTarget(): void {}

  setPose(eyeKm: Vec3, targetKm: Vec3): void {
    this.camera.position.set(toU(eyeKm[0] - targetKm[0]), toU(eyeKm[1] - targetKm[1]), toU(eyeKm[2] - targetKm[2]));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.controls?.target.set(0, 0, 0);
    this.orbit.set(0, 0, 0);
    this.posePending = true;
  }

  labels(): LabelSpec[] { return this.specs; }

  pick(ndcX: number, ndcY: number): number | null {
    if (this.selectedShip === null || !this.hull) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    return this.raycaster.intersectObject(this.hull).length ? this.selectedShip : null;
  }

  status(): ViewStatus {
    return { samplingText: null, scaleNote: this.statusText, notice: null };
  }

  dispose(): void {
    this.controls?.dispose();
    disposeTree(this.scene);
    this.scene.clear();
  }
}

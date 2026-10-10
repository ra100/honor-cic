import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { baseValue } from '../../core/evidence';
import { commanderPicture, replayTrackables, type CommanderPicture } from '../../core/perceived';
import {
  DrivePhase, packetAliveAt, packetPositionAt, ShipStatus, shipStatusAt, STATUS_TEXT, subsystemsAt, unitPosition, unitPresent, unitVelocity,
  type BeamEvent, type Replay,
} from '../../core/replay';
import { hashSeed, mulberry32 } from '../../core/rng';
import type { ScenarioPack } from '../../core/schema';
import type { Trackable } from '../../core/sensors';
import { toSystem } from '../../core/solver/formation';
import { orientationAt } from '../../core/solver/geometry';
import { bodyPosition, exclusionsAt, indexBodies } from '../../core/solver/orbits';
import { fmtCount, fmtDistance, fmtDuration, kmToLm } from '../../core/units';
import type { Vec3 } from '../../core/vec';
import { DOT_CAP, DotCache, packetSpreadKm, planDensity, salvoSpreadKm, sampledCount } from '../density';
import { BodyLayer } from '../engagement/bodies';
import {
  fleetMarksShown, gridFade, nearestEnemyUnit, ringCentreUnit, ringLabelsShown, ringPlan, smoothstep, type RingPlan,
} from '../engagement/focus';
import { BeamBatch, GLOW, GlowBatch } from '../engagement/fx';
import { StreakLayer } from '../engagement/streaks';
import {
  boundariesOf, boundaryCrossings, BOUNDARY_REACH, limitAnchor, sphereGap, TacticalPlane, zoneFlankCrossings, zoneNear,
} from '../engagement/tactical-plane';
import { formationSpread, GLYPH_GAP_PX, slotRadiusKm, slotSpacingKm } from '../formations';
import { applyPlotInsets, plotDistanceScale, plotSize, safePlotRect, type PlotRect } from '../framing';
import { shipGlyph } from '../glyphs';
import { projectedBounds, type LabelSpec } from '../labels';
import { LineBatch } from '../lines';
import { FloatingOrigin } from '../origin';
import { hexToNum, PALETTE, rgbOf, STATUS_BRIGHTNESS } from '../palette';
import { PointCloud, SHAPE } from '../points';
import { beamTheatersFor, LAUNCH_CUE_S, streakTailT } from '../salvos';
import type { TechRegistry } from '../../core/tech';
import type { ScaleView, ViewContext, ViewStatus } from './types';

const ROLE_SHAPE = { wall: SHAPE.wall, screen: SHAPE.screen, carrier: SHAPE.carrier, lac: SHAPE.lac } as const;
const RECENTER_KM = 50_000;
/** Coming back to the Engagement tab this far from the last time it showed re-frames the free camera. */
const REFRAME_AFTER_S = 120;
const LAC_DOTS_PER_GROUP = 4_000;
/** Swarm points of a LAC group that launch and receive missiles: the first of its drawn dots. */
const LAC_ANCHORS = 64;
/** Share of a packet's missiles that home on the ship the solver aimed it at; the rest spread over the target fleet. */
const AIMED_SHARE = 0.4;
/** A salvo converges from its launchers, and fans out over its targets, across this many drawn formation radii. */
const FUNNEL_RADII = 1.5;
const WEDGE_CAP = 300;
const LINKS_PER_MOTHER = 24;
const LINK_CAP = 2_048;
const FX_CAP = 16_384;
const MARK_SEGMENTS = 96;
const WEDGE_UP = new Set([ShipStatus.Operational, ShipStatus.Degraded, ShipStatus.MissionKill]);
const WALL_UP = new Set([ShipStatus.Operational, ShipStatus.Degraded, ShipStatus.MissionKill]);
/** Ships still manoeuvring with their fleet; mission kills drift off on their own tracks. */
const UNDER_WAY = new Set([ShipStatus.Operational, ShipStatus.Degraded]);
/** Site A's crowding budget (A report §4.7): uDens = clamp(sqrt(budget / on-screen streaks), 0.05, 1). */
const CROWD_BUDGET = 600;
/** Close views shorten the seven-second history so a streak spans at most this share of the camera distance. */
const TRAIL_VIEW_SHARE = 0.35;
/** Streak length on wide views (25 Mkm and beyond) and at most up close, CSS px. */
const TRAIL_MIN_PX = 14;
const TRAIL_MAX_PX = 80;
/** Ship-death fireball and shock-ring lifetimes, display aids (A report §4.8 blast types 2 and 3). */
const DEATH_S = 3.2;
const SHOCK_S = 6;
const LIGHT_KM_S = 299_792.458;
/** Site A names ships within 2.4 Mkm of the camera (A report §3.10). */
const FLAG_LABEL_KM = 2_400_000;
/** Site A linear colours (A report §4.2, §4.8). */
const VECTOR_RGB: [number, number, number] = [0.0, 0.55, 0.85];
const ROD_ALLIED = [0.55, 1.0, 0.75];
const ROD_HOSTILE = [1.0, 0.45, 0.55];
const GRASER_RGB = [0.6, 1.0, 0.9];
const CM_RGB = [0.72, 0.94, 1.0];
const PD_RGB = [1.0, 0.74, 0.42];
const HULL_HIT_RGB = [1.0, 0.42, 0.12];
const POD_FLASH_RGB = [1.0, 0.82, 0.45];
const FOOTPRINT_RGB = [0.45, 0.7, 1.0];
const TELEMETRY_RGB = [0.6, 0.22, 1.0];
const LIMIT_INK = '#c4a874';

export interface DrawCounts {
  ships: number; dots: number; lacDots: number; contacts: number; fx: number; wedges: number; links: number; trails: number;
  /** Range-ring labels shown; 0 when the grid is off. */
  rings: number;
  /** Hyper limits and resonance zones drawn on the tactical plane. */
  boundaries: number;
  /** Fleet rings drawn. */
  fleetRings: number;
  bodies: number;
}

/** Packs give LAC counts, not slots, so a group's swarm radius is a display aid [S], km. */
const lacSpreadKm = (n: number): number => Math.min(30_000, 2_000 * Math.sqrt(Math.max(0, n) / 100));

export const ageText = (s: number): string => (s < 60 ? `${s.toFixed(1)} s old` : `${fmtDuration(s)} old`);

function firstAtOrAfter(beams: BeamEvent[], t: number): number {
  let lo = 0;
  let hi = beams.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beams[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function rect(c: THREE.Vector3, a: Vec3, ha: number, b: Vec3, hb: number): THREE.Vector3[] {
  const at = (sa: number, sb: number) =>
    new THREE.Vector3(c.x + a[0] * ha * sa + b[0] * hb * sb, c.y + a[1] * ha * sa + b[1] * hb * sb, c.z + a[2] * ha * sa + b[2] * hb * sb);
  return [at(1, 1), at(1, -1), at(-1, -1), at(-1, 1)];
}

const shifted = (c: THREE.Vector3, d: Vec3, k: number): THREE.Vector3 => new THREE.Vector3(c.x + d[0] * k, c.y + d[1] * k, c.z + d[2] * k);
const mixRgb = (a: readonly number[], b: readonly number[], k: number): number[] => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const linear = (hex: number): [number, number, number] => rgbOf(hex, 1);
const overlaps = (a: PlotRect, b: PlotRect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A side's streak colour: its token pulled 15 % toward white, as Site A's pastel salvo hues (A report §4.7). */
export function streakRgb(hex: number): [number, number, number] {
  const c = linear(hex);
  return [c[0] * 0.85 + 0.15, c[1] * 0.85 + 0.15, c[2] * 0.85 + 0.15];
}

/** `live` is false once no ship of the fleet is under way with it (all wrecks or mission kills). */
interface FleetDisplay { centre: THREE.Vector3; radius: number; rect: PlotRect | null; live: boolean }

export class EngagementView implements ScaleView {
  readonly id = 'engagement' as const;
  readonly kmPerUnit = 1;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1e10);
  readonly controls: OrbitControls | null;
  private readonly origin = new FloatingOrigin(1);
  private readonly shipCloud: PointCloud;
  private readonly lacCloud: PointCloud;
  private readonly contactCloud = new PointCloud(8_192);
  private readonly wedgeLines = new LineBatch(WEDGE_CAP * 16, false, 0.8);
  private readonly contactLines = new LineBatch(16_384, false, 0.7);
  private readonly markLines: LineBatch;
  private readonly plane = new TacticalPlane();
  private readonly bodyLayer: BodyLayer;
  private readonly streaks: StreakLayer;
  private readonly glows = new GlowBatch(FX_CAP, 6);
  private readonly beamBatch = new BeamBatch(FX_CAP, 5);
  private readonly links = new BeamBatch(LINK_CAP, 2);
  private readonly cache = new DotCache();
  private readonly beams: BeamEvent[];
  private readonly maxBeamDur: number;
  private readonly beamTheaters = new Map<BeamEvent, string | null>();
  private readonly launchKinds: Map<string, 'tube' | 'pod' | 'tow'>;
  private readonly sideRgb: Map<string, number>;
  private readonly unitIndex: Map<string, number>;
  private readonly commanders: Map<string, string | null>;
  private readonly deaths: Array<{ t: number; ship: number }>;
  private readonly terminalStart: Float64Array;
  private readonly launchKm: Float64Array;
  private readonly flightKm: Float64Array;
  private readonly alive: Uint32Array;
  /** Each packet's drawn head-cloud radius this frame, render units. */
  private readonly headSpread: Float64Array;
  /** Each packet's solved launch point from its launching unit's centre, and its aim point from the target unit's, km. */
  private readonly launchOffKm: Float64Array;
  private readonly aimOffKm: Float64Array;
  /** Per packet, the launch-table glyphs its missiles leave from and come down on (StreakLayer anchors); set by prepare. */
  private launchAnchors: Uint32Array[] = [];
  private targetAnchors: Uint32Array[] = [];
  private readonly aimAnchor: Int32Array;
  private prepared = false;
  /** Ships each salvo is fired from, for the launch cues. */
  private readonly salvoLaunchers = new Map<string, number[]>();
  /** First launch-table index of each LAC group's swarm points. */
  private readonly lacAnchorBase = new Map<number, number>();
  /** Per unit: its formation's own spacing and radius (km) and the clear spacing its glyphs need (CSS px). */
  private readonly slotSpacing: Float64Array;
  private readonly slotRadius: Float64Array;
  private readonly gapPx: Float64Array;
  /** Per unit, how many times larger than life its formation is drawn this frame. */
  private readonly spread: Float64Array;
  /** Where every ship of the theater is drawn this frame (render units), and whether it has a place. */
  private readonly display: Float64Array;
  private readonly placed: Uint8Array;
  /** Each packet's pull onto its launchers' glyphs [0] and its targets' [1] at the head this frame. */
  private readonly headPull: Float64Array;
  private readonly bodies;
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private tracks: Trackable[] = [];
  private tracksTheater: string | null = null;
  private picture: CommanderPicture = { observer: null, contacts: [] };
  private pictureKey = '';
  private framedTheater: string | null = null;
  /** Set when the viewer shows this view again after another scale; see `update`. */
  private parked = false;
  private lastT = 0;
  private posePending = false;
  private plotScale = 1;
  private perceivedOn = false;
  private shipsInView: number[] = [];
  private fleets = new Map<number, FleetDisplay>();
  private fleetLabelBoxes: PlotRect[] = [];
  /** Where each ship's glyph is drawn this frame, render units. */
  private readonly shown = new Map<number, THREE.Vector3>();
  private readonly deathT = new Map<number, number>();
  private wedgeCount = 0;
  private ringLabels = 0;
  private fleetRings = 0;
  private plan: RingPlan | null = null;
  private specs: LabelSpec[] = [];
  private sampling: string | null = null;
  private notice: string | null = null;

  constructor(private readonly pack: ScenarioPack, private readonly replay: Replay, private readonly dom: HTMLElement | null) {
    this.camera.up.set(0, 0, 1);
    this.shipCloud = new PointCloud(Math.max(16, replay.ships.length));
    this.shipCloud.points.renderOrder = 20;
    this.lacCloud = new PointCloud(Math.max(16, replay.units.filter((u) => u.kind === 'lac').length * LAC_DOTS_PER_GROUP));
    this.lacCloud.points.renderOrder = 19;
    this.contactCloud.points.renderOrder = 21;
    this.markLines = new LineBatch(Math.max(64, replay.units.length * (MARK_SEGMENTS + 4)), true, 1);
    this.markLines.lines.renderOrder = 2;
    this.wedgeLines.lines.renderOrder = 7;
    let anchors = 1 + replay.ships.length;
    replay.units.forEach((u, i) => {
      if (u.kind !== 'lac') return;
      this.lacAnchorBase.set(i, anchors);
      anchors += LAC_ANCHORS;
    });
    this.streaks = new StreakLayer(replay.packets.length, DOT_CAP, anchors);
    this.beams = [...replay.beams].sort((a, b) => a.t - b.t);
    this.maxBeamDur = this.beams.reduce((m, b) => Math.max(m, b.dur), 0);
    const theaters = beamTheatersFor(replay);
    for (const beam of this.beams) this.beamTheaters.set(beam, theaters.get(beam) ?? null);
    this.launchKinds = new Map(pack.events.filter((e) => e.type === 'fire_plan').map((e) => [e.id, e.launch]));
    this.sideRgb = new Map(replay.sides.map((s) => [s.id, hexToNum(s.color)]));
    this.unitIndex = new Map(replay.units.map((u, i) => [u.id, i]));
    this.commanders = new Map(pack.units.map((u) => [u.id, u.commander.value]));
    this.deaths = replay.ships.flatMap((s) => s.status.filter((st) => st.status === ShipStatus.Destroyed).map((st) => ({ t: st.t, ship: s.idx })))
      .sort((a, b) => a.t - b.t);
    for (const d of this.deaths) if (!this.deathT.has(d.ship)) this.deathT.set(d.ship, d.t);
    this.terminalStart = Float64Array.from(replay.packets, (p) => p.phases.find((ph) => ph.phase === DrivePhase.Terminal)?.t0 ?? Infinity);
    this.launchKm = new Float64Array(replay.packets.length * 3);
    this.flightKm = new Float64Array(replay.packets.length);
    replay.packets.forEach((p, i) => {
      const a = packetPositionAt(p, p.tLaunch);
      const b = packetPositionAt(p, p.tArrive);
      this.launchKm.set(a, i * 3);
      this.flightKm[i] = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    });
    this.alive = new Uint32Array(replay.packets.length);
    this.headSpread = new Float64Array(replay.packets.length);
    this.slotSpacing = new Float64Array(replay.units.length);
    this.slotRadius = new Float64Array(replay.units.length);
    this.gapPx = new Float64Array(replay.units.length);
    this.spread = new Float64Array(replay.units.length).fill(1);
    replay.units.forEach((u, i) => {
      const slots = u.shipIdx.map((s) => replay.ships[s].slot);
      this.slotSpacing[i] = slotSpacingKm(slots);
      this.slotRadius[i] = slotRadiusKm(slots);
    });
    this.display = new Float64Array(replay.ships.length * 3);
    this.placed = new Uint8Array(replay.ships.length);
    this.headPull = new Float64Array(replay.packets.length * 2);
    this.launchOffKm = new Float64Array(replay.packets.length * 3);
    this.aimOffKm = new Float64Array(replay.packets.length * 3);
    this.aimAnchor = new Int32Array(replay.packets.length).fill(-1);
    replay.packets.forEach((p, i) => {
      const from = unitPosition(replay.units[p.fromUnit], p.tLaunch);
      const to = unitPosition(replay.units[p.toUnit], p.tArrive);
      const end = packetPositionAt(p, p.tArrive);
      for (let c = 0; c < 3; c++) {
        this.launchOffKm[i * 3 + c] = this.launchKm[i * 3 + c] - from[c];
        this.aimOffKm[i * 3 + c] = end[c] - to[c];
      }
    });
    this.bodies = indexBodies(pack.bodies);
    this.bodyLayer = new BodyLayer(this.bodies);
    this.scene.add(
      this.plane.mesh, this.markLines.lines, this.links.mesh, this.bodyLayer.points, this.bodyLayer.glows.mesh,
      this.streaks.mesh, this.beamBatch.mesh, this.glows.mesh, this.wedgeLines.lines, this.contactLines.lines,
      this.lacCloud.points, this.shipCloud.points, this.contactCloud.points,
    );
    this.controls = dom ? new OrbitControls(this.camera, dom) : null;
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.zoomSpeed = 1.6;
    }
  }

  /** Lets the next update tell a return to the Engagement tab from a pause in rendering. */
  onShow(): void {
    this.parked = true;
  }

  /** Class-dependent tables, built once from the first context's registry: glyph spacing and who launches and receives. */
  private prepare(tech: TechRegistry): void {
    if (this.prepared) return;
    this.prepared = true;
    const { replay } = this;
    replay.units.forEach((u, i) => {
      this.gapPx[i] = Math.max(0, ...u.shipIdx.map((s) => shipGlyph(tech.classes[replay.ships[s].classId], replay.ships[s].role).size)) + GLYPH_GAP_PX;
    });
    const launchers = new Map<string, Uint32Array>();
    const targets = new Map<string, Uint32Array>();
    this.launchAnchors = replay.packets.map((p) => {
      const kind = this.launchKinds.get(p.planId) ?? 'tube';
      const key = `${p.fromUnit}|${kind}|${p.tLaunch}`;
      let list = launchers.get(key);
      if (!list) {
        list = this.anchorsOf(tech, p.fromUnit, p.tLaunch, kind);
        launchers.set(key, list);
      }
      if (!this.salvoLaunchers.has(p.salvoId)) {
        this.salvoLaunchers.set(p.salvoId, Array.from(list, (a) => a - 1).filter((s) => s >= 0 && s < replay.ships.length));
      }
      return list;
    });
    this.targetAnchors = replay.packets.map((p, i) => {
      const key = `${p.toUnit}|${p.tLaunch}`;
      let list = targets.get(key);
      if (!list) {
        list = this.anchorsOf(tech, p.toUnit, p.tLaunch, null);
        targets.set(key, list);
      }
      const aim = p.targetShip >= 0 ? 1 + p.targetShip : -1;
      this.aimAnchor[i] = list.includes(aim) ? aim : -1;
      return list;
    });
  }

  /**
   * Launch-table glyphs of a unit at time t: its ships still fighting (for a launch, the ones that carry that kind of
   * missile: tubes, pods, or the wall ships towing pod strings), else its LAC group's swarm points.
   */
  private anchorsOf(tech: TechRegistry, unit: number, t: number, kind: 'tube' | 'pod' | 'tow' | null): Uint32Array {
    const { replay } = this;
    const lac = this.lacAnchorBase.get(unit);
    if (lac !== undefined) return Uint32Array.from({ length: LAC_ANCHORS }, (_, k) => lac + k);
    const fighting = replay.units[unit].shipIdx.filter((s) => UNDER_WAY.has(shipStatusAt(replay, replay.ships[s], t)));
    const carries = (s: number): boolean => {
      const cls = tech.classes[replay.ships[s].classId];
      if (!cls) return false;
      if (kind === 'pod') return (baseValue(cls.pod_capacity) ?? 0) > 0;
      if (kind === 'tow') return replay.ships[s].role === 'wall';
      return ((baseValue(cls.broadside.missile) ?? 0) + (baseValue(cls.fore.missile) ?? 0) + (baseValue(cls.aft.missile) ?? 0)) > 0;
    };
    const armed = kind === null ? fighting : fighting.filter(carries);
    const ships = armed.length ? armed : fighting.length ? fighting : replay.units[unit].shipIdx;
    return Uint32Array.from(ships, (s) => 1 + s);
  }

  update(ctx: ViewContext): void {
    this.prepare(ctx.tech);
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    applyPlotInsets(this.camera, width, height, ctx.plotInsets);
    const scale = plotDistanceScale(this.camera, width, height, ctx.plotInsets);
    const externalPose = this.posePending;
    const newTheater = this.framedTheater !== ctx.theater;
    const jumped = Math.abs(ctx.frame.t - this.lastT) > REFRAME_AFTER_S;
    const returned = this.parked && jumped;
    this.parked = false;
    this.lastT = ctx.frame.t;
    if (newTheater) {
      this.framedTheater = ctx.theater;
      if (!externalPose) this.frameTheater(ctx);
    } else if (!externalPose && (returned || (jumped && this.lost(ctx, width, height)))) {
      // Back on this tab, or scrubbed far with nothing left in the plot: frame what is happening around the look point.
      this.frameTheater(ctx, this.lookKm());
    }
    if (externalPose || (!newTheater && scale !== this.plotScale)) {
      const target = this.controls?.target ?? new THREE.Vector3();
      this.camera.position.sub(target).multiplyScalar(externalPose ? scale : scale / this.plotScale).add(target);
    }
    this.posePending = false;
    this.plotScale = scale;
    this.recenter();
    if (this.controls) this.controls.enableDamping = !ctx.reducedMotion;
    this.controls?.update();
    this.camera.updateMatrixWorld();
    const truth = ctx.layers.truth && !ctx.perceived.enabled;
    this.perceivedOn = ctx.perceived.enabled;
    const labels: LabelSpec[] = [];
    this.updatePicture(ctx);
    this.drawShips(ctx, truth, labels);
    this.drawGrid(ctx, labels);
    this.drawMarks(ctx, truth);
    this.drawLacs(ctx, truth);
    this.drawMissiles(ctx, truth && ctx.layers.engagement);
    this.drawFx(ctx, truth && ctx.layers.engagement);
    this.drawLinks(ctx, truth && ctx.layers.comms);
    this.drawWedges(ctx, truth && ctx.layers.protection);
    this.drawContacts(ctx, ctx.perceived.enabled || ctx.layers.commander, labels);
    this.specs = labels;
  }

  /**
   * Site A's macro framing (shot 2.2, image 4): my fleet low and near, the enemy high and far, rings filling the plot.
   * With no `around` it fits every unit in the theater; with one it keeps that look point and fits my nearest fleet and
   * the enemy it faces.
   */
  private frameTheater(ctx: ViewContext, around?: Vec3): void {
    const { frame } = ctx;
    const pts: Vec3[] = [];
    const add = (i: number): void => {
      const u = this.replay.units[i];
      pts.push([frame.unitPos[i * 3], frame.unitPos[i * 3 + 1], frame.unitPos[i * 3 + 2]]);
      if (u.kind === 'fleet') for (const ship of u.shipIdx) pts.push(Array.from(frame.shipPos.subarray(ship * 3, ship * 3 + 3)) as Vec3);
    };
    if (around) {
      pts.push(around);
      const own = ringCentreUnit(this.replay, frame, ctx.theater, ctx.focusSide, around, ctx.selectedShip);
      if (own !== null) {
        add(own);
        const foe = ctx.perceived.enabled ? null
          : nearestEnemyUnit(this.replay, frame, ctx.theater, ctx.focusSide, [frame.unitPos[own * 3], frame.unitPos[own * 3 + 1], frame.unitPos[own * 3 + 2]]);
        if (foe !== null) add(foe);
      }
    } else {
      this.replay.units.forEach((u, i) => {
        if (u.theater === ctx.theater && frame.unitCount[i] > 0 && (!ctx.perceived.enabled || u.side === ctx.perceived.side)) add(i);
      });
    }
    if (pts.length === 0) {
      const anchor = this.pack.meta.theaters.find((th) => th.id === ctx.theater)?.anchor_body ?? this.pack.meta.frame.origin_body;
      pts.push(bodyPosition(this.bodies, anchor, frame.t));
    }
    const box = new THREE.Box3().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
    const c = around ?? (box.getCenter(new THREE.Vector3()).toArray() as Vec3);
    const mine = ringCentreUnit(this.replay, frame, ctx.theater, ctx.focusSide, c, ctx.selectedShip);
    let az = (-60 * Math.PI) / 180;
    if (mine !== null) {
      const own: Vec3 = [frame.unitPos[mine * 3], frame.unitPos[mine * 3 + 1], frame.unitPos[mine * 3 + 2]];
      const enemy = nearestEnemyUnit(this.replay, frame, ctx.theater, ctx.focusSide, own);
      if (enemy !== null) {
        // Site A shot 2.2 (image 4, yaw about 210° in its theater frame): from behind my fleet and to its left, so the
        // line of fire runs from my fleet low and right to the enemy high and left.
        az = Math.atan2(frame.unitPos[enemy * 3 + 1] - own[1], frame.unitPos[enemy * 3] - own[0]) + (150 * Math.PI) / 180;
      }
    }
    const el = (24 * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
    const forward = dir.clone().negate();
    const right = forward.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
    const up = right.clone().cross(forward);
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    const safe = safePlotRect(width, height, ctx.plotInsets);
    const tanV = Math.tan((this.camera.fov * Math.PI) / 360) / this.camera.zoom;
    // Leave room for the two-line labels above each fleet and a margin at the plot edges.
    const tanX = (tanV * safe.width) / height * 0.82;
    const tanY = (tanV * safe.height) / height * 0.7;
    let d = 20_000;
    const rel = new THREE.Vector3();
    for (const p of pts) {
      rel.set(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
      const depth = rel.dot(forward);
      d = Math.max(d, depth + Math.abs(rel.dot(right)) / tanX, depth + Math.abs(rel.dot(up)) / tanY);
    }
    const radius = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    this.camera.far = Math.max(1e10, d + radius * 2);
    this.camera.updateProjectionMatrix();
    this.setPose([c[0] + dir.x * d, c[1] + dir.y * d, c[2] + dir.z * d], c);
  }

  /** True when no unit of the theater sits inside the plot, e.g. a close-up camera kept across a long scrub. */
  private lost(ctx: ViewContext, width: number, height: number): boolean {
    const safe = safePlotRect(width, height, ctx.plotInsets);
    this.camera.updateMatrixWorld();
    return !this.replay.units.some((u, i) => {
      if (u.theater !== ctx.theater || ctx.frame.unitCount[i] === 0) return false;
      const p = this.origin.point(ctx.frame.unitPos.subarray(i * 3, i * 3 + 3), this.v).project(this.camera);
      const x = ((p.x + 1) / 2) * width;
      const y = ((1 - p.y) / 2) * height;
      return p.z >= -1 && p.z <= 1 && x >= safe.x && x <= safe.x + safe.width && y >= safe.y && y <= safe.y + safe.height;
    });
  }

  private recenter(): void {
    if (!this.controls) return;
    const tg = this.controls.target;
    if (tg.length() < RECENTER_KM) return;
    const o = this.origin.origin;
    this.origin.set([o[0] + tg.x, o[1] + tg.y, o[2] + tg.z]);
    this.camera.position.sub(tg);
    tg.set(0, 0, 0);
  }

  setPose(eyeKm: Vec3, targetKm: Vec3): void {
    this.origin.set(targetKm);
    this.camera.position.copy(this.origin.point(eyeKm));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.controls?.target.set(0, 0, 0);
    this.posePending = true;
  }

  followTarget(targetKm: Vec3): void {
    const look = this.controls?.target ?? new THREE.Vector3();
    const offset = this.camera.position.clone().sub(look);
    this.origin.set(targetKm);
    this.camera.position.copy(offset);
    this.controls?.target.set(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  toRender(km: ArrayLike<number>): THREE.Vector3 {
    return this.origin.point(km, new THREE.Vector3());
  }

  /** The camera's look point in km. */
  private lookKm(): Vec3 {
    const t = this.controls?.target ?? new THREE.Vector3();
    const o = this.origin.origin;
    return [o[0] + t.x * this.origin.kmPerUnit, o[1] + t.y * this.origin.kmPerUnit, o[2] + t.z * this.origin.kmPerUnit];
  }

  private cameraKmTo(km: Vec3): number {
    return this.camera.position.distanceTo(this.origin.point(km, this.v)) * this.origin.kmPerUnit;
  }

  private dims(): { width: number; height: number; dpr: number } {
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    const dpr = typeof window !== 'undefined' ? Math.max(1, Math.min(window.devicePixelRatio || 1, 2)) : 1;
    return { width, height, dpr };
  }

  private updatePicture(ctx: ViewContext): void {
    if (!(ctx.perceived.enabled || ctx.layers.commander)) return;
    if (this.tracksTheater !== ctx.theater) {
      this.tracks = replayTrackables(ctx.replay, ctx.theater);
      this.tracksTheater = ctx.theater;
      this.pictureKey = '';
    }
    // Quantised to 0.25 s of scenario time: a pure function of t, and cheap during playback.
    const tq = Math.round(ctx.frame.t * 4) / 4;
    const key = `${ctx.perceived.side}|${ctx.theater}|${tq}`;
    if (key !== this.pictureKey) {
      this.picture = commanderPicture(ctx.replay, this.tracks, ctx.perceived.side, ctx.theater, tq, this.pack.meta.ftl_speed_c.value ?? 1);
      this.pictureKey = key;
    }
  }

  private fleetSubtitle(ctx: ViewContext, unit: number): string {
    const u = ctx.replay.units[unit];
    const n = ctx.frame.unitCount[unit];
    const parts: string[] = [];
    const commander = this.commanders.get(u.id);
    if (commander) parts.push(commander);
    if (u.kind === 'lac') {
      parts.push(`${fmtCount(n)} LACs`);
      return parts.join(' · ');
    }
    let wall = 0;
    for (const s of u.shipIdx) if (ctx.replay.ships[s].role === 'wall' && WALL_UP.has(ctx.frame.shipStatus[s] as ShipStatus)) wall++;
    parts.push(wall > 0 ? `${fmtCount(wall)} ships of the wall` : `${fmtCount(n)} ships`);
    return parts.join(' · ');
  }

  /** Kilometres per CSS pixel at the camera's look distance: the zoom, whatever the view direction. */
  private kmPerPxAtLook(height: number): number {
    const lookKm = this.camera.position.distanceTo(this.controls?.target ?? new THREE.Vector3()) * this.origin.kmPerUnit;
    return (2 * lookKm * Math.tan((this.camera.fov * Math.PI) / 360)) / (Math.max(1, height) * this.camera.zoom);
  }

  /**
   * Where every ship of the theater is drawn: its true place in its fleet's 3D formation, the formation spread about the
   * fleet's centre by formationSpread so neighbouring glyphs stay apart [S]. The spread follows zoom and positions only,
   * so orbiting turns the formation rather than reshaping it; a ship off its slot (a drifting hulk) keeps its offset.
   */
  private placeFormations(ctx: ViewContext, height: number): void {
    const { replay, frame } = ctx;
    this.placed.fill(0);
    this.spread.fill(1);
    const kmPerPx = this.kmPerPxAtLook(height);
    // A fleet wiped out keeps its wrecks where they were drawn; only fleets still fighting keep others at a distance.
    const fleets = replay.units.flatMap((u, i) => (u.kind === 'fleet' && u.theater === ctx.theater && unitPresent(u, frame.t) ? [i] : []));
    const fighting = fleets.filter((i) => frame.unitCount[i] > 0);
    const at = (i: number): Vec3 => [frame.unitPos[i * 3], frame.unitPos[i * 3 + 1], frame.unitPos[i * 3 + 2]];
    for (const i of fleets) {
      const u = replay.units[i];
      const centre = at(i);
      let neighbourKm = Infinity;
      for (const j of fighting) {
        if (j === i) continue;
        const other = at(j);
        neighbourKm = Math.min(neighbourKm, Math.hypot(other[0] - centre[0], other[1] - centre[1], other[2] - centre[2]));
      }
      const spread = formationSpread({ kmPerPx, spacingKm: this.slotSpacing[i], radiusKm: this.slotRadius[i], minGapPx: this.gapPx[i], neighbourKm });
      this.spread[i] = spread;
      const basis = orientationAt(u.facing, u.up, u.rolls, frame.t);
      const k = (spread - 1) / this.origin.kmPerUnit;
      for (const s of u.shipIdx) {
        const slot = toSystem(basis, replay.ships[s].slot);
        this.origin.point(frame.shipPos.subarray(s * 3, s * 3 + 3), this.v);
        this.display[s * 3] = this.v.x + slot[0] * k;
        this.display[s * 3 + 1] = this.v.y + slot[1] * k;
        this.display[s * 3 + 2] = this.v.z + slot[2] * k;
        this.placed[s] = 1;
      }
    }
  }

  private drawShips(ctx: ViewContext, on: boolean, labels: LabelSpec[]): void {
    const { replay, frame } = ctx;
    this.shipCloud.begin();
    this.shipsInView = [];
    this.fleets = new Map();
    this.shown.clear();
    this.placed.fill(0);
    if (on) {
      const { width, height } = plotSize(this.dom, this.camera.aspect);
      const safe = safePlotRect(width, height, ctx.plotInsets);
      this.placeFormations(ctx, height);
      // Each fleet's drawn glyphs, which its label and ring frame; a wreck stays part of it until its blast has faded.
      const bounds = new Map<number, THREE.Vector3[]>();
      replay.ships.forEach((s, i) => {
        if (replay.units[s.unit].theater !== ctx.theater) return;
        const st = frame.shipStatus[i] as ShipStatus;
        const k = STATUS_BRIGHTNESS[st];
        if (k === 0) return;
        const p = this.placed[i]
          ? new THREE.Vector3(this.display[i * 3], this.display[i * 3 + 1], this.display[i * 3 + 2])
          : this.origin.point(frame.shipPos.subarray(i * 3, i * 3 + 3), new THREE.Vector3());
        this.shown.set(i, p);
        if (st !== ShipStatus.Destroyed || frame.t - (this.deathT.get(i) ?? -Infinity) < SHOCK_S) {
          const group = bounds.get(s.unit) ?? [];
          group.push(p);
          bounds.set(s.unit, group);
        }
        const selected = ctx.selectedShip === i;
        const killed = st === ShipStatus.Destroyed || st === ShipStatus.MissionKill;
        const glyph = shipGlyph(ctx.tech.classes[s.classId], s.role, selected, ctx.layers.damage && killed);
        const color = selected ? PALETTE.wedge : this.sideRgb.get(s.side) ?? PALETTE.ink;
        this.shipCloud.push(p.x, p.y, p.z, rgbOf(color, selected ? 1.1 : k), glyph.size, glyph.shape);
        this.shipsInView.push(i);
        const ally = s.side === ctx.focusSide;
        if (selected) {
          const cls = ctx.tech.classes[s.classId]?.name ?? s.classId;
          labels.push({ key: `ship:${i}`, cls: 'ship selected', text: s.name, sub: `${cls}, ${STATUS_TEXT[st]}`, pos: p.clone() });
        } else if (s.flagship && WALL_UP.has(st) && this.camera.position.distanceTo(p) * this.origin.kmPerUnit < FLAG_LABEL_KM) {
          labels.push({ key: `ship:${i}`, cls: `ship ${ally ? 'allied' : 'hostile'}`, text: `${s.name} ★`, pos: p.clone() });
        }
      });
      for (const [unit, glyphs] of bounds) {
        const centre = this.origin.point(frame.unitPos.subarray(unit * 3, unit * 3 + 3), new THREE.Vector3());
        let radius = 0;
        let live = 0;
        for (const s of replay.units[unit].shipIdx) {
          if (!UNDER_WAY.has(frame.shipStatus[s] as ShipStatus)) continue;
          const p = this.shown.get(s);
          if (!p) continue;
          live++;
          radius = Math.max(radius, p.distanceTo(centre));
        }
        // The ring frames the ships still under way with the fleet, as drawn.
        this.fleets.set(unit, { centre, radius, rect: projectedBounds(glyphs, this.camera, width, height, 8), live: live > 0 });
      }
      this.placeFleetLabels(ctx, labels, bounds, width, height, safe);
    }
    this.shipCloud.commit();
  }

  /**
   * Site A's two-line fleet labels (A report §4.6), placed by the view so none lands on another fleet's glyphs: above
   * the formation first, then beside or below it. Each anchor is set where the label layer's first try puts the label
   * exactly in the chosen box. My side's fleets are placed first.
   */
  private placeFleetLabels(ctx: ViewContext, labels: LabelSpec[], bounds: Map<number, THREE.Vector3[]>, width: number, height: number, safe: PlotRect): void {
    const { replay, frame } = ctx;
    this.fleetLabelBoxes = [];
    const units = replay.units.map((u, i) => i).filter((i) => replay.units[i].theater === ctx.theater && frame.unitCount[i] > 0)
      .sort((a, b) => Number(replay.units[b].side === ctx.focusSide) - Number(replay.units[a].side === ctx.focusSide) || a - b);
    // The rectangles the label layer keeps labels off: each formation's drawn glyphs with its 10 px margin.
    const glyphRects = new Map<number, PlotRect>();
    for (const i of units) {
      const pts = bounds.get(i);
      const rect = pts ? projectedBounds(pts, this.camera, width, height, 10) : this.lacRect(ctx, i, width, height);
      if (rect) glyphRects.set(i, rect);
    }
    const all = [...glyphRects.values()];
    const pad = (r: PlotRect, d: number): PlotRect => ({ x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d });
    const hud = ctx.obstacles ?? [];
    const clear = (box: PlotRect): boolean => box.x >= safe.x + 10 && box.y >= safe.y + 4 && box.x + box.width <= safe.x + safe.width - 4
      && box.y + box.height <= safe.y + safe.height - 4 && !hud.some((r) => overlaps(box, pad(r, 6)))
      && !all.some((r) => overlaps(box, pad(r, 7))) && !this.fleetLabelBoxes.some((r) => overlaps(box, pad(r, 6)));
    for (const i of units) {
      const u = replay.units[i];
      const ally = u.side === ctx.focusSide;
      const text = u.name;
      const sub = this.fleetSubtitle(ctx, i);
      const centre = this.origin.point(frame.unitPos.subarray(i * 3, i * 3 + 3));
      const spec: LabelSpec = { key: `unit:${u.id}`, cls: `fleet ${ally ? 'allied' : 'hostile'}`, text, sub, pos: centre, avoid: bounds.get(i) };
      const ndc = centre.clone().project(this.camera);
      const r = glyphRects.get(i);
      if (ndc.z < -1 || ndc.z > 1 || !r) {
        labels.push(spec);
        continue;
      }
      // Rendered sizes of `.lbl.fleet` (13 px letter-spaced name over an 11 px line), with a little slack.
      const w = Math.max(text.length * 9, sub.length * 4.7) + 14;
      const h = 32;
      const cx = ((ndc.x + 1) / 2) * width;
      const cy = ((1 - ndc.y) / 2) * height;
      const tries: Array<[number, number]> = [
        [r.x, r.y - h - 8], [cx + 8, r.y - h - 8], [r.x + r.width + 8, cy - h / 2],
        [r.x, r.y + r.height + 8], [r.x - w - 8, cy - h / 2], [r.x + r.width - w, r.y - h - 8],
      ];
      const box = tries.map(([x, y]) => ({ x, y, width: w, height: h })).find(clear);
      if (box) {
        spec.pos = new THREE.Vector3(((box.x - 8) / width) * 2 - 1, 1 - ((box.y + 7) / height) * 2, ndc.z).unproject(this.camera);
        this.fleetLabelBoxes.push(box);
      } else {
        // A crowded cluster: Site B's callout (B report §3.3), a centred mono label further out on a thin leader.
        const cw = Math.max(text.length * 8.6, sub.length * 6.4) + 8;
        const ch = 36;
        let found: { box: PlotRect; dx: number; dy: number } | null = null;
        for (const d of [56, 90, 130, 180]) {
          for (const deg of [-90, -120, -60, 180, 0, -150, -30, 90, 150, 30]) {
            const dx = d * Math.cos((deg * Math.PI) / 180);
            const dy = d * Math.sin((deg * Math.PI) / 180);
            const b = { x: cx + dx - cw / 2, y: cy + dy - ch / 2, width: cw, height: ch };
            if (clear(b)) {
              found = { box: b, dx, dy };
              break;
            }
          }
          if (found) break;
        }
        if (found) {
          spec.offset = [found.dx, found.dy];
          spec.color = `#${(this.sideRgb.get(u.side) ?? PALETTE.ink).toString(16).padStart(6, '0')}`;
          this.fleetLabelBoxes.push(found.box);
        }
      }
      labels.push(spec);
    }
  }

  /** Screen rectangle of a LAC group's drawn swarm. */
  private lacRect(ctx: ViewContext, i: number, width: number, height: number): PlotRect | null {
    const u = ctx.replay.units[i];
    if (u.kind !== 'lac') return null;
    const n = ctx.frame.unitCount[i];
    const spread = lacSpreadKm(n) / this.origin.kmPerUnit;
    const c = this.origin.point(ctx.frame.unitPos.subarray(i * 3, i * 3 + 3));
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(spread);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).multiplyScalar(spread);
    return projectedBounds([c.clone().add(right).add(up), c.clone().sub(right).sub(up)], this.camera, width, height, 6);
  }

  /** Range rings on my fleet (A report §4.1), the hyper limits and the resonance zone near it (A §3.8, B §3.1). */
  private drawGrid(ctx: ViewContext, labels: LabelSpec[]): void {
    const { replay, frame } = ctx;
    this.ringLabels = 0;
    const look = this.lookKm();
    let unit: number | null;
    let enemy: Vec3 | null = null;
    if (ctx.perceived.enabled) {
      // The commander knows where their own forces are: my fleet nearest the look point (LAC groups after fleets),
      // else the observer's.
      unit = this.picture.observer;
      let nearest = Infinity;
      for (const c of this.picture.contacts) {
        const i = this.unitIndex.get(c.id);
        if (c.side !== ctx.perceived.side || c.kind === 'packet' || i === undefined || frame.unitCount[i] === 0) continue;
        const km = Math.hypot(frame.unitPos[i * 3] - look[0], frame.unitPos[i * 3 + 1] - look[1], frame.unitPos[i * 3 + 2] - look[2]) + (c.kind === 'fleet' ? 0 : 1e12);
        if (km < nearest) {
          nearest = km;
          unit = i;
        }
      }
      if (unit !== null) {
        const own: Vec3 = [frame.unitPos[unit * 3], frame.unitPos[unit * 3 + 1], frame.unitPos[unit * 3 + 2]];
        let best = Infinity;
        for (const c of this.picture.contacts) {
          if (c.side === ctx.perceived.side || c.kind === 'packet') continue;
          const km = Math.hypot(c.observed[0] - own[0], c.observed[1] - own[1], c.observed[2] - own[2]);
          if (km < best) {
            best = km;
            enemy = c.observed;
          }
        }
      }
    } else {
      unit = ringCentreUnit(replay, frame, ctx.theater, ctx.focusSide, look, ctx.selectedShip);
      if (unit === null) {
        // No fleet of mine here: centre on the nearest present unit so distances still read.
        let best = Infinity;
        replay.units.forEach((u, i) => {
          if (u.theater !== ctx.theater || frame.unitCount[i] === 0) return;
          const km = Math.hypot(frame.unitPos[i * 3] - look[0], frame.unitPos[i * 3 + 1] - look[1], frame.unitPos[i * 3 + 2] - look[2]);
          if (km < best) {
            best = km;
            unit = i;
          }
        });
      }
      if (unit !== null) {
        const own: Vec3 = [frame.unitPos[unit * 3], frame.unitPos[unit * 3 + 1], frame.unitPos[unit * 3 + 2]];
        const e = nearestEnemyUnit(replay, frame, ctx.theater, replay.units[unit].side, own);
        if (e !== null) enemy = [frame.unitPos[e * 3], frame.unitPos[e * 3 + 1], frame.unitPos[e * 3 + 2]];
      }
    }
    const centre: Vec3 = unit !== null ? [frame.unitPos[unit * 3], frame.unitPos[unit * 3 + 1], frame.unitPos[unit * 3 + 2]] : look;
    const cameraKm = this.cameraKmTo(centre);
    const plan = ringPlan(centre, unit, enemy, cameraKm);
    this.plan = plan;
    const fade = gridFade(cameraKm, plan.radius);
    const boundaryFade = ctx.layers.celestial ? smoothstep(0.004 * plan.radius, 0.03 * plan.radius, cameraKm) * (1 - smoothstep(9 * plan.radius, 16 * plan.radius, cameraKm)) : 0;
    const { spheres, cones } = boundariesOf(exclusionsAt(this.bodies, frame.t));
    const toRender = (km: Vec3) => this.origin.point(km, new THREE.Vector3());
    this.plane.update(plan, this.origin.kmPerUnit, toRender, fade, boundaryFade, spheres, cones);
    const { width, height: plotH } = plotSize(this.dom, this.camera.aspect);
    const safe = safePlotRect(width, plotH, ctx.plotInsets);
    const fleetRects = [...this.fleets.values()].flatMap((f) => (f.rect ? [f.rect] : []));
    // Already claimed: the HUD over the plot, every fleet's glyphs (padded) and the fleet labels placed by them.
    const hud = ctx.obstacles ?? [];
    const taken: PlotRect[] = [
      ...hud,
      ...fleetRects.map((r) => ({ x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 })),
      ...this.fleetLabelBoxes,
    ];
    if (fade > 0.05 && ringLabelsShown(cameraKm, plan.radius)) {
      // Site A strings the labels along the bearing to the enemy. Where a fleet's glyphs cover that line, the whole
      // line swings by the smallest angle that frees the most labels.
      let best: Array<{ text: string; km: number; pos: THREE.Vector3; box: PlotRect }> = [];
      for (const deg of [0, -12, 12, -24, 24, -36, 36, -48, 48]) {
        const a = (deg * Math.PI) / 180;
        const [bx, by] = [plan.bearing[0] * Math.cos(a) - plan.bearing[1] * Math.sin(a), plan.bearing[0] * Math.sin(a) + plan.bearing[1] * Math.cos(a)];
        const line: typeof best = [];
        for (const l of plan.labels) {
          const pos = toRender([centre[0] + bx * l.km, centre[1] + by * l.km, centre[2]]);
          const box = this.labelBox(pos, l.text, false, width, plotH);
          if (!box || box.x < safe.x || box.y < safe.y || box.x + box.width > safe.x + safe.width || box.y + box.height > safe.y + safe.height) continue;
          if (fleetRects.some((r) => overlaps(box, r)) || hud.some((r) => overlaps(box, r))) continue;
          line.push({ text: l.text, km: l.km, pos, box });
        }
        if (line.length > best.length) best = line;
        if (best.length === plan.labels.length) break;
      }
      for (const l of best) {
        labels.push({ key: `ring:${l.km}`, cls: 'ring', text: l.text, pos: l.pos });
        taken.push(l.box);
      }
      this.ringLabels = best.length;
    }
    const reach = plan.radius * BOUNDARY_REACH;
    if (boundaryFade > 0.3) {
      const near = reach * 0.8;
      for (const s of spheres) {
        if (Math.abs(sphereGap(s, centre)) > near) continue;
        const text = `${s.name} · ${kmToLm(s.radius).toFixed(2)} LM hyper limit`;
        const at = this.clearAnchor([limitAnchor(s, centre, plan.bearing, near), ...boundaryCrossings((p) => sphereGap(s, p), centre, near, 96)], text, false, safe, taken, width, plotH);
        if (!at) continue;
        labels.push({ key: `limit:${s.body}`, cls: 'limit ring', color: LIMIT_INK, text, pos: toRender(at) });
        taken.push(this.labelBox(toRender(at), text, false, width, plotH)!);
      }
      for (const z of cones) {
        if (!zoneNear(z, centre, near)) continue;
        const at = this.clearAnchor(zoneFlankCrossings(z, centre, near, spheres), 'Hyper translation impossible', true, safe, taken, width, plotH);
        if (!at) continue;
        labels.push({ key: `zone:${z.body}`, cls: 'junction', text: 'Resonance zone', sub: 'Hyper translation impossible', pos: toRender(at) });
        taken.push(this.labelBox(toRender(at), 'Hyper translation impossible', true, width, plotH)!);
      }
    }
    const { height, dpr } = this.dims();
    this.bodyLayer.update(frame.t, centre, reach, plan.radius * 1.6, this.origin.kmPerUnit, toRender, height, this.camera.fov, this.camera.zoom, dpr, labels, ctx.layers.celestial);
  }

  /** Where the label layer first tries to put a label anchored here: Site A's width estimate, 8 px right of the point. */
  private labelBox(pos: THREE.Vector3, text: string, twoLine: boolean, width: number, height: number): PlotRect | null {
    this.w.copy(pos).project(this.camera);
    if (this.w.z < -1 || this.w.z > 1) return null;
    const x = ((this.w.x + 1) / 2) * width;
    const y = ((1 - this.w.y) / 2) * height;
    const h = twoLine ? 30 : 16;
    return { x: x + 8, y: y - 7, width: Math.max(40, text.length * 6.6 + 14), height: h };
  }

  /**
   * The candidate anchor nearest the screen centre whose label, placed right of the point as the label layer first
   * tries, fits the plot and keeps clear of every fleet's glyphs and the labels already placed.
   */
  private clearAnchor(candidates: Vec3[], text: string, twoLine: boolean, safe: PlotRect, avoid: PlotRect[], width: number, height: number): Vec3 | null {
    let best: Vec3 | null = null;
    let bestScore = Infinity;
    const cx = safe.x + safe.width / 2, cy = safe.y + safe.height / 2;
    for (const c of candidates) {
      const box = this.labelBox(this.origin.point(c, this.v), text, twoLine, width, height);
      if (!box || box.x < safe.x + 4 || box.y < safe.y + 4 || box.x + box.width > safe.x + safe.width - 4 || box.y + box.height > safe.y + safe.height - 4) continue;
      if (avoid.some((r) => overlaps({ x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 }, r))) continue;
      const score = Math.hypot(box.x - 8 - cx, box.y + 7 - cy);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /** Fleet rings and velocity arrows (A report §4.2), sized to the displayed formation. */
  private drawMarks(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    this.markLines.begin();
    this.fleetRings = 0;
    const plan = this.plan;
    if (plan && (on || ctx.perceived.enabled)) {
      const cameraKm = this.cameraKmTo(plan.centre);
      if (fleetMarksShown(cameraKm, plan.radius)) {
        const k = 1 / this.origin.kmPerUnit;
        replay.units.forEach((u, i) => {
          if (u.kind !== 'fleet' || u.theater !== ctx.theater || frame.unitCount[i] === 0) return;
          if (ctx.perceived.enabled && i !== this.picture.observer) return;
          const shown = this.fleets.get(i);
          // No ring for a fleet with nothing under way to frame: wrecks only, or every ship escaped or gone.
          if (!ctx.perceived.enabled && !shown?.live) return;
          const c = this.origin.point(frame.unitPos.subarray(i * 3, i * 3 + 3), new THREE.Vector3());
          // A's 2.6 Mkm ring on a 90 Mkm grid, tightened in close-ups so it frames the fleet instead of the horizon.
          const floorKm = Math.min(0.029 * plan.radius, 0.12 * this.cameraKmTo([frame.unitPos[i * 3], frame.unitPos[i * 3 + 1], frame.unitPos[i * 3 + 2]]));
          const radius = Math.max(floorKm * k, (shown?.radius ?? 0) * 1.12);
          const ring = rgbOf(this.sideRgb.get(u.side) ?? PALETTE.ink, 0.55);
          let prev = new THREE.Vector3(c.x + radius, c.y, c.z);
          for (let s = 1; s <= MARK_SEGMENTS; s++) {
            const a = (2 * Math.PI * s) / MARK_SEGMENTS;
            const next = new THREE.Vector3(c.x + radius * Math.cos(a), c.y + radius * Math.sin(a), c.z);
            this.markLines.seg(prev, next, ring);
            prev = next;
          }
          this.fleetRings++;
          const vel = unitVelocity(u, frame.t);
          const speed = Math.hypot(vel[0], vel[1]);
          if (speed < 1) return;
          const dir = new THREE.Vector3(vel[0] / speed, vel[1] / speed, 0);
          // Site A draws 160 s of motion; kept between a third and two thirds of the ring so it reads at any zoom.
          const length = Math.min(0.66 * radius, Math.max(0.33 * radius, speed * 160 * k));
          const start = c.clone().addScaledVector(dir, radius);
          const tip = c.clone().addScaledVector(dir, radius + length);
          const side = new THREE.Vector3(-dir.y, dir.x, 0);
          const h = length * 0.22;
          this.markLines.seg(start, tip, VECTOR_RGB);
          this.markLines.seg(tip, tip.clone().addScaledVector(dir, -h).addScaledVector(side, h * 0.5), VECTOR_RGB);
          this.markLines.seg(tip, tip.clone().addScaledVector(dir, -h).addScaledVector(side, -h * 0.5), VECTOR_RGB);
        });
      }
    }
    this.markLines.commit();
  }

  private drawLacs(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    this.lacCloud.begin();
    if (on) {
      replay.units.forEach((u, i) => {
        const n = frame.unitCount[i];
        if (u.kind !== 'lac' || u.theater !== ctx.theater || n === 0) return;
        const dots = Math.min(LAC_DOTS_PER_GROUP, Math.ceil(n / Math.max(1, ctx.density)));
        const off = this.cache.offsets(hashSeed('lac', u.id), dots);
        const spread = lacSpreadKm(n);
        const c = this.origin.point(frame.unitPos.subarray(i * 3, i * 3 + 3), this.v);
        const rgb = rgbOf(this.sideRgb.get(u.side) ?? PALETTE.ink, 0.85);
        for (let k = 0; k < dots; k++) {
          this.lacCloud.push(c.x + off[k * 3] * spread, c.y + off[k * 3 + 1] * spread, c.z + off[k * 3 + 2] * spread, rgb, 4.5, ROLE_SHAPE.lac);
        }
      });
    }
    this.lacCloud.commit();
  }

  /**
   * Site A's missile streaks (A report §4.7): one ribbon per sampled missile from its position STREAK_TRAIL_S ago to now,
   * MAX-blended. Packet centres, counts and timing come from the replay; the per-missile scatter is a display aid.
   */
  private drawMissiles(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    const t = frame.t;
    this.sampling = null;
    for (let i = 0; i < replay.packets.length; i++) {
      this.alive[i] = on && replay.units[replay.packets[i].toUnit].theater === ctx.theater ? frame.packetAlive[i] : 0;
    }
    const plan = planDensity(this.alive, ctx.density);
    this.streaks.plan(
      plan.perPacket, plan.effectiveRatio,
      (i) => sampledCount(replay.packets[i].launched.attack + replay.packets[i].launched.ew, plan.effectiveRatio),
      (i) => replay.packets[i].seed, (i, n) => this.cache.offsets(replay.packets[i].seed, n), (i, n) => this.missileAnchors(i, n),
    );
    this.writeAnchors(ctx, on);
    const { width, height } = this.dims();
    const viewKm = this.camera.position.distanceTo(this.controls?.target ?? new THREE.Vector3()) * this.origin.kmPerUnit;
    const kmPerPx = (depthKm: number) => (2 * depthKm * Math.tan((this.camera.fov * Math.PI) / 360)) / (height * this.camera.zoom);
    let onScreen = 0;
    const projected = new THREE.Vector3();
    for (let i = 0; i < replay.packets.length; i++) {
      const n = plan.perPacket[i];
      if (n === 0) continue;
      this.origin.point(frame.packetPos.subarray(i * 3, i * 3 + 3), projected).project(this.camera);
      if (projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1.1 && Math.abs(projected.y) <= 1.1) onScreen += n;
    }
    // Site A's crowding control (A report §4.7): a busy screen draws a share of the sample, a little dimmer.
    const keep = Math.min(1, Math.max(0.05, Math.sqrt(CROWD_BUDGET / Math.max(1, onScreen))));
    // Site A dims salvos on wide views: uGainMsl = clamp((4 Mkm / view distance)^0.3, 0.45, 1).
    const gain = Math.min(1, Math.max(0.45, Math.pow(4_000_000 / Math.max(1, viewKm), 0.3))) * (0.35 + 0.65 * keep);
    // Seven seconds of flight (A report §4.7), drawn as a short dash on wide views (image 4) and a comet tail up close.
    const trailPx = Math.min(TRAIL_MAX_PX, Math.max(TRAIL_MIN_PX, (TRAIL_MIN_PX * 25_000_000) / Math.max(1, viewKm)));
    const maxTrailKm = Math.min(TRAIL_VIEW_SHARE * viewKm, trailPx * kmPerPx(viewKm));
    const head = new THREE.Vector3();
    const tail = new THREE.Vector3();
    const launchOff = new THREE.Vector3();
    const aimOff = new THREE.Vector3();
    const tailKm: Vec3 = [0, 0, 0];
    for (let i = 0; i < replay.packets.length; i++) {
      const n = plan.perPacket[i];
      if (n === 0) {
        this.streaks.hide(i);
        this.headSpread[i] = 0;
        continue;
      }
      const p = replay.packets[i];
      const phase = frame.packetPhase[i] as DrivePhase;
      const tTail = streakTailT(p, t, phase, this.terminalStart[i], maxTrailKm);
      const headKm = frame.packetPos.subarray(i * 3, i * 3 + 3);
      this.origin.point(headKm, head);
      packetPositionAt(p, tTail, tailKm);
      this.origin.point(tailKm, tail);
      const start = this.launchKm.subarray(i * 3, i * 3 + 3);
      const flight = Math.max(1, this.flightKm[i]);
      const covered = (q: ArrayLike<number>) => Math.min(1, Math.hypot(q[0] - start[0], q[1] - start[1], q[2] - start[2]) / flight);
      // Each missile leaves its launcher's glyph, joins Site A's compact salvo cloud within a few drawn formation radii,
      // and fans out onto its target's glyph on the last stretch. Display aid [S]: the packet centre stays on its solved
      // path, and its counts and timing are the replay's.
      const fromEdge = Math.min(0.45, Math.max(0.04, (FUNNEL_RADII * this.drawnRadiusKm(ctx, p.fromUnit)) / flight));
      const toEdge = Math.min(0.45, Math.max(0.04, (FUNNEL_RADII * this.drawnRadiusKm(ctx, p.toUnit)) / flight));
      const pull = (f: number): [number, number] => [1 - smoothstep(0, fromEdge, f), smoothstep(1 - toEdge, 1, f)];
      const scatter = (f: number, age: number) => Math.max(packetSpreadKm(age), salvoSpreadKm(flight, f)) / this.origin.kmPerUnit;
      const fHead = covered(headKm), fTail = covered(tailKm);
      const counts = packetAliveAt(p, t);
      const base = streakRgb(this.sideRgb.get(p.side) ?? PALETTE.ink);
      const terminal = phase === DrivePhase.Terminal;
      const rgb = terminal ? mixRgb(base, [1, 1, 1], 0.3) : base;
      const intensity = phase === DrivePhase.Coast ? 0.8 : terminal ? 1.7 : 1;
      this.headSpread[i] = scatter(fHead, t - p.tLaunch);
      [this.headPull[i * 2], this.headPull[i * 2 + 1]] = pull(fHead);
      const k = 1 / this.origin.kmPerUnit;
      this.streaks.write(i, {
        head, headSpread: this.headSpread[i], tail, tailSpread: scatter(fTail, tTail - p.tLaunch),
        launchOff: launchOff.set(this.launchOffKm[i * 3] * k, this.launchOffKm[i * 3 + 1] * k, this.launchOffKm[i * 3 + 2] * k),
        aimOff: aimOff.set(this.aimOffKm[i * 3] * k, this.aimOffKm[i * 3 + 1] * k, this.aimOffKm[i * 3 + 2] * k),
        headPull: pull(fHead), tailPull: pull(fTail),
        rgb: [rgb[0], rgb[1], rgb[2]], intensity, keep,
        ewShare: counts.attack + counts.ew > 0 ? counts.ew / (counts.attack + counts.ew) : 0, toArrival: p.tArrive - t,
      });
    }
    this.streaks.view(width, height, this.camera.fov, this.camera.zoom, this.camera.near, gain, t);
    this.streaks.commit();
    if (on && plan.total > 0) {
      const ratio = plan.effectiveRatio === plan.ratio ? `1:${plan.ratio}` : `1:${plan.effectiveRatio} (capped from 1:${plan.ratio})`;
      const thinned = keep < 0.999 ? `, ${Math.max(1, Math.round(keep * 100))}% drawn in this crowded view` : '';
      this.sampling = `Sampling ${ratio}, ${fmtCount(plan.total)} missiles in flight${thinned}`;
    }
  }

  /**
   * Moves a point of packet i's flight the way its missiles are drawn: toward the launcher glyph `from` and the target
   * glyph `to` (launch-table anchors), by the packet's current head pull. `p` is in render units.
   */
  private pullPoint(i: number, from: number, to: number, p: THREE.Vector3): THREE.Vector3 {
    const k = 1 / this.origin.kmPerUnit;
    const w0 = this.headPull[i * 2], w1 = this.headPull[i * 2 + 1];
    if (w0 > 0 && this.streaks.anchorOffset(from, this.w)) {
      p.addScaledVector(this.w.sub(this.v.set(this.launchOffKm[i * 3] * k, this.launchOffKm[i * 3 + 1] * k, this.launchOffKm[i * 3 + 2] * k)), w0);
    }
    if (w1 > 0 && this.streaks.anchorOffset(to, this.w)) {
      p.addScaledVector(this.w.sub(this.v.set(this.aimOffKm[i * 3] * k, this.aimOffKm[i * 3 + 1] * k, this.aimOffKm[i * 3 + 2] * k)), w1);
    }
    return p;
  }

  /**
   * Where a defensive kill is drawn: the solver puts it on the packet's path a few seconds out, so it moves onto the
   * drawn formation as the missiles do, toward a glyph of the defending fleet nearest it, over the same funnel.
   */
  private killOnPlot(ctx: ViewContext, at: Vec3, side: string, seed: number, out: THREE.Vector3, defenders: Map<number, number[]>): THREE.Vector3 {
    const { replay, frame } = ctx;
    this.origin.point(at, out);
    let fleet = -1;
    let best = Infinity;
    replay.units.forEach((u, i) => {
      if (u.kind !== 'fleet' || u.side !== side || u.theater !== ctx.theater || frame.unitCount[i] === 0) return;
      const d = Math.hypot(frame.unitPos[i * 3] - at[0], frame.unitPos[i * 3 + 1] - at[1], frame.unitPos[i * 3 + 2] - at[2]);
      if (d < best) {
        best = d;
        fleet = i;
      }
    });
    if (fleet < 0 || this.spread[fleet] <= 1) return out;
    let ships = defenders.get(fleet);
    if (!ships) {
      ships = replay.units[fleet].shipIdx.filter((s) => this.placed[s] && UNDER_WAY.has(frame.shipStatus[s] as ShipStatus));
      defenders.set(fleet, ships);
    }
    if (!ships.length) return out;
    const s = ships[(Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0) % ships.length];
    const w = 1 - smoothstep(0, FUNNEL_RADII * this.drawnRadiusKm(ctx, fleet), best);
    this.origin.point(frame.shipPos.subarray(s * 3, s * 3 + 3), this.v);
    return out.add(this.w.set(this.display[s * 3] - this.v.x, this.display[s * 3 + 1] - this.v.y, this.display[s * 3 + 2] - this.v.z).multiplyScalar(w));
  }

  /** How far a unit is drawn about its centre this frame, km: its spread formation, or its LAC swarm. */
  private drawnRadiusKm(ctx: ViewContext, unit: number): number {
    const u = ctx.replay.units[unit];
    return u.kind === 'lac' ? lacSpreadKm(ctx.frame.unitCount[unit]) : this.spread[unit] * this.slotRadius[unit];
  }

  /**
   * Launcher and target glyph of each sampled missile of packet i: spread over the ships still fighting (by what they
   * carry), and a share homing on the ship the solver aimed the packet at. Fixed per missile, so scrubbing never
   * reshuffles them.
   */
  private missileAnchors(i: number, n: number): Float32Array {
    const out = new Float32Array(n * 2);
    const from = this.launchAnchors[i] ?? new Uint32Array(0);
    const to = this.targetAnchors[i] ?? new Uint32Array(0);
    const aim = this.aimAnchor[i];
    const rng = mulberry32(hashSeed('missile-anchors', this.replay.packets[i].seed));
    for (let k = 0; k < n; k++) {
      const a = rng(), b = rng(), c = rng();
      out[k * 2] = from.length ? from[Math.floor(a * from.length)] : 0;
      out[k * 2 + 1] = aim >= 0 && c < AIMED_SHARE ? aim : to.length ? to[Math.floor(b * to.length)] : 0;
    }
    return out;
  }

  /** Every placed glyph's offset from its unit's centre, for the streaks to launch from and land on. */
  private writeAnchors(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    this.streaks.clearAnchors();
    if (!on) return;
    const c = new THREE.Vector3();
    replay.ships.forEach((s, i) => {
      if (!this.placed[i]) return;
      this.origin.point(frame.unitPos.subarray(s.unit * 3, s.unit * 3 + 3), c);
      this.streaks.setAnchor(1 + i, this.display[i * 3] - c.x, this.display[i * 3 + 1] - c.y, this.display[i * 3 + 2] - c.z);
    });
    for (const [unit, base] of this.lacAnchorBase) {
      const u = replay.units[unit];
      const n = frame.unitCount[unit];
      if (u.theater !== ctx.theater || n === 0) continue;
      // The first of the swarm's drawn dots (drawLacs uses the same seeded offsets).
      const off = this.cache.offsets(hashSeed('lac', u.id), LAC_ANCHORS);
      const r = lacSpreadKm(n) / this.origin.kmPerUnit;
      for (let k = 0; k < LAC_ANCHORS; k++) this.streaks.setAnchor(base + k, off[k * 3] * r, off[k * 3 + 1] * r, off[k * 3 + 2] * r);
    }
  }

  /** Replay events only: launch flashes, lasing rods, energy fire, kills, hyper footprints and ship deaths (A report §4.8). */
  private drawFx(ctx: ViewContext, on: boolean): void {
    const t = ctx.frame.t;
    const { width, height } = this.dims();
    this.glows.begin(height, this.camera.fov, this.camera.zoom);
    this.beamBatch.begin(width, height, this.camera.near, t);
    if (on) {
      const k = 1 / this.origin.kmPerUnit;
      const launches = new Set<string>();
      for (const packet of this.replay.packets) {
        if (this.replay.units[packet.fromUnit].theater !== ctx.theater || t < packet.tLaunch || t >= packet.tLaunch + LAUNCH_CUE_S || launches.has(packet.salvoId)) continue;
        launches.add(packet.salvoId);
        const kind = this.launchKinds.get(packet.planId) ?? 'tube';
        const fade = ctx.reducedMotion ? 0.7 : 1 - (t - packet.tLaunch) / LAUNCH_CUE_S;
        const rgb = kind === 'tube' ? streakRgb(this.sideRgb.get(packet.side) ?? PALETTE.ink) : POD_FLASH_RGB;
        // The whole firing line flashes: every ship the salvo leaves from, where it is drawn.
        const ships = (this.salvoLaunchers.get(packet.salvoId) ?? []).flatMap((s) => this.shown.get(s) ?? []);
        if (ships.length) for (const p of ships) this.glows.push(p, 1_500 * k, kind === 'tube' ? 3.5 : 4.5, rgb, 1.3 * fade, GLOW.spark);
        else this.glows.push(this.origin.point(packet.segments[0].p0, new THREE.Vector3()), 2_000 * k, kind === 'tube' ? 5 : 8, rgb, 1.5 * fade, GLOW.spark);
      }
      const defenders = new Map<number, number[]>();
      for (let i = firstAtOrAfter(this.beams, t - this.maxBeamDur); i < this.beams.length && this.beams[i].t <= t; i++) {
        const b = this.beams[i];
        if (t >= b.t + b.dur || this.beamTheaters.get(b) !== ctx.theater) continue;
        const u = Math.min(1, Math.max(0, (t - b.t) / b.dur));
        const fade = ctx.reducedMotion ? 0.75 : (1 - u) * (1 - u);
        let a = this.origin.point(b.from, new THREE.Vector3());
        let z = this.origin.point(b.to, new THREE.Vector3());
        // Fire aimed at a ship ends on its drawn glyph; the shot keeps its solved direction and length.
        const target = b.ship >= 0 ? this.shown.get(b.ship) : undefined;
        if (target) {
          a = target.clone().add(a.sub(z));
          z = target.clone();
        }
        if (b.kind === 'laserhead') {
          // The rod grows from the burst at light speed; the hull flashes when it arrives (A report §4.8).
          const span = a.distanceTo(z) * this.origin.kmPerUnit;
          const reach = Math.min(1, ((t - b.t) * LIGHT_KM_S) / Math.max(1, span));
          const ally = b.side === ctx.focusSide;
          this.beamBatch.push(a, a.clone().lerp(z, reach), ally ? ROD_ALLIED : ROD_HOSTILE, 2.6 * (ctx.reducedMotion ? 0.75 : 1 - 0.5 * u), 1.6);
          this.glows.push(a, 1_000 * k, 2.2, mixRgb([1, 0.92, 0.72], [1, 0.45, 0.12], u), 3 * fade, GLOW.blast);
          if (reach >= 1) this.glows.push(z, 600 * k, 2.5, HULL_HIT_RGB, 2.8 * fade, GLOW.spark);
        } else if (b.kind === 'graser' || b.kind === 'laser') {
          this.beamBatch.push(a, z, GRASER_RGB, 2.6 * (ctx.reducedMotion ? 0.75 : 0.4 + 0.6 * Math.sin(Math.PI * u)), 2.4);
          this.glows.push(z, 600 * k, 3, HULL_HIT_RGB, 2.4 * fade, GLOW.spark);
        } else if (b.kind === 'transit') {
          this.glows.push(z, 16_000 * k, 16, FOOTPRINT_RGB, 2.2 * (ctx.reducedMotion ? 0.75 : 1 - u), GLOW.ring);
        } else if (b.kind === 'cm-kill') {
          this.glows.push(this.killOnPlot(ctx, b.to, b.side, i, z, defenders), 300 * k, 3.5, CM_RGB, 2 * fade, GLOW.spark);
        } else {
          this.glows.push(this.killOnPlot(ctx, b.to, b.side, i, z, defenders), 200 * k, 3, PD_RGB, 1.7 * fade, GLOW.spark);
        }
      }
      for (const d of this.deaths) {
        if (d.t > t) break;
        const age = t - d.t;
        if (age >= SHOCK_S) continue;
        const ship = this.replay.ships[d.ship];
        if (this.replay.units[ship.unit].theater !== ctx.theater) continue;
        const hull = ctx.tech.classes[ship.classId]?.hull;
        const size = (hull === 'SD' || hull === 'SD(P)' ? 11_000 : hull === 'BC' || hull === 'BC(P)' ? 7_800 : 5_200) * k;
        const p = this.shown.get(d.ship)?.clone() ?? this.origin.point(ctx.frame.shipPos.subarray(d.ship * 3, d.ship * 3 + 3), new THREE.Vector3());
        if (age < DEATH_S) {
          const u = age / DEATH_S;
          const grow = 0.6 + 0.4 * Math.sqrt(u);
          this.glows.push(p, size * grow, 4.5, mixRgb([1, 0.85, 0.6], [0.6, 0.12, 0.04], u), 3 * Math.pow(1 - u, 1.5), GLOW.blast);
        }
        if (ship.role === 'wall') {
          const u = age / SHOCK_S;
          this.glows.push(p, size * 2.6 * (0.3 + 0.7 * u), 6, [1, 0.62, 0.32], 0.9 * (1 - u) * (1 - u), GLOW.ring);
        }
      }
    }
    this.glows.commit();
    this.beamBatch.commit();
  }

  /** Apollo telemetry (A report §4.8): violet links from the controlling ship to each controlled packet, pulses travelling out. */
  private drawLinks(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    const t = frame.t;
    const { width, height } = this.dims();
    this.links.begin(width, height, this.camera.near, t);
    if (on) {
      // Packets still steered by Apollo controllers, grouped by the launching unit.
      const byMother = new Map<number, number[]>();
      for (let i = 0; i < replay.packets.length; i++) {
        const p = replay.packets[i];
        if (p.guidance !== 'apollo' || frame.packetAlive[i] === 0 || replay.units[p.toUnit].theater !== ctx.theater) continue;
        if (packetAliveAt(p, t).controller === 0) continue;
        byMother.set(p.fromUnit, [...(byMother.get(p.fromUnit) ?? []), i]);
      }
      const end = new THREE.Vector3();
      for (const [unitIdx, packets] of byMother) {
        const unit = replay.units[unitIdx];
        const flag = unit.shipIdx.find((s) => replay.ships[s].flagship && WALL_UP.has(frame.shipStatus[s] as ShipStatus));
        const mother = (flag !== undefined ? this.shown.get(flag)?.clone() : undefined)
          ?? this.origin.point(flag !== undefined ? frame.shipPos.subarray(flag * 3, flag * 3 + 3) : frame.unitPos.subarray(unitIdx * 3, unitIdx * 3 + 3), new THREE.Vector3());
        // Site A draws a share of the links, one per control missile, fanned across the cloud: a few dozen per mother
        // here, each to its own point in its packet's drawn cloud, so they read as separate threads.
        const step = Math.max(1, Math.ceil(packets.length / LINKS_PER_MOTHER));
        for (let k = 0; k < packets.length && this.links.drawn < LINK_CAP; k += step) {
          const i = packets[k];
          const p = replay.packets[i];
          const h = Math.imul(p.seed ^ 0x9e3779b9, 2654435761) >>> 0;
          const u = ((h & 0xffff) / 0xffff) * 2 - 1;
          const phi = ((h >>> 16) / 0xffff) * Math.PI * 2;
          const r = 0.8 * this.headSpread[i] * Math.sqrt(1 - u * u);
          const from = this.launchAnchors[i] ?? new Uint32Array(0), to = this.targetAnchors[i] ?? new Uint32Array(0);
          this.origin.point(frame.packetPos.subarray(i * 3, i * 3 + 3), end);
          this.pullPoint(i, from.length ? from[h % from.length] : 0, to.length ? to[(h >>> 7) % to.length] : 0, end);
          end.add(this.v.set(r * Math.cos(phi), r * Math.sin(phi), 0.8 * this.headSpread[i] * u));
          const fade = smoothstep(p.tLaunch + 1.5, p.tLaunch + 8, t);
          this.links.push(mother, end, TELEMETRY_RGB, 0.6 * fade, 1, 0.5 + (i % 97) / 97);
        }
      }
    }
    this.links.commit();
  }

  /** Stress bands and sidewalls at physical size (MTS §3.1, §6.1) on each drawn glyph, nearest ships to the camera target first. */
  private drawWedges(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    this.wedgeLines.begin();
    this.wedgeCount = 0;
    if (on) {
      const target = this.controls?.target ?? new THREE.Vector3();
      const order = this.shipsInView
        .filter((i) => WEDGE_UP.has(frame.shipStatus[i] as ShipStatus))
        .map((i) => ({ i, c: this.shown.get(i)?.clone() ?? this.origin.point(frame.shipPos.subarray(i * 3, i * 3 + 3), new THREE.Vector3()) }))
        .sort((a, b) => a.c.distanceToSquared(target) - b.c.distanceToSquared(target))
        .slice(0, WEDGE_CAP);
      const bases = new Map<number, ReturnType<typeof orientationAt>>();
      for (const { i, c } of order) {
        const s = replay.ships[i];
        const cls = ctx.tech.classes[s.classId];
        if (!cls) continue;
        const u = replay.units[s.unit];
        let b = bases.get(s.unit);
        if (!b) {
          b = orientationAt(u.facing, u.up, u.rolls, frame.t);
          bases.set(s.unit, b);
        }
        const k = 1 / this.origin.kmPerUnit;
        const off = (baseValue(cls.wedge.band_offset) ?? 0) * k;
        const len = (baseValue(cls.wedge.band_length) ?? 0) * k;
        const wid = (baseValue(cls.wedge.band_width) ?? 0) * k;
        const side = (baseValue(cls.wedge.sidewall_offset) ?? 0) * k;
        const sub = subsystemsAt(s, frame.t);
        const bright = ctx.selectedShip === i ? 1.3 : 0.7;
        const band = rgbOf(PALETTE.wedge, bright);
        const wall = rgbOf(PALETTE.wedge, bright * 0.6);
        if (sub.drive_fore > 0 || sub.drive_aft > 0) {
          this.wedgeLines.loop(rect(shifted(c, b.u, off), b.f, len / 2, b.s, wid / 2), band);
          this.wedgeLines.loop(rect(shifted(c, b.u, -off), b.f, len / 2, b.s, wid / 2), band);
        }
        if (sub.wall_stbd > 0) this.wedgeLines.loop(rect(shifted(c, b.s, side), b.f, len / 2, b.u, off), wall);
        if (sub.wall_port > 0) this.wedgeLines.loop(rect(shifted(c, b.s, -side), b.f, len / 2, b.u, off), wall);
        this.wedgeCount++;
      }
    }
    this.wedgeLines.commit();
  }

  private drawContacts(ctx: ViewContext, on: boolean, labels: LabelSpec[]): void {
    const { replay } = ctx;
    this.contactCloud.begin();
    this.contactLines.begin();
    this.notice = null;
    if (on) {
      const sideName = replay.sides.find((s) => s.id === ctx.perceived.side)?.name ?? ctx.perceived.side;
      if (this.picture.observer === null) this.notice = `No ${sideName} fleet is present in this theater`;
      else if (this.picture.contacts.length === 0) this.notice = `No contacts: light from ${sideName}'s targets has not arrived yet`;
      const ghost = !ctx.perceived.enabled;
      for (const c of this.picture.contacts) {
        const color = c.identity === 'unknown' ? PALETTE.inkDim : this.sideRgb.get(c.side) ?? PALETTE.ink;
        // Spec §7: drawn at the last-known position; the faint leg shows where dead reckoning puts it now.
        const p = this.origin.point(c.observed, new THREE.Vector3());
        this.contactLines.seg(p, this.origin.point(c.predicted, this.w), rgbOf(color, 0.5), rgbOf(color, 0.15));
        if (c.kind === 'packet') {
          this.contactCloud.push(p.x, p.y, p.z, rgbOf(color, ghost ? 0.5 : 0.9), 4, 0);
          continue;
        }
        this.contactCloud.push(p.x, p.y, p.z, rgbOf(color, ghost ? 0.55 : 1), 9, c.kind === 'lac' ? ROLE_SHAPE.lac : ROLE_SHAPE.wall);
        const r = c.sigmaKm / this.origin.kmPerUnit;
        const ring = Array.from({ length: 24 }, (_, k) => {
          const a = (2 * Math.PI * k) / 24;
          return new THREE.Vector3(p.x + r * Math.cos(a), p.y + r * Math.sin(a), p.z);
        });
        this.contactLines.loop(ring, rgbOf(color, 0.45));
        const ally = c.side === ctx.focusSide;
        labels.push({
          key: `contact:${c.id}`, cls: `contact ${ally ? 'allied' : 'hostile'}${ghost ? ' ghost' : ''}`, text: c.label,
          sub: `${ageText(c.age)}, ±${fmtDistance(c.sigmaKm)}, ${c.identity}`, pos: p,
        });
      }
    }
    this.contactCloud.commit();
    this.contactLines.commit();
  }

  labels(): LabelSpec[] {
    return this.specs;
  }

  pick(ndcX: number, ndcY: number): number | null {
    if (this.perceivedOn) return null;
    this.camera.updateMatrixWorld();
    const pos = this.shipCloud.points.geometry.getAttribute('position').array as Float32Array;
    const sizes = this.shipCloud.points.geometry.getAttribute('size').array as Float32Array;
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    let best: number | null = null;
    let bestD = Infinity;
    for (let k = 0; k < this.shipsInView.length; k++) {
      this.v.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).project(this.camera);
      if (this.v.z < -1 || this.v.z > 1) continue;
      const d = Math.hypot((this.v.x - ndcX) * width / 2, (this.v.y - ndcY) * height / 2);
      if (d < Math.max(8, sizes[k] / 2 + 3) && d < bestD) {
        bestD = d;
        best = this.shipsInView[k];
      }
    }
    return best;
  }

  status(): ViewStatus {
    return {
      samplingText: this.sampling,
      scaleNote: 'Range rings centre on my side\'s fleet nearest the camera and are to scale; the hyper limits and resonance zone are the pack\'s. Class glyphs have bounded CSS-pixel sizes [S]; each fleet keeps its 3D formation, drawn larger about its true centre when zoomed out so ships stay apart [S], with centres and counts unchanged. Each streak is one sampled missile: it leaves a ship of its fleet, flies its packet\'s solved path and comes down on a ship of the target fleet [S]; crowded views draw a share of the sample. Packet/LAC spread, seven-second trails, launch cues and ship-death glows are display aids [S]; beam durations are unchanged. Wedges, ranges and uncertainty are to scale.',
      notice: this.notice,
    };
  }

  drawCounts(): DrawCounts {
    return {
      ships: this.shipCloud.drawn, dots: this.streaks.count, lacDots: this.lacCloud.drawn, contacts: this.contactCloud.drawn,
      fx: this.glows.drawn + this.beamBatch.drawn, wedges: this.wedgeCount, links: this.links.drawn,
      trails: this.streaks.count > 0 ? this.streaks.drawn() : 0,
      rings: this.ringLabels, boundaries: this.plane.shownSpheres + this.plane.shownCones, fleetRings: this.fleetRings,
      bodies: this.bodyLayer.drawn,
    };
  }

  /** Displayed ship positions, then the head of every sampled missile streak, in render units. */
  debugPositions(): Float32Array {
    const a = (this.shipCloud.points.geometry.getAttribute('position').array as Float32Array).subarray(0, this.shipCloud.drawn * 3);
    const b = this.streaks.heads();
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  }

  /** Where a ship's glyph is drawn this frame, render units; null when it is not drawn. */
  shipOnPlot(ship: number): THREE.Vector3 | null {
    return this.shown.get(ship)?.clone() ?? null;
  }

  /** [head, tail] pairs of the streaks drawn this frame, in render units. */
  debugTrails(): Float32Array {
    return this.streaks.segments();
  }

  /** The current range-ring plan, for inspection. */
  ringPlan(): RingPlan | null {
    return this.plan;
  }

  dispose(): void {
    this.controls?.dispose();
    this.plane.dispose();
    this.bodyLayer.dispose();
    this.streaks.dispose();
    this.glows.dispose();
    this.beamBatch.dispose();
    this.links.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((mat) => mat.dispose());
    });
  }
}

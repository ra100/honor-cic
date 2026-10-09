import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { baseValue } from '../../core/evidence';
import { commanderPicture, replayTrackables, type CommanderPicture } from '../../core/perceived';
import { DrivePhase, ShipStatus, STATUS_TEXT, subsystemsAt, type BeamEvent, type Replay } from '../../core/replay';
import { hashSeed } from '../../core/rng';
import type { ScenarioPack } from '../../core/schema';
import type { Trackable } from '../../core/sensors';
import { orientationAt } from '../../core/solver/geometry';
import { bodyPosition, indexBodies } from '../../core/solver/orbits';
import { fmtCount, fmtDistance, fmtDuration } from '../../core/units';
import type { Vec3 } from '../../core/vec';
import { DOT_CAP, DotCache, displaySpreadKm, packetSpreadKm, planDensity } from '../density';
import { fleetDisplayFormation, type FormationGlyph } from '../formations';
import { applyPlotInsets, fitPlotRadius, plotDistanceScale, plotSize, safePlotRect } from '../framing';
import { shipGlyph } from '../glyphs';
import type { LabelSpec } from '../labels';
import { LineBatch } from '../lines';
import { FloatingOrigin } from '../origin';
import { hexToNum, PALETTE, PHASE_BRIGHTNESS, rgbOf, STATUS_BRIGHTNESS } from '../palette';
import { PointCloud, SHAPE } from '../points';
import { beamTheatersFor, LAUNCH_CUE_S, packetTrailAt, TRAIL_CAP, trailStride } from '../salvos';
import type { ScaleView, ViewContext, ViewStatus } from './types';

const ROLE_SHAPE = { wall: SHAPE.wall, screen: SHAPE.screen, carrier: SHAPE.carrier, lac: SHAPE.lac } as const;
const RING_SHAPE = 4;
const RECENTER_KM = 50_000;
const LAC_DOTS_PER_GROUP = 4_000;
const WEDGE_CAP = 300;
const LINK_CAP = 1_024;
const WEDGE_UP = new Set([ShipStatus.Operational, ShipStatus.Degraded, ShipStatus.MissionKill]);

export interface DrawCounts { ships: number; dots: number; lacDots: number; contacts: number; fx: number; wedges: number; links: number; trails: number }

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

export class EngagementView implements ScaleView {
  readonly id = 'engagement' as const;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 1e10);
  readonly controls: OrbitControls | null;
  private readonly origin = new FloatingOrigin(1);
  private readonly shipCloud: PointCloud;
  private readonly lacCloud: PointCloud;
  private readonly dotCloud = new PointCloud(DOT_CAP);
  private readonly trailLines = new LineBatch(TRAIL_CAP, false, 0.55);
  private readonly contactCloud = new PointCloud(8_192);
  private readonly flashCloud = new PointCloud(8_192);
  private readonly beamLines = new LineBatch(8_192, false, 0.85);
  private readonly wedgeLines = new LineBatch(WEDGE_CAP * 16, false, 0.8);
  private readonly linkLines = new LineBatch(LINK_CAP, false, 0.6);
  private readonly contactLines = new LineBatch(16_384, false, 0.7);
  private readonly cache = new DotCache();
  private readonly beams: BeamEvent[];
  private readonly maxBeamDur: number;
  private readonly beamTheaters = new Map<BeamEvent, string | null>();
  private readonly launchKinds: Map<string, 'tube' | 'pod' | 'tow'>;
  private readonly sideRgb: Map<string, number>;
  private readonly alive: Uint32Array;
  private readonly bodies;
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private tracks: Trackable[] = [];
  private tracksTheater: string | null = null;
  private picture: CommanderPicture = { observer: null, contacts: [] };
  private pictureKey = '';
  private framedTheater: string | null = null;
  private posePending = false;
  private plotScale = 1;
  private perceivedOn = false;
  private shipsInView: number[] = [];
  private wedgeCount = 0;
  private specs: LabelSpec[] = [];
  private sampling: string | null = null;
  private notice: string | null = null;

  constructor(private readonly pack: ScenarioPack, private readonly replay: Replay, private readonly dom: HTMLElement | null) {
    this.camera.up.set(0, 0, 1);
    this.scene.background = new THREE.Color(PALETTE.void);
    this.shipCloud = new PointCloud(Math.max(16, replay.ships.length));
    this.lacCloud = new PointCloud(Math.max(16, replay.units.filter((u) => u.kind === 'lac').length * LAC_DOTS_PER_GROUP));
    this.beams = [...replay.beams].sort((a, b) => a.t - b.t);
    this.maxBeamDur = this.beams.reduce((m, b) => Math.max(m, b.dur), 0);
    const theaters = beamTheatersFor(replay);
    for (const beam of this.beams) this.beamTheaters.set(beam, theaters.get(beam) ?? null);
    this.launchKinds = new Map(pack.events.filter((e) => e.type === 'fire_plan').map((e) => [e.id, e.launch]));
    this.sideRgb = new Map(replay.sides.map((s) => [s.id, hexToNum(s.color)]));
    this.alive = new Uint32Array(replay.packets.length);
    this.bodies = indexBodies(pack.bodies);
    this.scene.add(
      this.wedgeLines.lines, this.linkLines.lines, this.contactLines.lines, this.beamLines.lines, this.trailLines.lines,
      this.lacCloud.points, this.shipCloud.points, this.contactCloud.points, this.dotCloud.points, this.flashCloud.points,
    );
    this.controls = dom ? new OrbitControls(this.camera, dom) : null;
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.zoomSpeed = 1.6;
    }
  }

  update(ctx: ViewContext): void {
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    applyPlotInsets(this.camera, width, height, ctx.plotInsets);
    const scale = plotDistanceScale(this.camera, width, height, ctx.plotInsets);
    const externalPose = this.posePending;
    const newTheater = this.framedTheater !== ctx.theater;
    if (newTheater) {
      this.framedTheater = ctx.theater;
      if (!externalPose) this.frameTheater(ctx);
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
    this.drawShips(ctx, truth, labels);
    this.drawLacs(ctx, truth);
    this.drawMissiles(ctx, truth && ctx.layers.engagement);
    this.drawFx(ctx, truth && ctx.layers.engagement);
    this.drawLinks(ctx, truth && ctx.layers.comms);
    this.drawWedges(ctx, truth && ctx.layers.protection);
    this.drawContacts(ctx, ctx.perceived.enabled || ctx.layers.commander, labels);
    this.specs = labels;
  }

  private frameTheater(ctx: ViewContext): void {
    const { frame } = ctx;
    const pts: Vec3[] = [];
    this.replay.units.forEach((u, i) => {
      if (u.theater === ctx.theater && frame.unitCount[i] > 0 && (!ctx.perceived.enabled || u.side === ctx.perceived.side)) {
        pts.push([frame.unitPos[i * 3], frame.unitPos[i * 3 + 1], frame.unitPos[i * 3 + 2]]);
        if (u.kind === 'fleet') for (const ship of u.shipIdx) pts.push(Array.from(frame.shipPos.subarray(ship * 3, ship * 3 + 3)) as Vec3);
      }
    });
    if (pts.length === 0) {
      const anchor = this.pack.meta.theaters.find((th) => th.id === ctx.theater)?.anchor_body ?? this.pack.meta.frame.origin_body;
      pts.push(bodyPosition(this.bodies, anchor, frame.t));
    }
    const box = new THREE.Box3().setFromPoints(pts.map((p) => new THREE.Vector3(...p)));
    const c = box.getCenter(new THREE.Vector3()).toArray() as Vec3;
    const radius = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    const safe = safePlotRect(width, height, ctx.plotInsets);
    const portrait = safe.height > safe.width;
    const d = Math.max(20_000, fitPlotRadius(this.camera, radius, width, height, ctx.plotInsets, 1.4));
    this.camera.far = Math.max(1e10, d + radius * 2);
    this.camera.updateProjectionMatrix();
    const el = ((portrait ? 70 : 30) * Math.PI) / 180;
    let az = (-60 * Math.PI) / 180;
    if (portrait) {
      const size = box.getSize(new THREE.Vector3());
      const axis = size.x >= size.y ? 0 : 1;
      let first = pts[0], last = pts[0];
      for (const p of pts) {
        if (p[axis] < first[axis]) first = p;
        if (p[axis] > last[axis]) last = p;
      }
      if (first[0] !== last[0] || first[1] !== last[1]) az = Math.atan2(last[1] - first[1], last[0] - first[0]);
    }
    this.setPose([c[0] + d * Math.cos(el) * Math.cos(az), c[1] + d * Math.cos(el) * Math.sin(az), c[2] + d * Math.sin(el)], c);
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

  private drawShips(ctx: ViewContext, on: boolean, labels: LabelSpec[]): void {
    const { replay, frame } = ctx;
    this.shipCloud.begin();
    this.shipsInView = [];
    if (on) {
      const { width, height } = plotSize(this.dom, this.camera.aspect);
      const safe = safePlotRect(width, height, ctx.plotInsets);
      const formations = new Map<number, FormationGlyph[]>();
      const positions = new Map<number, THREE.Vector3>();
      const bounds = new Map<number, THREE.Vector3[]>();
      replay.ships.forEach((s, i) => {
        const status = frame.shipStatus[i] as ShipStatus;
        if (replay.units[s.unit].theater !== ctx.theater || STATUS_BRIGHTNESS[status] === 0 || status === ShipStatus.Destroyed) return;
        const group = formations.get(s.unit) ?? [];
        group.push({
          ship: i, role: s.role, classId: s.classId, flagship: s.flagship,
          size: shipGlyph(ctx.tech.classes[s.classId], s.role, ctx.selectedShip === i).size,
          pos: this.origin.point(frame.shipPos.subarray(i * 3, i * 3 + 3), new THREE.Vector3()),
        });
        formations.set(s.unit, group);
      });
      const centres = new Map([...formations.keys()].map((unit) => [
        unit, this.origin.point(frame.unitPos.subarray(unit * 3, unit * 3 + 3), new THREE.Vector3()),
      ]));
      const projected = new Map([...centres].map(([unit, centre]) => [unit, centre.clone().project(this.camera)]));
      for (const [unit, glyphs] of formations) {
        const centre = projected.get(unit)!;
        const footprint = { halfWidth: Infinity, halfHeight: Infinity };
        for (const [other, pos] of projected) {
          if (other !== unit && pos.z >= -1 && pos.z <= 1) {
            const dx = Math.abs(centre.x - pos.x) * width / 2;
            const dy = Math.abs(centre.y - pos.y) * height / 2;
            if (dx >= dy) footprint.halfWidth = Math.min(footprint.halfWidth, dx / 2);
            else footprint.halfHeight = Math.min(footprint.halfHeight, dy / 2);
          }
        }
        const display = fleetDisplayFormation(
          glyphs, centres.get(unit)!, this.camera, width, height, safe, replay.units[unit].id, undefined, footprint,
        );
        glyphs.forEach((g, i) => positions.set(g.ship, display.positions[i]));
        if (display.schematic) bounds.set(unit, display.bounds);
      }
      replay.ships.forEach((s, i) => {
        if (replay.units[s.unit].theater !== ctx.theater) return;
        const st = frame.shipStatus[i] as ShipStatus;
        const k = STATUS_BRIGHTNESS[st];
        if (k === 0) return;
        const p = positions.get(i) ?? this.origin.point(frame.shipPos.subarray(i * 3, i * 3 + 3), this.v);
        const selected = ctx.selectedShip === i;
        const killed = st === ShipStatus.Destroyed || st === ShipStatus.MissionKill;
        const glyph = shipGlyph(ctx.tech.classes[s.classId], s.role, selected, ctx.layers.damage && killed);
        const color = selected ? PALETTE.wedge : this.sideRgb.get(s.side) ?? PALETTE.ink;
        this.shipCloud.push(p.x, p.y, p.z, rgbOf(color, selected ? 1.1 : k), glyph.size, glyph.shape);
        this.shipsInView.push(i);
        if (selected) {
          const cls = ctx.tech.classes[s.classId]?.name ?? s.classId;
          labels.push({ key: `ship:${i}`, cls: 'ship selected', text: s.name, sub: `${cls}, ${STATUS_TEXT[st]}`, pos: p.clone(), avoid: bounds.get(s.unit) });
        }
      });
      replay.units.forEach((u, i) => {
        if (u.theater !== ctx.theater || frame.unitCount[i] === 0) return;
        const ally = u.side === replay.sides[0].id;
        labels.push({
          key: `unit:${u.id}`, cls: `fleet ${ally ? 'allied' : 'hostile'}`, text: u.name,
          sub: `${fmtCount(frame.unitCount[i])} ${u.kind === 'lac' ? 'LACs' : 'ships'}${bounds.has(i) ? ', formation spread [S]' : ''}`,
          pos: this.origin.point(frame.unitPos.subarray(i * 3, i * 3 + 3)),
          avoid: bounds.get(i),
        });
      });
    }
    this.shipCloud.commit();
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
        // Packs give LAC counts, not slots, so the swarm spread is a display aid (S).
        const spread = Math.min(30_000, 2_000 * Math.sqrt(n / 100));
        const c = this.origin.point(frame.unitPos.subarray(i * 3, i * 3 + 3), this.v);
        const rgb = rgbOf(this.sideRgb.get(u.side) ?? PALETTE.ink, 0.85);
        for (let k = 0; k < dots; k++) {
          this.lacCloud.push(c.x + off[k * 3] * spread, c.y + off[k * 3 + 1] * spread, c.z + off[k * 3 + 2] * spread, rgb, 4.5, ROLE_SHAPE.lac);
        }
      });
    }
    this.lacCloud.commit();
  }

  private drawMissiles(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    this.dotCloud.begin();
    this.trailLines.begin();
    this.sampling = null;
    if (on) {
      replay.packets.forEach((p, i) => {
        this.alive[i] = replay.units[p.toUnit].theater === ctx.theater ? frame.packetAlive[i] : 0;
      });
      const plan = planDensity(this.alive, ctx.density);
      const stride = trailStride(plan.dots);
      let dotIndex = 0;
      const viewKm = this.camera.position.distanceTo(this.controls?.target ?? new THREE.Vector3()) * this.origin.kmPerUnit;
      const { width, height } = plotSize(this.dom, this.camera.aspect);
      const safe = safePlotRect(width, height, ctx.plotInsets);
      for (let i = 0; i < replay.packets.length; i++) {
        const n = plan.perPacket[i];
        if (n === 0) continue;
        const p = replay.packets[i];
        const off = this.cache.offsets(p.seed, n);
        const c = this.origin.point(frame.packetPos.subarray(i * 3, i * 3 + 3), this.v);
        const phase = frame.packetPhase[i] as DrivePhase;
        const size = phase === DrivePhase.Terminal ? 3.4 : phase === DrivePhase.Coast ? 2.8 : 2.2;
        const radiusPx = Math.min(80, safe.width * 0.22, safe.height * 0.22, Math.max(8, Math.sqrt(n) * size * 0.55));
        const depthKm = Math.abs(c.clone().applyMatrix4(this.camera.matrixWorldInverse).z) * this.origin.kmPerUnit;
        const screenSpreadKm = radiusPx * depthKm * 2 * Math.tan(this.camera.fov * Math.PI / 360) / (height * this.camera.zoom);
        const spread = Math.max(displaySpreadKm(packetSpreadKm(frame.t - p.tLaunch), viewKm), screenSpreadKm) / this.origin.kmPerUnit;
        const trail = packetTrailAt(p, frame.t, phase, viewKm);
        const tail = this.origin.point(trail.tail, new THREE.Vector3());
        const rgb = rgbOf(this.sideRgb.get(p.side) ?? PALETTE.ink, PHASE_BRIGHTNESS[phase]);
        const trailRgb = rgbOf(this.sideRgb.get(p.side) ?? PALETTE.ink, PHASE_BRIGHTNESS[phase] * 0.55);
        const tailRgb = rgbOf(this.sideRgb.get(p.side) ?? PALETTE.ink, 0.03);
        const headPoint = new THREE.Vector3();
        const tailPoint = new THREE.Vector3();
        const opacity = Math.max(0.3, Math.min(1, 18 / Math.sqrt(n)));
        const shape = phase === DrivePhase.Coast ? SHAPE.ring : phase === DrivePhase.Terminal ? SHAPE.wall : SHAPE.powered;
        for (let k = 0; k < n; k++) {
          const x = off[k * 3] * spread, y = off[k * 3 + 1] * spread, z = off[k * 3 + 2] * spread;
          this.dotCloud.push(c.x + x, c.y + y, c.z + z, rgb, size, shape, opacity);
          if (dotIndex++ % stride === 0 && trail.tailT < frame.t) {
            this.trailLines.seg(headPoint.set(c.x + x, c.y + y, c.z + z), tailPoint.set(tail.x + x, tail.y + y, tail.z + z), trailRgb, tailRgb);
          }
        }
      }
      if (plan.total > 0) {
        const ratio = plan.effectiveRatio === plan.ratio ? `1:${plan.ratio}` : `1:${plan.effectiveRatio} (capped from 1:${plan.ratio})`;
        this.sampling = `Sampling ${ratio}, ${fmtCount(plan.total)} missiles in flight`;
      }
    }
    this.dotCloud.commit();
    this.trailLines.commit();
  }

  private drawFx(ctx: ViewContext, on: boolean): void {
    const t = ctx.frame.t;
    this.beamLines.begin();
    this.flashCloud.begin();
    if (on) {
      const launches = new Set<string>();
      for (const packet of this.replay.packets) {
        if (this.replay.units[packet.fromUnit].theater !== ctx.theater || t < packet.tLaunch || t >= packet.tLaunch + LAUNCH_CUE_S || launches.has(packet.salvoId)) continue;
        launches.add(packet.salvoId);
        const kind = this.launchKinds.get(packet.planId) ?? 'tube';
        const p = this.origin.point(packet.segments[0].p0, new THREE.Vector3());
        const fade = ctx.reducedMotion ? 0.7 : 1 - (t - packet.tLaunch) / LAUNCH_CUE_S;
        this.flashCloud.push(p.x, p.y, p.z, rgbOf(kind === 'tube' ? this.sideRgb.get(packet.side) ?? PALETTE.ink : PALETTE.amber, 1.1), kind === 'tube' ? 8 : 11, kind === 'tube' ? SHAPE.ring : SHAPE.carrier, fade);
      }
      for (let i = firstAtOrAfter(this.beams, t - this.maxBeamDur); i < this.beams.length && this.beams[i].t <= t; i++) {
        const b = this.beams[i];
        const age = t - b.t;
        if (t >= b.t + b.dur || this.beamTheaters.get(b) !== ctx.theater) continue;
        const fade = ctx.reducedMotion ? 0.75 : 0.4 + 0.6 * Math.sin(Math.PI * age / b.dur);
        const a = this.origin.point(b.from, this.v);
        const z = this.origin.point(b.to, this.w);
        if (b.kind === 'laserhead' || b.kind === 'graser' || b.kind === 'laser') {
          this.beamLines.seg(a, z, rgbOf(PALETTE.flash, 1.8 * fade));
          this.flashCloud.push(z.x, z.y, z.z, rgbOf(PALETTE.flash, 1.8), b.kind === 'graser' ? 14 : 9, b.kind === 'laserhead' ? SHAPE.cross : SHAPE.disc, fade);
        } else if (b.kind === 'transit') {
          this.flashCloud.push(z.x, z.y, z.z, rgbOf(PALETTE.violet, 1.8), 22, RING_SHAPE, fade);
        } else {
          this.flashCloud.push(z.x, z.y, z.z, rgbOf(b.kind === 'cm-kill' ? PALETTE.wedge : PALETTE.ink, 1.1), b.kind === 'cm-kill' ? 10 : 7, b.kind === 'cm-kill' ? SHAPE.ring : SHAPE.cross, fade);
        }
      }
    }
    this.beamLines.commit();
    this.flashCloud.commit();
  }

  private drawLinks(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    this.linkLines.begin();
    if (on) {
      const live: number[] = [];
      replay.packets.forEach((p, i) => {
        if (p.guidance === 'apollo' && frame.packetAlive[i] > 0 && replay.units[p.toUnit].theater === ctx.theater) live.push(i);
      });
      const stride = Math.max(1, Math.ceil(live.length / LINK_CAP));
      const rgb = rgbOf(PALETTE.violet, 1);
      for (let k = 0; k < live.length; k += stride) {
        const i = live[k];
        const from = replay.packets[i].fromUnit;
        this.linkLines.seg(
          this.origin.point(frame.packetPos.subarray(i * 3, i * 3 + 3), this.v),
          this.origin.point(frame.unitPos.subarray(from * 3, from * 3 + 3), this.w),
          rgb,
        );
      }
    }
    this.linkLines.commit();
  }

  /** Stress bands and sidewalls at physical size (MTS §3.1, §6.1), nearest ships to the camera target first. */
  private drawWedges(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    this.wedgeLines.begin();
    this.wedgeCount = 0;
    if (on) {
      const target = this.controls?.target ?? new THREE.Vector3();
      const order = this.shipsInView
        .filter((i) => WEDGE_UP.has(frame.shipStatus[i] as ShipStatus))
        .map((i) => ({ i, c: this.origin.point(frame.shipPos.subarray(i * 3, i * 3 + 3), new THREE.Vector3()) }))
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
    const { replay, frame } = ctx;
    this.contactCloud.begin();
    this.contactLines.begin();
    this.notice = null;
    if (on) {
      if (this.tracksTheater !== ctx.theater) {
        this.tracks = replayTrackables(replay, ctx.theater);
        this.tracksTheater = ctx.theater;
        this.pictureKey = '';
      }
      // Quantised to 0.25 s of scenario time: a pure function of t, and cheap during playback.
      const tq = Math.round(frame.t * 4) / 4;
      const key = `${ctx.perceived.side}|${tq}`;
      if (key !== this.pictureKey) {
        this.picture = commanderPicture(replay, this.tracks, ctx.perceived.side, ctx.theater, tq, this.pack.meta.ftl_speed_c.value ?? 1);
        this.pictureKey = key;
      }
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
        const ally = c.side === replay.sides[0].id;
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
      scaleNote: 'Class glyphs have bounded CSS-pixel sizes [S]. Crowded fleet glyphs use a bounded, class-grouped display formation [S]; fleet centers and counts are unchanged. Packet/LAC spread and 0.75 s launch cues are display aids [S], not physical dispersion or ejection timing. Dense packets receive a bounded minimum screen spread [S] for readable sampling. Trails sample solved paths; beam durations are unchanged. Wedges, ranges and uncertainty are to scale.',
      notice: this.notice,
    };
  }

  drawCounts(): DrawCounts {
    return {
      ships: this.shipCloud.drawn, dots: this.dotCloud.drawn, lacDots: this.lacCloud.drawn, contacts: this.contactCloud.drawn,
      fx: this.flashCloud.drawn + this.beamLines.drawn, wedges: this.wedgeCount, links: this.linkLines.drawn,
      trails: this.trailLines.drawn,
    };
  }

  debugPositions(): Float32Array {
    const read = (c: PointCloud) => (c.points.geometry.getAttribute('position').array as Float32Array).subarray(0, c.drawn * 3);
    const a = read(this.shipCloud);
    const b = read(this.dotCloud);
    const out = new Float32Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  }

  debugTrails(): Float32Array {
    return new Float32Array((this.trailLines.lines.geometry.getAttribute('position').array as Float32Array).subarray(0, this.trailLines.drawn * 6));
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

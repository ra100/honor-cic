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
import { DOT_CAP, DotCache, packetSpreadKm, planDensity } from '../density';
import type { LabelSpec } from '../labels';
import { LineBatch } from '../lines';
import { FloatingOrigin } from '../origin';
import { hexToNum, PALETTE, PHASE_BRIGHTNESS, rgbOf, STATUS_BRIGHTNESS } from '../palette';
import { PointCloud } from '../points';
import type { ScaleView, ViewContext, ViewStatus } from './types';

const ROLE_SHAPE = { wall: 1, screen: 2, carrier: 3, lac: 2 } as const;
const RING_SHAPE = 4;
const RECENTER_KM = 50_000;
/** Flashes linger briefly after the event so they read at normal playback speeds (display aid). */
const FX_TAIL_S = 1.5;
const LAC_DOTS_PER_GROUP = 4_000;
const WEDGE_CAP = 300;
const LINK_CAP = 1_024;
const PICK_RADIUS_NDC = 0.04;
const WEDGE_UP = new Set([ShipStatus.Operational, ShipStatus.Degraded, ShipStatus.MissionKill]);

export interface DrawCounts { ships: number; dots: number; lacDots: number; contacts: number; fx: number; wedges: number; links: number }

const ageText = (s: number): string => (s < 60 ? `${s.toFixed(1)} s old` : `${fmtDuration(s)} old`);

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
  private readonly dotCloud = new PointCloud(DOT_CAP, true);
  private readonly contactCloud = new PointCloud(8_192);
  private readonly flashCloud = new PointCloud(8_192, true);
  private readonly beamLines = new LineBatch(8_192, true);
  private readonly wedgeLines = new LineBatch(WEDGE_CAP * 16, false, 0.8);
  private readonly linkLines = new LineBatch(LINK_CAP, false, 0.6);
  private readonly contactLines = new LineBatch(16_384, false, 0.7);
  private readonly cache = new DotCache();
  private readonly beams: BeamEvent[];
  private readonly maxBeamDur: number;
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
  private perceivedOn = false;
  private shipsInView: number[] = [];
  private wedgeCount = 0;
  private specs: LabelSpec[] = [];
  private sampling: string | null = null;
  private notice: string | null = null;

  constructor(private readonly pack: ScenarioPack, private readonly replay: Replay, dom: HTMLElement | null) {
    this.camera.up.set(0, 0, 1);
    this.shipCloud = new PointCloud(Math.max(16, replay.ships.length));
    this.lacCloud = new PointCloud(Math.max(16, replay.units.filter((u) => u.kind === 'lac').length * LAC_DOTS_PER_GROUP));
    this.beams = [...replay.beams].sort((a, b) => a.t - b.t);
    this.maxBeamDur = this.beams.reduce((m, b) => Math.max(m, b.dur), 0);
    this.sideRgb = new Map(replay.sides.map((s) => [s.id, hexToNum(s.color)]));
    this.alive = new Uint32Array(replay.packets.length);
    this.bodies = indexBodies(pack.bodies);
    this.scene.add(
      this.wedgeLines.lines, this.linkLines.lines, this.contactLines.lines, this.beamLines.lines,
      this.lacCloud.points, this.shipCloud.points, this.contactCloud.points, this.dotCloud.points, this.flashCloud.points,
    );
    this.controls = dom ? new OrbitControls(this.camera, dom) : null;
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.zoomSpeed = 1.6;
    }
  }

  update(ctx: ViewContext): void {
    if (this.framedTheater !== ctx.theater) this.frameTheater(ctx);
    this.recenter();
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
    this.controls?.update();
  }

  private frameTheater(ctx: ViewContext): void {
    this.framedTheater = ctx.theater;
    const { frame } = ctx;
    const pts: Vec3[] = [];
    this.replay.units.forEach((u, i) => {
      if (u.theater === ctx.theater && frame.unitCount[i] > 0) pts.push([frame.unitPos[i * 3], frame.unitPos[i * 3 + 1], frame.unitPos[i * 3 + 2]]);
    });
    if (pts.length === 0) {
      const anchor = this.pack.meta.theaters.find((th) => th.id === ctx.theater)?.anchor_body ?? this.pack.meta.frame.origin_body;
      pts.push(bodyPosition(this.bodies, anchor, frame.t));
    }
    const c: Vec3 = [0, 0, 0];
    for (const p of pts) for (let k = 0; k < 3; k++) c[k] += p[k] / pts.length;
    const radius = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])));
    const d = Math.min(5e8, Math.max(20_000, radius * 2.4));
    const el = (30 * Math.PI) / 180;
    const az = (-60 * Math.PI) / 180;
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
  }

  toRender(km: ArrayLike<number>): THREE.Vector3 {
    return this.origin.point(km, new THREE.Vector3());
  }

  private drawShips(ctx: ViewContext, on: boolean, labels: LabelSpec[]): void {
    const { replay, frame } = ctx;
    this.shipCloud.begin();
    this.shipsInView = [];
    if (on) {
      replay.ships.forEach((s, i) => {
        if (replay.units[s.unit].theater !== ctx.theater) return;
        const st = frame.shipStatus[i] as ShipStatus;
        const k = STATUS_BRIGHTNESS[st];
        if (k === 0) return;
        const p = this.origin.point(frame.shipPos.subarray(i * 3, i * 3 + 3), this.v);
        const selected = ctx.selectedShip === i;
        const killed = st === ShipStatus.Destroyed || st === ShipStatus.MissionKill;
        const shape = ctx.layers.damage && killed ? RING_SHAPE : ROLE_SHAPE[s.role];
        const color = selected ? PALETTE.wedge : this.sideRgb.get(s.side) ?? PALETTE.ink;
        this.shipCloud.push(p.x, p.y, p.z, rgbOf(color, selected ? 1.4 : k), selected ? 12 : s.role === 'wall' ? 7 : 5, shape);
        this.shipsInView.push(i);
        if (selected) {
          const cls = ctx.tech.classes[s.classId]?.name ?? s.classId;
          labels.push({ key: `ship:${i}`, cls: 'ship selected', text: s.name, sub: `${cls}, ${STATUS_TEXT[st]}`, pos: p.clone() });
        }
      });
      replay.units.forEach((u, i) => {
        if (u.theater !== ctx.theater || frame.unitCount[i] === 0) return;
        const ally = u.side === replay.sides[0].id;
        labels.push({
          key: `unit:${u.id}`, cls: `fleet ${ally ? 'allied' : 'hostile'}`, text: u.name,
          sub: `${fmtCount(frame.unitCount[i])} ${u.kind === 'lac' ? 'LACs' : 'ships'}`,
          pos: this.origin.point(frame.unitPos.subarray(i * 3, i * 3 + 3)),
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
        const dots = Math.min(LAC_DOTS_PER_GROUP, Math.ceil(n / ctx.density));
        const off = this.cache.offsets(hashSeed('lac', u.id), dots);
        // Packs give LAC counts, not slots, so the swarm spread is a display aid (S).
        const spread = Math.min(30_000, 2_000 * Math.sqrt(n / 100));
        const c = this.origin.point(frame.unitPos.subarray(i * 3, i * 3 + 3), this.v);
        const rgb = rgbOf(this.sideRgb.get(u.side) ?? PALETTE.ink, 0.85);
        for (let k = 0; k < dots; k++) {
          this.lacCloud.push(c.x + off[k * 3] * spread, c.y + off[k * 3 + 1] * spread, c.z + off[k * 3 + 2] * spread, rgb, 3, ROLE_SHAPE.lac);
        }
      });
    }
    this.lacCloud.commit();
  }

  private drawMissiles(ctx: ViewContext, on: boolean): void {
    const { replay, frame } = ctx;
    this.dotCloud.begin();
    this.sampling = null;
    if (on) {
      replay.packets.forEach((p, i) => {
        this.alive[i] = replay.units[p.toUnit].theater === ctx.theater ? frame.packetAlive[i] : 0;
      });
      const plan = planDensity(this.alive, ctx.density);
      for (let i = 0; i < replay.packets.length; i++) {
        const n = plan.perPacket[i];
        if (n === 0) continue;
        const p = replay.packets[i];
        const off = this.cache.offsets(p.seed, n);
        const spread = packetSpreadKm(frame.t - p.tLaunch) / this.origin.kmPerUnit;
        const c = this.origin.point(frame.packetPos.subarray(i * 3, i * 3 + 3), this.v);
        const phase = frame.packetPhase[i] as DrivePhase;
        const rgb = rgbOf(this.sideRgb.get(p.side) ?? PALETTE.ink, PHASE_BRIGHTNESS[phase]);
        const size = phase === DrivePhase.Terminal ? 3.5 : 2.5;
        for (let k = 0; k < n; k++) {
          this.dotCloud.push(c.x + off[k * 3] * spread, c.y + off[k * 3 + 1] * spread, c.z + off[k * 3 + 2] * spread, rgb, size, 0);
        }
      }
      if (plan.total > 0) {
        const ratio = plan.effectiveRatio === plan.ratio ? `1:${plan.ratio}` : `1:${plan.effectiveRatio} (capped from 1:${plan.ratio})`;
        this.sampling = `Sampling ${ratio}, ${fmtCount(plan.total)} missiles in flight`;
      }
    }
    this.dotCloud.commit();
  }

  private drawFx(ctx: ViewContext, on: boolean): void {
    const t = ctx.frame.t;
    this.beamLines.begin();
    this.flashCloud.begin();
    if (on) {
      for (let i = firstAtOrAfter(this.beams, t - this.maxBeamDur - FX_TAIL_S); i < this.beams.length && this.beams[i].t <= t; i++) {
        const b = this.beams[i];
        const age = t - b.t;
        if (age > b.dur + FX_TAIL_S) continue;
        const fade = age <= b.dur ? 1 : 1 - (age - b.dur) / FX_TAIL_S;
        const a = this.origin.point(b.from, this.v);
        const z = this.origin.point(b.to, this.w);
        if (b.kind === 'laserhead' || b.kind === 'graser' || b.kind === 'laser') {
          this.beamLines.seg(a, z, rgbOf(PALETTE.flash, 1.6 * fade));
          this.flashCloud.push(z.x, z.y, z.z, rgbOf(PALETTE.flash, 2 * fade), b.kind === 'graser' ? 14 : 9, 0);
        } else if (b.kind === 'transit') {
          this.flashCloud.push(z.x, z.y, z.z, rgbOf(PALETTE.violet, 2 * fade), 22, RING_SHAPE);
        } else {
          this.flashCloud.push(z.x, z.y, z.z, rgbOf(PALETTE.ink, 1.2 * fade), b.kind === 'cm-kill' ? 6 : 4, 0);
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
    let best: number | null = null;
    let bestD = PICK_RADIUS_NDC;
    for (let k = 0; k < this.shipsInView.length; k++) {
      this.v.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).project(this.camera);
      if (this.v.z > 1) continue;
      const d = Math.hypot(this.v.x - ndcX, this.v.y - ndcY);
      if (d < bestD) {
        bestD = d;
        best = this.shipsInView[k];
      }
    }
    return best;
  }

  status(): ViewStatus {
    return {
      samplingText: this.sampling,
      scaleNote: 'Ship and missile symbols are drawn at a fixed size. Wedges, sidewalls, ranges and uncertainty rings are to scale.',
      notice: this.notice,
    };
  }

  drawCounts(): DrawCounts {
    return {
      ships: this.shipCloud.drawn, dots: this.dotCloud.drawn, lacDots: this.lacCloud.drawn, contacts: this.contactCloud.drawn,
      fx: this.flashCloud.drawn + this.beamLines.drawn, wedges: this.wedgeCount, links: this.linkLines.drawn,
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

  dispose(): void {
    this.controls?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((mat) => mat.dispose());
    });
  }
}

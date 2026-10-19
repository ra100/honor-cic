import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { baseValue } from '../../core/evidence';
import { commanderPicture, replayTrackables, type CommanderPicture } from '../../core/perceived';
import { ShipStatus, unitPosition, unitPresent, type Replay, type UnitTrack } from '../../core/replay';
import type { CelestialBody, ScenarioPack } from '../../core/schema';
import type { Trackable } from '../../core/sensors';
import { orientationAt } from '../../core/solver/geometry';
import { bodyPosition, exclusionsAt, indexBodies, orbitPolyline, type ConeExclusion } from '../../core/solver/orbits';
import { fmtCount, fmtDuration, LM_KM } from '../../core/units';
import { dist, type Vec3 } from '../../core/vec';
import { CourseLayer, FleetCourses } from '../courses';
import { applyPlotInsets, plotDistanceScale, plotSize, safePlotRect, type PlotRect } from '../framing';
import type { LabelSpec } from '../labels';
import { FloatingOrigin } from '../origin';
import { inkOf, PALETTE, rgbOf, sideColor } from '../palette';
import {
  barycentre, fleetShortName, limitText, lmText, LOOK_COLORS, LOOK_MARK, LOOK_MIN_PX, LOOK_RADIUS_KM, planetLook, planetSubtitle,
  resonanceLabel, solarMasses, stableHash, starSubtitle, systemCatalog, terminusSubtitle, type PlanetLook, type SystemCatalog,
} from '../system/catalog';
import { BARS, GLYPH, GlyphCloud } from '../system/glyphs';
import {
  additiveLine, coneMesh, dashedLine, dustPoints, glowMesh, LOOK_KIND, markerPoints, planetMaterial, shellMesh, stationRing, sunMaterial, vortexMesh,
} from '../system/materials';
import { CameraTween, presetPose } from '../system/presets';
import { BASE_FADE, coneFade, coneFrame } from '../system/resonance';
import { ageText } from './engagement-view';
import type { ScaleView, SystemFocus, ViewContext, ViewStatus } from './types';

/** One render unit is one Mkm. */
const KM_PER_UNIT = 1e6;
const SUN_RADIUS_KM = 696_000;
/** Label visibility windows by camera distance in render units (Site A §3.10). */
const RANGE = {
  star: [2, 1e7], planet: [0.02, 9000], junction: [5, 1e7], zone: [600, 1e7], bary: [2500, 1e7], limit: [6, 7000], belt: [6, 9000], fleet: [0, 8000],
} as const;
/** Site A glyph radii in CSS px by role (A §4.5). */
const GLYPH_PX: Record<string, number> = { wall: 6.5, carrier: 6.0, screen: 4.6, lac: 1.8 };
const CALLOUT_PX = 96;

interface StarRig {
  body: CelestialBody; core: THREE.Mesh; glow: THREE.Mesh; shell: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null;
  limit: number; pos: Vec3; sub: string; limitText: string | null;
}
interface PlanetRig {
  body: CelestialBody; look: PlanetLook; star: string; mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  ring: THREE.Mesh | null; radius: number; floorPx: number; sub: string;
}
interface ConeRig { e: ConeExclusion; mesh: THREE.Mesh<THREE.ConeGeometry, THREE.ShaderMaterial>; rim: THREE.Line; label: { text: string; sub: string } | null }
interface CalloutReq { spec: LabelSpec; anchor: THREE.Vector3; width: number }

/** Star tint from mass: Site A's G0 V white for the heavier primary, its warmer companion tint below a solar mass. */
function starTint(b: CelestialBody): [number, number, number] {
  const m = solarMasses(b);
  const k = m === null ? 1 : Math.max(0, Math.min(1, (m - 0.9) / 0.22));
  return [1.0, 0.886 + (0.945 - 0.886) * k, 0.69 + (0.875 - 0.69) * k];
}

export class SystemView implements ScaleView {
  readonly id = 'system' as const;
  readonly kmPerUnit = KM_PER_UNIT;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5e6);
  readonly controls: OrbitControls | null;
  private readonly origin = new FloatingOrigin(KM_PER_UNIT);
  private readonly index;
  private readonly cat: SystemCatalog;
  /** Everything Site A's "system" layer toggles; star cores and glows stay on (A §3.11). */
  private readonly celestial = new THREE.Group();
  private readonly px = { value: 1000 };
  private readonly rtime = { value: 0 };
  private readonly stars: StarRig[] = [];
  private readonly planets: PlanetRig[] = [];
  private cone: ConeRig | null = null;
  private markers: THREE.Points | null = null;
  private markerBodies: CelestialBody[] = [];
  private readonly glyphs = new GlyphCloud(8192);
  private readonly courseLines = new CourseLayer(32_768, KM_PER_UNIT);
  private readonly courses: FleetCourses;
  /** Ship index and render-space position of every drawn hull glyph, for picking. */
  private readonly glyphShip = new Int32Array(8192);
  private readonly glyphPos = new Float32Array(8192 * 3);
  private glyphCount = 0;
  private specs: LabelSpec[] = [];
  private framed = false;
  private posePending = false;
  private followed = false;
  private plotScale = 1;
  private readonly look = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  /** Screen boxes already claimed this frame by callouts and the star and station-world labels. */
  private busy: PlotRect[] = [];
  private focus: SystemFocus | null = null;
  private tween: { motion: CameraTween; start: number } | null = null;
  private tracks: Trackable[] = [];
  private tracksTheater: string | null = null;
  private picture: CommanderPicture = { observer: null, contacts: [] };
  private pictureKey = '';
  private notice: string | null = null;
  private readonly stopTween = () => { this.tween = null; };

  constructor(private readonly pack: ScenarioPack, private readonly replay: Replay, private readonly dom: HTMLElement | null) {
    this.index = indexBodies(pack.bodies);
    this.cat = systemCatalog(pack);
    this.camera.up.set(0, 0, 1);
    this.courses = new FleetCourses(pack.bodies, replay);
    this.scene.add(this.celestial, this.glyphs.points, this.courseLines.lines.lines);
    this.controls = dom ? new OrbitControls(this.camera, dom) : null;
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.addEventListener('start', this.stopTween);
    }
    this.buildStars();
    this.buildOrbits();
    this.buildBinary();
    this.buildPlanets();
    this.buildTerminus();
    this.buildMarkers();
  }

  private u(km: Vec3): THREE.Vector3 {
    return this.origin.point(km);
  }

  /* ---------- static scene ---------- */

  private buildStars(): void {
    for (const b of this.cat.stars) {
      const pos = bodyPosition(this.index, b.id, 0);
      const r = (baseValue(b.radius) ?? SUN_RADIUS_KM * Math.pow(solarMasses(b) ?? 1, 0.8)) / KM_PER_UNIT;
      const col = starTint(b);
      const core = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), sunMaterial(col, this.rtime));
      core.scale.setScalar(r);
      core.position.copy(this.u(pos));
      const glow = glowMesh({ col: [col[0], col[1] * 0.95, col[2] * 0.85], sizeUnits: r * 16, minPx: 26, intensity: 2.2, streak: 0.5 }, this.px);
      glow.position.copy(core.position);
      this.scene.add(core, glow);
      const limitKm = baseValue(b.hyper_limit);
      let shell: StarRig['shell'] = null;
      if (limitKm !== null) {
        shell = shellMesh();
        shell.scale.setScalar(limitKm / KM_PER_UNIT);
        shell.position.copy(core.position);
        this.celestial.add(shell);
      }
      this.stars.push({ body: b, core, glow, shell, limit: (limitKm ?? 0) / KM_PER_UNIT, pos, sub: starSubtitle(b, this.index), limitText: limitText(b) });
    }
  }

  /** Site A orbits: native 1 px additive circles, dark by colour, vertices relative to the parent (A §3.5). */
  private buildOrbits(): void {
    for (const b of this.pack.bodies) {
      if (!b.orbit || !b.parent_id || b.kind === 'belt') continue;
      const parent = bodyPosition(this.index, b.parent_id, 0);
      const pts = orbitPolyline(this.index, b.id, 0, 360).map((p) => new THREE.Vector3((p[0] - parent[0]) / KM_PER_UNIT, (p[1] - parent[1]) / KM_PER_UNIT, (p[2] - parent[2]) / KM_PER_UNIT));
      const line = additiveLine(pts, [0.07, 0.13, 0.22], true);
      line.position.copy(this.u(parent));
      this.celestial.add(line);
    }
    // Belts as Site A dust: faint additive points, radius jitter from two uniforms (A §3.6).
    let seed = 3;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (const b of this.cat.belts) {
      const r = baseValue(b.orbit?.radius);
      if (r === null || !b.parent_id) continue;
      const ru = r / KM_PER_UNIT, w = ru * 0.1;
      const pos: number[] = [], col: number[] = [];
      for (let i = 0; i < 2600; i++) {
        const a = rnd() * Math.PI * 2, rr = ru + (rnd() + rnd() - 1) * w;
        pos.push(Math.cos(a) * rr, Math.sin(a) * rr, (rnd() - 0.5) * w * 0.15);
        const k = 0.06 + rnd() * 0.08;
        col.push(k * 1.1, k, k * 0.85, 1.1 + rnd());
      }
      const dust = dustPoints(pos, col);
      dust.position.copy(this.u(bodyPosition(this.index, b.parent_id, 0)));
      this.celestial.add(dust);
    }
  }

  /** The golden binary orbits about the barycentre (A §3.6) and Site B's dashed A–B axis (B §2.7), when the masses allow. */
  private buildBinary(): void {
    const a = this.cat.origin, b = this.cat.companion;
    if (!b) return;
    const pa = bodyPosition(this.index, a.id, 0), pb = bodyPosition(this.index, b.id, 0);
    this.celestial.add(dashedLine([this.u(pa), this.u(pb)], 0x687e8b, 0.25, 12, 9.6));
    const bary = barycentre(a, b, this.index, 0);
    if (!bary) return;
    for (const r of [dist(pa, bary), dist(pb, bary)]) {
      const ru = r / KM_PER_UNIT;
      const pts = Array.from({ length: 720 }, (_, i) => new THREE.Vector3(Math.cos((i / 720) * Math.PI * 2) * ru, Math.sin((i / 720) * Math.PI * 2) * ru, 0));
      const ring = additiveLine(pts, [0.1, 0.09, 0.05], true);
      ring.position.copy(this.u(bary));
      this.celestial.add(ring);
    }
  }

  private buildPlanets(): void {
    this.cat.planets.forEach((b, i) => {
      const parent = b.parent_id ? this.index.get(b.parent_id) : undefined;
      const parentLimit = parent ? baseValue(parent.hyper_limit) : null;
      const look = planetLook(b, parentLimit);
      const radius = (baseValue(b.radius) ?? LOOK_RADIUS_KM[look]) / KM_PER_UNIT;
      const palette = LOOK_COLORS[look];
      const h = stableHash(b.id);
      const floorPx = LOOK_MIN_PX[look];
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), planetMaterial(palette[h % palette.length], LOOK_KIND[look], (h % 997) / 997 * 70, this.px, floorPx));
      mesh.scale.setScalar(radius);
      // The shaders band along object Y: stand that axis up on the ecliptic with a small per-planet tilt.
      mesh.rotation.set(Math.PI / 2 + 0.25 + i * 0.07, 0, 0);
      this.celestial.add(mesh);
      let ring: THREE.Mesh | null = null;
      if (this.cat.stations.some((s) => s.parent_id === b.id)) {
        ring = stationRing(this.px, floorPx);
        ring.scale.setScalar(radius);
        ring.rotation.set(0.32, 0, 0.4);
        this.celestial.add(ring);
      }
      let star = parent;
      while (star && star.kind !== 'star') star = star.parent_id ? this.index.get(star.parent_id) : undefined;
      this.planets.push({ body: b, look, star: star?.id ?? this.cat.origin.id, mesh, ring, radius, floorPx, sub: planetSubtitle(b, this.index) });
    });
  }

  /** The terminus vortex and glow (A §3.7) and the resonance zone cone with its dashed axis (A §3.8, B §2.8-2.9). */
  private buildTerminus(): void {
    for (const j of this.cat.termini) {
      const pj = bodyPosition(this.index, j.id, 0);
      const toward = j.resonance_zone?.star ?? j.parent_id ?? this.cat.origin.id;
      const ps = this.index.has(toward) ? bodyPosition(this.index, toward, 0) : [0, 0, 0] as Vec3;
      // Site A sized the vortex 9 Mkm and its glow 14 Mkm for a terminus it never visited; here both scale with the
      // pack's terminus radius (about half a light-second), so a close look shows the vortex rather than a violet wash.
      const r = (baseValue(j.radius) ?? 150_000) / KM_PER_UNIT;
      const disc = vortexMesh(this.rtime);
      disc.scale.setScalar(r * 12);
      disc.position.copy(this.u(pj));
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.u(ps).sub(this.u(pj)).normalize());
      const glow = glowMesh({ col: [0.55, 0.4, 1.0], sizeUnits: r * 10, minPx: 16, intensity: 1.2, streak: 0.25 }, this.px);
      glow.position.copy(disc.position);
      this.celestial.add(disc, glow);
      // The terminus's own exclusion bound, as the solver enforces it.
      const ex = baseValue(j.exclusion);
      if (ex !== null) {
        const r = ex / KM_PER_UNIT;
        const ring = dashedLine(Array.from({ length: 97 }, (_, i) => new THREE.Vector3(Math.cos((i / 96) * Math.PI * 2) * r, Math.sin((i / 96) * Math.PI * 2) * r, 0)), PALETTE.amber, 0.55, r * 0.12, r * 0.08);
        ring.position.copy(disc.position);
        this.celestial.add(ring);
      }
    }
    const e = exclusionsAt(this.index, 0).find((x): x is ConeExclusion => x.kind === 'resonance-zone');
    if (!e) return;
    const f = coneFrame(e);
    const mesh = coneMesh(f.baseRadius / KM_PER_UNIT, f.height / KM_PER_UNIT, (BASE_FADE * f.baseRadius) / KM_PER_UNIT);
    mesh.position.copy(this.u(f.centre));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...f.axis));
    // The base rim marks where the zone ends: a great circle of the star's hyper sphere, square to the axis.
    const a = new THREE.Vector3(...f.axis);
    const side = new THREE.Vector3(0, 0, 1).cross(a);
    if (side.lengthSq() < 1e-9) side.set(1, 0, 0);
    side.normalize();
    const up = a.clone().cross(side).normalize();
    const r = e.radius / KM_PER_UNIT;
    const rim = additiveLine(Array.from({ length: 256 }, (_, i) => {
      const t = (i / 256) * Math.PI * 2;
      return side.clone().multiplyScalar(Math.cos(t) * r).addScaledVector(up, Math.sin(t) * r);
    }), [0.45, 0.25, 0.85], true);
    rim.position.copy(this.u(e.base));
    rim.renderOrder = 1;
    this.celestial.add(mesh, rim);
    this.celestial.add(dashedLine([this.u(e.apex), this.u(e.base)], 0xb08aff, 0.22, 12, 9.6));
    const terminus = this.index.get(e.body);
    this.cone = { e, mesh, rim, label: terminus ? resonanceLabel(terminus) : null };
  }

  /** Site A markers: the terminus dot and thin rings round planets that sit at their pixel floor (A §3.4). */
  private buildMarkers(): void {
    const pos: number[] = [], col: number[] = [], rad: number[] = [], floor: number[] = [];
    this.markerBodies = [];
    for (const p of this.planets) {
      pos.push(0, 0, 0);
      // A faint Site A ring round each sphere at its pixel floor; station worlds wear their torus instead.
      col.push(...LOOK_MARK[p.look].map((c) => (p.ring ? 0 : c * 0.4)), 2 * p.floorPx + 9);
      rad.push(p.radius);
      floor.push(p.floorPx);
      this.markerBodies.push(p.body);
    }
    const ring = markerPoints(pos, col, rad, floor, this.px, 0);
    this.celestial.add(ring);
    this.markers = ring;
    if (!this.cat.termini.length) return;
    const tp = this.cat.termini.flatMap((j) => this.u(bodyPosition(this.index, j.id, 0)).toArray());
    const zeros = this.cat.termini.map(() => 0);
    this.celestial.add(markerPoints(tp, this.cat.termini.flatMap(() => [0.65, 0.45, 1.0, 7]), zeros, zeros, this.px, 1));
  }

  /* ---------- camera ---------- */

  private fleetPositions(t: number): Vec3[] {
    const out: Vec3[] = [];
    this.replay.units.forEach((u) => { if (u.kind === 'fleet' && unitPresent(u, t)) out.push(unitPosition(u, t)); });
    return out;
  }

  private preset(focus: SystemFocus, t: number): { eye: Vec3; target: Vec3 } {
    return presetPose(focus, { index: this.index, catalog: this.cat, t, fleets: this.fleetPositions(t), fovDeg: this.camera.fov });
  }

  private startTween(focus: SystemFocus, t: number, scale: number, reduced: boolean): void {
    const p = this.preset(focus, t);
    const target = this.u(p.target);
    const eye = this.u(p.eye).sub(target).multiplyScalar(scale).add(target);
    const from = this.controls?.target ?? this.look;
    if (reduced) {
      this.place(eye, target);
      this.tween = null;
      return;
    }
    this.tween = {
      motion: new CameraTween({ eye: this.camera.position.toArray(), target: from.toArray() }, { eye: eye.toArray(), target: target.toArray() }),
      start: performance.now(),
    };
  }

  private place(eye: THREE.Vector3, target: THREE.Vector3): void {
    this.camera.position.copy(eye);
    this.look.copy(target);
    this.camera.lookAt(target);
    this.controls?.target.copy(target);
  }

  /** Near and far follow the viewing distance, as Site A does (A §1.6). */
  private fitClip(): void {
    const focus = this.camera.position.distanceTo(this.controls?.target ?? this.look);
    const near = Math.min(4, Math.max(2e-4, focus * 0.0015));
    const far = Math.max(2e5, focus * 20);
    if (this.camera.near !== near || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  /* ---------- per frame ---------- */

  update(ctx: ViewContext): void {
    const t = ctx.frame.t;
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    applyPlotInsets(this.camera, width, height, ctx.plotInsets);
    const scale = plotDistanceScale(this.camera, width, height, ctx.plotInsets);
    this.px.value = height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.rtime.value = (performance.now() / 1000) % 3600;
    const externalPose = this.posePending;
    if (externalPose) this.tween = null;
    if (this.focus !== null && ctx.systemFocus !== this.focus && !externalPose && this.framed) this.startTween(ctx.systemFocus, t, scale, ctx.reducedMotion);
    this.focus = ctx.systemFocus;
    if (!this.framed && !externalPose) {
      const p = this.preset(ctx.systemFocus, t);
      this.setPose(p.eye, p.target);
    }
    if (externalPose || !this.framed) {
      const target = this.controls?.target ?? this.look;
      this.camera.position.sub(target).multiplyScalar(scale).add(target);
    } else if (this.tween) {
      const pose = this.tween.motion.at((performance.now() - this.tween.start) / 1000);
      const target = new THREE.Vector3(...pose.target);
      const eye = new THREE.Vector3(...pose.eye);
      if (this.followed) {
        // Follow owns the look-at point; the preset only sets the angle and distance.
        const held = (this.controls?.target ?? this.look).clone();
        eye.sub(target).add(held);
        target.copy(held);
      }
      this.place(eye, target);
      if (pose.done) this.tween = null;
    } else if (scale !== this.plotScale) {
      const target = this.controls?.target ?? this.look;
      this.camera.position.sub(target).multiplyScalar(scale / this.plotScale).add(target);
    }
    this.framed = true;
    this.posePending = false;
    this.followed = false;
    this.plotScale = scale;
    if (this.controls) this.controls.enableDamping = !ctx.reducedMotion;
    this.controls?.update();
    this.fitClip();
    this.camera.updateMatrixWorld();

    const eye = this.camera.position;
    this.celestial.visible = ctx.layers.celestial;
    const specs: LabelSpec[] = [];
    const callouts: CalloutReq[] = [];
    this.notice = null;
    this.glyphs.begin();
    this.glyphCount = 0;
    if (ctx.layers.truth && !ctx.perceived.enabled) this.drawFleets(ctx, callouts);
    if (ctx.perceived.enabled || ctx.layers.commander) this.drawContacts(ctx, callouts);
    this.glyphs.commit();
    this.drawCourses(ctx, ctx.layers.truth && !ctx.perceived.enabled && ctx.layers.courses, specs, width, height);
    this.busy = this.layoutCallouts(callouts, width, height, ctx, specs);

    for (const s of this.stars) {
      const p = this.u(s.pos);
      // Site A: 0.42 × smoothstep(60, 420 Mkm) from the shell's surface, i.e. 0.15 to 1.06 limit radii.
      if (s.shell) s.shell.material.uniforms.uA.value = 0.42 * THREE.MathUtils.smoothstep(Math.abs(eye.distanceTo(p) - s.limit), 0.15 * s.limit, 1.06 * s.limit);
      if (this.inRange(p, RANGE.star)) specs.push({ key: `body:${s.body.id}`, cls: 'star', text: s.body.name, sub: s.sub, pos: p });
    }
    if (ctx.layers.celestial) this.updateCelestial(ctx, specs);
    this.specs = specs;
  }

  private toScreen(p: THREE.Vector3, width: number, height: number): [number, number] | null {
    const v = this.scratch.copy(p).project(this.camera);
    return v.z < -1 || v.z > 1 ? null : [(v.x + 1) / 2 * width, (1 - v.y) / 2 * height];
  }

  private inRange(p: THREE.Vector3, range: readonly [number, number]): boolean {
    const d = this.camera.position.distanceTo(p);
    return d >= range[0] && d <= range[1];
  }

  private updateCelestial(ctx: ViewContext, specs: LabelSpec[]): void {
    const t = ctx.frame.t;
    const view = this.camera.matrixWorldInverse;
    const markerPos = this.markers?.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const markerCol = this.markers?.geometry.getAttribute('aC') as THREE.BufferAttribute | undefined;
    const planetSpecs: LabelSpec[] = [];
    this.planets.forEach((p, i) => {
      const pos = this.u(bodyPosition(this.index, p.body.id, t));
      p.mesh.position.copy(pos);
      p.mesh.rotation.y = t * 0.00015 * (i % 2 ? 1 : -1);
      if (p.ring) p.ring.position.copy(pos);
      const star = this.u(bodyPosition(this.index, p.star, t));
      // Planets fold into their star once the orbit spans only a few dozen pixels, so strategic views stay clean.
      const orbitPx = star.distanceTo(pos) * this.px.value / Math.max(1e-9, this.camera.position.distanceTo(pos));
      const k = THREE.MathUtils.smoothstep(orbitPx, 24, 60);
      p.mesh.visible = k > 0.01;
      if (p.ring) p.ring.visible = k > 0.01;
      p.mesh.material.uniforms.uMinPx.value = p.floorPx * (0.3 + 0.7 * k);
      if (p.ring) (p.ring.material as THREE.ShaderMaterial).uniforms.uMinPx.value = p.floorPx * (0.3 + 0.7 * k);
      (p.mesh.material.uniforms.uLightV.value as THREE.Vector3).copy(star.sub(pos)).transformDirection(view);
      markerPos?.setXYZ(i, pos.x, pos.y, pos.z);
      markerCol?.setW(i, k > 0.01 ? (2 * p.floorPx + 9) * (0.3 + 0.7 * k) : 0);
      if (k > 0.5 && this.inRange(pos, RANGE.planet)) {
        (p.ring ? specs : planetSpecs).push({ key: `body:${p.body.id}`, cls: 'planet', text: p.body.name, sub: p.sub, pos });
      }
    });
    if (markerPos) markerPos.needsUpdate = true;
    if (markerCol) markerCol.needsUpdate = true;

    for (const j of this.cat.termini) {
      const pos = this.u(bodyPosition(this.index, j.id, t));
      if (this.inRange(pos, RANGE.junction)) specs.push({ key: `body:${j.id}`, cls: 'junction', text: j.name, sub: terminusSubtitle(j, this.cat.origin, this.index), pos });
    }

    let zoneFade = 0;
    if (this.cone) {
      const { e, mesh, rim } = this.cone;
      const o = this.origin.origin, c = this.camera.position;
      zoneFade = coneFade([o[0] + this.origin.km(c.x), o[1] + this.origin.km(c.y), o[2] + this.origin.km(c.z)], e);
      mesh.material.uniforms.uA.value = zoneFade;
      (rim.material as THREE.LineBasicMaterial).color.setRGB(0.45 * 0.35 * zoneFade, 0.25 * 0.35 * zoneFade, 0.85 * 0.35 * zoneFade);
    }

    // Site A's priorities: planets before the hyper-limit labels, those before the resonance zone. The layer places
    // labels right of their point first, so each of these picks the anchor whose right-hand box is still clear.
    specs.push(...planetSpecs);
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    const safe = safePlotRect(width, height, ctx.plotInsets);
    const taken = [...this.busy, ...(ctx.obstacles ?? [])];
    for (const sp of specs) {
      const q = sp.offset ? null : this.toScreen(sp.pos, width, height);
      if (q) taken.push({ x: q[0], y: q[1] - 9, width: Math.max(sp.text.length * 8.5, (sp.sub?.length ?? 0) * 5.6) + 24, height: sp.sub ? 32 : 18 });
    }
    const fits = (q: [number, number] | null, w: number, h: number, against: PlotRect[]): PlotRect | null => {
      if (!q) return null;
      const box = { x: q[0] + 4, y: q[1] - h / 2 - 2, width: w + 10, height: h + 4 };
      if (box.x < safe.x || box.y < safe.y || box.x + box.width > safe.x + safe.width || box.y + box.height > safe.y + safe.height) return null;
      return against.some((o) => box.x < o.x + o.width && o.x < box.x + box.width && box.y < o.y + o.height && o.y < box.y + box.height) ? null : box;
    };
    // Hyper limits ride the equator on the camera's side (A §3.10); crowded fronts fall back to the first bearing clear
    // of the callouts and leave the rest to the label layer.
    for (const s of this.stars) {
      const text = s.shell ? s.limitText : null;
      if (!text) continue;
      const c = this.u(s.pos);
      const facing = Math.atan2(this.camera.position.y - c.y, this.camera.position.x - c.x);
      const w = text.length * 6.2 + 8;
      let chosen: THREE.Vector3 | null = null, fallback: THREE.Vector3 | null = null;
      for (let i = 0; i < 11; i++) {
        const da = 0.35 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.3;
        const pos = new THREE.Vector3(c.x + Math.cos(facing + da) * s.limit, c.y + Math.sin(facing + da) * s.limit, c.z);
        if (!this.inRange(pos, RANGE.limit)) continue;
        const q = this.toScreen(pos, width, height);
        if (!fallback && fits(q, w, 14, this.busy)) fallback = pos;
        const box = fits(q, w, 14, taken);
        if (box) { chosen = pos; taken.push(box); break; }
      }
      const pos = chosen ?? fallback;
      if (pos) specs.push({ key: `limit:${s.body.id}`, cls: 'ring limit', text, pos });
    }
    // The zone's label rides the cone as far from the star as the plot allows, as Site A's sits out on the cylinder:
    // on the axis, else across the band toward either wall.
    if (this.cone?.label && zoneFade > 0.02) {
      const { e, label } = this.cone;
      const base = this.u(e.base), apex = this.u(e.apex);
      const axis = apex.clone().sub(base).normalize();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const across = up.sub(axis.clone().multiplyScalar(up.dot(axis))).normalize();
      const radius = e.radius / KM_PER_UNIT;
      const w = Math.max(label.text.length * 8.5, label.sub.length * 5.6) + 8;
      let chosen: THREE.Vector3 | null = null;
      search: for (let i = 0; i <= 30; i++) {
        const k = 0.6 * Math.pow(0.05 / 0.6, i / 30);
        for (const f of [0, 0.45, -0.45, 0.75, -0.75]) {
          const pos = base.clone().lerp(apex, k).addScaledVector(across, f * radius * (1 - k));
          if (!this.inRange(pos, RANGE.zone)) continue;
          const box = fits(this.toScreen(pos, width, height), w, 30, taken);
          if (box) { chosen = pos; taken.push(box); break search; }
        }
      }
      if (chosen) specs.push({ key: `zone:${e.body}`, cls: 'junction', text: label.text, sub: label.sub, pos: chosen });
    }

    for (const b of this.cat.belts) {
      const r = baseValue(b.orbit?.radius);
      if (r === null || !b.parent_id) continue;
      const c = this.u(bodyPosition(this.index, b.parent_id, t));
      const a = Math.atan2(this.camera.position.y - c.y, this.camera.position.x - c.x) - 0.6;
      const pos = new THREE.Vector3(c.x + Math.cos(a) * r / KM_PER_UNIT, c.y + Math.sin(a) * r / KM_PER_UNIT, c.z);
      if (this.inRange(pos, RANGE.belt)) specs.push({ key: `belt:${b.id}`, cls: 'ring', text: `${b.name} · ${lmText(r)}`, pos });
    }

    const companion = this.cat.companion;
    const bary = companion ? barycentre(this.cat.origin, companion, this.index, t) : null;
    if (companion && bary) {
      // Site A anchors it at the barycentre; dropped toward the viewer's foot of the orbit it clears the star labels.
      const centre = this.u(bary);
      const r = dist(bary, bodyPosition(this.index, this.cat.origin.id, t)) / KM_PER_UNIT;
      const toEye = Math.atan2(this.camera.position.y - centre.y, this.camera.position.x - centre.x);
      const pos = new THREE.Vector3(centre.x + Math.cos(toEye) * r * 0.55, centre.y + Math.sin(toEye) * r * 0.55, centre.z);
      const da = dist(bary, bodyPosition(this.index, this.cat.origin.id, t)), db = dist(bary, bodyPosition(this.index, companion.id, t));
      const whole = (km: number) => `${Math.round(km / LM_KM)} LM`;
      if (this.inRange(pos, RANGE.bary)) specs.push({ key: 'barycentre', cls: 'ring', text: `Barycentre · ${whole(da)} from ${this.cat.origin.name}, ${whole(db)} from ${companion.name}`, pos });
    }
  }

  /** Ground-truth fleets: Site A ship glyphs per hull, Site B callouts per fleet; fleets still to arrive are dimmed. */
  private drawFleets(ctx: ViewContext, callouts: CalloutReq[]): void {
    const t = ctx.frame.t;
    const tmp = new THREE.Vector3();
    for (const u of this.replay.units) {
      const present = unitPresent(u, t) && ctx.frame.unitCount[u.idx] > 0;
      const upcoming = !present && u.kind === 'fleet' && t < u.tAppear && u.appearVia !== null;
      if (!present && !upcoming) continue;
      const ally = u.side === ctx.focusSide;
      const rgb = rgbOf(sideColor(this.replay, u.side), 1);
      const anchorKm = present ? Array.from(ctx.frame.unitPos.subarray(u.idx * 3, u.idx * 3 + 3)) as Vec3 : unitPosition(u, u.tAppear);
      const anchor = this.u(anchorKm);
      const depth = this.camera.position.distanceTo(anchor);
      const shrink = 1 + (0.62 - 1) * THREE.MathUtils.smoothstep(depth, 10, 90);
      if (u.kind === 'lac') {
        const fade = 1 - THREE.MathUtils.smoothstep(depth, 2.5, 9);
        if (fade > 0.01) this.glyphs.push(anchor, rgb, [1, 0, 0], [0, 0, 1], GLYPH_PX.lac * 1.6, GLYPH.lac, 0.85 * fade, BARS.none);
        continue;
      }
      const basis = orientationAt(u.facing, u.up, u.rolls, present ? t : u.tAppear);
      const bars = ally ? BARS.allied : BARS.hostile;
      if (present) {
        for (const s of u.shipIdx) {
          const status = ctx.frame.shipStatus[s];
          if (status === ShipStatus.Absent || status === ShipStatus.Escaped || status === ShipStatus.Destroyed) continue;
          const ship = this.replay.ships[s];
          this.origin.point(ctx.frame.shipPos.subarray(s * 3, s * 3 + 3), tmp);
          this.glyphs.push(tmp, rgb, basis.f, basis.u, (GLYPH_PX[ship.role] ?? 4.6) * shrink, GLYPH[ship.role === 'carrier' ? 'carrier' : ship.role === 'screen' ? 'screen' : 'wall'], status === ShipStatus.MissionKill ? 0.55 : 0.95, bars);
          if (this.glyphCount < this.glyphShip.length) {
            this.glyphShip[this.glyphCount] = s;
            this.glyphPos.set([tmp.x, tmp.y, tmp.z], this.glyphCount++ * 3);
          }
        }
      } else {
        this.glyphs.push(anchor, rgb, basis.f, basis.u, GLYPH_PX.wall * shrink, GLYPH.wall, 0.4, bars);
      }
      if (!this.inRange(anchor, RANGE.fleet)) continue;
      callouts.push({ spec: this.fleetSpec(u, ally, present, ctx), anchor, width: 0 });
    }
  }

  /** Projected courses of every fleet under way: dotted path, turnover, arrival and uncertainty cone. */
  private drawCourses(ctx: ViewContext, on: boolean, specs: LabelSpec[], width: number, height: number): void {
    this.courseLines.begin();
    if (on) {
      for (const { unit, plot } of this.courses.at(ctx.frame.t, 'all', (u) => ctx.frame.unitCount[u.idx] > 0)) {
        this.courseLines.draw(unit.id, plot, { rgb: rgbOf(sideColor(this.replay, unit.side), 0.85), ink: inkOf(sideColor(this.replay, unit.side), unit.side === ctx.focusSide, 0.9) },
          (km) => this.u(km), this.camera, width, height, specs);
      }
    }
    this.courseLines.commit();
  }

  /** Projected courses drawn this frame. */
  courseCount(): number {
    return this.courseLines.drawn;
  }

  private fleetSpec(u: UnitTrack, ally: boolean, present: boolean, ctx: ViewContext): LabelSpec {
    const n = present ? ctx.frame.unitCount[u.idx] : u.shipIdx.length;
    const def = this.pack.units.find((x) => x.id === u.id);
    const flagship = def?.kind === 'fleet' ? def.flagship_name?.value ?? null : null;
    const count = `${fmtCount(n)} ship${n === 1 ? '' : 's'}`;
    const sub = present ? (flagship ? `${flagship} · ${count}` : count) : `arrives T+${fmtDuration(u.tAppear)}`;
    const color = inkOf(sideColor(this.replay, u.side), ally, 1);
    return { key: `unit:${u.id}`, cls: `fleet ${ally ? 'allied' : 'hostile'}${present ? '' : ' pending'}`, text: fleetShortName(u.name), sub, pos: new THREE.Vector3(), color };
  }

  /** Fleets as one commander knows them: delayed by light or the FTL sensor preset (MTS §7); packets are left to the engagement view. */
  private drawContacts(ctx: ViewContext, callouts: CalloutReq[]): void {
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
      const p = this.u(c.observed);
      const ally = c.side === ctx.focusSide;
      const rgb = c.identity === 'unknown' ? rgbOf(0x8199b0, 1) : rgbOf(sideColor(this.replay, c.side), 1);
      this.glyphs.push(p, rgb, [1, 0, 0], [0, 0, 1], 4.2, c.kind === 'fleet' ? GLYPH.contact : GLYPH.lac, ghost ? 0.55 : 0.95, BARS.none);
      callouts.push({
        spec: { key: `contact:${c.id}`, cls: `contact ${ally ? 'allied' : 'hostile'}${ghost ? ' ghost' : ''}`, text: fleetShortName(c.label), sub: `${ageText(c.age)}, ${c.identity}`, pos: p, color: c.identity === 'unknown' ? 'rgba(129, 153, 176, 0.9)' : inkOf(sideColor(this.replay, c.side), ally, ghost ? 0.55 : 1) },
        anchor: p, width: 0,
      });
    }
  }

  /**
   * Site B callouts (B §2.10): a leader of fixed length fanning out from the fleets' common centre on screen, swung in
   * 28° steps, then lengthened, until the box clears the plot edges and everything placed so far. A fleet that finds
   * no room keeps a plain two-line label, which the label layer places or hides.
   */
  private layoutCallouts(reqs: CalloutReq[], width: number, height: number, ctx: ViewContext, specs: LabelSpec[]): PlotRect[] {
    const safe = safePlotRect(width, height, ctx.plotInsets);
    const placed: PlotRect[] = [...(ctx.obstacles ?? []), ...(ctx.layers.celestial ? this.reservedRects(ctx.frame.t, width, height) : [])];
    const v = new THREE.Vector3();
    const screen = reqs.map((r) => {
      v.copy(r.anchor).project(this.camera);
      return { r, on: v.z >= -1 && v.z <= 1, x: (v.x + 1) / 2 * width, y: (1 - v.y) / 2 * height };
    });
    const visible = screen.filter((p) => p.on && p.x >= safe.x && p.x <= safe.x + safe.width && p.y >= safe.y && p.y <= safe.y + safe.height);
    v.copy(this.controls?.target ?? this.look).project(this.camera);
    const tx = (v.x + 1) / 2 * width, ty = (1 - v.y) / 2 * height;
    const cx = visible.length > 1 ? visible.reduce((a, p) => a + p.x, 0) / visible.length : tx;
    const cy = visible.length > 1 ? visible.reduce((a, p) => a + p.y, 0) / visible.length : ty;
    for (const p of screen) {
      if (!visible.includes(p)) {
        specs.push({ ...p.r.spec, pos: p.r.anchor });
        continue;
      }
      const { r, x, y } = p;
      // Generous text metrics: the label layer drops any callout whose real box overlaps one already placed.
      const w = Math.max(r.spec.text.length * 10, (r.spec.sub?.length ?? 0) * 7) + 16, h = r.spec.sub ? 52 : 28;
      let base = Math.atan2(y - cy, x - cx);
      if (Math.hypot(x - cx, y - cy) < 6) base = Math.hypot(x - tx, y - ty) < 6 ? Math.atan2(-0.45, -1) : Math.atan2(y - ty, x - tx);
      let offset: [number, number] | null = null;
      search: for (const length of [CALLOUT_PX, CALLOUT_PX * 1.45, CALLOUT_PX * 1.9]) {
        for (const step of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
          const a = base + step * 0.49;
          const ox = Math.cos(a) * length, oy = Math.sin(a) * length * 0.72;
          const box = { x: x + ox - w / 2, y: y + oy - h / 2, width: w, height: h };
          if (box.x < safe.x || box.y < safe.y || box.x + w > safe.x + safe.width || box.y + h > safe.y + safe.height) continue;
          if (placed.some((o) => box.x < o.x + o.width + 6 && o.x < box.x + box.width + 6 && box.y < o.y + o.height + 6 && o.y < box.y + box.height + 6)) continue;
          placed.push(box);
          offset = [Math.round(ox), Math.round(oy)];
          break search;
        }
      }
      specs.push(offset ? { ...r.spec, pos: r.anchor, offset } : { ...r.spec, pos: r.anchor });
    }
    return placed;
  }

  /** Where the star and station-world labels will sit (right of their point), kept clear of fleet callouts. */
  private reservedRects(t: number, width: number, height: number): PlotRect[] {
    const out: PlotRect[] = [];
    const v = new THREE.Vector3();
    const keep = (pos: THREE.Vector3, text: string, sub: string) => {
      v.copy(pos).project(this.camera);
      if (v.z < -1 || v.z > 1) return;
      const x = (v.x + 1) / 2 * width, y = (1 - v.y) / 2 * height;
      out.push({ x: x - 6, y: y - 14, width: Math.max(text.length * 8, sub.length * 5.8) + 28, height: 36 });
    };
    for (const p of this.planets) if (p.mesh.visible && p.ring) keep(this.u(bodyPosition(this.index, p.body.id, t)), p.body.name, p.sub);
    for (const s of this.stars) keep(this.u(s.pos), s.body.name, s.sub);
    return out;
  }

  followTarget(targetKm: Vec3): void {
    const look = this.controls?.target ?? this.look;
    const offset = this.camera.position.clone().sub(look);
    const target = this.origin.point(targetKm);
    this.camera.position.copy(target).add(offset);
    this.look.copy(target);
    this.camera.lookAt(target);
    this.controls?.target.copy(target);
    this.camera.updateMatrixWorld();
    this.followed = true;
  }

  setPose(eyeKm: Vec3, targetKm: Vec3): void {
    const target = this.origin.point(targetKm);
    this.camera.position.copy(this.origin.point(eyeKm));
    this.look.copy(target);
    this.camera.lookAt(target);
    this.controls?.target.copy(target);
    this.camera.updateMatrixWorld();
    this.posePending = true;
  }

  animating(): boolean {
    return this.tween !== null;
  }

  labels(): LabelSpec[] {
    return this.specs;
  }

  /** The nearest drawn hull within 12 px of the pointer. */
  pick(ndcX: number, ndcY: number): number | null {
    const { width, height } = plotSize(this.dom, this.camera.aspect);
    const v = new THREE.Vector3();
    let best: number | null = null;
    let bestD = 12;
    for (let i = 0; i < this.glyphCount; i++) {
      v.fromArray(this.glyphPos, i * 3).project(this.camera);
      if (v.z < -1 || v.z > 1) continue;
      const d = Math.hypot((v.x - ndcX) * width / 2, (v.y - ndcY) * height / 2);
      if (d < bestD) { bestD = d; best = this.glyphShip[i]; }
    }
    return best;
  }

  status(): ViewStatus {
    return { samplingText: null, scaleNote: 'Stars, planets and ship symbols are enlarged to stay visible. Orbits, hyper limits and the resonance zone are to scale. Projected courses are CIC estimates from each fleet\'s present velocity, thrust and the stars\' gravity [S].', notice: this.notice };
  }

  dispose(): void {
    this.controls?.removeEventListener('start', this.stopTween);
    this.controls?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((mat) => mat.dispose());
    });
  }
}

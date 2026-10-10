import { z } from 'zod';
import { baseFactor } from './units';
import type { Vec3 } from './vec';

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and dashes');
const n0 = z.number().int().nonnegative().default(0);

export const EvidenceZ = z.enum(['P', 'W', 'D', 'S']);
export const UnitZ = z.enum([
  'km', 'Mkm', 'LM', 'm', 'km/s', 'km/s2', 'g', 's', 'min', 'yr',
  't', 'deg', 'count', 'c', 'Msun', 'PD-date', 'text', 'ratio',
]);

const svFields = {
  unit: UnitZ,
  evidence: EvidenceZ,
  source_id: z.string().min(1),
  locator: z.string().optional(),
  era: z.string().optional(),
  uncertainty: z.string().optional(),
  status: z.enum(['verified', 'unverified', 'conflict']).optional(),
};
export const SVNumZ = z.object({ value: z.number().finite().nullable(), ...svFields }).strict();
export const SVStrZ = z.object({ value: z.string().nullable(), ...svFields }).strict();
export const Vec3Z = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const PosZ = z.object({ value: Vec3Z, unit: z.enum(['km', 'Mkm', 'LM']) }).strict();
export const TimeRefZ = z.union([
  z.number().finite(),
  z.object({
    ref: z.string(),
    anchor: z.enum(['launch', 'arrival', 'last_arrival', 't']),
    offset_s: z.number().finite(),
  }).strict(),
]);
export const CountsZ = z.object({
  attack: z.number().int().nonnegative(),
  ew: z.number().int().nonnegative(),
  controller: z.number().int().nonnegative(),
}).strict();

export const ShotZ = z.object({
  id: Id, label: z.string(), desc: z.string(), t0: TimeRefZ, theater: z.string(),
  scale: z.enum(['system', 'engagement']),
  subject: z.array(z.string()).min(1),
  distance_km: z.number().positive(),
  elev_deg: z.number(), azim_deg: z.number(),
  orbit_deg_per_min: z.number().default(0),
}).strict();

export const MetaZ = z.object({
  id: Id,
  title: z.string().min(1),
  alt_titles: z.array(z.string()).default([]),
  date: SVStrZ,
  year_pd: z.number().int(),
  era: z.string().min(1),
  location: z.string().min(1),
  summary: z.string().min(1),
  stub: z.boolean().default(false),
  sides: z.array(z.object({ id: Id, name: z.string(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict()).min(2),
  frame: z.object({ origin_body: z.string(), axes: z.string(), evidence: EvidenceZ }).strict(),
  duration_s: z.number().positive(),
  motion_model: z.literal('narrative-calibrated'),
  ftl_speed_c: SVNumZ,
  phases: z.array(z.object({ id: Id, label: z.string(), t0: TimeRefZ }).strict()).min(1),
  theaters: z.array(z.object({ id: Id, label: z.string(), anchor_body: z.string() }).strict()).min(1),
  shots: z.array(ShotZ).default([]),
  sources: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().url().optional(), kind: EvidenceZ }).strict()).min(1),
}).strict();

export const BodyZ = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(['star', 'planet', 'belt', 'station', 'terminus']),
  designation: z.string().optional(),
  ordinal: z.number().int().positive().optional(),
  parent_id: z.string().nullable(),
  radius: SVNumZ,
  mass: SVNumZ.optional(),
  orbit: z.object({ radius: SVNumZ, phase: SVNumZ, period: SVNumZ, inclination: SVNumZ }).strict().nullable(),
  offset: PosZ.nullable(),
  offset_evidence: EvidenceZ.optional(),
  hyper_limit: SVNumZ.nullable(),
  exclusion: SVNumZ.nullable(),
  /** Terminus only: the roughly conical interference volume toward its star (MTS §2.6). Translation inside it is lethal in the lowest bands. */
  resonance_zone: z.object({ star: z.string(), base_radius: SVNumZ, note: z.string().optional() }).strict().optional(),
  note: z.string().optional(),
}).strict();
const BodiesFileZ = z.object({ bodies: z.array(BodyZ).min(1) }).strict();

export const ShipEntryZ = z.object({
  class_id: z.string(),
  count: z.number().int().positive(),
  names: z.array(z.string()).default([]),
  name_evidence: EvidenceZ.default('S'),
  flagship: z.boolean().default(false),
  equipment: z.array(z.enum(['keyhole', 'keyhole-ii'])).default([]),
  equipment_evidence: EvidenceZ.default('S'),
  hyper_readiness: z.enum(['powered-down', 'routine', 'standby', 'ready']).default('routine'),
  overrides: z.record(SVNumZ).default({}),
  note: z.string().optional(),
}).strict();

const PlaceZ = z.union([
  z.object({ frame: z.string(), position: PosZ }).strict(),
  z.object({ relative_to: z.string(), position: PosZ }).strict(),
]);
const VelZ = z.union([
  z.object({ frame: z.literal('system'), velocity_km_s: Vec3Z }).strict(),
  z.object({ relative_to: z.string(), velocity_km_s: Vec3Z }).strict(),
]);
export const StateZ = z.object({
  t: TimeRefZ, place: PlaceZ, velocity: VelZ, evidence: EvidenceZ, note: z.string().optional(),
}).strict();
const FormationZ = z.object({
  kind: z.enum(['wall', 'globe', 'column', 'swarm']),
  facing: Vec3Z, up: Vec3Z, spacing: SVNumZ,
}).strict();
const PresentZ = z.object({
  from: TimeRefZ.nullable(), from_via: z.enum(['hyper', 'junction', 'launch']).nullable(),
  until: TimeRefZ.nullable(), until_via: z.enum(['hyper', 'junction', 'recovered']).nullable(),
}).strict();
const unitCommon = {
  id: Id, name: z.string(), side: z.string(), theater: z.string(),
  commander: SVStrZ, formation: FormationZ, state: StateZ, present: PresentZ,
  evidence: EvidenceZ, source_id: z.string(), note: z.string().optional(),
};
export const FleetZ = z.object({
  kind: z.literal('fleet'), ...unitCommon,
  flagship_name: SVStrZ,
  ships: z.array(ShipEntryZ).min(1),
  stores: z.object({ pods: SVNumZ, pod_load: z.string() }).strict().nullable(),
}).strict();
export const LacGroupZ = z.object({
  kind: z.literal('lac'), ...unitCommon,
  classes: z.record(z.number().int().nonnegative()),
  class_evidence: EvidenceZ,
}).strict();
export const UnitDefZ = z.discriminatedUnion('kind', [FleetZ, LacGroupZ]);
const ForcesFileZ = z.object({ units: z.array(UnitDefZ).min(1) }).strict();

const evBase = {
  id: Id, t: TimeRefZ, evidence: EvidenceZ, source_id: z.string(),
  note: z.string().optional(), seed: z.number().int().nonnegative(),
};
const ReactsZ = z.object({
  ref: z.string(), anchor: z.enum(['launch', 'arrival', 't']),
  sensor: z.enum(['light', 'grav']), observer: z.string(),
}).strict();
const DirectionZ = z.union([
  z.object({ toward: z.string() }).strict(),
  z.object({ away: z.string() }).strict(),
  z.object({ vector: Vec3Z }).strict(),
]);

export const ManeuverZ = z.object({
  type: z.literal('maneuver'), ...evBase, unit: z.string(), until: TimeRefZ, accel: SVNumZ,
  direction: DirectionZ, reacts_to: ReactsZ.nullable().default(null),
}).strict();
export const RollZ = z.object({
  type: z.literal('roll'), ...evBase, unit: z.string(), angle_deg: z.number(), duration_s: z.number().positive(),
}).strict();
export const FirePlanZ = z.object({
  type: z.literal('fire_plan'), ...evBase,
  engagement: z.string(), from: z.string(), to: z.string(), profile: z.string(),
  salvos: z.number().int().positive(), interval_s: z.number().nonnegative(),
  launch: z.enum(['tube', 'pod', 'tow']),
  pod_load: z.string().nullable(), pods: z.number().int().nonnegative().nullable(),
  totals: CountsZ,
  guidance: z.enum(['shipboard', 'apollo', 'autonomous']),
  packets_per_salvo: z.number().int().positive(),
  arrival_window: z.tuple([z.number(), z.number()]).nullable(),
  canon_intercept_share: SVNumZ.nullable().default(null),
}).strict();
export const BeamAttackZ = z.object({
  type: z.literal('beam_attack'), ...evBase,
  engagement: z.string(), from: z.string(), to: z.string(), until: TimeRefZ,
  weapon: z.enum(['graser', 'laser', 'lac-mixed']), shots: z.number().int().positive(), range: SVNumZ,
}).strict();
export const OutcomeZ = z.object({
  type: z.literal('outcome'), ...evBase,
  engagement: z.string(), unit: z.string(), from: TimeRefZ,
  roles: z.array(z.enum(['wall', 'screen', 'carrier', 'lac'])).min(1),
  counts: z.object({
    destroyed: n0, mission_kill: n0, degraded: n0, undamaged: n0, abandoned: n0, captured: n0, escaped: n0,
  }).strict(),
  by_class: z.record(z.number().int().nonnegative()).nullable().default(null),
  partial: z.boolean().default(false),
  escape: z.object({ via: z.literal('hyper'), readiness_from: TimeRefZ }).strict().nullable().default(null),
}).strict();
export const RangeZ = z.object({
  type: z.literal('range'), ...evBase, a: z.string(), b: z.string(),
  distance: SVNumZ.nullable(), min: SVNumZ.nullable(), tolerance: z.number().positive(),
  closing_min_km_s: z.number().positive().nullable().default(null),
}).strict();
export const SignalZ = z.object({
  type: z.literal('signal'), ...evBase, actor: z.string(), text: z.string(),
  unit: z.string().nullable(), reacts_to: ReactsZ.nullable().default(null),
}).strict();
export const SurrenderZ = z.object({
  type: z.literal('surrender'), ...evBase, unit: z.string(), reacts_to: ReactsZ.nullable().default(null),
}).strict();
export const NoteZ = z.object({
  type: z.literal('note'), ...evBase, text: z.string(), side: z.string().nullable(),
}).strict();
export const EventZ = z.discriminatedUnion('type', [
  ManeuverZ, RollZ, FirePlanZ, BeamAttackZ, OutcomeZ, RangeZ, SignalZ, SurrenderZ, NoteZ,
]);
const TimelineFileZ = z.object({ events: z.array(EventZ) }).strict();

export type TimeRef = z.infer<typeof TimeRefZ>;
export type Pos = z.infer<typeof PosZ>;
export type ScenarioMeta = z.infer<typeof MetaZ>;
export type Shot = z.infer<typeof ShotZ>;
export type CelestialBody = z.infer<typeof BodyZ>;
export type ShipEntry = z.infer<typeof ShipEntryZ>;
export type FleetDef = z.infer<typeof FleetZ>;
export type LacGroupDef = z.infer<typeof LacGroupZ>;
export type UnitDef = z.infer<typeof UnitDefZ>;
export type TimelineEvent = z.infer<typeof EventZ>;
export type ManeuverEvent = z.infer<typeof ManeuverZ>;
export type RollEvent = z.infer<typeof RollZ>;
export type FirePlanEvent = z.infer<typeof FirePlanZ>;
export type BeamAttackEvent = z.infer<typeof BeamAttackZ>;
export type OutcomeEvent = z.infer<typeof OutcomeZ>;
export type RangeEvent = z.infer<typeof RangeZ>;
export type SignalEvent = z.infer<typeof SignalZ>;
export type SurrenderEvent = z.infer<typeof SurrenderZ>;
export type NoteEvent = z.infer<typeof NoteZ>;

export interface ScenarioPack {
  meta: ScenarioMeta;
  bodies: CelestialBody[];
  units: UnitDef[];
  events: TimelineEvent[];
  notes: string;
}
export interface RawPack { meta: unknown; bodies: unknown; forces: unknown; timeline: unknown; notes: string }
export type ParseResult = { ok: true; pack: ScenarioPack } | { ok: false; errors: string[] };

export function posToKm(p: Pos): Vec3 {
  const f = baseFactor(p.unit) as number;
  return [p.value[0] * f, p.value[1] * f, p.value[2] * f];
}

export function eventUnitRefs(ev: TimelineEvent): string[] {
  const observer = 'reacts_to' in ev && ev.reacts_to ? [ev.reacts_to.observer] : [];
  switch (ev.type) {
    case 'maneuver': case 'surrender': return [ev.unit, ...observer];
    case 'roll': return [ev.unit];
    case 'fire_plan': case 'beam_attack': return [ev.from, ev.to];
    case 'outcome': return [ev.unit];
    case 'range': return [ev.a, ev.b];
    case 'signal': return [...(ev.unit ? [ev.unit] : []), ...observer];
    case 'note': return [];
  }
}

export function eventTimeRefs(ev: TimelineEvent): TimeRef[] {
  const refs: TimeRef[] = [ev.t];
  if (ev.type === 'maneuver' || ev.type === 'beam_attack') refs.push(ev.until);
  if (ev.type === 'outcome') {
    refs.push(ev.from);
    if (ev.escape) refs.push(ev.escape.readiness_from);
  }
  return refs;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

export function integrityErrors(p: ScenarioPack): string[] {
  const e: string[] = [];
  const bodyIds = new Set(p.bodies.map((b) => b.id));
  const unitIds = new Set(p.units.map((u) => u.id));
  const eventIds = new Set(p.events.map((x) => x.id));
  const sideIds = new Set(p.meta.sides.map((s) => s.id));
  const theaterIds = new Set(p.meta.theaters.map((t) => t.id));

  for (const d of duplicates(p.bodies.map((b) => b.id))) e.push(`bodies.json: duplicate body id "${d}"`);
  for (const d of duplicates(p.units.map((u) => u.id))) e.push(`forces.json: duplicate unit id "${d}"`);
  for (const d of duplicates(p.events.map((x) => x.id))) e.push(`timeline.json: duplicate event id "${d}"`);

  const ref = (where: string, r: TimeRef | null) => {
    if (r !== null && typeof r !== 'number' && !eventIds.has(r.ref)) e.push(`${where}: time reference "${r.ref}" is not an event id`);
  };

  if (!bodyIds.has(p.meta.frame.origin_body)) e.push(`meta.json: frame.origin_body "${p.meta.frame.origin_body}" is not a body`);
  p.meta.theaters.forEach((t, i) => {
    if (!bodyIds.has(t.anchor_body)) e.push(`meta.json: theaters.${i}.anchor_body "${t.anchor_body}" is not a body`);
  });
  p.meta.phases.forEach((ph, i) => ref(`meta.json: phases.${i}.t0`, ph.t0));
  p.meta.shots.forEach((s, i) => {
    ref(`meta.json: shots.${i}.t0`, s.t0);
    if (!theaterIds.has(s.theater)) e.push(`meta.json: shots.${i}.theater "${s.theater}" is not a theater`);
    for (const id of s.subject) {
      if (!unitIds.has(id) && !bodyIds.has(id)) e.push(`meta.json: shots.${i}.subject "${id}" is not a unit or body`);
    }
  });

  p.bodies.forEach((b, i) => {
    if (b.parent_id !== null && !bodyIds.has(b.parent_id)) e.push(`bodies.json: bodies.${i}.parent_id "${b.parent_id}" is not a body`);
    if (b.resonance_zone) {
      if (b.kind !== 'terminus') e.push(`bodies.json: bodies.${i}.resonance_zone belongs on a terminus, not a ${b.kind}`);
      const star = p.bodies.find((s) => s.id === b.resonance_zone?.star);
      if (star?.kind !== 'star') e.push(`bodies.json: bodies.${i}.resonance_zone.star "${b.resonance_zone.star}" is not a star`);
    }
  });

  p.units.forEach((u, i) => {
    const at = `forces.json: units.${i}`;
    if (!sideIds.has(u.side)) e.push(`${at}.side "${u.side}" is not a declared side`);
    if (!theaterIds.has(u.theater)) e.push(`${at}.theater "${u.theater}" is not a declared theater`);
    const pl = u.state.place;
    if ('frame' in pl && !bodyIds.has(pl.frame)) e.push(`${at}.state.place.frame "${pl.frame}" is not a body`);
    if ('relative_to' in pl && !unitIds.has(pl.relative_to)) e.push(`${at}.state.place.relative_to "${pl.relative_to}" is not a unit`);
    const v = u.state.velocity;
    if ('relative_to' in v && !unitIds.has(v.relative_to)) e.push(`${at}.state.velocity.relative_to "${v.relative_to}" is not a unit`);
    ref(`${at}.state.t`, u.state.t);
    ref(`${at}.present.from`, u.present.from);
    ref(`${at}.present.until`, u.present.until);
  });

  p.events.forEach((ev, i) => {
    const at = `timeline.json: events.${i} (${ev.id})`;
    for (const id of eventUnitRefs(ev)) if (!unitIds.has(id)) e.push(`${at}: unit "${id}" does not exist`);
    for (const r of eventTimeRefs(ev)) ref(at, r);
    if ('reacts_to' in ev && ev.reacts_to && !eventIds.has(ev.reacts_to.ref)) e.push(`${at}: reacts_to "${ev.reacts_to.ref}" is not an event id`);
    if (ev.type === 'range' && ev.distance === null && ev.min === null) e.push(`${at}: range needs distance or min`);
    if (ev.type === 'maneuver') {
      const target = 'toward' in ev.direction ? ev.direction.toward : 'away' in ev.direction ? ev.direction.away : null;
      if (target !== null && !unitIds.has(target) && !bodyIds.has(target)) e.push(`${at}: direction target "${target}" is not a unit or body`);
    }
    if (ev.type === 'note' && ev.side !== null && !sideIds.has(ev.side)) e.push(`${at}: side "${ev.side}" is not declared`);
  });
  return e;
}

export function parsePack(raw: RawPack): ParseResult {
  const errors: string[] = [];
  const take = <T>(file: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T | null => {
    const r = schema.safeParse(data);
    if (r.success) return r.data;
    for (const issue of r.error.issues) errors.push(`${file}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    return null;
  };
  const meta = take('meta.json', MetaZ, raw.meta);
  const bodies = take('bodies.json', BodiesFileZ, raw.bodies);
  const forces = take('forces.json', ForcesFileZ, raw.forces);
  const timeline = take('timeline.json', TimelineFileZ, raw.timeline);
  if (!meta || !bodies || !forces || !timeline) return { ok: false, errors };
  const pack: ScenarioPack = { meta, bodies: bodies.bodies, units: forces.units, events: timeline.events, notes: raw.notes };
  errors.push(...integrityErrors(pack));
  return errors.length ? { ok: false, errors } : { ok: true, pack };
}

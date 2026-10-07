import { baseValue } from '../evidence';
import { capOf, podArithmetic, allSourceValues } from '../tech';
import { G0_KM_S2, gToKmS2, kmS2ToG, kmToLm, kmToMkm, lmToKm, mkmToKm, type Unit } from '../units';
import { ejectRate, firePlans, launcherTubes, magazineTotal, podCapacity, shipsOf } from './forces';
import { issue, type Issue, type StaticCheck } from './types';
import { bodyPosition, indexBodies, orbitPolyline } from '../solver/orbits';
import { dist } from '../vec';

const FIELD_UNITS: Record<string, readonly Unit[]> = {
  radius: ['km', 'Mkm', 'LM', 'm'], hyper_limit: ['km', 'Mkm', 'LM'], exclusion: ['km', 'Mkm', 'LM'],
  phase: ['deg'], inclination: ['deg'], period: ['s', 'min', 'yr'], mass: ['Msun', 't'],
  spacing: ['km', 'Mkm'], accel: ['g', 'km/s2'], accel_max: ['g', 'km/s2'], accel_normal: ['g', 'km/s2'],
  distance: ['km', 'Mkm', 'LM'], min: ['km', 'Mkm', 'LM'], range: ['km', 'Mkm', 'LM'],
  pods: ['count'], ftl_speed_c: ['ratio'], date: ['PD-date'], commander: ['text'], flagship_name: ['text'],
};

/** MTS §12.2 check 1. */
const unitsCheck: StaticCheck = ({ pack }) => {
  const out: Issue[] = [];
  const trips: Array<[string, number, number]> = [
    ['LM to km and back', kmToLm(lmToKm(22)), 22],
    ['Mkm to km and back', kmToMkm(mkmToKm(78)), 78],
    ['g to km/s² and back', kmS2ToG(gToKmS2(674.3)), 674.3],
  ];
  for (const [name, got, want] of trips) {
    if (Math.abs(got - want) > 1e-9 * want) out.push(issue('units', 'error', `${name} drifted: ${got} vs ${want}`));
  }
  const scanned = { meta: pack.meta, bodies: pack.bodies, units: pack.units, events: pack.events };
  for (const { path, v } of allSourceValues(scanned)) {
    const field = path.split('.').filter((s) => !/^\d+$/.test(s)).pop() ?? '';
    const allowed = FIELD_UNITS[field];
    if (allowed && !allowed.includes(v.unit)) {
      out.push(issue('units', 'error', `${field} uses unit "${v.unit}"; expected ${allowed.join(', ')}`, path));
    }
  }
  return out;
};

/** MTS §12.2 check 2, structural part (positions are checked in Task 7). */
const framesStructureCheck: StaticCheck = ({ pack }) => {
  const out: Issue[] = [];
  const byId = new Map(pack.bodies.map((b) => [b.id, b]));
  for (const b of pack.bodies) {
    const seen = new Set<string>();
    let cur = b;
    while (cur.parent_id !== null) {
      if (seen.has(cur.id)) {
        out.push(issue('frames', 'error', `parent cycle through ${b.name}`, `bodies.${b.id}`));
        break;
      }
      seen.add(cur.id);
      const next = byId.get(cur.parent_id);
      if (!next) break;
      cur = next;
    }
  }
  for (const r of pack.bodies.filter((b) => b.parent_id === null)) {
    if (r.id !== pack.meta.frame.origin_body) {
      out.push(issue('frames', 'error', `root body ${r.name} is not the frame origin "${pack.meta.frame.origin_body}"`, `bodies.${r.id}`));
    }
  }
  const groups = new Map<string, typeof pack.bodies>();
  for (const b of pack.bodies) {
    if (b.parent_id !== null && b.ordinal !== undefined && b.orbit && b.orbit.radius.value !== null) {
      groups.set(b.parent_id, [...(groups.get(b.parent_id) ?? []), b]);
    }
  }
  for (const [parent, list] of groups) {
    const sorted = [...list].sort((a, c) => (a.ordinal as number) - (c.ordinal as number));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if ((baseValue(cur.orbit!.radius) as number) <= (baseValue(prev.orbit!.radius) as number)) {
        out.push(issue('frames', 'error',
          `${cur.name} (${cur.designation ?? cur.ordinal}) orbits inside ${prev.name} (${prev.designation ?? prev.ordinal}) around ${parent}; orbital order must follow the designation (MTS §2.2)`,
          `bodies.${cur.id}`));
      }
    }
  }
  return out;
};

/** MTS §12.2 check 4. */
const epochCheck: StaticCheck = ({ pack }) => {
  const out: Issue[] = [];
  for (const b of pack.bodies) {
    const at = `bodies.${b.id}`;
    if (b.parent_id === null || b.kind === 'belt') continue;
    if (!b.orbit && !b.offset) {
      out.push(issue('epoch', 'error', `${b.name} has a parent but neither an orbit nor an offset, so it has no position`, at));
      continue;
    }
    if (!b.orbit) continue;
    if (b.orbit.radius.value === null) out.push(issue('epoch', 'error', `${b.name}: orbit radius unknown`, at));
    if (b.orbit.phase.value === null) {
      out.push(issue('epoch', 'error', `${b.name}: an orbit radius alone does not give a position; set a phase at the epoch (MTS §1.2)`, at));
    } else if (b.orbit.phase.evidence === 'S') {
      out.push(issue('epoch', 'info', `${b.name}: orbital phase at the epoch is a scenario assumption`, at));
    }
    if (b.orbit.period.value === null) out.push(issue('epoch', 'warn', `${b.name}: period unknown, the body is held fixed`, at));
  }
  return out;
};

/** MTS §12.2 check 5. */
const weaponsCheck: StaticCheck = ({ pack, tech }) => {
  const out: Issue[] = [];
  const units = new Map(pack.units.map((u) => [u.id, u]));
  for (const ev of firePlans(pack)) {
    const from = units.get(ev.from);
    if (!from) continue;
    const at = `events.${ev.id}`;
    const perSalvo = (ev.totals.attack + ev.totals.ew + ev.totals.controller) / ev.salvos;
    if (ev.launch === 'tube') {
      const tubes = launcherTubes(from, tech);
      if (tubes === null) out.push(issue('weapons', 'warn', `${from.name}: tube count unknown; salvo size not checked`, at));
      else if (perSalvo > tubes) {
        out.push(issue('weapons', 'error', `${ev.id}: ${perSalvo} missiles per salvo exceeds the ${tubes} tubes bearing (one broadside plus bow, MTS §5.1)`, at));
      }
    }
    if (ev.launch === 'pod') {
      const rate = ejectRate(from, tech);
      const pods = (ev.pods ?? 0) / ev.salvos;
      const window = ev.salvos > 1 ? ev.interval_s : 120;
      if (rate === null) out.push(issue('weapons', 'warn', `${from.name}: pod ejection rate unknown`, at));
      else if (pods > rate * window + 1e-9) {
        out.push(issue('weapons', 'error', `${ev.id}: ${pods} pods per salvo need ${Math.ceil(pods / rate)} s of ejection; ${window} s available`, at));
      }
    }
  }
  return out;
};

/** MTS §12.2 check 6. */
const inventoryCheck: StaticCheck = ({ pack, tech }) => {
  const out: Issue[] = [];
  const units = new Map(pack.units.map((u) => [u.id, u]));
  const podsUsed = new Map<string, number>();
  const tubesUsed = new Map<string, number>();
  for (const ev of firePlans(pack)) {
    const at = `events.${ev.id}`;
    if (ev.launch === 'tube') {
      if (ev.totals.controller > 0) out.push(issue('inventory', 'error', `${ev.id}: tube launches carry no Apollo controllers`, at));
      tubesUsed.set(ev.from, (tubesUsed.get(ev.from) ?? 0) + ev.totals.attack + ev.totals.ew);
      continue;
    }
    const load = ev.pod_load ? tech.podLoads[ev.pod_load] : undefined;
    if (!load || ev.pods === null) {
      out.push(issue('inventory', 'error', `${ev.id}: pod launches need a known pod_load and a pod count`, at));
      continue;
    }
    const a = podArithmetic(ev.pods, load);
    if (ev.totals.attack + ev.totals.ew !== a.attackEw || ev.totals.controller !== a.controllers) {
      out.push(issue('inventory', 'error',
        `${ev.id}: ${ev.pods} pods of "${load.name}" gives ${a.attackEw} attack/EW and ${a.controllers} controllers; the plan says ${ev.totals.attack + ev.totals.ew} and ${ev.totals.controller}`, at));
    }
    if (load.profile !== ev.profile) out.push(issue('inventory', 'error', `${ev.id}: the pod load carries ${load.profile}, the plan says ${ev.profile}`, at));
    podsUsed.set(ev.from, (podsUsed.get(ev.from) ?? 0) + ev.pods);
  }
  for (const [id, used] of podsUsed) {
    const u = units.get(id);
    if (!u) continue;
    const stock = u.kind === 'fleet' && u.stores ? u.stores.pods.value : podCapacity(u, tech);
    if (stock === null) out.push(issue('inventory', 'warn', `${u.name}: pod stock unknown; ${used} pods launched not checked`, `units.${id}`));
    else if (used > stock) out.push(issue('inventory', 'error', `${u.name}: ${used} pods launched exceeds the ${stock} available`, `units.${id}`));
  }
  for (const [id, used] of tubesUsed) {
    const u = units.get(id);
    if (!u) continue;
    const mag = magazineTotal(u, tech);
    if (mag === null) out.push(issue('inventory', 'warn', `${u.name}: magazine size unknown; ${used} tube launches not checked`, `units.${id}`));
    else if (used > mag) out.push(issue('inventory', 'error', `${u.name}: ${used} missiles launched from tubes exceeds magazines of ${mag}`, `units.${id}`));
  }
  return out;
};

/** MTS §12.2 check 7. */
const guidanceCheck: StaticCheck = ({ pack, tech }) => {
  const out: Issue[] = [];
  const units = new Map(pack.units.map((u) => [u.id, u]));
  for (const u of pack.units) {
    if (u.kind !== 'fleet') continue;
    u.ships.forEach((s, i) => {
      const cls = tech.classes[s.class_id];
      if (!cls) return;
      for (const eq of s.equipment) {
        const allowed = eq === 'keyhole-ii' ? cls.keyhole_allowed === 'keyhole-ii' : cls.keyhole_allowed !== 'none';
        if (!allowed) out.push(issue('guidance', 'error', `${u.name}: ${cls.name} cannot carry ${eq}`, `units.${u.id}.ships.${i}`));
      }
    });
  }
  for (const ev of firePlans(pack)) {
    const at = `events.${ev.id}`;
    const prof = tech.missiles[ev.profile];
    if (!prof) {
      out.push(issue('guidance', 'error', `${ev.id}: unknown missile profile "${ev.profile}"`, at));
      continue;
    }
    if (!prof.guidance_allowed.includes(ev.guidance)) {
      out.push(issue('guidance', 'error', `${ev.id}: ${prof.name} does not support ${ev.guidance} guidance`, at));
    }
    if (ev.guidance === 'apollo') {
      const from = units.get(ev.from);
      const hasKeyholeII = from?.kind === 'fleet' && from.ships.some((s) => s.equipment.includes('keyhole-ii'));
      if (!hasKeyholeII) {
        out.push(issue('guidance', 'error', `${ev.id}: Apollo control needs at least one Keyhole II ship in ${from?.name ?? ev.from}; ordinary telemetry must not inherit Apollo`, at));
      }
      if (ev.pod_load !== 'apollo') out.push(issue('guidance', 'error', `${ev.id}: Apollo guidance needs Apollo pods`, at));
      if (ev.pods !== null && ev.totals.controller !== ev.pods) out.push(issue('guidance', 'error', `${ev.id}: one Mk23-E controller per Apollo pod expected`, at));
    } else if (ev.totals.controller > 0) {
      out.push(issue('guidance', 'error', `${ev.id}: controllers present without Apollo guidance`, at));
    }
  }
  return out;
};

/** MTS §12.2 check 12. */
const eraCheck: StaticCheck = ({ pack, tech }) => {
  const out: Issue[] = [];
  const year = pack.meta.year_pd;
  const era = tech.eras[pack.meta.era];
  if (!era) out.push(issue('era', 'error', `unknown tech era "${pack.meta.era}"`, 'meta.era'));
  else if (year < era.year_from || year > era.year_to) out.push(issue('era', 'error', `scenario year ${year} is outside era ${era.label}`, 'meta.era'));
  const dated = (what: string, y: number | null, path: string) => {
    if (y === null) out.push(issue('era', 'warn', `${what}: introduction year unknown`, path));
    else if (y > year) out.push(issue('era', 'error', `${what} (from ${y}) appears in a ${year} scenario (MTS §1.3)`, path));
  };
  for (const u of pack.units) {
    const ids = u.kind === 'fleet' ? u.ships.map((s) => s.class_id) : Object.keys(u.classes);
    for (const id of new Set(ids)) {
      const c = tech.classes[id];
      if (!c) out.push(issue('era', 'error', `${u.name}: unknown ship class "${id}"`, `units.${u.id}`));
      else dated(c.name, c.era_from.value, `units.${u.id}`);
    }
    if (u.kind === 'fleet') {
      for (const s of u.ships) for (const eq of s.equipment) dated(tech.equipment[eq]?.name ?? eq, tech.equipment[eq]?.era_from.value ?? null, `units.${u.id}`);
    }
  }
  for (const ev of firePlans(pack)) {
    const m = tech.missiles[ev.profile];
    if (m) dated(m.name, m.era_from.value, `events.${ev.id}`);
    if (ev.pod_load) {
      const l = tech.podLoads[ev.pod_load];
      if (!l) out.push(issue('era', 'error', `unknown pod load "${ev.pod_load}"`, `events.${ev.id}`));
      else dated(l.name, l.era_from, `events.${ev.id}`);
    }
  }
  return out;
};

/** MTS §12.2 check 2, positional part: children stay at their orbit radius around their own parent. */
const framesPositionCheck: StaticCheck = ({ pack }) => {
  const out: Issue[] = [];
  const idx = indexBodies(pack.bodies);
  for (const b of pack.bodies) {
    if (!b.orbit || b.parent_id === null || b.kind === 'belt') continue;
    const r = baseValue(b.orbit.radius);
    if (r === null) continue;
    for (const t of [0, pack.meta.duration_s / 2, pack.meta.duration_s]) {
      const d = dist(bodyPosition(idx, b.id, t), bodyPosition(idx, b.parent_id, t));
      if (Math.abs(d - r) > 1e-9 * r + 1e-6) {
        out.push(issue('frames', 'error', `${b.name} drifts from its parent frame: ${d} km vs orbit ${r} km at t=${t}`, `bodies.${b.id}`));
        break;
      }
    }
  }
  return out;
};

/** MTS §12.2 check 3: body and orbit overlay come from the same transform. */
const projectionCheck: StaticCheck = ({ pack }) => {
  const out: Issue[] = [];
  const idx = indexBodies(pack.bodies);
  const n = 1024;
  for (const b of pack.bodies) {
    if (!b.orbit || b.parent_id === null || b.kind === 'belt') continue;
    const r = baseValue(b.orbit.radius);
    if (!r) continue;
    const sagitta = r * (1 - Math.cos(Math.PI / n));
    for (const t of [0, pack.meta.duration_s]) {
      const p = bodyPosition(idx, b.id, t);
      const nearest = Math.min(...orbitPolyline(idx, b.id, t, n).map((q) => dist(p, q)));
      if (nearest > 2 * Math.PI * r / n + sagitta) {
        out.push(issue('projection', 'error', `${b.name} sits ${nearest.toFixed(0)} km off its drawn orbit at t=${t}`, `bodies.${b.id}`));
        break;
      }
    }
  }
  return out;
};

/** MTS §12.2 check 9, fleet part: maneuvers stay within the slowest member's limits (MTS §3.2). */
const fleetFlightCheck: StaticCheck = ({ pack, tech }) => {
  const out: Issue[] = [];
  const units = new Map(pack.units.map((u) => [u.id, u]));
  for (const ev of pack.events) {
    if (ev.type !== 'maneuver') continue;
    const u = units.get(ev.unit);
    const a = baseValue(ev.accel);
    if (!u || a === null) continue;
    const g = a / G0_KM_S2;
    const groups = shipsOf(u, tech);
    const maxes = groups.map((x) => capOf(x.cls, x.entry, 'accel_max').value).filter((v): v is number => v !== null);
    const normals = groups.map((x) => capOf(x.cls, x.entry, 'accel_normal').value).filter((v): v is number => v !== null);
    if (maxes.length && g > Math.min(...maxes) + 1e-9) {
      out.push(issue('flight', 'error', `${ev.id}: ${g.toFixed(1)} g exceeds the slowest member's maximum of ${Math.min(...maxes)} g`, `events.${ev.id}`));
    } else if (normals.length && g > Math.min(...normals) + 1e-9) {
      out.push(issue('flight', 'warn', `${ev.id}: ${g.toFixed(1)} g is above the slowest member's normal ${Math.min(...normals)} g`, `events.${ev.id}`));
    }
  }
  return out;
};

/** MTS §12.2 check 10, formation part: neighbouring wedges never overlap (MTS §6.1). */
const formationGeometryCheck: StaticCheck = ({ pack, tech }) => {
  const out: Issue[] = [];
  for (const u of pack.units) {
    if (u.kind !== 'fleet' || u.formation.kind === 'swarm') continue;
    const spacing = baseValue(u.formation.spacing);
    if (spacing === null) {
      out.push(issue('geometry', 'error', `${u.name}: formation spacing unknown`, `units.${u.id}`));
      continue;
    }
    let along = 0;
    let between = 0;
    for (const { cls, entry } of shipsOf(u, tech)) {
      along = Math.max(along, baseValue(capOf(cls, entry, 'wedge.band_length')) ?? 0);
      between = Math.max(between, 2 * (baseValue(capOf(cls, entry, 'wedge.band_offset')) ?? 0));
    }
    const rowGap = u.formation.kind === 'wall' ? 0.6 * spacing : spacing;
    if (spacing < along || rowGap < between) {
      out.push(issue('geometry', 'error',
        `${u.name}: ${spacing} km spacing lets neighbouring wedges overlap (needs ${along} km bow to stern and ${between} km between rows)`, `units.${u.id}`));
    }
  }
  return out;
};

export const STATIC_CHECKS: StaticCheck[] = [
  unitsCheck, framesStructureCheck, framesPositionCheck, projectionCheck, epochCheck,
  weaponsCheck, inventoryCheck, guidanceCheck, eraCheck, fleetFlightCheck, formationGeometryCheck,
];

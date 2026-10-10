import { baseValue } from '../../core/evidence';
import type { CelestialBody, ScenarioPack } from '../../core/schema';
import { bodyPosition } from '../../core/solver/orbits';
import { LM_KM } from '../../core/units';
import { dist, type Vec3 } from '../../core/vec';

type Index = Map<string, CelestialBody>;

/** The bodies the system view draws, sorted by role. Generic across packs: no body ids are assumed. */
export interface SystemCatalog {
  /** The frame's origin star, else the first star. */
  origin: CelestialBody;
  stars: CelestialBody[];
  /** A second star, if the pack has one. */
  companion: CelestialBody | null;
  planets: CelestialBody[];
  stations: CelestialBody[];
  belts: CelestialBody[];
  termini: CelestialBody[];
}

export function systemCatalog(pack: ScenarioPack): SystemCatalog {
  const stars = pack.bodies.filter((b) => b.kind === 'star');
  const origin = stars.find((b) => b.id === pack.meta.frame.origin_body) ?? stars[0] ?? pack.bodies[0];
  return {
    origin,
    stars: [origin, ...stars.filter((s) => s !== origin)],
    companion: stars.find((s) => s !== origin) ?? null,
    planets: pack.bodies.filter((b) => b.kind === 'planet'),
    stations: pack.bodies.filter((b) => b.kind === 'station'),
    belts: pack.bodies.filter((b) => b.kind === 'belt'),
    termini: pack.bodies.filter((b) => b.kind === 'terminus'),
  };
}

const ROMAN: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

export function roman(n: number): string {
  let x = Math.max(0, Math.floor(n));
  let out = '';
  for (const [v, s] of ROMAN) while (x >= v) { out += s; x -= v; }
  return out;
}

/** "12.4 LM", "412 LM": at most two decimals, trailing zeros dropped (Site B). */
export const lmText = (km: number): string => `${Number((km / LM_KM).toFixed(2))} LM`;
/** "22.00 LM": the fixed two-decimal form Site A uses for hyper limits. */
export const lmFixed = (km: number): string => `${(km / LM_KM).toFixed(2)} LM`;

export const solarMasses = (b: CelestialBody): number | null => (b.mass?.unit === 'Msun' ? b.mass.value : null);

const parentOf = (b: CelestialBody, index: Index): CelestialBody | undefined => (b.parent_id ? index.get(b.parent_id) : undefined);

/**
 * "Primary · 1.12 solar masses". Only what the pack states: the role when the system has two stars (from the body
 * hierarchy), the mass when given, a companion's separation from its primary.
 */
export function starSubtitle(star: CelestialBody, index: Index): string {
  const parent = parentOf(star, index);
  const companion = parent?.kind === 'star';
  const binary = companion || [...index.values()].some((b) => b.kind === 'star' && b.parent_id === star.id);
  const parts: string[] = [];
  if (binary) parts.push(companion ? 'Companion' : 'Primary');
  const m = solarMasses(star);
  if (m !== null) parts.push(`${m} solar mass${m === 1 ? '' : 'es'}`);
  if (companion) parts.push(`${lmText(dist(bodyPosition(index, star.id, 0), bodyPosition(index, parent.id, 0)))} from ${parent.name}`);
  return parts.join(' · ');
}

/** "Manticore-A III" from the parent star and the ordinal; the pack's own designation otherwise. */
export function planetDesignation(b: CelestialBody, index: Index): string | null {
  const parent = parentOf(b, index);
  if (parent?.kind === 'star' && b.ordinal) return `${parent.name} ${roman(b.ordinal)}`;
  return b.designation ?? null;
}

/** Site A's two-line planet label: designation, orbit radius, class and the stations above it, all from the pack. */
export function planetSubtitle(b: CelestialBody, index: Index): string {
  const parts: string[] = [];
  const designation = planetDesignation(b, index);
  if (designation) parts.push(designation);
  const orbit = baseValue(b.orbit?.radius);
  if (orbit !== null) parts.push(lmText(orbit));
  const said = `${b.radius.uncertainty ?? ''} ${b.note ?? ''}`.toLowerCase().match(/\b(gas giant|ice giant)\b/);
  if (said) parts.push(said[1]);
  for (const s of index.values()) if (s.kind === 'station' && s.parent_id === b.id) parts.push(s.name);
  if (b.note && b.note.length <= 48) parts.push(b.note.replace(/\.$/, ''));
  return parts.join(' · ');
}

/** Site A's mono hyper-limit label, "Manticore-A · 22.00 LM hyper limit"; speculative limits carry [S]. */
export function limitText(star: CelestialBody): string | null {
  const limit = baseValue(star.hyper_limit);
  if (limit === null) return null;
  return `${star.name} · ${lmFixed(limit)} hyper limit${star.hyper_limit?.evidence === 'S' ? ' [S]' : ''}`;
}

export function terminusSubtitle(terminus: CelestialBody, origin: CelestialBody, index: Index): string {
  return `${lmText(dist(bodyPosition(index, terminus.id, 0), bodyPosition(index, origin.id, 0)))} from ${origin.name}`;
}

const EVIDENCE_WORD: Record<string, string> = { S: 'Provisional', D: 'Derived', W: 'Reference', P: 'Canon' };

/** The resonance zone's label: the cone's base width and its evidence grade come from the pack. */
export function resonanceLabel(terminus: CelestialBody): { text: string; sub: string } | null {
  const rz = terminus.resonance_zone;
  const base = rz ? baseValue(rz.base_radius) : null;
  if (!rz || base === null) return null;
  const ev = rz.base_radius.evidence;
  return { text: 'Resonance zone', sub: `${EVIDENCE_WORD[ev]} ${lmText(2 * base)} cone · hyper translation lethal [${ev}]` };
}

/** Both stars' masses are given, so the barycentre lies on the line between them. */
export function barycentre(a: CelestialBody, b: CelestialBody, index: Index, t: number): Vec3 | null {
  const ma = solarMasses(a), mb = solarMasses(b);
  if (ma === null || mb === null || ma + mb <= 0) return null;
  const pa = bodyPosition(index, a.id, t), pb = bodyPosition(index, b.id, t);
  const k = mb / (ma + mb);
  return [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k];
}

export type PlanetLook = 'terrestrial' | 'rocky' | 'gas-giant' | 'ice-giant';

/**
 * Shading only, never shown as a fact. The schema has no planet class, so giants are recognised from the pack's own
 * wording ("gas giant radius not in the MTS"); bodies of Earth size get oceans and clouds, smaller ones bare rock.
 */
export function planetLook(b: CelestialBody, parentLimitKm: number | null): PlanetLook {
  const text = `${b.radius.uncertainty ?? ''} ${b.note ?? ''}`.toLowerCase();
  const r = baseValue(b.radius);
  const orbit = baseValue(b.orbit?.radius);
  if (/ice giant/.test(text)) return 'ice-giant';
  if (/gas giant/.test(text) || (r !== null && r > 20_000)) {
    return orbit !== null && parentLimitKm !== null && orbit > 3 * parentLimitKm ? 'ice-giant' : 'gas-giant';
  }
  return r !== null && r >= 5_500 ? 'terrestrial' : 'rocky';
}

/** Display radius when the pack leaves it unknown; it only shows when zoomed in to a few planet radii. */
export const LOOK_RADIUS_KM: Record<PlanetLook, number> = { terrestrial: 6_400, rocky: 3_000, 'gas-giant': 64_000, 'ice-giant': 26_000 };
/** Smallest on-screen radius in CSS px, so a planet always reads as a lit sphere (Site B sizes). */
export const LOOK_MIN_PX: Record<PlanetLook, number> = { terrestrial: 5.6, rocky: 4.2, 'gas-giant': 10.5, 'ice-giant': 8.5 };
/** Site B base colours (B report §2.4), picked per body by a stable hash. */
export const LOOK_COLORS: Record<PlanetLook, number[]> = {
  terrestrial: [0x54aacf, 0x61baab, 0x809fbf],
  rocky: [0xaf7e64, 0xdca383, 0xc4a16d, 0xb7907a, 0x9e9489],
  'gas-giant': [0xd6af86, 0xd2aa8a, 0xbaa076],
  'ice-giant': [0x7f9fb9, 0x99abc0],
};
/** Site A marker colours by look (A report §3.4), linear. */
export const LOOK_MARK: Record<PlanetLook, [number, number, number]> = {
  terrestrial: [0.35, 0.65, 1.0], rocky: [0.6, 0.55, 0.5], 'gas-giant': [0.95, 0.8, 0.55], 'ice-giant': [0.55, 0.85, 0.95],
};

export function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** "Home Fleet" → HOME, "Eighth Fleet screen" → EIGHTH SCREEN, "Diamato's task group" → DIAMATO (Site B callouts). */
export function fleetShortName(name: string): string {
  const words = name.replace(/['’]s\b/g, '').split(/\s+/).filter((w) => w && !/^(fleet|squadron|task|group|force|training|the|of)$/i.test(w));
  return (words.length ? words.join(' ') : name).toUpperCase();
}

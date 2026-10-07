import { evidenceScore, type EvidenceLabel } from './core/evidence';
import { parsePack, type RawPack, type ScenarioPack } from './core/schema';
import { TECH, allSourceValues } from './core/tech';
import { formatIssues, validateStatic } from './core/validate';

const jsonFiles = import.meta.glob('/scenarios/*/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const noteFiles = import.meta.glob('/scenarios/*/notes.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

type FileKey = 'meta' | 'bodies' | 'forces' | 'timeline';

export function rawPacks(): Record<string, RawPack> {
  const found: Record<string, Partial<Record<FileKey, unknown>> & { notes?: string }> = {};
  for (const [path, data] of Object.entries(jsonFiles)) {
    const m = /\/scenarios\/([^/]+)\/(meta|bodies|forces|timeline)\.json$/.exec(path);
    if (m) (found[m[1]] ??= {})[m[2] as FileKey] = data;
  }
  for (const [path, text] of Object.entries(noteFiles)) {
    const m = /\/scenarios\/([^/]+)\/notes\.md$/.exec(path);
    if (m) (found[m[1]] ??= {}).notes = text;
  }
  return Object.fromEntries(
    Object.entries(found).map(([id, f]) => [id, { meta: f.meta, bodies: f.bodies, forces: f.forces, timeline: f.timeline, notes: f.notes ?? '' }]),
  );
}

export interface CatalogEntry {
  id: string;
  title: string;
  date: string | null;
  dateEvidence: EvidenceLabel | null;
  year_pd: number | null;
  location: string;
  summary: string;
  stub: boolean;
  sides: Array<{ id: string; name: string; color: string }>;
  /** Share of P and W labels across the pack's values and events, 0..1. */
  evidence: number;
  ok: boolean;
  errors: string[];
}

function brokenEntry(id: string, raw: RawPack, errors: string[]): CatalogEntry {
  const meta = (raw.meta ?? {}) as Record<string, unknown>;
  return {
    id,
    title: typeof meta.title === 'string' ? meta.title : id,
    date: null, dateEvidence: null,
    year_pd: typeof meta.year_pd === 'number' ? meta.year_pd : null,
    location: typeof meta.location === 'string' ? meta.location : '',
    summary: '', stub: false, sides: [], evidence: 0, ok: false, errors,
  };
}

export function listScenarios(): CatalogEntry[] {
  return Object.entries(rawPacks())
    .map(([id, raw]): CatalogEntry => {
      const r = parsePack(raw);
      if (!r.ok) return brokenEntry(id, raw, r.errors);
      const p = r.pack;
      const errors = validateStatic(p, TECH).filter((i) => i.severity === 'error');
      if (errors.length) return brokenEntry(id, raw, formatIssues(errors).split('\n'));
      const labels: EvidenceLabel[] = [
        ...allSourceValues({ bodies: p.bodies, units: p.units, events: p.events }).map((x) => x.v.evidence),
        ...p.events.map((e) => e.evidence),
      ];
      return {
        id, title: p.meta.title, date: p.meta.date.value, dateEvidence: p.meta.date.evidence, year_pd: p.meta.year_pd,
        location: p.meta.location, summary: p.meta.summary, stub: p.meta.stub, sides: p.meta.sides,
        evidence: evidenceScore(labels), ok: true, errors: [],
      };
    })
    .sort((a, b) => (a.year_pd ?? 9999) - (b.year_pd ?? 9999) || a.title.localeCompare(b.title));
}

export function getPack(id: string): ScenarioPack | null {
  const raw = rawPacks()[id];
  if (!raw) return null;
  const r = parsePack(raw);
  return r.ok ? r.pack : null;
}

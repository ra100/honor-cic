import { describe, expect, it } from 'vitest';
import { parsePack } from '../src/core/schema';
import { TECH } from '../src/core/tech';
import { formatIssues, validateStatic } from '../src/core/validate';
import { getPack, listScenarios, rawPacks } from '../src/registry';

describe('scenario packs', () => {
  const packs = rawPacks();

  it('finds the Manticore and training packs', () => {
    expect(Object.keys(packs).sort()).toEqual(['manticore', 'training']);
  });

  for (const [id, raw] of Object.entries(packs)) {
    it(`${id}: parses`, () => {
      const r = parsePack(raw);
      expect(r.ok ? [] : r.errors).toEqual([]);
    });
    it(`${id}: passes static validation with zero errors`, () => {
      const pack = getPack(id);
      expect(pack).not.toBeNull();
      const errors = validateStatic(pack!, TECH).filter((i) => i.severity === 'error');
      expect(formatIssues(errors)).toBe('');
    });
  }

  it('lists the catalog with titles and an evidence score', () => {
    const m = listScenarios().find((e) => e.id === 'manticore');
    expect(m?.title).toBe('Battle of Manticore');
    expect(m?.ok).toBe(true);
    expect(m?.evidence).toBeGreaterThan(0);
    expect(m?.evidence).toBeLessThan(1);
  });

  it('never calls it the Eighth Battle of Manticore (MTS §10.1)', () => {
    expect(JSON.stringify(packs['manticore'])).not.toMatch(/Eighth Battle of Manticore/i);
  });

  it('keeps the Apollo strike counts exact (MTS §10.2)', () => {
    const ev = getPack('manticore')!.events.find((e) => e.id === 'fp-apollo-5f');
    if (ev?.type !== 'fire_plan') throw new Error('fp-apollo-5f missing');
    expect(ev.pods).toBe(7776);
    expect(ev.totals.attack + ev.totals.ew).toBe(62208);
    expect(ev.totals.controller).toBe(7776);
  });
});

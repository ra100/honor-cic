import { describe, expect, it } from 'vitest';
import { parsePack } from '../src/core/schema';
import { TECH } from '../src/core/tech';
import { formatIssues, validateStatic } from '../src/core/validate';
import { getPack, listScenarios, rawPacks } from '../src/registry';
import { ShipStatus } from '../src/core/replay';
import { solve } from '../src/core/solver/solve';
import { validateReplay } from '../src/core/validate';

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

describe('scenario replays', () => {
  for (const id of Object.keys(rawPacks())) {
    it(`${id}: solves with zero replay errors`, () => {
      const pack = getPack(id)!;
      const t0 = performance.now();
      const replay = solve(pack, TECH);
      const ms = performance.now() - t0;
      const errors = validateReplay(pack, TECH, replay).filter((i) => i.severity === 'error');
      expect(formatIssues(errors)).toBe('');
      expect(ms).toBeLessThan(20_000);
    }, 60_000);
  }

  it('Manticore: canon losses hold exactly', () => {
    const r = solve(getPack('manticore')!, TECH);
    const final = (i: number) => r.ships[i].status[r.ships[i].status.length - 1].status;
    const shipsOf = (unit: string) => r.units.find((u) => u.id === unit)!.shipIdx;
    const count = (unit: string, st: ShipStatus) => shipsOf(unit).filter((i) => final(i) === st).length;
    expect(count('home-fleet', ShipStatus.Destroyed)).toBe(147);
    expect(count('fifth-fleet', ShipStatus.Escaped)).toBe(17);
    expect(count('fifth-fleet', ShipStatus.Destroyed)).toBe(79);
    expect(count('third-fleet', ShipStatus.Destroyed)).toBe(62);
    expect(count('diamato', ShipStatus.Escaped)).toBe(32);
    const wall = shipsOf('second-fleet').filter((i) => r.ships[i].role === 'wall');
    expect(wall.filter((i) => final(i) === ShipStatus.Destroyed)).toHaveLength(172);
    expect(wall.filter((i) => final(i) === ShipStatus.Captured)).toHaveLength(68);
    expect(final(r.ships.find((s) => s.name === 'RHNS Canonnade')!.idx)).toBe(ShipStatus.Escaped);
  }, 60_000);
});

import { describe, expect, it } from 'vitest';
import { catalogCards, EMPTY_CATALOG_TEXT } from '../../src/ui/catalog';
import { fmtClock, fmtPdDate } from '../../src/ui/format';
import { listScenarios, type CatalogEntry } from '../../src/registry';

describe('catalog model', () => {
  it('builds a card per pack with a labelled date, sides and an evidence meter', () => {
    const cards = catalogCards(listScenarios());
    const m = cards.find((c) => c.id === 'manticore')!;
    expect(m.title).toBe('Battle of Manticore');
    expect(m.dateText).toBe('24 July 1921 PD [W]');
    expect(m.sides.map((s) => s.name)).toHaveLength(2);
    expect(m.evidencePct).toBeGreaterThanOrEqual(0);
    expect(m.evidencePct).toBeLessThanOrEqual(100);
    expect(m.href).toBe('#/battle/manticore');
    expect(m.broken).toBe(false);
  });
  it('keeps an invalid pack visible with its first three errors', () => {
    const bad: CatalogEntry = {
      id: 'bad', title: 'Broken pack', date: null, dateEvidence: null, year_pd: null, location: '', summary: '',
      stub: false, sides: [], evidence: 0, ok: false, errors: ['e1', 'e2', 'e3', 'e4'],
    };
    const [card] = catalogCards([bad]);
    expect(card.broken).toBe(true);
    expect(card.errors).toEqual(['e1', 'e2', 'e3']);
    expect(card.dateText).toBe('date unknown');
  });
  it('has the empty-state copy from DESIGN.md', () => {
    expect(catalogCards([])).toEqual([]);
    expect(EMPTY_CATALOG_TEXT).toBe('No battles yet. Add a scenario pack under scenarios/, see README: Adding a scenario.');
  });
  it('formats dates and clocks', () => {
    expect(fmtPdDate('1921-07-24')).toBe('24 July 1921 PD');
    expect(fmtClock(714)).toBe('T+11:54');
    expect(fmtClock(-5)).toBe('T-0:05');
  });
});

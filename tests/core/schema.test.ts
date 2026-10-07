import { describe, expect, it } from 'vitest';
import { parsePack, posToKm } from '../../src/core/schema';
import { miniPackRaw } from '../fixtures/mini-pack';

// Tests mutate untyped JSON copies of the fixture on purpose.
type Any = any;

describe('parsePack', () => {
  it('accepts the mini pack', () => {
    const r = parsePack(miniPackRaw());
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('reports a missing field with file and path', () => {
    const raw = miniPackRaw();
    delete (raw.meta as Any).title;
    const r = parsePack(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain('meta.json: title: Required');
  });

  it('accepts null for unknown values and rejects "unknown" strings', () => {
    const raw = miniPackRaw();
    (raw.bodies as Any).bodies[0].radius.value = 'unknown';
    expect(parsePack(raw).ok).toBe(false);
    (raw.bodies as Any).bodies[0].radius.value = null;
    expect(parsePack(raw).ok).toBe(true);
  });

  it('rejects undeclared sides, duplicate ids and dangling time references', () => {
    const raw = miniPackRaw();
    const units = (raw.forces as Any).units;
    units[1].side = 'green';
    units[1].id = units[0].id;
    (raw.timeline as Any).events[0].t = { ref: 'nope', anchor: 't', offset_s: 0 };
    const r = parsePack(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes('units.1.side "green"'))).toBe(true);
    expect(r.errors.some((e) => e.includes('duplicate unit id "blue-ca"'))).toBe(true);
    expect(r.errors.some((e) => e.includes('time reference "nope"'))).toBe(true);
  });

  it('rejects zero ship counts with a precise path', () => {
    const raw = miniPackRaw();
    (raw.forces as Any).units[0].ships[0].count = 0;
    const r = parsePack(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.startsWith('forces.json: units.0.ships.0.count'))).toBe(true);
  });

  it('requires range constraints to say distance or min', () => {
    const raw = miniPackRaw();
    (raw.timeline as Any).events.push({
      id: 'r1', type: 'range', t: 0, a: 'blue-ca', b: 'red-ca', distance: null, min: null, tolerance: 0.05,
      evidence: 'S', source_id: 'test', seed: 0,
    });
    const r = parsePack(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('range needs distance or min'))).toBe(true);
  });

  it('converts authored positions to km', () => {
    expect(posToKm({ value: [1, 0, 0], unit: 'LM' })[0]).toBeCloseTo(17_987_547.48, 2);
    expect(posToKm({ value: [0, 2, 0], unit: 'Mkm' })[1]).toBe(2_000_000);
  });
});

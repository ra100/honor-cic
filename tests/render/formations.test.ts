import { describe, expect, it } from 'vitest';
import { rngFor } from '../../src/core/rng';
import { formationOffsets } from '../../src/core/solver/formation';
import { formationSpread, MAX_FORMATION_RADIUS_PX, NEIGHBOUR_SHARE, slotRadiusKm, slotSpacingKm } from '../../src/render/formations';

describe('display spread of a 3D formation', () => {
  const wall = formationOffsets('wall', 147, 25_000, rngFor('formation', 'home-fleet'));
  const spacing = slotSpacingKm(wall);
  const radius = slotRadiusKm(wall);
  const base = { spacingKm: spacing, radiusKm: radius, minGapPx: 12, neighbourKm: Infinity };

  it('measures a wall by its own slots: rows 0.6 of the column spacing apart', () => {
    expect(spacing).toBeCloseTo(15_000, -2);
    expect(radius).toBeGreaterThan(150_000);
    expect(radius).toBeLessThan(250_000);
    expect(slotSpacingKm([[0, 0, 0]])).toBe(0);
  });

  it('is life size up close and grows with the zoom-out just enough to keep neighbours apart', () => {
    expect(formationSpread({ ...base, kmPerPx: 500 })).toBe(1);
    const k = formationSpread({ ...base, kmPerPx: 20_000 });
    expect(k * spacing / 20_000).toBeCloseTo(12, 6);
    expect(formationSpread({ ...base, kmPerPx: 30_000 })).toBeGreaterThan(k);
  });

  it('caps the drawn radius in pixels and keeps clear of the nearest other fleet', () => {
    // 147 ships stay under the cap at any zoom; Second Fleet's 330-ship wall reaches it.
    expect(formationSpread({ ...base, kmPerPx: 1e6 }) * radius / 1e6).toBeLessThan(MAX_FORMATION_RADIUS_PX);
    const big = formationOffsets('wall', 330, 25_000, rngFor('formation', 'second-fleet'));
    const bigRadius = slotRadiusKm(big);
    const wide = formationSpread({ ...base, spacingKm: slotSpacingKm(big), radiusKm: bigRadius, kmPerPx: 1e6 });
    expect(wide * bigRadius / 1e6).toBeCloseTo(MAX_FORMATION_RADIUS_PX, 6);
    const crowded = formationSpread({ ...base, kmPerPx: 20_000, neighbourKm: 2e6 });
    expect(crowded * radius).toBeCloseTo(NEIGHBOUR_SHARE * 2e6, 0);
    expect(formationSpread({ ...base, kmPerPx: 20_000, neighbourKm: 1_000 })).toBe(1);
  });

  it('falls back to life size for a single ship or a degenerate camera', () => {
    expect(formationSpread({ ...base, radiusKm: 0, kmPerPx: 20_000 })).toBe(1);
    expect(formationSpread({ ...base, kmPerPx: Number.NaN })).toBe(1);
    expect(formationSpread({ ...base, kmPerPx: Infinity })).toBe(1);
  });
});

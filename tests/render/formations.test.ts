import { describe, expect, it } from 'vitest';
import { rngFor } from '../../src/core/rng';
import { formationOffsets } from '../../src/core/solver/formation';
import { FORMATION_SCALE, formationScale, NEIGHBOUR_SHARE, slotRadiusKm } from '../../src/render/formations';

describe('display scale of a 3D formation', () => {
  const home = slotRadiusKm(formationOffsets('wall', 147, 25_000, rngFor('formation', 'home-fleet')));
  const second = slotRadiusKm(formationOffsets('wall', 330, 25_000, rngFor('formation', 'second-fleet')));

  it('measures a wall by its own slots', () => {
    expect(home).toBeGreaterThan(150_000);
    expect(home).toBeLessThan(250_000);
    expect(second).toBeGreaterThan(home);
  });

  it('draws every fleet at the same scale, whatever its size, so their sizes compare', () => {
    expect(formationScale(home, Infinity)).toBe(FORMATION_SCALE);
    expect(formationScale(second, Infinity)).toBe(FORMATION_SCALE);
    expect(formationScale(second, 57e6)).toBe(FORMATION_SCALE);
    // Site A draws walls 1.5–3 Mkm wide.
    expect(2 * FORMATION_SCALE * second).toBeGreaterThan(1.5e6);
    expect(2 * FORMATION_SCALE * second).toBeLessThan(3e6);
  });

  it('shrinks a fleet toward life size as another closes, never past the neighbour share', () => {
    const near = formationScale(second, 2e6);
    expect(near * second).toBeCloseTo(NEIGHBOUR_SHARE * 2e6, 0);
    expect(near).toBeLessThan(FORMATION_SCALE);
    expect(formationScale(second, 305_000)).toBe(1);
  });

  it('is life size for a single ship', () => {
    expect(formationScale(0, Infinity)).toBe(1);
  });
});

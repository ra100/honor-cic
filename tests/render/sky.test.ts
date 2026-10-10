import { describe, expect, it } from 'vitest';
import { BAND_NORMAL, SKY_STARS, skyStars } from '../../src/render/sky';

describe('Site A sky', () => {
  const stars = skyStars();

  it('is deterministic, unit-length and mostly faint', () => {
    expect(stars).toHaveLength(SKY_STARS);
    expect(skyStars(5)).toEqual(stars.slice(0, 5));
    for (const s of stars) expect(Math.hypot(...s.dir)).toBeCloseTo(1, 6);
    const bright = stars.filter((s) => s.sizePx > 3);
    expect(bright.length).toBeGreaterThan(0);
    expect(bright.length / stars.length).toBeLessThan(0.05);
    expect(Math.max(...stars.map((s) => s.sizePx))).toBeLessThanOrEqual(3.5);
  });

  it('pulls about a third of the stars toward the galactic band', () => {
    const near = stars.filter((s) => Math.abs(s.dir[0] * BAND_NORMAL[0] + s.dir[1] * BAND_NORMAL[1] + s.dir[2] * BAND_NORMAL[2]) < 0.15);
    // Uniform stars put 15 % inside |h| < 0.15; the band pull roughly triples that.
    expect(near.length / stars.length).toBeGreaterThan(0.3);
  });
});

import { describe, expect, it } from 'vitest';
import { add, cross, dist, dot, len, norm, rotateAbout, scale, sub } from '../../src/core/vec';
import {
  C_KM_S, G0_KM_S2, LM_KM, MKM_KM, baseFactor, fmtCount, fmtDistance, fmtDuration,
  gToKmS2, kmS2ToG, kmToLm, lmToKm, toFractionC,
} from '../../src/core/units';
import { EVIDENCE_TEXT, MissingValueError, baseValue, evidenceScore, formatLabelled, formatSourceValue, known, need, sv } from '../../src/core/evidence';
import { binomial, hashSeed, mulberry32, rngFor, shuffleInPlace } from '../../src/core/rng';

describe('vec', () => {
  it('does basic algebra', () => {
    expect(add([1, 2, 3], [1, 1, 1])).toEqual([2, 3, 4]);
    expect(sub([1, 2, 3], [1, 1, 1])).toEqual([0, 1, 2]);
    expect(scale([1, 2, 3], 2)).toEqual([2, 4, 6]);
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(len([3, 4, 0])).toBe(5);
    expect(dist([0, 0, 0], [0, 0, 2])).toBe(2);
    expect(norm([0, 0, 0])).toEqual([0, 0, 0]);
  });
  it('rotates about an axis', () => {
    const r = rotateAbout([1, 0, 0], [0, 0, 1], Math.PI / 2);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(1, 12);
  });
});

describe('units (MTS §1.2)', () => {
  it('uses the MTS constants', () => {
    expect(C_KM_S).toBe(299_792.458);
    expect(G0_KM_S2).toBe(0.00980665);
    expect(LM_KM).toBe(17_987_547.48);
  });
  it('round-trips LM, km and Mkm', () => {
    expect(kmToLm(lmToKm(22))).toBeCloseTo(22, 12);
    expect(lmToKm(739) / MKM_KM).toBeCloseTo(13_292.8, 1); // the MTS's corrected 739 LM figure
    expect(lmToKm(22)).toBeCloseTo(395_726_044.56, 2);
  });
  it('round-trips g and km/s²', () => {
    expect(gToKmS2(46_000)).toBeCloseTo(451.1059, 4); // MTS §8.2
    expect(gToKmS2(580.9)).toBeCloseTo(5.697, 3); // MTS §5.4 corrected conversion
    expect(kmS2ToG(gToKmS2(674.3))).toBeCloseTo(674.3, 10);
  });
  it('maps authored units to base factors', () => {
    expect(baseFactor('LM')).toBe(LM_KM);
    expect(baseFactor('Mkm')).toBe(1e6);
    expect(baseFactor('g')).toBe(G0_KM_S2);
    expect(baseFactor('m')).toBe(0.001);
    expect(baseFactor('yr')).toBe(31_557_600);
    expect(baseFactor('text')).toBeNull();
    expect(toFractionC(C_KM_S / 2)).toBe(0.5);
  });
  it('formats for display', () => {
    expect(fmtDuration(714)).toBe('11:54');
    expect(fmtDuration(5400)).toBe('1:30:00');
    expect(fmtDuration(-65)).toBe('-1:05');
    expect(fmtDistance(78e6)).toBe('78.00 Mkm');
    expect(fmtDistance(lmToKm(22))).toBe('22.00 LM');
    expect(fmtDistance(75_000)).toBe('75,000 km');
    expect(fmtCount(62208)).toBe('62,208');
  });
});

describe('evidence (MTS §1.1, §12.1)', () => {
  it('treats null as unknown, never zero', () => {
    const v = sv<number>(null, 'count', 'S', 'mts');
    expect(known(v)).toBe(false);
    expect(formatSourceValue(v)).toBe('unknown');
    expect(known(sv(0, 'count', 'W', 'wiki'))).toBe(true);
  });
  it('marks S values as speculative', () => {
    expect(formatSourceValue(sv(64, 'ratio', 'S', 'mts'))).toBe('64 (speculative)');
    expect(formatSourceValue(sv(25, 'count', 'W', 'wiki'))).toBe('25');
    expect(formatLabelled(sv(25, 'count', 'W', 'wiki'))).toBe('25 [W]');
    expect(formatLabelled(sv(64, 'ratio', 'S', 'mts'))).toBe('64 (speculative) [S]');
    expect(formatLabelled(sv<number>(null, 'km', 'S', 'mts'))).toBe('unknown');
    expect(formatSourceValue(sv(674.3, 'g', 'W', 'wiki'))).toBe('674.3 g');
  });
  it('need() throws a contextual error for unknown values', () => {
    expect(() => need(sv(null, 'km', 'S', 'x'), 'nike.wedge.band_offset')).toThrow(MissingValueError);
    expect(need(sv(5, 'km', 'S', 'x'), 'ctx')).toBe(5);
  });
  it('converts authored units to base units', () => {
    expect(baseValue(sv(22, 'LM', 'P', 'obs'))).toBeCloseTo(395_726_044.56, 2);
    expect(baseValue(sv(48_000, 'g', 'W', 'wiki'))).toBeCloseTo(470.7192, 4);
    expect(baseValue(sv<number>(null, 'km', 'S', 'x'))).toBeNull();
  });
  it('explains every label and scores canon share', () => {
    expect(Object.keys(EVIDENCE_TEXT).sort()).toEqual(['D', 'P', 'S', 'W']);
    expect(evidenceScore(['P', 'W', 'D', 'S'])).toBe(0.5);
    expect(evidenceScore([])).toBe(0);
  });
});

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(42), b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it('hashes with FNV-1a', () => {
    expect(hashSeed('a')).toBe(0xe40c292c);
    expect(rngFor('manticore', 7)()).toBe(rngFor('manticore', 7)());
    expect(rngFor('manticore', 7)()).not.toBe(rngFor('manticore', 8)());
  });
  it('draws binomials with the right mean and bounds', () => {
    const r = mulberry32(1);
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += binomial(r, 1000, 0.3);
    expect(sum / 2000).toBeGreaterThan(295);
    expect(sum / 2000).toBeLessThan(305);
    expect(binomial(r, 10, 0)).toBe(0);
    expect(binomial(r, 10, 1)).toBe(10);
    expect(binomial(r, 0, 0.5)).toBe(0);
  });
  it('shuffles deterministically without losing items', () => {
    const s = shuffleInPlace(mulberry32(3), [1, 2, 3, 4, 5]);
    expect([...s].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(s).toEqual(shuffleInPlace(mulberry32(3), [1, 2, 3, 4, 5]));
  });
});

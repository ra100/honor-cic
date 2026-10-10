import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  bandCorners, bowText, fromB, keyholeText, placeFrame, podX, railOffset, rollPoint, sidewallVertices, sternText, toB, wedgeHit, wedgeVertices,
  type V3,
} from '../../../src/render/ship/site-b';
import { glowAlpha } from '../../../src/render/ship/glow';
import { gradeInverse, matchLinear, siteBDisplay } from '../../../src/render/ship/display-match';

describe('Site B ship geometry (B report §4)', () => {
  it('scales the band quads to Site B\'s published world corners', () => {
    const table: Array<[number, number, number, number]> = [[1, 1, 1.2, 4], [1, 0.94, 1.128, 3.76], [-1, 1, -1.2, -4], [-1, 0.94, -1.128, -3.76]];
    for (const [sign, band, stern, bow] of table) {
      const c = bandCorners(sign, band);
      expect(c[0]).toEqual([expect.closeTo(-6.16, 6), expect.closeTo(stern, 6), expect.closeTo(-2.7, 6)]);
      expect(c[1][2]).toBeCloseTo(2.7, 6);
      expect(c[2]).toEqual([expect.closeTo(6.72, 6), expect.closeTo(bow, 6), expect.closeTo(4.455, 6)]);
      expect(c[3][2]).toBeCloseTo(-4.455, 6);
    }
    expect(wedgeVertices(1, 1)).toEqual([[-4.4, 0.75, -2], [-4.4, 0.75, 2], [4.8, 2.5, 3.3], [4.8, 2.5, -3.3]]);
  });

  it('joins the outer band edges with a sidewall on each broadside', () => {
    const stbd = sidewallVertices(1);
    expect(stbd.map((p) => p[2])).toEqual([2.7, 2.7, 4.455, 4.455].map((z) => expect.closeTo(z, 6)));
    expect(stbd.map((p) => p[1])).toEqual([-1.2, 1.2, 4, -4].map((y) => expect.closeTo(y, 6)));
    expect(sidewallVertices(-1).every((p) => p[2] < 0)).toBe(true);
  });

  it('maps Site B\'s frame onto ours: bow +X, dorsal +Z, starboard −Y, scaled to the hull length', () => {
    const k = 13.617;
    const frame = new THREE.Group();
    placeFrame(frame, k);
    frame.updateMatrixWorld(true);
    for (const p of [[5.16, 0, 0], [0, 1, 0], [0, 0, 1], [-3, 2, -1]] as V3[]) {
      const world = frame.localToWorld(new THREE.Vector3(...p));
      expect(world.distanceTo(fromB(p, k))).toBeLessThan(1e-9);
      toB(world, k).forEach((v, i) => expect(v).toBeCloseTo(p[i], 9));
    }
    expect(fromB([0, 0, 1], k).y).toBeLessThan(0);
    expect(fromB([0, 1, 0], k).z).toBeGreaterThan(0);
  });

  it('lays the pod rails out as Site B\'s two-row lane matrix', () => {
    expect(Array.from({ length: 6 }, (_, i) => railOffset(i, 6))).toEqual([
      [-0.19, -0.43], [0.19, -0.43], [-0.19, 0], [0.19, 0], [-0.19, 0.43], [0.19, 0.43],
    ].map(([a, b]) => [expect.closeTo(a, 9), expect.closeTo(b, 9)]));
    expect(railOffset(3, 4)[1]).toBeCloseTo(0.215, 9);
  });

  it('slides each pod row two units aft over the ejection cycle, then snaps back', () => {
    expect(podX(0, 0, 12)).toBeCloseTo(-6.4, 9);
    expect(podX(2, 0, 12)).toBeCloseTo(-7.86, 9);
    expect(podX(0, 6, 12)).toBeCloseTo(-7.4, 9);
    expect(podX(0, 12, 12)).toBeCloseTo(-6.4, 9);
    expect(podX(1, 18, 12)).toBeCloseTo(-8.13, 9);
  });

  it('stops a beam on the bands only when they face it', () => {
    const beam: [V3, V3] = [[1.75, 0, -4.5], [1, 0, 0]];
    expect(wedgeHit(...beam, 0)).toBeNull();
    const hit = wedgeHit(...beam, Math.PI / 2)!;
    expect(hit).not.toBeNull();
    expect(Math.abs(hit[2])).toBeGreaterThan(2.5);
    expect(Math.abs(hit[2])).toBeLessThan(4.5);
    expect(wedgeHit([0, 6, 0], [0, 0, 0], 0)).not.toBeNull();
    expect(wedgeHit([12, 0, 0], [0, 0, 0], 0)).toBeNull();
  });

  it('rolls points about the hull axis like Site B\'s shipRoot', () => {
    const p = rollPoint([1, 0, -0.6], Math.PI / 2);
    expect(p[0]).toBe(1);
    expect(p[1]).toBeCloseTo(0.6, 9);
    expect(p[2]).toBeCloseTo(0, 9);
  });

  it('picks Site B\'s label variants from the class walls and pod lanes', () => {
    expect(bowText({ bow_wall: 'none' }, true)).toBe('BOW / DEEPER THROAT');
    expect(bowText({ bow_wall: 'buckler' }, true)).toBe('BOW BUCKLER / DRIVE APERTURE');
    expect(bowText({ bow_wall: 'full' }, true)).toBe('BOW WALL / CLOSED THROAT');
    expect(bowText({ bow_wall: 'none' }, false)).toBe('BOW');
    expect(sternText({ stern_wall: 'none' }, 6, true)).toBe('STERN / 6 POD LANES');
    expect(sternText({ stern_wall: 'none' }, 0, true)).toBe('STERN / SHALLOWER KILT');
    expect(sternText({ stern_wall: 'full' }, 0, true)).toBe('STERN WALL / CLOSED KILT');
    expect(keyholeText(1)).toBe('KEYHOLE I / DEFENSE');
    expect(keyholeText(2)).toBe('KEYHOLE II / APOLLO');
  });
});

describe('Site B glow and display matching', () => {
  it('follows the radial gradient stops of Site B\'s glow texture', () => {
    expect(glowAlpha(0)).toBe(1);
    expect(glowAlpha(0.12)).toBeCloseTo(0.7, 9);
    expect(glowAlpha(0.35)).toBeCloseTo(0.15, 9);
    expect(glowAlpha(1)).toBe(0);
    expect(glowAlpha(0.6)).toBeLessThan(0.15);
  });

  it('reproduces three\'s ACES at exposure 1.2', () => {
    expect(siteBDisplay([0, 0, 0])).toEqual([expect.closeTo(0, 2), expect.closeTo(0, 2), expect.closeTo(0, 2)]);
    const mid = siteBDisplay([0.18, 0.18, 0.18]);
    expect(mid[0]).toBeGreaterThan(0.55);
    expect(mid[0]).toBeLessThan(0.75);
    expect(siteBDisplay([20, 20, 20])[0]).toBeGreaterThan(0.97);
  });

  it('inverts our grade so faint additive fields land at Site B\'s displayed brightness', () => {
    const shown = (linear: number, exposure = 1) => {
      const x = linear * exposure;
      const y = Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
      return y ** (1 / 2.2);
    };
    for (const d of [0.02, 0.1, 0.4, 0.8]) expect(shown(gradeInverse(d, 1))).toBeCloseTo(d, 4);
    const cyan: [number, number, number] = [0.102, 0.745, 0.896];
    const bg = 3 / 255;
    const one = matchLinear(cyan, 0.04, true);
    const target = bg + 0.04 * siteBDisplay(cyan)[0];
    expect(shown(gradeInverse(bg, 1) + 0.04 * one[0])).toBeCloseTo(target, 3);
    const two = matchLinear(cyan, 0.04, true, false, 2);
    expect(shown(gradeInverse(bg, 1) + 2 * 0.04 * two[0])).toBeCloseTo(bg + 2 * 0.04 * siteBDisplay(cyan)[0], 3);
  });
});

import { describe, expect, it } from 'vitest';
import { createFrame, logBetween, logUntil, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { C_KM_S } from '../../src/core/units';
import { miniPack } from '../fixtures/mini-pack';

describe('solve and the Replay', () => {
  const r = solve(miniPack(), TECH);

  it('is deterministic, and the seed matters', () => {
    expect(solve(miniPack(), TECH).hash).toBe(r.hash);
    expect(solve(miniPack((raw) => { raw.timeline.events[0].seed = 99; }), TECH).hash).not.toBe(r.hash);
  });

  it('never moves anything at or above c', () => {
    expect(Math.max(...r.packets.map((p) => p.maxSpeed))).toBeLessThan(C_KM_S);
  });

  it('conserves launched counts', () => {
    expect(r.packets.reduce((a, p) => a + p.launched.attack, 0)).toBe(40);
    expect(r.stats.launched['blue'].attack).toBe(40);
  });

  it('samples the same frame for the same t in any order (Review Focus 1)', () => {
    const fresh = sampleFrame(r, 300);
    const reused = createFrame(r);
    sampleFrame(r, 800, reused);
    sampleFrame(r, 10, reused);
    sampleFrame(r, 300, reused);
    expect(Array.from(reused.shipPos)).toEqual(Array.from(fresh.shipPos));
    expect(Array.from(reused.packetAlive)).toEqual(Array.from(fresh.packetAlive));
    expect(Array.from(sampleFrame(r, -50).shipPos)).toEqual(Array.from(sampleFrame(r, 0).shipPos));
    expect(sampleFrame(r, 1e9).t).toBe(r.duration_s);
  });

  it('delivers every log entry exactly once across uneven steps (Review Focus 3)', () => {
    const seen = [];
    let prev = -1;
    for (let t = 0; t <= r.duration_s; t += 37) {
      seen.push(...logBetween(r, prev, t));
      prev = t;
    }
    seen.push(...logBetween(r, prev, r.duration_s));
    expect(seen).toEqual(logUntil(r, r.duration_s));
    expect(logBetween(r, 500, 100)).toEqual([]);
  });

  it('shows packets in flight and gone after arrival', () => {
    const p = r.packets[0];
    expect(sampleFrame(r, (p.tLaunch + p.tArrive) / 2).packetAlive[0]).toBeGreaterThan(0);
    expect(sampleFrame(r, p.tArrive + 1).packetAlive[0]).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { DrivePhase, packetPositionAt } from '../../../src/core/replay';
import { solve } from '../../../src/core/solver/solve';
import { TECH } from '../../../src/core/tech';
import { dist } from '../../../src/core/vec';
import { MAX_DOTS_PER_PACKET, planDensity, SALVO_SCATTER, salvoSpreadKm, sampledCount } from '../../../src/render/density';
import { COAST_TRAIL_SHARE, STREAK_TRAIL_S, streakTailT } from '../../../src/render/salvos';
import { getPack } from '../../../src/registry';

describe('missile streak helpers (Site A §4.7)', () => {
  const replay = solve(getPack('training')!, TECH);
  const packet = replay.packets[0];
  const mid = (packet.tLaunch + packet.tArrive) / 2;

  it('trails seven seconds of solved flight, a quarter of that while coasting', () => {
    expect(streakTailT(packet, mid, DrivePhase.Boost, Infinity, 0)).toBeCloseTo(mid - STREAK_TRAIL_S, 9);
    expect(streakTailT(packet, mid, DrivePhase.Coast, Infinity, 0)).toBeCloseTo(mid - STREAK_TRAIL_S * COAST_TRAIL_SHARE, 9);
    expect(streakTailT(packet, packet.tLaunch + 2, DrivePhase.Boost, Infinity, 0)).toBe(packet.tLaunch);
  });

  it('starts a terminal trail no earlier than the terminal leg', () => {
    expect(streakTailT(packet, mid, DrivePhase.Terminal, mid - 1, 0)).toBe(mid - 1);
  });

  it('shortens a tail to the on-screen limit by sampling a later point on the same path', () => {
    const full = streakTailT(packet, mid, DrivePhase.Boost, Infinity, 0);
    const head = packetPositionAt(packet, mid);
    const span = dist(head, packetPositionAt(packet, full));
    const short = streakTailT(packet, mid, DrivePhase.Boost, Infinity, span / 4);
    expect(short).toBeGreaterThan(full);
    expect(short).toBeLessThanOrEqual(mid);
    expect(dist(head, packetPositionAt(packet, short))).toBeLessThanOrEqual(span / 4 + 1e-6);
  });

  it('scatters a salvo like Site A: tight at both ends, widest a third of the way', () => {
    expect(salvoSpreadKm(60e6, 0)).toBe(0);
    expect(salvoSpreadKm(60e6, 1)).toBe(0);
    expect(salvoSpreadKm(60e6, 1 / 3)).toBeCloseTo(60e6 * SALVO_SCATTER, 3);
    expect(salvoSpreadKm(60e6, 0.2)).toBeLessThan(salvoSpreadKm(60e6, 1 / 3));
    expect(salvoSpreadKm(60e6, Number.NaN)).toBe(0);
  });

  it('sizes each packet sample exactly as the density plan does', () => {
    const alive = Uint32Array.from([0, 1, 3, 4, 5, 999, 21_429, 3_000_000]);
    for (const ratio of [1, 2, 4, 8, 16]) {
      const plan = planDensity(alive, ratio);
      alive.forEach((n, i) => expect(sampledCount(n, plan.effectiveRatio)).toBe(plan.perPacket[i]));
      expect(plan.total).toBe(alive.reduce((a, b) => a + b, 0));
    }
    expect(sampledCount(10_000_000, 1)).toBe(MAX_DOTS_PER_PACKET);
  });
});

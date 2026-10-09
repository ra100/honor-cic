import { describe, expect, it } from 'vitest';
import { DrivePhase, packetPositionAt } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { dist } from '../../src/core/vec';
import { beamTheater, packetTrailAt, TRAIL_CAP, trailStride } from '../../src/render/salvos';
import { getPack } from '../../src/registry';

describe('deterministic solved-path trails', () => {
  const replay = solve(getPack('training')!, TECH);
  const packet = replay.packets[0];
  it('samples both endpoints from actual historical segments and clamps launch/arrival boundaries', () => {
    for (const t of [packet.tLaunch, packet.tLaunch + 0.1, (packet.tLaunch + packet.tArrive) / 2, packet.tArrive]) {
      const trail = packetTrailAt(packet, t, DrivePhase.Boost, 1e7);
      expect(trail.head).toEqual(packetPositionAt(packet, t));
      expect(trail.tail).toEqual(packetPositionAt(packet, trail.tailT));
      expect(trail.tailT).toBeGreaterThanOrEqual(packet.tLaunch);
      expect(trail.tailT).toBeLessThanOrEqual(t);
    }
  });
  it('shortens excessive projected tails by sampling a shorter real history window', () => {
    const t = packet.tLaunch + 100;
    const trail = packetTrailAt(packet, t, DrivePhase.Coast, 20_000);
    expect(dist(trail.head, trail.tail)).toBeLessThanOrEqual(300);
    expect(trail.tail).toEqual(packetPositionAt(packet, trail.tailT));
    expect(packetTrailAt(packet, t, DrivePhase.Coast, 20_000)).toEqual(trail);
  });
  it('bounds tail counts at any density without changing the number of missile heads', () => {
    for (const heads of [1, 500, 20_000, 250_000]) expect(Math.ceil(heads / trailStride(heads))).toBeLessThanOrEqual(TRAIL_CAP);
  });
  it('identifies interception theaters from actual packet positions, not an invented PD beam', () => {
    const cm = replay.beams.find((b) => b.kind === 'cm-kill')!;
    const pd = replay.beams.find((b) => b.kind === 'pd-kill')!;
    expect(cm.from).toEqual(cm.to);
    expect(pd.from).toEqual(pd.to);
    expect(beamTheater(cm, replay)).toBe('range');
    expect(beamTheater(pd, replay)).toBe('range');
  });
});

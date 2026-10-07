import { describe, expect, it } from 'vitest';
import { commanderPicture, observerUnit, replayTrackables } from '../../src/core/perceived';
import { unitPosition } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { getPack } from '../../src/registry';

describe('commander picture (MTS §7, Review Focus 5)', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const ftl = pack.meta.ftl_speed_c.value as number;
  const tracks = replayTrackables(replay, 'range');

  it("observes from the side's own fleet", () => {
    const o = observerUnit(replay, 'alliance', 'range', 10);
    expect(o).not.toBeNull();
    expect(replay.units[o!].id).toBe('tf-blue');
  });

  it('places a contact where the target was when its signal left, not where it is now', () => {
    const t = 120;
    const pic = commanderPicture(replay, tracks, 'alliance', 'range', t, ftl);
    const red = pic.contacts.find((c) => c.id === 'tf-red');
    expect(red).toBeDefined();
    expect(red!.age).toBeGreaterThan(0.5);
    const now = unitPosition(replay.units.find((u) => u.id === 'tf-red')!, t);
    const gap = Math.hypot(red!.observed[0] - now[0], red!.observed[1] - now[1], red!.observed[2] - now[2]);
    expect(gap).toBeGreaterThan(100);
  });

  it('shows nothing when the side has no unit in the theater', () => {
    const pic = commanderPicture(replay, tracks, 'nobody', 'range', 10, ftl);
    expect(pic.observer).toBeNull();
    expect(pic.contacts).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { LAYERS, type ViewContext } from '../../src/render/scales/types';
import { SystemView } from '../../src/render/scales/system-view';
import { getPack } from '../../src/registry';

describe('SystemView', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const ctx = (t: number): ViewContext => ({
    replay, pack, tech: TECH, frame: sampleFrame(replay, t, createFrame(replay)),
    layers: Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewContext['layers'],
    perceived: { enabled: false, side: 'alliance' }, density: 4, theater: 'range',
    selectedShip: null, selectedClass: null, reducedMotion: false,
  });
  it('builds bodies, orbits and hyper limits from the pack', () => {
    const v = new SystemView(pack, replay, null);
    v.update(ctx(0));
    const names = v.labels().map((l) => l.text);
    expect(names).toContain('Range star');
    expect(names).toContain('Range planet');
    expect(names.some((n) => n.includes('hyper limit'))).toBe(true);
  });
  it('draws no ground-truth fleets in the perceived picture, only delayed contacts (Review Focus 5)', () => {
    const v = new SystemView(pack, replay, null);
    const c = ctx(30);
    c.perceived = { enabled: true, side: 'alliance' };
    v.update(c);
    expect(v.labels().some((l) => l.cls.split(' ').includes('fleet'))).toBe(false);
    const red = v.labels().find((l) => l.key === 'contact:tf-red');
    expect(red?.sub ?? '').toContain('old');
  });

  it('hides the celestial layer when it is switched off', () => {
    const v = new SystemView(pack, replay, null);
    const c = ctx(0);
    c.layers.celestial = false;
    v.update(c);
    expect(v.labels().some((l) => l.cls.includes('planet'))).toBe(false);
  });
});

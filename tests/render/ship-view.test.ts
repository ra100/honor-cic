import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { ShipView } from '../../src/render/scales/ship-view';
import { LAYERS, type ViewContext } from '../../src/render/scales/types';
import { getPack } from '../../src/registry';

describe('ShipView (Site B class viewer)', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const ctx = (patch: Partial<ViewContext> = {}): ViewContext => ({
    replay, pack, tech: TECH, frame: sampleFrame(replay, 0, createFrame(replay)),
    layers: Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewContext['layers'],
    perceived: { enabled: false, side: 'alliance' }, density: 4, theater: 'range',
    selectedShip: null, selectedClass: null, reducedMotion: false, ...patch,
  });

  it('builds the chosen class to its published dimensions and mounts (MTS §5.4)', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.currentClass()).toBe('saganami-c');
    const [l, b, h] = v.hullKm();
    expect(l).toBeCloseTo(0.61, 6);
    expect(b).toBeCloseTo(0.074, 6);
    expect(h).toBeCloseTo(0.062, 6);
    expect(v.mountCount()).toEqual({ missile: 40, graser: 16 });
  });

  it('always shows the stress bands and sidewalls, the subject of the class view, whatever the global protection layer says', () => {
    const v = new ShipView(pack, replay, null);
    const c = ctx({ selectedClass: 'saganami-c' });
    c.layers.protection = false;
    v.update(c);
    expect(v.wedgeVisible()).toBe(true);
  });

  it('follows the selected ship when no class is chosen', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedShip: replay.ships.findIndex((s) => s.side === 'haven') }));
    expect(v.currentClass()).toBe('rhn-ca');
  });

  it('labels every figure with its evidence class or "unknown"', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    const specs = v.labels().filter((l) => l.cls.includes('spec'));
    expect(specs.length).toBeGreaterThan(3);
    expect(specs.every((l) => /\[(P|W|D|S)\]|unknown/.test(`${l.text} ${l.sub ?? ''}`))).toBe(true);
  });

  it('moves pods astern as the pod demo runs', () => {
    const v = new ShipView(pack, replay, null);
    v.setDemo('pods', 0);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    const before = v.podsOut();
    v.setDemo('pods', 1);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.podsOut()).toBeGreaterThan(before);
  });

  it('fires the starboard broadside in the broadside demo', () => {
    const v = new ShipView(pack, replay, null);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.shotsFiring()).toBe(0);
    v.setDemo('broadside', 0.05);
    v.update(ctx({ selectedClass: 'saganami-c' }));
    expect(v.shotsFiring()).toBeGreaterThan(0);
    expect(v.labels().some((l) => l.text.startsWith('Broadside: 20 tubes and 8 grasers'))).toBe(true);
  });
});

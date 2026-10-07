import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { EngagementView } from '../../src/render/scales/engagement-view';
import { LAYERS, type ViewContext } from '../../src/render/scales/types';
import { getPack } from '../../src/registry';

describe('EngagementView', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const ctx = (t: number, patch: Partial<ViewContext> = {}): ViewContext => ({
    replay, pack, tech: TECH, frame: sampleFrame(replay, t, createFrame(replay)),
    layers: { ...(Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewContext['layers']), commander: false, protection: false },
    perceived: { enabled: false, side: 'alliance' }, density: 1, theater: 'range',
    selectedShip: null, selectedClass: null, reducedMotion: false, ...patch,
  });
  const inFlight = Math.min(...replay.packets.map((p) => p.tLaunch)) + 20;

  it('draws one marker per present ship', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(0));
    expect(v.drawCounts().ships).toBe(replay.ships.length);
  });

  it('samples missiles at the chosen ratio and says so (Review Focus 4)', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(inFlight, { density: 1 }));
    const oneToOne = v.drawCounts().dots;
    expect(oneToOne).toBeGreaterThan(0);
    expect(v.status().samplingText).toContain('Sampling 1:1');
    v.update(ctx(inFlight, { density: 4 }));
    expect(v.drawCounts().dots).toBeLessThan(oneToOne);
    expect(v.status().samplingText).toContain('Sampling 1:4');
  });

  it('never draws ground truth in the perceived picture (Review Focus 5)', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(inFlight, { perceived: { enabled: true, side: 'alliance' } }));
    const c = v.drawCounts();
    expect(c.ships + c.dots + c.lacDots + c.fx + c.wedges + c.links).toBe(0);
    expect(c.contacts).toBeGreaterThan(0);
    expect(v.labels().some((l) => (l.sub ?? '').includes('old'))).toBe(true);
    expect(v.pick(0, 0)).toBeNull();
  });

  it('redraws the same picture after scrubbing away and back (Review Focus 1)', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(inFlight));
    const before = Array.from(v.debugPositions());
    v.update(ctx(inFlight + 200));
    v.update(ctx(inFlight));
    expect(Array.from(v.debugPositions())).toEqual(before);
  });

  it('draws wedges and sidewalls only with the protection layer on', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(0));
    expect(v.drawCounts().wedges).toBe(0);
    const c = ctx(0);
    c.layers.protection = true;
    v.update(c);
    expect(v.drawCounts().wedges).toBe(replay.ships.length);
  });

  it('keeps the user\'s viewing angle and distance while it follows a moving target', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(0));
    v.setPose([0, -50_000, 20_000], [0, 0, 0]);
    const before = v.camera.position.clone();
    v.followTarget([1_000_000, 0, 0]);
    expect(v.camera.position.distanceTo(before)).toBeLessThan(1e-6);
    expect(Array.from(v.toRender([1_000_000, 0, 0]).toArray())).toEqual([0, 0, 0]);
  });

  it('picks a ship under the pointer', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(0));
    const f = sampleFrame(replay, 0, createFrame(replay));
    const ndc = v.toRender(f.shipPos.subarray(0, 3)).project(v.camera);
    const i = v.pick(ndc.x, ndc.y);
    expect(i).not.toBeNull();
    expect(replay.ships[i!].unit).toBe(replay.ships[0].unit);
  });
});

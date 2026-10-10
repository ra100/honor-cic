import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
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
    perceived: { enabled: false, side: 'alliance' }, density: 1, theater: 'range', focusSide: 'alliance', systemFocus: 'primary', ship: { roll: false, pods: true, sails: false, fireT: null },
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
    expect(c.ships + c.dots + c.lacDots + c.fx + c.wedges + c.links + c.trails).toBe(0);
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

  it('picks each displayed glyph as its original ship, not the unspread physical slot', () => {
    const v = new EngagementView(pack, replay, null);
    const c = ctx(0);
    const physical = Array.from(c.frame.shipPos);
    v.update(c);
    const displayed = v.debugPositions();
    for (let ship = 0; ship < replay.ships.length; ship++) {
      const p = new THREE.Vector3().fromArray(displayed, ship * 3).project(v.camera);
      expect(v.pick(p.x, p.y)).toBe(ship);
    }
    expect(Array.from(c.frame.shipPos)).toEqual(physical);
    v.update({ ...c, perceived: { enabled: true, side: 'alliance' } });
    expect(v.drawCounts().ships).toBe(0);
    expect(v.debugPositions()).toHaveLength(0);
    expect(v.pick(0, 0)).toBeNull();
  });

  it('reserves separate display footprints for neighboring fleet centres', () => {
    const v = new EngagementView(pack, replay, null);
    const c = ctx(0);
    replay.units.forEach((unit, i) => {
      c.frame.unitPos.set([i ? 750 : -750, 0, 0], i * 3);
      unit.shipIdx.forEach((ship) => c.frame.shipPos.set([i ? 750 : -750, 0, 0], ship * 3));
    });
    v.setPose([0, -50_000, 50_000], [0, 0, 0]);
    v.update(c);
    const bounds = v.labels().filter((label) => label.key.startsWith('unit:')).map((label) => {
      const points = label.avoid!.map((p) => p.clone().project(v.camera));
      return { left: Math.min(...points.map((p) => p.x)), right: Math.max(...points.map((p) => p.x)) };
    });
    expect(bounds).toHaveLength(2);
    bounds.sort((a, b) => a.left - b.left);
    expect(bounds[0].right).toBeLessThan(bounds[1].left);
  });

  it('preserves a director pose applied before the first update and reframes measured safe space', () => {
    const v = new EngagementView(pack, replay, null);
    v.setPose([0, -50_000, 20_000], [0, 0, 0]);
    const offset = v.camera.position.clone();
    const c = ctx(0, { plotInsets: { top: 50, right: 220, bottom: 150, left: 20 } });
    v.update(c);
    expect(v.camera.position.clone().normalize().distanceTo(offset.normalize())).toBeLessThan(1e-6);
    const centre = v.toRender([0, 0, 0]).project(v.camera);
    expect(centre.x).toBeCloseTo(-0.2, 6);
    expect(centre.y).toBeCloseTo(0.1, 6);
    const framed = v.camera.position.clone();
    v.update(c);
    expect(v.camera.position.toArray()).toEqual(framed.toArray());
  });

  it('thins bounded solved-path trails at density changes, without changing physical ships or determinism', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(inFlight));
    const trails = Array.from(v.debugTrails());
    const count = v.drawCounts().trails;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(8192);
    const ships = Array.from(v.debugPositions().subarray(0, v.drawCounts().ships * 3));
    v.update(ctx(inFlight, { density: 4 }));
    expect(v.drawCounts().trails).toBeLessThan(count);
    expect(Array.from(v.debugPositions().subarray(0, v.drawCounts().ships * 3))).toEqual(ships);
    v.update(ctx(inFlight + 200));
    v.update(ctx(inFlight));
    expect(Array.from(v.debugTrails())).toEqual(trails);
  });

  it('ends a firing ray at its replay duration, not a made-up visual firing tail', () => {
    const beam = { ...replay.beams.find((b) => b.kind === 'laserhead')!, t: 100, dur: 0.35 };
    const local = { ...replay, beams: [beam] };
    const v = new EngagementView(pack, local, null);
    v.update({ ...ctx(100.1), replay: local, frame: sampleFrame(local, 100.1, createFrame(local)) });
    expect(v.drawCounts().fx).toBe(2);
    v.update({ ...ctx(beam.t + beam.dur), replay: local, frame: sampleFrame(local, beam.t + beam.dur, createFrame(local)) });
    expect(v.drawCounts().fx).toBe(0);
    expect(beam.dur).toBe(0.35);
  });

  it('does not draw another theater’s attacks', () => {
    const beam = { ...replay.beams.find((b) => b.kind === 'laserhead')!, ship: 0, t: 100, dur: 0.35 };
    const unit = replay.ships[0].unit;
    const local = { ...replay, beams: [beam], units: replay.units.map((u, i) => i === unit ? { ...u, theater: 'elsewhere' } : u) };
    const v = new EngagementView(pack, local, null);
    v.update({ ...ctx(100.1), replay: local, frame: sampleFrame(local, 100.1, createFrame(local)) });
    expect(v.drawCounts().fx).toBe(0);
  });

  it('bounds LAC samples and uses distinct chevrons without pretending they are physical slots', () => {
    const original = replay.units[0];
    const local = { ...replay, units: [{ ...original, kind: 'lac' as const, shipIdx: [], lacCount: [{ t: 0, count: 50_000 }] }, ...replay.units.slice(1)] };
    const v = new EngagementView(pack, local, null);
    v.update({ ...ctx(0), replay: local, frame: sampleFrame(local, 0, createFrame(local)) });
    expect(v.drawCounts().lacDots).toBe(4_000);
    expect(v.status().scaleNote).toContain('Packet/LAC spread');
  });
});

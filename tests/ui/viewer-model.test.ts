import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame, ShipStatus } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import {
  advance, autoSpeed, composition, eventIndex, forcesModel, initialState, inspectorModel, logModel, nextPhase, phaseMarks, prevPhase,
  scaleSelection, shipClassId, sourceText, tickLabels, knownSide, perceivedSelection,
} from '../../src/ui/viewer/model';
import { getPack } from '../../src/registry';

describe('viewer model', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const ix = eventIndex(replay);

  it('starts paused at T0 with Auto speed, director camera and 1:4 density', () => {
    const s = initialState(pack, false);
    expect(s).toMatchObject({ t: 0, playing: false, speed: 'auto', camera: 'director', density: 4, theater: 'range', shipFraming: 'hull', motionOverride: null });
    expect(s.layers.protection).toBe(false);
    expect(s.perceived).toEqual({ enabled: false, side: 'alliance' });
  });

  it('slows Auto playback near events and speeds through quiet stretches', () => {
    const busy = replay.packets[0].tArrive;
    expect(autoSpeed(ix, busy)).toBeLessThanOrEqual(2);
    const quiet = { times: new Float64Array([0, 10_000]) };
    expect(autoSpeed(quiet, 5_000)).toBe(240);
  });

  it('advances by wall time times rate, clamps long frames and stops at the end', () => {
    const s = { ...initialState(pack, false), playing: true, speed: 60 as const };
    expect(advance(s, 0.1, ix, replay.duration_s).t).toBeCloseTo(6, 9);
    expect(advance(s, 5, ix, replay.duration_s).t).toBeCloseTo(15, 9);
    const end = advance({ ...s, t: replay.duration_s - 1 }, 0.25, ix, replay.duration_s);
    expect(end).toEqual({ t: replay.duration_s, playing: false });
    expect(advance({ ...s, playing: false, t: 3 }, 1, ix, replay.duration_s)).toEqual({ t: 3, playing: false });
  });

  it('uses cinematic pacing only for Director + Auto, preserving Free + Auto and manual speeds', () => {
    const s = { ...initialState(pack, false), playing: true, t: 500, speed: 'auto' as const };
    expect(advance(s, 0.1, ix, replay.duration_s, 0.25).t).toBeCloseTo(500.025);
    expect(advance({ ...s, speed: 60 }, 0.1, ix, replay.duration_s, 0.25).t).toBe(506);
    expect(advance({ ...s, camera: 'free' }, 0.1, ix, replay.duration_s, 0.25).t).toBe(500 + autoSpeed(ix, 500) * 0.1);
  });

  it('has genuinely different battle and inspection compositions', () => {
    expect(composition({ scale: 'system', shipReplay: false })).toEqual({ battle: true, engagement: false, system: true, ship: false, transport: true });
    expect(composition({ scale: 'engagement', shipReplay: false })).toEqual({ battle: true, engagement: true, system: false, ship: false, transport: true });
    expect(composition({ scale: 'ship', shipReplay: false })).toEqual({ battle: false, engagement: false, system: false, ship: true, transport: false });
    expect(composition({ scale: 'ship', shipReplay: true }).transport).toBe(true);
  });

  it('closes battle context when inspecting without changing framing, time or replay speed', () => {
    const s = { ...initialState(pack, false), t: 50, speed: 60, shipFraming: 'defenses' as const };
    const next = { ...s, ...scaleSelection('ship') };
    expect(next).toMatchObject({ scale: 'ship', camera: 'free', drawer: 'none', menu: 'none', demo: 'none', t: 50, speed: 60, shipFraming: 'defenses' });
    expect(shipClassId(replay, { selectedShip: 0, selectedClass: null })).toBe(replay.ships[0].classId);
    expect(shipClassId(replay, { selectedShip: 0, selectedClass: 'rhn-ca' })).toBe('rhn-ca');
    expect(shipClassId(replay, { selectedShip: null, selectedClass: null })).toBe((replay.ships.find((ship) => ship.flagship && ship.side === replay.sides[0].id) ?? replay.ships[0]).classId);
  });

  it('steps between phases', () => {
    const marks = phaseMarks(pack, replay);
    expect(marks.map((m) => m.id)).toEqual(['open']);
    expect(nextPhase(marks, 0)).toBeNull();
    expect(prevPhase(marks, 100)).toBe(0);
  });

  it('hides a phase label that would collide with the previous one, keeping the tick', () => {
    const marks = [{ id: 'a', label: 'A', t: 0 }, { id: 'b', label: 'B', t: 100 }, { id: 'c', label: 'C', t: 5000 }];
    const ticks = tickLabels(marks, 10_000);
    expect(ticks.map((k) => k.showLabel)).toEqual([true, false, true]);
    expect(ticks.map((k) => k.left)).toEqual([0, 1, 50]);
  });

  it('counts ships by status per unit, with text for every status', () => {
    const frame = sampleFrame(replay, replay.duration_s, createFrame(replay));
    const sides = forcesModel(replay, frame);
    expect(sides.map((s) => s.id)).toEqual(['alliance', 'haven']);
    const blue = sides[0].units[0];
    expect(blue.total).toBe(4);
    expect(blue.counts.reduce((n, c) => n + c.n, 0)).toBe(4);
    expect(blue.counts.every((c) => c.text.length > 2)).toBe(true);
  });

  it('describes a ship with labelled figures and subsystem state', () => {
    const m = inspectorModel(pack, TECH, replay, 0, 0);
    expect(m.className).toBe('Edward Saganami-C-class CA');
    expect(m.status).toBe('operational');
    expect(m.subsystems.every((s) => s.ok)).toBe(true);
    expect(m.figures.find((f) => f.label === 'Broadside tubes')?.value).toBe('20 [W]');
    expect(m.figures.every((f) => /\[(P|W|D|S)\]|unknown/.test(f.value))).toBe(true);
    expect(sourceText(pack, { source_id: 'mts', locator: '§5.4' })).toContain('§5.4');
  });

  it('filters the CIC log by side and keeps the most recent entries', () => {
    const all = logModel(replay, replay.duration_s, 'all', 1000);
    const blue = logModel(replay, replay.duration_s, 'alliance', 1000);
    expect(blue.length).toBeLessThanOrEqual(all.length);
    expect(blue.every((l) => l.side === 'alliance' || l.side === null)).toBe(true);
    expect(logModel(replay, replay.duration_s, 'all', 2).length).toBeLessThanOrEqual(2);
  });

  it('in the perceived picture shows only the commander\'s own forces, log and selection (Review Focus 5)', () => {
    const s = { ...initialState(pack, false), perceived: { enabled: true, side: 'alliance' } };
    expect(knownSide(s)).toBe('alliance');
    expect(knownSide({ ...s, perceived: { enabled: false, side: 'alliance' } })).toBeNull();
    const frame = sampleFrame(replay, replay.duration_s, createFrame(replay));
    expect(forcesModel(replay, frame, 'alliance').map((x) => x.id)).toEqual(['alliance']);
    const rows = logModel(replay, replay.duration_s, 'all', 1000, 'alliance');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.side === 'alliance')).toBe(true);
    const enemy = replay.ships.findIndex((x) => x.side === 'haven');
    const own = replay.ships.findIndex((x) => x.side === 'alliance');
    expect(perceivedSelection(replay, { ...s, selectedShip: enemy })).toBeNull();
    expect(perceivedSelection(replay, { ...s, selectedShip: own })).toBe(own);
    expect(perceivedSelection(replay, { ...s, perceived: { enabled: false, side: 'alliance' }, selectedShip: enemy })).toBe(enemy);
  });

  it('never reports a destroyed ship as operational in the forces table', () => {
    const frame = sampleFrame(replay, replay.duration_s, createFrame(replay));
    const destroyed = Array.from(frame.shipStatus).filter((s) => s === ShipStatus.Destroyed).length;
    const listed = forcesModel(replay, frame).flatMap((s) => s.units).flatMap((u) => u.counts).filter((c) => c.status === ShipStatus.Destroyed).reduce((n, c) => n + c.n, 0);
    expect(listed).toBe(destroyed);
  });
});

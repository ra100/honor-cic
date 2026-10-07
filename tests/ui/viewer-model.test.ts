import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame, ShipStatus } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import {
  advance, autoSpeed, eventIndex, forcesModel, initialState, inspectorModel, logModel, nextPhase, phaseMarks, prevPhase, sourceText, tickLabels,
} from '../../src/ui/viewer/model';
import { getPack } from '../../src/registry';

describe('viewer model', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const ix = eventIndex(replay);

  it('starts paused at T0 with Auto speed, director camera and 1:4 density', () => {
    const s = initialState(pack, false);
    expect(s).toMatchObject({ t: 0, playing: false, speed: 'auto', camera: 'director', density: 4, theater: 'range' });
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

  it('never reports a destroyed ship as operational in the forces table', () => {
    const frame = sampleFrame(replay, replay.duration_s, createFrame(replay));
    const destroyed = Array.from(frame.shipStatus).filter((s) => s === ShipStatus.Destroyed).length;
    const listed = forcesModel(replay, frame).flatMap((s) => s.units).flatMap((u) => u.counts).filter((c) => c.status === ShipStatus.Destroyed).reduce((n, c) => n + c.n, 0);
    expect(listed).toBe(destroyed);
  });
});

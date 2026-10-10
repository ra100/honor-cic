import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame, ShipStatus } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { LM_KM } from '../../src/core/units';
import { shotsFor } from '../../src/render/director';
import { getPack } from '../../src/registry';
import { forceUnits, limitText, monthYear, phaseAt, phaseSpans, salvoTicks, shotNumbers, speedChip, tallies } from '../../src/ui/viewer/hud-model';
import { phaseMarks } from '../../src/ui/viewer/model';

describe('HUD model (Site A tallies, forces, scrubber and captions)', () => {
  const pack = getPack('manticore')!;
  const replay = solve(pack, TECH);
  const marks = phaseMarks(pack, replay);

  it('counts missiles in space, detonations and losses from the replay only', () => {
    const before = tallies(replay, sampleFrame(replay, 0, createFrame(replay)));
    const firstArrival = Math.min(...replay.packets.map((p) => p.tArrive));
    const midFlight = tallies(replay, sampleFrame(replay, firstArrival - 1, createFrame(replay)));
    expect(midFlight.inSpace).toBeGreaterThan(0);
    expect(midFlight.inSpaceBySide.reduce((a, b) => a + b.n, 0)).toBe(midFlight.inSpace);
    expect(midFlight.launched).toBeGreaterThanOrEqual(midFlight.inSpace);
    expect(before.lost).toEqual({ ally: 0, hostile: 0 });
    const end = sampleFrame(replay, replay.duration_s, createFrame(replay));
    const last = tallies(replay, end);
    expect(last.inSpace).toBe(0);
    expect(last.detonated).toBeGreaterThan(0);
    expect(last.detonated + last.stopped).toBe(last.launched);
    const destroyed = replay.ships.filter((_, i) => end.shipStatus[i] === ShipStatus.Destroyed).length;
    expect(last.lost.ally + last.lost.hostile).toBe(destroyed);
  });

  it('builds Forces bars per role with exact totals and the limit status', () => {
    const units = forceUnits(pack, replay, sampleFrame(replay, 0, createFrame(replay)));
    const home = units.find((u) => u.id === 'home-fleet')!;
    expect(home.ally).toBe(true);
    expect(home.commander).toBe("Fleet Admiral Sebastian D'Orville");
    expect(home.limit).toBe('Inside limit');
    expect(home.bars.reduce((a, b) => a + b.total, 0)).toBe(replay.units.find((u) => u.id === 'home-fleet')!.shipIdx.length);
    expect(units.find((u) => u.id === 'fifth-fleet')!.dormant).toBe(true);
    expect(limitText(pack, [30 * LM_KM, 0, 0], 0)).toBe('Outside limit');
  });

  it('lays phase segments end to end and puts one tick on each salvo', () => {
    const spans = phaseSpans(marks, replay.duration_s);
    expect(spans.reduce((a, b) => a + b.width, 0)).toBeCloseTo(100 - (spans[0]?.left ?? 0), 6);
    const ticks = salvoTicks(replay);
    expect(ticks.length).toBeGreaterThan(10);
    expect(ticks.some((t) => t.cls === 'sa')).toBe(true);
    expect(ticks.every((t) => t.left >= 0 && t.left <= 100)).toBe(true);
    expect(phaseAt(marks, 0)?.id).toBe(marks[0].id);
  });

  it('numbers shots by sequence and formats the clock chip', () => {
    const shots = shotsFor(pack, replay);
    const numbers = shotNumbers(shots, marks);
    expect(numbers.get(shots[0].id)?.no).toBe('1.1');
    expect(new Set([...numbers.values()].map((n) => n.no)).size).toBe(shots.length);
    expect(speedChip(false, 'auto', 24)).toBe('paused');
    expect(speedChip(true, 'auto', 24)).toBe('×24');
    expect(speedChip(true, 'auto', 0.35)).toBe('slow ×0.35');
    expect(speedChip(true, 4, 99)).toBe('×4');
    expect(monthYear(pack)).toBe('July 1921 PD');
  });
});

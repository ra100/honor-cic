import { describe, expect, it } from 'vitest';
import { createFrame, lacCountAt, sampleFrame, ShipStatus } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { LM_KM } from '../../src/core/units';
import { shotsFor } from '../../src/render/director';
import { getPack } from '../../src/registry';
import { cycleFollow, debrief, followGroups, followLabel, forceUnits, limitText, monthYear, phaseAt, phaseSpans, salvoTicks, scaleBar, shotNumbers, speedChip, tallies } from '../../src/ui/viewer/hud-model';
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
    // LAC strength reads aboard before launch and the survivors after recovery, not zero.
    const hfLacs = replay.units.find((u) => u.id === 'hf-lacs')!;
    const lacsAt = (t: number) => forceUnits(pack, replay, sampleFrame(replay, t, createFrame(replay))).find((u) => u.id === 'hf-lacs')!;
    expect(lacsAt(0).lacText).toBe('2,300/2,300');
    expect(lacsAt(replay.duration_s).lacText).toBe(`${lacCountAt(hfLacs, replay.duration_s).toLocaleString('en-US')}/2,300`);
    expect(lacCountAt(hfLacs, replay.duration_s)).toBeGreaterThan(0);
  });

  it('lists follow targets per theater, LAC groups included, and only the own side when perceived', () => {
    const f = sampleFrame(replay, 1860, createFrame(replay));
    const groups = followGroups(pack, replay, f, null);
    expect(groups.map((g) => g.label)).toEqual(pack.meta.theaters.map((th) => th.label));
    const all = groups.flatMap((g) => g.choices);
    expect(all).toHaveLength(replay.units.length);
    expect(all.find((c) => c.id === 'hf-lacs')).toMatchObject({ name: 'Home Fleet LACs', ally: true, present: true });
    expect(all.find((c) => c.id === 'second-fleet')).toMatchObject({ ally: false, present: true });
    expect(all.find((c) => c.id === 'fifth-fleet')!.present).toBe(false);
    const own = followGroups(pack, replay, f, 'alliance').flatMap((g) => g.choices);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((c) => c.ally)).toBe(true);
  });

  it('cycles the follow target through the present units of the theater and names what is followed', () => {
    const groups = followGroups(pack, replay, sampleFrame(replay, 1860, createFrame(replay)), null);
    const present = groups.find((g) => g.theater === 'sphinx')!.choices.filter((c) => c.present).map((c) => c.id);
    expect(present.length).toBeGreaterThan(2);
    expect(cycleFollow(groups, 'sphinx', null, 1)).toBe(present[0]);
    expect(cycleFollow(groups, 'sphinx', present[0], 1)).toBe(present[1]);
    expect(cycleFollow(groups, 'sphinx', present[0], -1)).toBe(present[present.length - 1]);
    expect(cycleFollow(groups, 'junction', null, 1)).toBe('diamato');
    expect(followLabel(replay, ['hf-lacs'])).toBe('Home Fleet LACs');
    expect(followLabel(replay, ['home-fleet', 'second-fleet'])).toBe('Home Fleet and Second Fleet');
    expect(followLabel(replay, [])).toBeNull();
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

  it('snaps the scale bar to 1, 2 or 5 of a decade near 110 px, in light-minutes past 2 LM', () => {
    expect(scaleBar(3000 / 110)).toEqual({ widthPx: 73.3, label: '2,000 km' });
    expect(scaleBar(7e6 / 110)).toEqual({ widthPx: 78.6, label: '5 million km' });
    const far = scaleBar((66.7 * LM_KM) / 110)!;
    expect(far.label).toBe('50 light-minutes');
    expect(far.widthPx).toBeCloseTo(82.5, 1);
    expect(scaleBar(0.9 / 110)).toEqual({ widthPx: 61.1, label: '500 m' });
    expect(scaleBar(1.5 / 110)).toEqual({ widthPx: 73.3, label: '1 km' });
    expect(scaleBar(0)).toBeNull();
    expect(scaleBar(Number.NaN)).toBeNull();
  });

  it('sums the after-action debrief from the final frame and the packet survivors', () => {
    const end = sampleFrame(replay, replay.duration_s, createFrame(replay));
    const d = debrief(pack, replay);
    expect(d.rows.map((r) => r.id)).toEqual(replay.units.map((u) => u.id));
    for (const row of d.rows) {
      const u = replay.units.find((x) => x.id === row.id)!;
      expect(row.kind).toBe(u.kind);
      if (u.kind === 'fleet') {
        expect(row.strength).toBe(u.shipIdx.length);
        expect(row.destroyed + row.crippled + row.captured + row.escaped).toBeLessThanOrEqual(row.strength);
      } else {
        expect(row.strength).toBe(u.lacCount[0].count);
        // LACs leave the count only through canon outcomes: destroyed, or captured and abandoned.
        expect(row.destroyed + row.captured).toBe(u.lacCount[0].count - lacCountAt(u, replay.duration_s));
      }
    }
    const lacs = (id: string) => d.rows.find((r) => r.id === id)!;
    expect(lacs('sf-lacs').captured).toBeGreaterThan(0);
    const destroyed = replay.ships.filter((_, i) => end.shipStatus[i] === ShipStatus.Destroyed).length;
    expect(d.rows.filter((r) => r.kind === 'fleet').reduce((a, r) => a + r.destroyed, 0)).toBe(destroyed);
    const launched = replay.packets.reduce((a, p) => a + p.launched.attack + p.launched.ew, 0);
    expect(d.launched.reduce((a, x) => a + x.n, 0)).toBe(launched);
    expect(d.detonated).toBe(tallies(replay, end).detonated);
    for (const p of replay.packets.slice(0, 40)) {
      const at = tallies(replay, sampleFrame(replay, p.tLaunch + 0.5, createFrame(replay))).inSpace;
      expect(d.peak.n).toBeGreaterThanOrEqual(at);
    }
    expect(d.peak.n).toBe(tallies(replay, sampleFrame(replay, d.peak.t, createFrame(replay))).inSpace);
  });
});

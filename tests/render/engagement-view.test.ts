import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { fmtCount } from '../../src/core/units';
import { planDensity } from '../../src/render/density';
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

  it('centres the range rings on my fleet and strings true distances along the bearing to the enemy', () => {
    const v = new EngagementView(pack, replay, null);
    const c = ctx(inFlight);
    v.update(c);
    const at = (i: number) => Array.from(c.frame.unitPos.subarray(i * 3, i * 3 + 3));
    const mine = replay.units.findIndex((u) => u.side === 'alliance');
    const enemy = replay.units.findIndex((u) => u.side === 'haven');
    const plan = v.ringPlan()!;
    expect(plan.unit).toBe(mine);
    expect(plan.centre).toEqual(at(mine));
    const [dx, dy] = [at(enemy)[0] - at(mine)[0], at(enemy)[1] - at(mine)[1]];
    expect(plan.bearing[0]).toBeCloseTo(dx / Math.hypot(dx, dy), 9);
    expect(plan.bearing[1]).toBeCloseTo(dy / Math.hypot(dx, dy), 9);
    expect(plan.enemyKm).toBeCloseTo(Math.hypot(dx, dy, at(enemy)[2] - at(mine)[2]), 3);
    expect(plan.labels.length).toBeGreaterThan(0);
    for (const label of plan.labels) {
      expect(label.km % (2 * plan.step)).toBe(0);
      expect(label.km).toBeLessThan(plan.radius);
    }
    v.update({ ...c, focusSide: 'haven' });
    expect(v.ringPlan()!.unit).toBe(enemy);
  });

  it('keeps the true missile count while sampling and thinning streaks', () => {
    const v = new EngagementView(pack, replay, null);
    for (const density of [1, 4, 16]) {
      const c = ctx(inFlight, { density });
      v.update(c);
      const alive = Uint32Array.from(replay.packets, (p, i) => replay.units[p.toUnit].theater === 'range' ? c.frame.packetAlive[i] : 0);
      const plan = planDensity(alive, density);
      expect(v.status().samplingText).toContain(`${fmtCount(plan.total)} missiles in flight`);
      expect(v.drawCounts().dots).toBe(plan.dots);
      expect(v.drawCounts().trails).toBeLessThanOrEqual(plan.dots);
    }
  });

  it('never moves the solved replay it draws', () => {
    const c = ctx(inFlight);
    const before = [c.frame.shipPos, c.frame.unitPos, c.frame.packetPos, c.frame.packetAlive].map((a) => Array.from(a));
    const v = new EngagementView(pack, replay, null);
    v.update(c);
    v.update({ ...c, density: 16 });
    v.update({ ...c, focusSide: 'haven' });
    expect([c.frame.shipPos, c.frame.unitPos, c.frame.packetPos, c.frame.packetAlive].map((a) => Array.from(a))).toEqual(before);
    const fresh = sampleFrame(replay, inFlight, createFrame(replay));
    expect(Array.from(fresh.packetPos)).toEqual(before[2]);
  });

  it('labels each fleet with Site A’s name over commander and wall strength', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(inFlight));
    const fleets = v.labels().filter((l) => l.key.startsWith('unit:'));
    expect(fleets).toHaveLength(2);
    for (const label of fleets) {
      expect(label.cls).toMatch(/^fleet (allied|hostile)$/);
      expect(label.sub).toMatch(/\d+ ships( of the wall)?$/);
    }
    expect(fleets.map((l) => l.cls).sort()).toEqual(['fleet allied', 'fleet hostile']);
  });

  it('keeps its own ring and fleet labels off the HUD boxes over the plot', () => {
    const v = new EngagementView(pack, replay, null);
    v.update(ctx(inFlight));
    expect(v.drawCounts().rings).toBeGreaterThan(0);
    v.update(ctx(inFlight, { obstacles: [{ x: -1e4, y: -1e4, width: 2e4, height: 2e4 }] }));
    expect(v.drawCounts().rings).toBe(0);
    expect(v.labels().filter((l) => l.key.startsWith('unit:') && l.offset)).toHaveLength(0);
  });

  it('bounds LAC dots and says the squadron layout is a display aid', () => {
    const original = replay.units[0];
    const local = { ...replay, units: [{ ...original, kind: 'lac' as const, shipIdx: [], lacCount: [{ t: 0, count: 50_000 }] }, ...replay.units.slice(1)] };
    const v = new EngagementView(pack, local, null);
    v.update({ ...ctx(0), replay: local, frame: sampleFrame(local, 0, createFrame(local)) });
    expect(v.drawCounts().lacDots).toBe(4_000);
    expect(v.status().scaleNote).toContain('squadron of 12 on its wing\'s disc, also four times life size');
  });
});

describe('EngagementView in 3D: formations and launches (Manticore)', () => {
  const pack = getPack('manticore')!;
  const replay = solve(pack, TECH);
  const ctx = (r: typeof replay, t: number): ViewContext => ({
    replay: r, pack, tech: TECH, frame: sampleFrame(r, t, createFrame(r)),
    layers: { ...(Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewContext['layers']), commander: false, protection: false },
    perceived: { enabled: false, side: 'alliance' }, density: 1, theater: 'sphinx', focusSide: 'alliance', systemFocus: 'primary',
    ship: { roll: false, pods: true, sails: false, fireT: null }, selectedShip: null, selectedClass: null, reducedMotion: false,
  });
  const unit = (id: string) => replay.units.findIndex((u) => u.id === id);
  const centreOf = (c: ViewContext, i: number): [number, number, number] => [c.frame.unitPos[i * 3], c.frame.unitPos[i * 3 + 1], c.frame.unitPos[i * 3 + 2]];
  const orbitPose = (v: EngagementView, centre: [number, number, number], azDeg: number, elDeg: number, km: number) => {
    const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
    v.setPose([centre[0] + km * Math.cos(el) * Math.cos(az), centre[1] + km * Math.cos(el) * Math.sin(az), centre[2] + km * Math.sin(el)], centre);
  };

  it('keeps each fleet\'s formation in 3D while the camera orbits it, instead of turning a flat grid to face the camera', () => {
    const v = new EngagementView(pack, replay, null);
    const c = ctx(replay, 0);
    const hf = centreOf(c, unit('home-fleet'));
    const shipsAt = (az: number, el: number) => {
      orbitPose(v, hf, az, el, 20e6);
      v.update(c);
      return Array.from(v.debugPositions().subarray(0, v.drawCounts().ships * 3));
    };
    const reference = shipsAt(-30, 25);
    expect(reference.length).toBeGreaterThan(300);
    for (const [az, el] of [[0, 25], [60, 10], [150, 45], [210, -20], [300, 70], [-30, 0]]) {
      const moved = shipsAt(az, el);
      expect(moved).toHaveLength(reference.length);
      const worst = moved.reduce((m, x, i) => Math.max(m, Math.abs(x - reference[i])), 0);
      expect(worst).toBeLessThan(1);
    }
  });

  it('frames a unit picked to follow when it is off the plot or too small to read, and leaves a framed one alone', () => {
    const v = new EngagementView(pack, replay, null);
    const c = ctx(replay, 1860);
    const lacs = unit('hf-lacs');
    const centre = centreOf(c, lacs);
    const look = () => v.camera.position.length();
    orbitPose(v, centre, 210, 25, 150e6);
    v.update(c);
    v.frameUnit(lacs);
    v.update(c);
    expect(look()).toBeLessThan(20e6);
    const at = v.toRender(centre).project(v.camera);
    expect(Math.abs(at.x)).toBeLessThan(0.5);
    expect(Math.abs(at.y)).toBeLessThan(0.5);
    orbitPose(v, centre, 210, 25, 4e6);
    v.update(c);
    const before = v.camera.position.clone();
    v.frameUnit(lacs);
    v.update(c);
    expect(v.camera.position.distanceTo(before)).toBeLessThan(1);
  });

  it('fires each missile from a ship of the launching fleet and brings it down on a ship of the target fleet', () => {
    const hfIdx = unit('home-fleet'), sfIdx = unit('second-fleet');
    const packet = replay.packets.find((p) => p.fromUnit === hfIdx && p.toUnit === sfIdx && p.tLaunch > 0)!;
    const local = { ...replay, packets: [{ ...packet, idx: 0 }] };
    const v = new EngagementView(pack, local, null);
    const headsNearShips = (t: number, fleet: number, toleranceKm: number) => {
      const c = ctx(local, t);
      orbitPose(v, centreOf(c, fleet), 210, 25, 20e6);
      v.update(c);
      const glyphs = local.units[fleet].shipIdx.flatMap((s) => v.shipOnPlot(s) ?? []);
      expect(glyphs.length).toBeGreaterThan(100);
      const heads = v.debugPositions().subarray(v.drawCounts().ships * 3);
      expect(heads.length / 3).toBeGreaterThan(30);
      let far = 0;
      for (let h = 0; h < heads.length; h += 3) {
        const d = Math.min(...glyphs.map((g) => Math.hypot(g.x - heads[h], g.y - heads[h + 1], g.z - heads[h + 2])));
        if (d > toleranceKm) far++;
      }
      return far / (heads.length / 3);
    };
    // Glyphs are a few hundred thousand km apart at 20 Mkm, so these tolerances single out the glyphs themselves. Missiles
    // close at up to 0.8 c, so the landing is checked 0.02 s out (about 5,000 km), inside the terminal scatter.
    expect(headsNearShips(packet.tLaunch + 1, hfIdx, 3_000)).toBe(0);
    expect(headsNearShips(packet.tArrive - 0.02, sfIdx, 25_000)).toBe(0);
  });

  it('ends Shrike graser fire on a live ship drawn near the LAC that fires, even when the solved target is already lost', () => {
    const sf = unit('second-fleet');
    const t = 1868.5;
    const local = { ...replay, packets: [], beams: replay.beams.filter((b) => b.kind === 'graser' && b.toUnit === sf) };
    const v = new EngagementView(pack, local, null);
    const c = ctx(local, t);
    orbitPose(v, centreOf(c, sf), 210, 25, 5e6);
    v.update(c);
    const live = local.units[sf].shipIdx.flatMap((s) => v.shipOnPlot(s) ?? []);
    const segs = v.debugBeams();
    expect(segs.length / 6).toBeGreaterThan(20);
    let longest = 0;
    let offGlyph = 0;
    for (let k = 0; k < segs.length; k += 6) {
      longest = Math.max(longest, Math.hypot(segs[k + 3] - segs[k], segs[k + 4] - segs[k + 1], segs[k + 5] - segs[k + 2]));
      const end = Math.min(...live.map((g) => Math.hypot(g.x - segs[k + 3], g.y - segs[k + 4], g.z - segs[k + 5])));
      if (end > 1) offGlyph++;
    }
    expect(offGlyph).toBe(0);
    // The wing passes through the wall face to face, so each Shrike fires at a ship drawn close by.
    expect(longest).toBeLessThan(400_000);
  });

  it('flies each Ferret packet from its lane of LACs onto the ships around its aim, not across the whole wall', () => {
    const ferret = replay.packets.find((p) => p.planId === 'lac-ferret-flush' && p.targetShip >= 0)!;
    const local = { ...replay, packets: [{ ...ferret, idx: 0 }] };
    const v = new EngagementView(pack, local, null);
    const c = ctx(local, ferret.tArrive - 0.02);
    orbitPose(v, centreOf(c, unit('second-fleet')), 210, 25, 5e6);
    v.update(c);
    const heads = v.debugPositions().subarray(v.drawCounts().ships * 3);
    const n = heads.length / 3;
    expect(n).toBeGreaterThan(30);
    const mid = [0, 1, 2].map((k) => heads.reduce((a, x, j) => (j % 3 === k ? a + x / n : a), 0));
    let worst = 0;
    for (let h = 0; h < heads.length; h += 3) worst = Math.max(worst, Math.hypot(heads[h] - mid[0], heads[h + 1] - mid[1], heads[h + 2] - mid[2]));
    // Second Fleet is drawn over 2 Mkm; the ships around one aim sit within a few hundred thousand km of each other.
    expect(worst).toBeLessThan(400_000);
  });
});

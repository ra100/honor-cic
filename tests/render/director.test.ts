import { describe, expect, it } from 'vitest';
import { createFrame, sampleFrame } from '../../src/core/replay';
import { solve } from '../../src/core/solver/solve';
import { TECH } from '../../src/core/tech';
import { dist } from '../../src/core/vec';
import { CameraRig, directorPose, directorSpeed, followSubjects, perceivedSubject, shotAt, shotsFor, subjectCentroid, type DirectorPose } from '../../src/render/director';
import { lacFront } from '../../src/core/solver/lac-wing';
import { FORMATION_SCALE } from '../../src/render/formations';
import { getPack } from '../../src/registry';

describe('director', () => {
  const pack = getPack('training')!;
  const replay = solve(pack, TECH);
  const shots = shotsFor(pack, replay);
  const frameAt = (t: number) => sampleFrame(replay, t, createFrame(replay));
  const az = (p: DirectorPose) => (Math.atan2(p.eye[1] - p.target[1], p.eye[0] - p.target[0]) * 180) / Math.PI;

  it('orders shots by resolved start and closes each at the next start', () => {
    expect(shots[0].id).toBe('overview');
    expect(shots[0].t0).toBe(0);
    for (let i = 0; i < shots.length; i++) {
      expect(shots[i].t1).toBe(shots[i + 1]?.t0 ?? replay.duration_s);
      expect(shots[i].t1).toBeGreaterThan(shots[i].t0);
      expect(shotAt(shots, shots[i].t0)?.id).toBe(shots[i].id);
    }
    expect(new Set(shots.map((s) => s.kind))).toEqual(new Set(['establish', 'launch', 'flight', 'impact', 'aftermath']));
  });

  it('aims at the centre of the subject units from the shot distance', () => {
    const f = frameAt(100);
    const pose = directorPose(shots[0], replay, f, false);
    const a = replay.units.findIndex((u) => u.id === 'tf-blue');
    const b = replay.units.findIndex((u) => u.id === 'tf-red');
    for (let k = 0; k < 3; k++) expect(pose.target[k]).toBeCloseTo((f.unitPos[a * 3 + k] + f.unitPos[b * 3 + k]) / 2, 3);
    expect(dist(pose.eye, pose.target)).toBeCloseTo(2.5e7, 0);
  });

  it('orbits at the shot rate, and holds still with reduced motion', () => {
    const p0 = directorPose(shots[0], replay, frameAt(0), false);
    const p1 = directorPose(shots[0], replay, frameAt(60), false);
    expect(az(p1) - az(p0)).toBeCloseTo(4, 3);
    expect(az(directorPose(shots[0], replay, frameAt(60), true))).toBeCloseTo(az(p0), 6);
  });

  it("frames the commander's own fleet in the perceived picture, never an enemy's true position", () => {
    expect(perceivedSubject(shots[0], 'tf-blue', true)?.subject).toEqual(['tf-blue']);
    expect(perceivedSubject(shots[0], null, false)).toBe(shots[0]);
    // No observer in the theater: hold the camera rather than aim it at true enemy positions.
    expect(perceivedSubject(shots[0], null, true)).toBeNull();
  });

  it('follows the selected ship\'s fleet, else the current engagement, and only the own fleet when perceived', () => {
    const red = replay.ships.findIndex((x) => x.side === 'haven');
    expect(followSubjects(replay, shots, 100, red, null)).toEqual(['tf-red']);
    expect(followSubjects(replay, shots, 100, null, null)).toEqual(shotAt(shots, 100)!.subject);
    expect(followSubjects(replay, shots, 100, red, 'alliance')).toEqual(['tf-blue']);
    const f = frameAt(100);
    const c = subjectCentroid(replay, f, ['tf-blue', 'tf-red'])!;
    expect(c[0]).toBeCloseTo(directorPose(shots[0], replay, f, true).target[0], 3);
  });

  it('follows the picked unit first, unless the perceived picture hides it or it is in another theater', () => {
    const red = replay.ships.findIndex((x) => x.side === 'haven');
    const theater = replay.units.find((u) => u.id === 'tf-red')!.theater;
    expect(followSubjects(replay, shots, 100, null, null, 'tf-red', theater)).toEqual(['tf-red']);
    expect(followSubjects(replay, shots, 100, red, null, 'tf-blue', theater)).toEqual(['tf-blue']);
    expect(followSubjects(replay, shots, 100, null, 'alliance', 'tf-red', theater)).toEqual(['tf-blue']);
    expect(followSubjects(replay, shots, 100, null, null, 'tf-red', 'elsewhere')).toEqual(shotAt(shots, 100)!.subject);
  });

  it('eases toward a pose, and snaps on a cut', () => {
    const rig = new CameraRig();
    rig.follow({ shotId: 'a', scale: 'engagement', theater: 'x', eye: [0, 0, 0], target: [0, 0, 0] }, 0.016, true);
    rig.follow({ shotId: 'a', scale: 'engagement', theater: 'x', eye: [100, 0, 0], target: [0, 0, 0] }, 0.016, false);
    expect(rig.eye[0]).toBeGreaterThan(0);
    expect(rig.eye[0]).toBeLessThan(100);
    rig.follow({ shotId: 'b', scale: 'engagement', theater: 'x', eye: [100, 0, 0], target: [0, 0, 0] }, 0.016, true);
    expect(rig.eye[0]).toBe(100);
  });

  it('tracks actual packet positions instead of inventing a cinematic missile path', () => {
    const shot = shots.find((s) => s.kind === 'flight')!;
    const f = frameAt(shot.t0 + 1);
    const pose = directorPose(shot, replay, f, false);
    const packets = shot.focus!.packets!.filter((i) => f.packetAlive[i] > 0);
    for (let k = 0; k < 3; k++) expect(pose.target[k]).toBeCloseTo(packets.reduce((sum, i) => sum + f.packetPos[i * 3 + k], 0) / packets.length, 5);
    expect(dist(pose.eye, pose.target)).toBeLessThan(2.5e7);
  });

  it('retains the nearest present launcher or target as context around a flight packet', () => {
    const shot = shots.find((s) => s.kind === 'flight')!;
    const f = frameAt(shot.t0 + 1);
    const pose = directorPose(shot, replay, f, true);
    const active = shot.focus!.packets!.filter((i) => f.packetAlive[i] > 0);
    const endpoints = [...new Set(active.flatMap((i) => [replay.packets[i].fromUnit, replay.packets[i].toUnit]))];
    const positions = endpoints.map((i) => Array.from(f.unitPos.subarray(i * 3, i * 3 + 3)) as [number, number, number]);
    const nearest = Math.min(...positions.map((pos) => dist(pos, pose.target)));
    expect(dist(pose.eye, pose.target)).toBeGreaterThanOrEqual(nearest * 2.8);
    const moved = frameAt(shot.t0 + 1);
    endpoints.forEach((i) => { moved.unitPos[i * 3] += 30_000_000; });
    const wider = directorPose(shot, replay, moved, true);
    expect(wider.target).toEqual(pose.target);
    expect(dist(wider.eye, wider.target)).toBeGreaterThan(dist(pose.eye, pose.target) * 2);
  });

  it('brakes before launch/impact, uses supported Auto rates and does not prolong beam durations', () => {
    const beam = replay.beams.find((b) => b.kind === 'laserhead')!;
    expect(directorSpeed(shots, beam.t + beam.dur / 2)).toBe(0.25);
    expect(directorSpeed(shots, 5)).toBe(0.25);
    expect(directorSpeed(shots, 18 - 2)).toBeLessThanOrEqual(1);
    expect(directorSpeed(shots, replay.duration_s - 1)).toBeNull();
    const rates = new Set(shots.flatMap((s) => s.speedWindows?.map((w) => w.rate) ?? []));
    expect([...rates].every((rate) => [0.25, 0.5, 1, 2, 4, 8, 15, 30, 60, 120, 240].includes(rate))).toBe(true);
  });

  it('removes packet/beam focus in perceived framing, including an absent observer', () => {
    const shot = perceivedSubject(shots.find((s) => s.kind === 'flight')!, 'tf-blue', true)!;
    expect(shot.focus).toBeUndefined();
    const f = frameAt(100);
    const own = replay.units.findIndex((u) => u.id === 'tf-blue');
    f.unitCount[own] = 0;
    const before = directorPose(shot, replay, f, true);
    const enemy = replay.units.findIndex((u) => u.id === 'tf-red');
    f.unitPos[enemy * 3] += 1e9;
    expect(directorPose(shot, replay, f, true)).toEqual(before);
  });

  it('cuts on shot changes and reduced motion without disabling camera control', () => {
    const rig = new CameraRig();
    const pose = directorPose(shots[0], replay, frameAt(0), true);
    rig.follow(pose, 0.016, false);
    const moved = { ...pose, eye: [pose.eye[0] + 100, pose.eye[1], pose.eye[2]] as [number, number, number] };
    rig.follow(moved, 0.016, false);
    expect(rig.eye).toEqual(moved.eye);
    expect(rig.settled(moved)).toBe(true);
    const cut = { ...moved, cut: false, shotId: 'new', target: [100, 200, 300] as [number, number, number] };
    rig.follow(cut, 0.016, false);
    expect(rig.target).toEqual(cut.target);
  });
});

describe('scenario-driven close-range choreography', () => {
  const pack = getPack('manticore')!;
  const replay = solve(pack, TECH);
  const shots = shotsFor(pack, replay);

  it('keeps authored shot IDs and resolves the corrected LAC encounters, not the old 60-second-early camera', () => {
    for (const shot of pack.meta.shots) expect(shots.some((s) => s.id === shot.id)).toBe(true);
    expect(shots.find((s) => s.id === 'lacs')!.t0).toBe(1850);
    const dogfight = shotAt(shots, 1854)!;
    const pass = shotAt(shots, 1869)!;
    expect(dogfight.kind).toBe('encounter');
    expect(new Set(dogfight.subject)).toEqual(new Set(['hf-lacs', 'sf-lacs']));
    expect(pass.kind).toBe('encounter');
    expect(new Set(pass.subject)).toEqual(new Set(['hf-lacs', 'second-fleet']));
    expect(directorSpeed(shots, 1854)).toBe(0.25);
    expect(directorSpeed(shots, 1869)).toBe(0.25);
    expect(shots.length).toBeLessThanOrEqual(40);
  });

  it('captions generated shots like Site A: a framing, then what this shot shows, in replay numbers', () => {
    const authored = new Set(pack.meta.shots.map((x) => x.id));
    const generated = shots.filter((x) => !authored.has(x.id));
    expect(generated.length).toBeGreaterThan(10);
    for (const shot of generated) {
      expect(shot.label).toMatch(/^(Wide|Macro wide|Medium|Close) · \S/);
      expect(shot.desc).not.toMatch(/Camera composition|Packet-focused|schematic/i);
      expect(shot.desc.length).toBeGreaterThan(20);
    }
    // No two generated shots repeat one boilerplate description.
    const descs = generated.map((x) => x.desc);
    expect(new Set(descs).size).toBeGreaterThan(descs.length * 0.6);
    const launch = generated.find((x) => x.kind === 'launch')!;
    const plan = pack.events.find((e) => e.id === launch.focus?.planId)!;
    const salvo = launch.focus!.packets!;
    const n = salvo.reduce((a, i) => a + replay.packets[i].launched.attack + replay.packets[i].launched.ew, 0);
    expect(launch.desc).toContain(n.toLocaleString('en-US'));
    expect(launch.desc).toContain(replay.units[replay.packets[salvo[0]].toUnit].name);
    expect(plan.type).toBe('fire_plan');
    // Authored captions stay as the pack wrote them, including the LAC strike that becomes an encounter.
    expect(shots.find((x) => x.id === 'lacs')!.desc).toBe(pack.meta.shots.find((x) => x.id === 'lacs')!.desc);
  });

  it('cuts closer for actual launch/encounter detail while retaining the physical subjects', () => {
    const hf = replay.units.find((u) => u.id === 'hf-lacs')!;
    const wing = FORMATION_SCALE * lacFront(hf.lacCount[0].count, hf.spacing);
    for (const t of [1854, 1869]) {
      const shot = shotAt(shots, t)!;
      const f = sampleFrame(replay, t, createFrame(replay));
      const pose = directorPose(shot, replay, f, false);
      expect(pose.target).toEqual(subjectCentroid(replay, f, shot.subject));
      // Within a few drawn wing radii: the wings pass through each other, so the shot holds both and nothing more.
      expect(dist(pose.eye, pose.target)).toBeLessThan(3.2 * wing);
    }
    const podLaunch = shots.find((s) => s.id === 'apollo-launch')!;
    expect(podLaunch.kind).toBe('launch');
    expect(podLaunch.focus?.packets?.length).toBeGreaterThan(0);
  });

  it('frames LAC wings and fleets as the Engagement view draws them, four times life size', () => {
    const halfView = (d: number) => d * Math.tan((22.5 * Math.PI) / 180);
    const hf = replay.units.find((u) => u.id === 'hf-lacs')!;
    const wing = FORMATION_SCALE * lacFront(hf.lacCount[0].count, hf.spacing);
    for (const t of [1854, 1863, 1869]) {
      const shot = shotAt(shots, t)!;
      expect(shot.subject).toContain('hf-lacs');
      const f = sampleFrame(replay, t, createFrame(replay));
      const pose = directorPose(shot, replay, f, false);
      // The drawn wing fits in the 45° view instead of filling it from a few thousand km away.
      expect(halfView(dist(pose.eye, pose.target))).toBeGreaterThan(wing);
    }
  });

  it('does not mutate scenario events, shot metadata or solved replay timestamps', () => {
    const events = JSON.stringify(pack.events);
    const metadata = JSON.stringify(pack.meta.shots);
    const durations = replay.beams.map((b) => [b.t, b.dur]);
    const packetTimes = replay.packets.map((p) => [p.tLaunch, p.tArrive]);
    expect(shotsFor(pack, replay)).toEqual(shots);
    expect(JSON.stringify(pack.events)).toBe(events);
    expect(JSON.stringify(pack.meta.shots)).toBe(metadata);
    expect(replay.beams.map((b) => [b.t, b.dur])).toEqual(durations);
    expect(replay.packets.map((p) => [p.tLaunch, p.tArrive])).toEqual(packetTimes);
  });
});

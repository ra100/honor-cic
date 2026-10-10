import { describe, expect, it } from 'vitest';
import { DEMO_STATUS, fireDemoFrame, pdEmitter, type DemoInput, type DemoMount, type DemoSpec } from '../../../src/render/ship/fire-demo';
import { B_COLOR } from '../../../src/render/ship/site-b';

/** A reduced Invictus in Site B units: CM, PD and graser broadsides, fore/aft rings, six stern rails. */
const broadside = (type: DemoMount['type'], aspect: 'port' | 'starboard', n: number): DemoMount[] =>
  Array.from({ length: n }, (_, i) => ({ type, aspect, point: [-3.35 + 6.7 * (i + 0.5) / n, 0, aspect === 'port' ? -0.6 : 0.6] }));
const end = (type: DemoMount['type'], aspect: 'fore' | 'aft', n: number): DemoMount[] =>
  Array.from({ length: n }, (_, i) => ({ type, aspect, point: [aspect === 'fore' ? 5.13 : -5.13, Math.sin(i) * 0.18, Math.cos(i) * 0.18] }));
const invictus: DemoSpec = {
  mounts: [...(['port', 'starboard'] as const).flatMap((s) => [...broadside('G', s, 18), ...broadside('CM', s, 84), ...broadside('PD', s, 62)]),
    ...end('G', 'fore', 10), ...end('CM', 'fore', 24), ...end('PD', 'fore', 22), ...end('CM', 'aft', 14), ...end('PD', 'aft', 24)],
  carrier: false, rails: 6, externalPods: 0, podLoad: 10, apollo: false, spinal: null,
};
const input = (t: number, patch: Partial<DemoInput> = {}): DemoInput => ({ t, roll: 0, pose: 0, pods: true, missiles: true, defense: true, links: true, ...patch });

describe('fire / defense demo timeline (B report §4.14)', () => {
  it('steps the status through launch, contact and standoff', () => {
    expect(fireDemoFrame({ ...invictus, mounts: [] }, input(0.5)).status).toBe(DEMO_STATUS.launch);
    expect(fireDemoFrame({ ...invictus, mounts: [] }, input(5)).status).toBe(DEMO_STATUS.contact);
    expect(fireDemoFrame({ ...invictus, mounts: [] }, input(8)).status).toBe(DEMO_STATUS.standoff);
  });

  it('launches one packet per stern rail from 2 s, ten missiles each, for five seconds', () => {
    const cyan = (f: ReturnType<typeof fireDemoFrame>) => f.tracks.filter((t) => t.color === B_COLOR.friendly && t.brightness === 1).length;
    expect(cyan(fireDemoFrame(invictus, input(1.9)))).toBe(0);
    expect(cyan(fireDemoFrame(invictus, input(2.05)))).toBe(10);
    expect(cyan(fireDemoFrame(invictus, input(3)))).toBe(60);
    expect(cyan(fireDemoFrame(invictus, input(3, { pods: false })))).toBe(0);
    expect(cyan(fireDemoFrame(invictus, input(7.7)))).toBe(0);
    expect(cyan(fireDemoFrame({ ...invictus, podLoad: 8 }, input(3)))).toBe(48);
  });

  it('links each Apollo pod controller to the Keyhole II platform and its eight missiles', () => {
    const violet = fireDemoFrame({ ...invictus, apollo: true, podLoad: 8 }, input(3)).tracks.filter((t) => t.color === B_COLOR.violet);
    expect(violet).toHaveLength(6 * 9);
    expect(fireDemoFrame({ ...invictus, apollo: true }, input(3, { links: false })).tracks.some((t) => t.color === B_COLOR.violet)).toBe(false);
  });

  it('fires a broadside energy shot through the open side at 1.0–1.12 s', () => {
    const frame = fireDemoFrame(invictus, input(1.05));
    expect(frame.tracks.some((t) => t.color === B_COLOR.allied && t.brightness === 1.8)).toBe(true);
    expect(frame.status).toBe(DEMO_STATUS.broadside);
    expect(fireDemoFrame(invictus, input(1.2)).tracks.some((t) => t.brightness === 1.8)).toBe(false);
  });

  it('kills inbound missiles with CMs and PD while the open broadside faces them', () => {
    const cm = fireDemoFrame(invictus, input(2));
    expect(cm.status).toBe(DEMO_STATUS.cm);
    expect(cm.tracks.some((t) => t.color === B_COLOR.allied)).toBe(true);
    const flash = fireDemoFrame(invictus, input(2.65)).flash;
    expect(flash).toMatchObject({ color: B_COLOR.allied, size: 0.65 });
    const pd = fireDemoFrame(invictus, input(11 * 16 / 14 + 3.65));
    expect(pd.status).toMatch(/^PD emitter \d+ \/ 14 · provisional 16 s cycle\.$/);
    expect(pd.flash).toMatchObject({ color: 0xe1ffdc, size: 0.55 });
    for (let t = 0; t < 20; t += 0.05) expect(fireDemoFrame(invictus, input(t)).status).not.toBe(DEMO_STATUS.exposed);
  });

  it('stops laserhead beams on the bands once the hull rolls them toward the threat', () => {
    const rolled = { roll: Math.PI / 2, pose: Math.PI / 2 };
    const statuses = new Set<string>();
    let blocked = 0;
    for (let t = 0; t < 20; t += 0.05) {
      const f = fireDemoFrame(invictus, input(t, rolled));
      statuses.add(f.status);
      if (f.flash?.color === B_COLOR.friendly) blocked++;
    }
    expect(statuses).toContain(DEMO_STATUS.blocked);
    expect(statuses).not.toContain(DEMO_STATUS.exposed);
    expect(blocked).toBeGreaterThan(0);
  });

  it('lets a laserhead through an exposed aspect when nothing can intercept it', () => {
    const unarmed: DemoSpec = { ...invictus, mounts: [], rails: 0 };
    const statuses = new Set<string>();
    for (let t = 0; t < 20; t += 0.05) statuses.add(fireDemoFrame(unarmed, input(t)).status);
    expect(statuses).toContain(DEMO_STATUS.exposed);
  });

  it('flies a lone spinal graser forward when nothing blocks it', () => {
    const shrike: DemoSpec = { mounts: end('PD', 'fore', 6), carrier: false, rails: 0, externalPods: 0, podLoad: 10, apollo: false, spinal: [5.13, 0, 0] };
    const f = fireDemoFrame(shrike, input(1.05));
    expect(f.status).toBe(DEMO_STATUS.spinal);
    expect(f.tracks.find((t) => t.brightness === 1.8)?.b).toEqual([18, 0, 0]);
  });

  it('launches eight LACs from a carrier instead of missiles', () => {
    const clac: DemoSpec = { mounts: [], carrier: true, rails: 0, externalPods: 0, podLoad: 10, apollo: false, spinal: null };
    expect(fireDemoFrame(clac, input(2.5)).tracks.filter((t) => t.color === B_COLOR.allied)).toHaveLength(8);
  });

  it('hides attack tracks with the engagement layer off', () => {
    expect(fireDemoFrame(invictus, input(3, { missiles: false, defense: false })).tracks).toHaveLength(0);
  });

  it('cycles fourteen PD emitters every sixteen seconds', () => {
    expect(pdEmitter(0).emitter).toBe(0);
    expect(pdEmitter(16 / 14 * 13 + 0.01).emitter).toBe(13);
    expect(pdEmitter(16 + 0.01).emitter).toBe(0);
  });
});

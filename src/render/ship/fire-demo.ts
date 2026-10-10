import { B_COLOR, keyholePosition, railOffset, rollPoint, wedgeHit, type V3 } from './site-b';

/**
 * Site B's fire / defense demonstration (B report §4.14), as a pure timeline in Site B's ship frame:
 * launches, the energy shot, twelve inbound missiles, CM and PD intercepts and laserhead beams that
 * the stress bands stop. Demo time is illustrative and runs on the wall clock, not the replay.
 */
export type DemoMountType = 'M' | 'G' | 'L' | 'ET' | 'CM' | 'PD';
export type Aspect = 'fore' | 'aft' | 'port' | 'starboard';
export interface DemoMount { type: DemoMountType; point: V3; aspect: Aspect }

export interface DemoSpec {
  mounts: DemoMount[];
  carrier: boolean;
  rails: number;
  externalPods: number;
  podLoad: number;
  /** Keyhole II fitted: Apollo telemetry links from the platform to each pod's controller. */
  apollo: boolean;
  /** A spinal graser fires forward instead of a broadside energy shot. */
  spinal: V3 | null;
}

export interface DemoInput {
  t: number;
  /** Current roll about the hull axis. */
  roll: number;
  /** Roll when the demo started; launch paths keep this attitude, as in Site B. */
  pose: number;
  pods: boolean;
  missiles: boolean;
  defense: boolean;
  links: boolean;
}

export interface DemoTrack { a: V3; b: V3; color: number; brightness: number }
export interface DemoFlash { point: V3; age: number; color: number; size: number }
export interface DemoFrame { tracks: DemoTrack[]; flash: DemoFlash | null; status: string }

const PD_EMITTERS = 14;
const PD_CYCLE_S = 16;
const INBOUND = 12;
/**
 * Laserheads detonate 30% of the way back from their target. Site B's 10% put the burst inside the band envelope,
 * so the rolled hull could never show the blocked beam its status line describes.
 */
const STANDOFF = 0.3;
/**
 * The broadside the action plays on: −1 is port. Site B stages it to starboard, toward its own camera; framed tightly
 * on the wedge that action leaves the plot, so the mirrored demo plays on the far side, seen through the bands.
 */
const THREAT_SIDE = -1;

export const DEMO_STATUS = {
  launch: 'Launch through an open aspect; clear the wedge before turning.',
  contact: 'CMs kill by wedge contact. PD must see an exposed missile aspect.',
  standoff: 'Laserhead standoff flashes; blue field flashes indicate a blocked beam.',
  spinal: 'Forward graser shot; within the schematic close-range envelope.',
  broadside: 'Broadside energy shot through an exposed side; no through-wedge firing.',
  cm: 'CM accelerating toward a predicted wedge intersection.',
  blocked: 'Laserhead beam intercepted by the wedge; no through-wedge hit.',
  exposed: 'Laserhead fires through an exposed aspect; walls are not absolute immunity.',
} as const;

export function pdEmitter(time: number): { emitter: number; shot: number; age: number } {
  const interval = PD_CYCLE_S / PD_EMITTERS;
  const shot = Math.floor(time / interval);
  return { emitter: ((shot % PD_EMITTERS) + PD_EMITTERS) % PD_EMITTERS, shot, age: time - shot * interval };
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const mix = (a: V3, b: V3, p: number): V3 => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];

export function fireDemoFrame(spec: DemoSpec, input: DemoInput): DemoFrame {
  const { t, roll, pose } = input;
  const tracks: DemoTrack[] = [];
  let flash: DemoFlash | null = null;
  let status: string = t < 3 ? DEMO_STATUS.launch : t < 7 ? DEMO_STATUS.contact : DEMO_STATUS.standoff;
  const add = (a: V3, b: V3, color: number, brightness = 1) => { tracks.push({ a, b, color, brightness }); };
  const burst = (point: V3, age: number, color: number, size: number) => { flash = { point, age, color, size }; };
  const at = (p: V3, r = roll): V3 => rollPoint(p, r);
  const available = (type: DemoMountType, target: V3): DemoMount | undefined => spec.mounts.find((m) => {
    if (m.type !== type || wedgeHit(at(m.point), target, roll)) return false;
    const local = rollPoint(target, -roll);
    return m.aspect === 'fore' ? local[0] > 5 : m.aspect === 'aft' ? local[0] < -5 : m.aspect === 'starboard' ? local[2] > 0 : local[2] < 0;
  });

  const side = (v: number) => v * THREAT_SIDE;
  const podPoint = (a: V3, packet: number, i: number, q: number): V3 => {
    const b: V3 = [13, ((i % 3) - 1) * 0.3, side(9 + packet * 0.5 + (i - 4) * 0.15)];
    const clear = at([-9, -1, 0], pose), exit = at([-9, -1, side(12)], pose);
    return q < 0.12 ? mix(a, clear, q / 0.12) : q < 0.3 ? mix(clear, exit, (q - 0.12) / 0.18) : mix(exit, b, (q - 0.3) / 0.7);
  };
  const podsLaunch = input.pods && (spec.rails > 0 || spec.externalPods > 0);

  if (spec.carrier) {
    for (let i = 0; i < 8; i++) {
      const p = clamp01((t - i * 0.25) / 5), a = at([-3 + i * 0.8, 0, side(1)]), b: V3 = [-3 + i * 0.8, 0, side(10)];
      if (p > 0 && p < 1) add(mix(a, b, Math.max(0, p - 0.06)), mix(a, b, p), B_COLOR.allied);
    }
  } else if (podsLaunch) {
    if (input.missiles) {
      const packets = spec.rails || 4;
      for (let packet = 0; packet < packets; packet++) {
        const age = t - (2 + packet * 0.13);
        if (age < 0 || age > 5) continue;
        const [y, z] = spec.rails ? railOffset(packet, spec.rails) : [0, 0];
        const a = at(spec.rails ? [-8.5, y, z] : [-3 + packet * 0.7, -1, 0], pose);
        const q = clamp01(age / 5) ** 2;
        for (let i = 0; i < spec.podLoad; i++) add(podPoint(a, packet, i, Math.max(0, q - 0.045)), podPoint(a, packet, i, q), B_COLOR.friendly);
        if (spec.apollo && input.links) {
          const controller = podPoint(a, packet, 4, Math.max(0, q - 0.03));
          add(keyholePosition(side(7)), controller, B_COLOR.violet, 0.5);
          for (let i = 0; i < 8; i++) add(controller, podPoint(a, packet, i, q), B_COLOR.violet, 0.5);
        }
      }
    }
  } else if (input.missiles) {
    spec.mounts.filter((m) => m.type === 'M').forEach((m, i) => {
      const p = (t - 0.4 - i * 0.018) / 4;
      if (p < 0 || p > 1) return;
      const [x, y, z] = m.point;
      const out = (Math.sign(z) || THREAT_SIDE) * 5.2;
      const exit = at(m.aspect === 'fore' ? [7, y, z] : m.aspect === 'aft' ? [-7, y, z] : [x, y, out], pose);
      const clear = at(m.aspect === 'fore' ? [8, y, z] : [m.aspect === 'aft' ? -8 : 8, y, out], pose);
      const a = at(m.point, pose);
      const dest: V3 = [15, 0, side(10 + ((i % 7) - 3) * 0.4)];
      const point = (q: number): V3 => q < 0.18 ? mix(a, exit, q / 0.18) : q < 0.4 ? mix(exit, clear, (q - 0.18) / 0.22) : mix(clear, dest, ((q - 0.4) / 0.6) ** 1.6);
      add(point(Math.max(0, p - 0.035)), point(p), B_COLOR.friendly);
    });
  }

  if (input.missiles && t > 1 && t < 1.12) {
    if (spec.spinal) {
      const a = at(spec.spinal), b = at([18, 0, 0]);
      if (!wedgeHit(a, b, roll)) {
        add(a, b, B_COLOR.allied, 1.8);
        status = DEMO_STATUS.spinal;
      }
    } else {
      const target: V3 = [4, 0, side(15)];
      const gun = available('G', target) ?? available('L', target);
      if (gun) {
        add(at(gun.point), target, B_COLOR.allied, 1.8);
        status = DEMO_STATUS.broadside;
      }
    }
  }

  const interval = PD_CYCLE_S / PD_EMITTERS;
  const target: V3 = [1, 0, 0];
  for (let i = 0; i < INBOUND; i++) {
    const age = t - i * interval;
    if (age < 0 || age > 4.55) continue;
    const incoming: V3 = i % 6 === 5 ? [18, 0, side(0.4)] : [4 + ((i % 3) - 1) * 0.5, 0, side(15)];
    const standoff = mix(target, incoming, STANDOFF);
    const q = clamp01(age / 4.2);
    const point = (p: number): V3 => mix(incoming, standoff, p * p);
    const cm = i % 3 !== 2 ? available('CM', point(0.62)) : undefined;
    const pd = i % 3 === 2 ? available('PD', point(0.86)) : undefined;
    const endAge = cm ? 2.6 : pd ? 3.6 : 4.2;
    if (age < endAge && input.missiles) add(point(Math.max(0, q - 0.025)), point(q), B_COLOR.hostile);
    if (cm && input.defense) {
      if (age > 1.4 && age < 2.6) {
        const start = at(cm.point), hit = point(2.6 / 4.2), cp = (age - 1.4) / 1.2;
        add(mix(start, hit, Math.max(0, cp - 0.07) ** 2), mix(start, hit, cp * cp), B_COLOR.allied);
        status = DEMO_STATUS.cm;
      }
      if (age >= 2.6 && age < 2.78) burst(point(2.6 / 4.2), (age - 2.6) / 0.18, B_COLOR.allied, 0.65);
    }
    if (pd && input.defense && age >= 3.6 && age < 3.72) {
      add(at(pd.point), point(3.6 / 4.2), 0xe1ffdc, 1.5);
      burst(point(3.6 / 4.2), (age - 3.6) / 0.12, 0xe1ffdc, 0.55);
      status = `PD emitter ${pdEmitter(t - 3.6).emitter + 1} / ${PD_EMITTERS} · provisional ${PD_CYCLE_S} s cycle.`;
    }
    if (!cm && !pd && age >= 4.2 && input.missiles) {
      const terminal = point(1);
      const hit = wedgeHit(terminal, target, roll);
      add(terminal, hit ?? target, hit ? B_COLOR.friendly : 0xffe3b8, 1.5);
      burst(hit ?? terminal, (age - 4.2) / 0.35, hit ? B_COLOR.friendly : 0xffcb8e, 0.8);
      status = hit ? DEMO_STATUS.blocked : DEMO_STATUS.exposed;
    }
  }
  return { tracks, flash, status };
}

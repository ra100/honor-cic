import type { RawPack } from '../../src/core/schema';
import { parsePack, type ScenarioPack } from '../../src/core/schema';

const S = (value: number | null, unit: string, evidence = 'S') => ({ value, unit, evidence, source_id: 'test' });
const STR = (value: string | null) => ({ value, unit: 'text', evidence: 'S', source_id: 'test' });

function fleet(id: string, side: string, classId: string, posMkm: [number, number, number], facing: [number, number, number]) {
  return {
    kind: 'fleet', id, name: id, side, theater: 'main',
    commander: STR(null), flagship_name: STR(null),
    ships: [{ class_id: classId, count: 2 }],
    formation: { kind: 'wall', facing, up: [0, 0, 1], spacing: S(2000, 'km') },
    state: {
      t: 0,
      place: { frame: 'planet', position: { value: posMkm, unit: 'Mkm' } },
      velocity: { frame: 'system', velocity_km_s: [0, 0, 0] },
      evidence: 'S',
    },
    present: { from: null, from_via: null, until: null, until_via: null },
    stores: null, evidence: 'S', source_id: 'test',
  };
}

/** A valid, tiny two-fleet engagement. Tests mutate copies of it. */
export function miniPackRaw(): RawPack {
  return {
    meta: {
      id: 'mini', title: 'Mini engagement',
      date: { value: '1921-01-01', unit: 'PD-date', evidence: 'S', source_id: 'test' },
      year_pd: 1921, era: 'early-apollo-1921', location: 'Test system',
      summary: 'Two cruiser pairs trade one salvo.',
      sides: [{ id: 'blue', name: 'Blue', color: '#00ff66' }, { id: 'red', name: 'Red', color: '#ff0033' }],
      frame: { origin_body: 'star', axes: '+X toward the red start position', evidence: 'S' },
      duration_s: 900, motion_model: 'narrative-calibrated', ftl_speed_c: S(64, 'ratio'),
      phases: [{ id: 'open', label: 'Opening salvo', t0: 0 }],
      theaters: [{ id: 'main', label: 'Main', anchor_body: 'planet' }],
      sources: [{ id: 'test', title: 'Test fixture', kind: 'S' }],
    },
    bodies: {
      bodies: [
        { id: 'star', name: 'Star', kind: 'star', parent_id: null, radius: S(696000, 'km'), mass: S(1, 'Msun'),
          orbit: null, offset: null, hyper_limit: S(22, 'LM'), exclusion: null },
        { id: 'planet', name: 'Planet', kind: 'planet', ordinal: 1, parent_id: 'star', radius: S(6000, 'km'),
          orbit: { radius: S(12, 'LM'), phase: S(0, 'deg'), period: S(1.7, 'yr'), inclination: S(0, 'deg') },
          offset: null, hyper_limit: null, exclusion: null },
      ],
    },
    forces: {
      units: [
        fleet('blue-ca', 'blue', 'saganami-c', [-5, 0, 0], [1, 0, 0]),
        fleet('red-ca', 'red', 'rhn-ca', [5, 0, 0], [-1, 0, 0]),
      ],
    },
    timeline: {
      events: [
        { id: 'fp-blue', type: 'fire_plan', t: 0, engagement: 'e1', from: 'blue-ca', to: 'red-ca', profile: 'mk16-ddm',
          salvos: 1, interval_s: 0, launch: 'tube', pod_load: null, pods: null,
          totals: { attack: 40, ew: 0, controller: 0 }, guidance: 'shipboard', packets_per_salvo: 2,
          arrival_window: null, evidence: 'S', source_id: 'test', seed: 1 },
      ],
    },
    notes: '# Mini\nTest fixture.',
  };
}

/** Parsed mini pack. `mutate` edits a fresh raw copy first; invalid edits throw with the parse errors. */
export function miniPack(mutate?: (raw: any) => void): ScenarioPack {
  const raw = miniPackRaw();
  mutate?.(raw);
  const r = parsePack(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.pack;
}

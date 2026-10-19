import { sv } from '../evidence';
import type { Unit } from '../units';
import { MTS, REC } from './sv-helpers';
import type { Equipment, MissileProfile, PodLoad } from './types';

const STAGE_180 =
  '180 s per stage, from the MTS §4.2 conventional example; with three stages it reproduces the nine-minute Mk23 run (MTS §4.4)';

const MISSILES_1921: Record<string, MissileProfile> = {
  mk23: {
    id: 'mk23',
    name: 'Mark 23 MDM, half setting, long profile',
    navy: 'RMN',
    era_from: REC(1919, 'count', 'first fleet use year not in the MTS; set before the 1921 battles'),
    mass: MTS(94, 't', '§4.1 Mark 23'),
    stages: [0, 1, 2].map(() => ({ accel: MTS(48_000, 'g', '§4.1 Mark 23 half setting'), duration: REC(180, 's', STAGE_180) })),
    max_coast: REC(1_200, 's', 'ballistic interval before the last stage; long enough for the Apollo shot beyond 150 Mkm (wiki, Battle of Manticore)'),
    coast: 'before-last-stage',
    standoff: REC(30_000, 'km', 'MTS Appendix A gives 30,000 to 40,000 km as provisional; the low end is used'),
    beams: MTS(25, 'count', '§4.4 older laserhead descriptions'),
    hit_fraction: REC(0.09, 'ratio', 'share of beams that strike and damage the aimed aspect; calibrated with the Battle of Manticore pack: the 150,000 Home Fleet missiles knock out about 116 of the 240 Second Fleet SD(P) (wiki); see scenarios/manticore/notes.md'),
    damage_per_beam: REC(1, 'ratio', 'abstract damage unit; only relative values matter'),
    reported_burnout_c: MTS(0.83, 'c', '§4.1 wiki long profile', 'the Weber FAQ gives 0.81c for a nine-minute run (P, MTS §4.4)'),
    guidance_allowed: ['shipboard', 'apollo'],
    note: 'Three-stage capital MDM. The 96,000 g maximum setting is not used: three stages at maximum would pass c classically.',
  },
  'mk16-ddm': {
    id: 'mk16-ddm',
    name: 'Mark 16 DDM',
    navy: 'RMN',
    era_from: REC(1917, 'count', 'introduction year not in the MTS'),
    mass: REC(null, 't', 'not in the MTS'),
    stages: [0, 1].map(() => ({
      accel: REC(46_000, 'g', 'MTS §4.2 conventional example applied to the Mk16 DDM'),
      duration: REC(180, 's', STAGE_180),
    })),
    max_coast: REC(600, 's', 'ballistic interval assumed'),
    coast: 'before-last-stage',
    standoff: REC(30_000, 'km', 'MTS Appendix A provisional standoff'),
    beams: REC(25, 'count', 'older laserhead beam count (MTS §4.4) assumed for the Mod G warhead'),
    hit_fraction: REC(0.09, 'ratio', 'same calibration as the Mk23 (Battle of Manticore pack)'),
    damage_per_beam: REC(0.6, 'ratio', 'smaller warhead than the Mk23; relative value only'),
    reported_burnout_c: null,
    guidance_allowed: ['shipboard'],
    note: 'Two-stage DDM for cruisers, battlecruisers and LACs (MTS §4.1). Not the older single-drive Mk16.',
  },
  'rhn-mdm': {
    id: 'rhn-mdm',
    name: 'Havenite MDM (reconstruction)',
    navy: 'RHN',
    era_from: REC(1919, 'count', 'introduction year not in the MTS'),
    mass: REC(null, 't', 'not in the MTS'),
    stages: [0, 1, 2].map(() => ({
      accel: REC(46_000, 'g', 'Havenite MDM drive figures are not in the MTS; the §4.2 conventional example is assumed'),
      duration: REC(180, 's', STAGE_180),
    })),
    max_coast: REC(600, 's', 'ballistic interval assumed'),
    coast: 'before-last-stage',
    standoff: REC(30_000, 'km', 'MTS Appendix A provisional standoff'),
    beams: REC(20, 'count', 'fewer beams than the Mk23 assumed'),
    hit_fraction: REC(0.075, 'ratio', 'lower terminal accuracy than RMN missiles assumed; same calibration scale as the Mk23'),
    damage_per_beam: REC(1, 'ratio', 'abstract damage unit'),
    reported_burnout_c: null,
    guidance_allowed: ['shipboard'],
    note: 'Reconstruction. The MTS warns against giving every navy one missile envelope (§4.1, §10.3).',
  },
};

/** On Basilisk Station, quoted directly (P). */
const OBS = (value: number, unit: Unit, locator: string) => sv(value, unit, 'P', 'obs', { locator });

const OBS_DRIVE = 'On Basilisk Station ch. 29: the warning shot is throttled to 417 KPS² (42,500 g) to raise its burnout time from one minute to three';

const MISSILES_1900: Record<string, MissileProfile> = {
  'rmn-1900': {
    id: 'rmn-1900',
    name: 'RMN single-drive missile, 1900 PD, reduced drive setting',
    navy: 'RMN',
    era_from: REC(1890, 'count', 'in service well before 1900 PD; year not established'),
    mass: REC(null, 't', 'not established'),
    stages: [{ accel: OBS(42_500, 'g', `ch. 29, ${OBS_DRIVE}`), duration: OBS(180, 's', `ch. 29, ${OBS_DRIVE}`) }],
    max_coast: REC(600, 's', 'a ballistic missile cannot correct its aim; ten minutes allowed, far more than any shot in the battle uses'),
    coast: 'after-burnout',
    standoff: REC(20_000, 'km', 'laserhead standoff of 15,000 to 22,000 km from the supplied extract; not confirmed in the novel'),
    beams: REC(3, 'count', 'early laserhead rod count not established'),
    hit_fraction: REC(0.5, 'ratio', 'calibrated so a single leaking laserhead badly damages a light cruiser, as in chapter 30'),
    damage_per_beam: REC(1, 'ratio', 'abstract damage unit'),
    reported_burnout_c: null,
    guidance_allowed: ['shipboard'],
    note: 'Single impeller drive: 85,000 g for one minute at full setting, or 42,500 g for three minutes, then ballistic (On Basilisk Station ch. 29). The reduced setting is used here because it reproduces both ships\' quoted flight times.',
  },
  'pn-1900': {
    id: 'pn-1900',
    name: 'People\'s Navy single-drive missile, 1900 PD (reconstruction)',
    navy: 'PN',
    era_from: REC(1890, 'count', 'in service well before 1900 PD; year not established'),
    mass: REC(null, 't', 'not established'),
    stages: [{
      accel: REC(42_500, 'g', 'Havenite drive figures are not given; the RMN reduced setting is assumed'),
      duration: OBS(179, 's', 'ch. 30: at a 188-second flight time the missiles burn out nine seconds before they reach Fearless'),
    }],
    max_coast: REC(600, 's', 'same ballistic allowance as the RMN missile'),
    coast: 'after-burnout',
    standoff: REC(20_000, 'km', 'laserhead standoff of 15,000 to 22,000 km from the supplied extract; not confirmed in the novel'),
    beams: REC(3, 'count', 'early laserhead rod count not established'),
    hit_fraction: REC(0.5, 'ratio', 'calibrated so a single leaking laserhead badly damages a light cruiser, as in chapter 30'),
    damage_per_beam: REC(1, 'ratio', 'abstract damage unit'),
    reported_burnout_c: null,
    guidance_allowed: ['shipboard'],
    note: 'Sirius\'s laserheads. With the reduced setting the solver gives the 188-second flight time quoted in chapter 30 at the quoted range.',
  },
};
export const MISSILES: Record<string, MissileProfile> = { ...MISSILES_1921, ...MISSILES_1900 };

export const POD_LOADS: Record<string, PodLoad> = {
  'mk17-mk23': { id: 'mk17-mk23', name: 'Mk17 flatpack, ten Mk23', profile: 'mk23', attack_ew: 10, controller: 0, evidence: 'W', source_id: 'mts', locator: '§4.2', era_from: 1919 },
  apollo: { id: 'apollo', name: 'Apollo pod: eight attack or EW Mk23 plus one Mk23-E controller', profile: 'mk23', attack_ew: 8, controller: 1, evidence: 'W', source_id: 'mts', locator: '§4.3', era_from: 1921 },
  'agamemnon-mk16': { id: 'agamemnon-mk16', name: 'Agamemnon pod, fourteen Mk16', profile: 'mk16-ddm', attack_ew: 14, controller: 0, evidence: 'W', source_id: 'mts', locator: '§5.7', era_from: 1919 },
  'rhn-mdm-10': { id: 'rhn-mdm-10', name: 'Havenite pod, ten MDM (reconstruction)', profile: 'rhn-mdm', attack_ew: 10, controller: 0, evidence: 'S', source_id: 'honor-cic', locator: 'pod size not in the MTS; ten assumed from the RMN Mk17', era_from: 1919 },
};

export const EQUIPMENT: Record<string, Equipment> = {
  keyhole: { id: 'keyhole', name: 'Keyhole', era_from: REC(1919, 'count', 'service year not in the MTS'), note: 'Tethered platform that coordinates CM waves around wedge interference (MTS §4.7, §7.3).' },
  'keyhole-ii': { id: 'keyhole-ii', name: 'Keyhole II', era_from: REC(1920, 'count', 'service year not in the MTS; in service by the 1921 battle'), note: 'Adds Apollo FTL control (MTS §4.3, §7.3). Fitted per ship, never per class.' },
};

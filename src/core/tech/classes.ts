import type { Unit } from '../units';
import { DER, MTS, REC, mtsMounts, recMounts } from './sv-helpers';
import type { Hull, Mounts, Navy, Role, ShipClass, SV } from './types';

const WEDGE_WHY = 'stress-band geometry is not published; sized for formation clearance (MTS §3.1, §6.1)';
function wedge(offset: number, length: number, width: number, sidewall: number): ShipClass['wedge'] {
  return {
    band_offset: REC(offset, 'km', WEDGE_WHY),
    band_length: REC(length, 'km', WEDGE_WHY),
    band_width: REC(width, 'km', WEDGE_WHY),
    sidewall_offset: REC(sidewall, 'km', 'Weber FAQ 10 km example scaled by hull size (MTS §4.6)'),
  };
}
const WEDGE: Record<'SD' | 'BC' | 'CA' | 'CL' | 'CLAC' | 'LAC', () => ShipClass['wedge']> = {
  SD: () => wedge(12, 40, 30, 10), BC: () => wedge(8, 26, 20, 7), CA: () => wedge(6, 18, 14, 5),
  CL: () => wedge(5, 14, 10, 4), CLAC: () => wedge(12, 36, 28, 9), LAC: () => wedge(2, 6, 4, 1),
};

const DEF_WHY = 'defense constants are not published; calibrated so Fifth Fleet stops about 30% of the Apollo strike (wiki, Battle of Manticore)';
function defense(cmWaves: number, pkCm: number, pdShots: number, pkPd: number): ShipClass['defense'] {
  return {
    cm_waves: REC(cmWaves, 'count', DEF_WHY),
    pk_cm: REC(pkCm, 'ratio', DEF_WHY),
    pd_shots: REC(pdShots, 'count', DEF_WHY),
    pk_pd: REC(pkPd, 'ratio', DEF_WHY),
    control_links: REC(null, 'count', 'telemetry link count not established (MTS Appendix B removes the 128-link claim)'),
  };
}
const RMN_DEF = () => defense(4, 0.6, 6, 0.6);
const RHN_DEF = () => defense(5, 0.62, 7, 0.58);
const LAC_DEF = () => defense(2, 0.4, 4, 0.4);

const DUR = (n: number) => REC(n, 'ratio', 'abstract durability used only to rank damage; scaled from Site A hit points');
const ERA = (y: number, why = 'introduction year not in the MTS; set no later than the scenario year') => REC(y, 'count', why);
const UNK = (unit: Unit, why = 'not established in the MTS') => REC(null, unit, why);
const CYCLE = {
  SD: () => REC(240, 's', 'MTS §3.5 representative 8-Mt SD cycle from standby, applied to this class'),
  MID: () => REC(90, 's', 'assumed between the MTS §3.5 SD and Saganami-C examples'),
  CRUISER: () => REC(60, 's', 'assumed near the MTS §3.5 Saganami-C example'),
  LAC: () => REC(30, 's', 'MTS §3.5 small military vessel minimum, applied'),
};
const NO_PODS = (): [SV, SV, SV] => [DER(0, 'count', 'not a pod-layer hull'), DER(0, 'count', 'not a pod-layer hull'), DER(0, 's', 'not a pod-layer hull')];

interface Spec {
  id: string; name: string; navy: Navy; hull: Hull; role: Role;
  era: SV; mass: SV; dims: [SV, SV, SV]; accel: [SV, SV];
  broadside: Mounts; fore: Mounts; aft: Mounts;
  magazine?: [SV, string | null]; pods?: [SV, SV, SV];
  hyper: SV; wedge: ShipClass['wedge']; walls?: [ShipClass['bow_wall'], ShipClass['stern_wall']];
  defense: ShipClass['defense']; durability: SV;
  keyhole?: ShipClass['keyhole_allowed']; crew?: SV; lacBays?: SV; note: string;
}

function ship(s: Spec): ShipClass {
  const pods = s.pods ?? NO_PODS();
  return {
    id: s.id, name: s.name, navy: s.navy, hull: s.hull, role: s.role,
    era_from: s.era, mass: s.mass, length: s.dims[0], beam: s.dims[1], height: s.dims[2],
    accel_max: s.accel[0], accel_normal: s.accel[1],
    broadside: s.broadside, fore: s.fore, aft: s.aft,
    magazine: s.magazine?.[0] ?? UNK('count'), magazine_model: s.magazine?.[1] ?? null,
    pod_capacity: pods[0], pod_eject_count: pods[1], pod_eject_cycle: pods[2],
    hyper_cycle: s.hyper, wedge: s.wedge,
    bow_wall: s.walls?.[0] ?? 'none', stern_wall: s.walls?.[1] ?? 'none',
    defense: s.defense, durability: s.durability,
    keyhole_allowed: s.keyhole ?? 'none',
    crew: s.crew ?? UNK('count'),
    lac_bays: s.lacBays ?? DER(0, 'count', 'no LAC bays'),
    note: s.note,
  };
}

const INVICTUS_SIDE = 'mount counts not in the MTS; Invictus per-side figures assumed';

const LIST: ShipClass[] = [
  ship({
    id: 'invictus', name: 'Invictus-class SD(P)', navy: 'RMN', hull: 'SD(P)', role: 'wall',
    era: MTS(1919, 'count', '§5.2 introduction'), mass: MTS(8_768_500, 't', '§5.2'),
    dims: [MTS(1394, 'm', '§5.2'), MTS(202, 'm', '§5.2'), MTS(188, 'm', '§5.2')],
    accel: [MTS(562.6, 'g', '§5.2 maximum'), MTS(450.1, 'g', '§5.2 normal')],
    broadside: mtsMounts('§5.2 each broadside', { graser: 18, cm: 84, pd: 62 }),
    fore: mtsMounts('§5.2 fore', { graser: 10, cm: 24, pd: 22 }),
    aft: mtsMounts('§5.2 aft', { pod_lanes: 6, graser: 10, cm: 14, pd: 24 }),
    pods: [MTS(1074, 'count', '§5.2 pod stowage'), MTS(6, 'count', '§5.2 ejection cycle'), MTS(12, 's', '§5.2 ejection cycle')],
    hyper: CYCLE.SD(), wedge: WEDGE.SD(), defense: RMN_DEF(), durability: DUR(100), keyhole: 'keyhole-ii',
    note: 'Pod superdreadnought with no broadside missile tubes. Keyhole II fit varies by ship (MTS §5.2): set it on the ship entry. Endwall fit not in the MTS.',
  }),
  ship({
    id: 'medusa', name: 'Medusa-class SD(P)', navy: 'RMN', hull: 'SD(P)', role: 'wall',
    era: ERA(1914, 'Medusa class is not in the MTS; early RMN pod superdreadnought'),
    mass: REC(8_550_000, 't', 'Site A figure, not in the MTS'),
    dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [REC(502.8, 'g', 'Site A figure, not in the MTS'), DER(402.2, 'g', '80% of the maximum (MTS §3.2 convention)')],
    broadside: recMounts(INVICTUS_SIDE, { graser: 18, cm: 84, pd: 62 }),
    fore: recMounts(INVICTUS_SIDE, { graser: 10, cm: 24, pd: 22 }),
    aft: recMounts(INVICTUS_SIDE, { pod_lanes: 6, graser: 10, cm: 14, pd: 24 }),
    pods: [REC(492, 'count', 'Site A figure, not in the MTS'), REC(6, 'count', 'Invictus rate assumed'), REC(12, 's', 'Invictus rate assumed')],
    hyper: CYCLE.SD(), wedge: WEDGE.SD(), defense: RMN_DEF(), durability: DUR(100), keyhole: 'keyhole',
    note: 'Earlier RMN pod superdreadnought; every figure is a labelled assumption.',
  }),
  ship({
    id: 'sd-conventional', name: 'Conventional SD (Gryphon figures)', navy: 'RMN', hull: 'SD', role: 'wall',
    era: ERA(1905), mass: MTS(8_339_000, 't', '§5.7 Gryphon'),
    dims: [MTS(1371, 'm', '§5.7 Gryphon'), MTS(199, 'm', '§5.7 Gryphon'), MTS(185, 'm', '§5.7 Gryphon')],
    accel: [MTS(402.1, 'g', '§5.7 Gryphon listed', 'setting not established; treated as maximum'), DER(321.7, 'g', '80% of the listed acceleration (MTS §3.2)')],
    broadside: mtsMounts('§5.7 Gryphon per broadside', { missile: 37, laser: 19, graser: 22, energy_torpedo: 8, cm: 28, pd: 30 }),
    fore: recMounts('chase armament not in the MTS', { missile: 4, graser: 4, cm: 8, pd: 10 }),
    aft: recMounts('chase armament not in the MTS', { missile: 2, graser: 4, cm: 8, pd: 10 }),
    hyper: CYCLE.SD(), wedge: WEDGE.SD(), defense: RMN_DEF(), durability: DUR(96),
    note: 'Stands in for Home Fleet\'s 48 conventional SDs; their individual classes are not established.',
  }),
  ship({
    id: 'agamemnon', name: 'Agamemnon-class BC(P)', navy: 'RMN', hull: 'BC(P)', role: 'screen',
    era: ERA(1918), mass: MTS(1_750_750, 't', '§5.7'),
    dims: [MTS(815, 'm', '§5.7'), MTS(118, 'm', '§5.7'), MTS(110, 'm', '§5.7')],
    accel: [DER(692.6, 'g', 'normal 554.1 g taken as 80% of maximum (MTS §3.2)'), MTS(554.1, 'g', '§5.7 normal')],
    broadside: mtsMounts('§5.7 Agamemnon per broadside', { graser: 10, cm: 30, pd: 30 }),
    fore: recMounts('chase armament not in the MTS', { graser: 2, cm: 6, pd: 8 }),
    aft: { ...recMounts('chase armament not in the MTS', { graser: 2, cm: 6, pd: 8 }), pod_lanes: MTS(4, 'count', '§5.7 four ejection lanes') },
    pods: [MTS(360, 'count', '§5.7'), REC(4, 'count', 'one pod per lane per cycle assumed'), REC(12, 's', 'Invictus cycle assumed')],
    hyper: CYCLE.MID(), wedge: WEDGE.BC(), defense: RMN_DEF(), durability: DUR(40), keyhole: 'keyhole',
    note: 'Pod battlecruiser with a typical fourteen-Mk16 pod load (MTS §5.7).',
  }),
  ship({
    id: 'nike', name: 'Nike-class BC', navy: 'RMN', hull: 'BC', role: 'screen',
    era: ERA(1920), mass: MTS(2_519_750, 't', '§5.3'),
    dims: [MTS(1012, 'm', '§5.3'), MTS(129, 'm', '§5.3'), MTS(114, 'm', '§5.3')],
    accel: [MTS(674.3, 'g', '§5.3 maximum'), MTS(539.4, 'g', '§5.3 normal')],
    broadside: mtsMounts('§5.3 each broadside', { missile: 25, graser: 12, cm: 32, pd: 30 }),
    fore: mtsMounts('§5.3 chase entry', { graser: 4, pd: 12 }),
    aft: recMounts('§5.3 chase entry assumed to apply to each end; the MTS asks to confirm', { graser: 4, pd: 12 }),
    magazine: [MTS(6000, 'count', '§5.3'), 'mk16-ddm'],
    hyper: CYCLE.MID(), wedge: WEDGE.BC(), defense: RMN_DEF(), durability: DUR(46), keyhole: 'keyhole',
    crew: MTS(750, 'count', '§5.3'),
    note: 'Conventional large battlecruiser, not a BC(P): 25 tubes and 12 grasers per side (MTS §5.3, Appendix B).',
  }),
  ship({
    id: 'saganami-c', name: 'Edward Saganami-C-class CA', navy: 'RMN', hull: 'CA', role: 'screen',
    era: MTS(1920, 'count', '§5.4 introduction'), mass: MTS(483_000, 't', '§5.4'),
    dims: [MTS(610, 'm', '§5.4'), MTS(74, 'm', '§5.4'), MTS(62, 'm', '§5.4')],
    accel: [MTS(726.2, 'g', '§5.4 maximum'), MTS(580.9, 'g', '§5.4 normal')],
    broadside: mtsMounts('§5.4 each broadside', { missile: 20, graser: 8, cm: 20, pd: 24 }),
    fore: mtsMounts('§5.4 chase entry', { laser: 3, graser: 2, pd: 8 }),
    aft: recMounts('§5.4 chase entry assumed to apply to each end', { laser: 3, graser: 2, pd: 8 }),
    magazine: [MTS(1200, 'count', '§5.4 internal magazine'), 'mk16-ddm'],
    pods: [MTS(40, 'count', '§5.4 external Mk23 flatpack provision'), REC(40, 'count', 'external pods released together'), REC(18, 's', 'one off-bore salvo cycle (MTS §5.4)')],
    hyper: MTS(44.6, 's', '§3.5 Saganami-C'), wedge: WEDGE.CA(), defense: RMN_DEF(), durability: DUR(22),
    crew: MTS(355, 'count', '§5.4 including 140 Marines'),
    note: 'Forty tubes combined, twenty per side. The "128 Apollo links" claim is removed as unverified (MTS Appendix B).',
  }),
  ship({
    id: 'rmn-clac', name: 'RMN CLAC (Covington figures)', navy: 'RMN', hull: 'CLAC', role: 'carrier',
    era: ERA(1915), mass: MTS(6_244_250, 't', '§5.7 Covington'),
    dims: [MTS(1135, 'm', '§5.7 Covington'), MTS(189, 'm', '§5.7 Covington'), MTS(175, 'm', '§5.7 Covington')],
    accel: [MTS(476.7, 'g', '§5.7 Covington maximum'), MTS(381.4, 'g', '§5.7 Covington normal')],
    broadside: recMounts('carrier armament not in the MTS', { cm: 20, pd: 24 }),
    fore: recMounts('carrier armament not in the MTS', { cm: 6, pd: 8 }),
    aft: recMounts('carrier armament not in the MTS', { cm: 6, pd: 8 }),
    hyper: REC(200, 's', 'assumed from the MTS §3.5 SD example scaled by mass'), wedge: WEDGE.CLAC(), defense: RMN_DEF(), durability: DUR(60),
    lacBays: MTS(124, 'count', '§5.7 Covington'),
    note: 'Representative Alliance CLAC; Covington figures stand in for the classes present.',
  }),
  ship({
    id: 'cl-rmn', name: 'RMN light cruiser (representative)', navy: 'RMN', hull: 'CL', role: 'screen',
    era: ERA(1910), mass: UNK('t'), dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [REC(600, 'g', 'assumed'), DER(480, 'g', '80% of the assumed maximum')],
    broadside: recMounts('light cruiser fit not in the MTS', { missile: 8, laser: 4, cm: 8, pd: 8 }),
    fore: recMounts('light cruiser fit not in the MTS', { cm: 2, pd: 4 }),
    aft: recMounts('light cruiser fit not in the MTS', { cm: 2, pd: 4 }),
    magazine: [REC(300, 'count', 'assumed'), 'mk16-ddm'],
    hyper: CYCLE.CRUISER(), wedge: WEDGE.CL(), defense: RMN_DEF(), durability: DUR(13),
    note: 'Stands in for Home Fleet\'s 26 light cruisers.',
  }),
  ship({
    id: 'harrington-ii', name: 'Honor Harrington II-class SD(P) (GSN)', navy: 'GSN', hull: 'SD(P)', role: 'wall',
    era: ERA(1920), mass: UNK('t'), dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [REC(560, 'g', 'assumed close to Invictus'), DER(448, 'g', '80% of the assumed maximum')],
    broadside: recMounts('Grayson keeps broadside tubes at the cost of pod volume (MTS §5.7); counts assumed', { missile: 10, graser: 16, cm: 60, pd: 50 }),
    fore: recMounts('counts assumed', { graser: 8, cm: 20, pd: 20 }),
    aft: recMounts('counts assumed', { pod_lanes: 6, graser: 8, cm: 12, pd: 20 }),
    pods: [REC(800, 'count', 'less pod volume than Invictus (MTS §5.7); size assumed'), REC(6, 'count', 'Invictus rate assumed'), REC(12, 's', 'Invictus rate assumed')],
    magazine: [REC(1000, 'count', 'assumed internal magazine for broadside tubes'), 'mk23'],
    hyper: CYCLE.SD(), wedge: WEDGE.SD(), defense: RMN_DEF(), durability: DUR(100), keyhole: 'keyhole-ii',
    note: 'Detailed dimensions are not established (MTS §5.7). Do not copy the Invictus layout beyond the stated assumptions.',
  }),
  ship({
    id: 'ian-sdp', name: 'IAN SD(P) (representative)', navy: 'IAN', hull: 'SD(P)', role: 'wall',
    era: ERA(1920), mass: UNK('t'), dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [REC(540, 'g', 'assumed'), DER(432, 'g', '80% of the assumed maximum')],
    broadside: recMounts(INVICTUS_SIDE, { graser: 18, cm: 84, pd: 62 }),
    fore: recMounts(INVICTUS_SIDE, { graser: 10, cm: 24, pd: 22 }),
    aft: recMounts(INVICTUS_SIDE, { pod_lanes: 6, graser: 10, cm: 14, pd: 24 }),
    pods: [REC(900, 'count', 'assumed'), REC(6, 'count', 'Invictus rate assumed'), REC(12, 's', 'Invictus rate assumed')],
    hyper: CYCLE.SD(), wedge: WEDGE.SD(), defense: RMN_DEF(), durability: DUR(100), keyhole: 'keyhole',
    note: 'Andermani task force 16 ships; class not established.',
  }),
  ship({
    id: 'shrike-b', name: 'Shrike-B LAC', navy: 'RMN', hull: 'LAC', role: 'lac',
    era: MTS(1915, 'count', '§5.5 new construction from 1915'), mass: MTS(21_250, 't', '§5.5'),
    dims: [MTS(72, 'm', '§5.5'), MTS(20, 'm', '§5.5'), MTS(20, 'm', '§5.5')],
    accel: [MTS(635, 'g', '§5.5 maximum'), MTS(508.4, 'g', '§5.5 normal')],
    broadside: mtsMounts('§5.5 (no broadside weapons)', {}),
    fore: mtsMounts('§5.5 forward', { missile: 4, graser: 1, cm: 4, pd: 6 }),
    aft: mtsMounts('§5.5 aft', { cm: 4, pd: 6 }),
    magazine: [MTS(20, 'count', '§5.5 attack missiles'), 'mk16-ddm'],
    hyper: CYCLE.LAC(), wedge: WEDGE.LAC(), walls: ['none', 'full'], defense: LAC_DEF(), durability: DUR(3),
    note: 'Stern wall fitted from 1915; power does not allow bow and stern walls together (MTS §5.5). 1.5 m graser aperture.',
  }),
  ship({
    id: 'ferret', name: 'Ferret missile LAC (reconstruction)', navy: 'RMN', hull: 'LAC', role: 'lac',
    era: ERA(1918, 'Ferret is not in the MTS'), mass: UNK('t'), dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [REC(635, 'g', 'Shrike-B hull assumed'), REC(508.4, 'g', 'Shrike-B hull assumed')],
    broadside: recMounts('Ferret fit not in the MTS', {}),
    fore: recMounts('Ferret fit not in the MTS', { missile: 4, cm: 4, pd: 6 }),
    aft: recMounts('Ferret fit not in the MTS', { cm: 4, pd: 6 }),
    magazine: [DER(54, 'count', '16,000 missiles flushed by 300 Ferrets (wiki, Battle of Manticore), rounded up'), 'mk16-ddm'],
    hyper: CYCLE.LAC(), wedge: WEDGE.LAC(), defense: LAC_DEF(), durability: DUR(3),
    note: 'Missile-armed LAC. Only the magazine is derived from canon counts.',
  }),
  ship({
    id: 'katana', name: 'Katana space-superiority LAC', navy: 'GSN', hull: 'LAC', role: 'lac',
    era: ERA(1920), mass: REC(19_500, 't', 'MTS Appendix A provisional'),
    dims: [REC(71, 'm', 'MTS Appendix A provisional'), REC(20, 'm', 'MTS Appendix A provisional'), REC(20, 'm', 'MTS Appendix A provisional')],
    accel: [REC(640.4, 'g', 'MTS Appendix A provisional'), DER(512.3, 'g', '80% of the provisional maximum')],
    broadside: mtsMounts('§5.6 (no broadside weapons)', {}),
    fore: mtsMounts('§5.6 five off-bore Mk31/Mk9 launchers, three heavy PD clusters', { cm: 5, pd: 3 }),
    aft: recMounts('light aft PD; six clusters from MTS Appendix A provisional', { pd: 6 }),
    hyper: CYCLE.LAC(), wedge: WEDGE.LAC(), walls: ['buckler', 'none'], defense: defense(3, 0.5, 6, 0.5), durability: DUR(3),
    note: 'Anti-LAC and fleet missile defense; no anti-ship missiles (MTS §5.6). Two-phase bow buckler.',
  }),
  ship({
    id: 'sovereign-of-space', name: 'Sovereign of Space-class SD(P)', navy: 'RHN', hull: 'SD(P)', role: 'wall',
    era: ERA(1918), mass: MTS(8_750_000, 't', '§5.7'), dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [MTS(529, 'g', '§5.7 listed', 'setting not established; treated as maximum'), DER(423.2, 'g', '80% of the listed acceleration')],
    broadside: recMounts('defensive mounts not in the MTS; sized for the 30% interception calibration', { graser: 18, cm: 60, pd: 40 }),
    fore: recMounts('mounts not in the MTS', { graser: 10, cm: 12, pd: 12 }),
    aft: { ...recMounts('mounts not in the MTS', { graser: 10, cm: 10, pd: 12 }), pod_lanes: REC(6, 'count', 'lane count assumed from the six-pod cycle') },
    pods: [UNK('count', 'pod stowage not in the MTS'), MTS(6, 'count', '§5.7 six pods per twelve seconds'), MTS(12, 's', '§5.7')],
    hyper: CYCLE.SD(), wedge: WEDGE.SD(), defense: RHN_DEF(), durability: DUR(100),
    note: 'Havenite pod-layer with no broadside attack tubes (MTS §5.7). Second Fleet also towed Donkey pod arrays (wiki).',
  }),
  ship({
    id: 'rhn-bc', name: 'RHN battlecruiser (representative)', navy: 'RHN', hull: 'BC', role: 'screen',
    era: ERA(1915), mass: UNK('t'), dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [REC(620, 'g', 'assumed'), DER(496, 'g', '80% of the assumed maximum')],
    broadside: recMounts('Havenite BC fit not in the MTS', { missile: 12, graser: 8, cm: 20, pd: 18 }),
    fore: recMounts('Havenite BC fit not in the MTS', { graser: 2, cm: 4, pd: 6 }),
    aft: recMounts('Havenite BC fit not in the MTS', { graser: 2, cm: 4, pd: 6 }),
    magazine: [REC(1500, 'count', 'assumed'), 'mk16-ddm'],
    hyper: CYCLE.MID(), wedge: WEDGE.BC(), defense: RHN_DEF(), durability: DUR(40),
    note: 'Stands in for Second Fleet and Diamato\'s battlecruisers.',
  }),
  ship({
    id: 'rhn-ca', name: 'RHN heavy cruiser (representative)', navy: 'RHN', hull: 'CA', role: 'screen',
    era: ERA(1915), mass: UNK('t'), dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [REC(650, 'g', 'assumed'), DER(520, 'g', '80% of the assumed maximum')],
    broadside: recMounts('Havenite CA fit not in the MTS', { missile: 10, graser: 4, cm: 12, pd: 12 }),
    fore: recMounts('Havenite CA fit not in the MTS', { cm: 2, pd: 4 }),
    aft: recMounts('Havenite CA fit not in the MTS', { cm: 2, pd: 4 }),
    magazine: [REC(400, 'count', 'assumed'), 'mk16-ddm'],
    hyper: CYCLE.CRUISER(), wedge: WEDGE.CA(), defense: RHN_DEF(), durability: DUR(20),
    note: 'Stands in for Second Fleet\'s heavy cruisers.',
  }),
  ship({
    id: 'rhn-clac', name: 'RHN CLAC (representative)', navy: 'RHN', hull: 'CLAC', role: 'carrier',
    era: ERA(1915), mass: UNK('t'), dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [REC(450, 'g', 'assumed'), DER(360, 'g', '80% of the assumed maximum')],
    broadside: recMounts('carrier armament not in the MTS', { cm: 16, pd: 20 }),
    fore: recMounts('carrier armament not in the MTS', { cm: 4, pd: 6 }),
    aft: recMounts('carrier armament not in the MTS', { cm: 4, pd: 6 }),
    hyper: REC(200, 's', 'assumed from the MTS §3.5 SD example scaled by mass'), wedge: WEDGE.CLAC(), defense: RHN_DEF(), durability: DUR(55),
    lacBays: DER(200, 'count', 'about 3,200 LACs across 16 CLACs (wiki, Battle of Manticore)'),
    note: 'Stands in for Havenite CLACs.',
  }),
  ship({
    id: 'cimeterre', name: 'Cimeterre LAC', navy: 'RHN', hull: 'LAC', role: 'lac',
    era: ERA(1918), mass: UNK('t'), dims: [UNK('m'), UNK('m'), UNK('m')],
    accel: [REC(600, 'g', 'assumed'), DER(480, 'g', '80% of the assumed maximum')],
    broadside: recMounts('Cimeterre fit not in the MTS', {}),
    fore: recMounts('Cimeterre fit not in the MTS', { missile: 2, graser: 1, cm: 2, pd: 4 }),
    aft: recMounts('Cimeterre fit not in the MTS', { cm: 2, pd: 4 }),
    hyper: CYCLE.LAC(), wedge: WEDGE.LAC(), defense: LAC_DEF(), durability: DUR(2),
    crew: MTS(15, 'count', '§5.7 crew 13 to 15', 'upper bound of the published range'),
    note: 'Fleet-defense LAC; Alpha and Beta variants differ in power, walls and weapons (MTS §5.7).',
  }),
];

export const CLASSES: Record<string, ShipClass> = Object.fromEntries(LIST.map((c) => [c.id, c]));

import type { EvidenceLabel, SourceValue } from '../evidence';

export type SV = SourceValue<number>;
export type MountKey = 'missile' | 'graser' | 'laser' | 'energy_torpedo' | 'cm' | 'pd' | 'pod_lanes';
export type Mounts = Record<MountKey, SV>;
export type Hull = 'SD' | 'SD(P)' | 'BC' | 'BC(P)' | 'CA' | 'CL' | 'CLAC' | 'LAC';
export type Role = 'wall' | 'screen' | 'carrier' | 'lac';
export type Navy = 'RMN' | 'GSN' | 'IAN' | 'RHN';

export interface ShipClass {
  id: string;
  name: string;
  navy: Navy;
  hull: Hull;
  role: Role;
  era_from: SV;
  mass: SV;
  length: SV;
  beam: SV;
  height: SV;
  accel_max: SV;
  accel_normal: SV;
  /** Per side (MTS §5.1). */
  broadside: Mounts;
  fore: Mounts;
  aft: Mounts;
  magazine: SV;
  magazine_model: string | null;
  pod_capacity: SV;
  pod_eject_count: SV;
  pod_eject_cycle: SV;
  /** Final readiness cycle C; from powered down a translation takes 8C (MTS §3.5). */
  hyper_cycle: SV;
  wedge: { band_offset: SV; band_length: SV; band_width: SV; sidewall_offset: SV };
  bow_wall: 'none' | 'buckler' | 'full';
  stern_wall: 'none' | 'buckler' | 'full';
  defense: { cm_waves: SV; pk_cm: SV; pd_shots: SV; pk_pd: SV; control_links: SV };
  /** Abstract damage points to destruction; ranking only, never shown as canon. */
  durability: SV;
  keyhole_allowed: 'none' | 'keyhole' | 'keyhole-ii';
  crew: SV;
  lac_bays: SV;
  note: string;
}

export interface MissileStage { accel: SV; duration: SV }

export interface MissileProfile {
  id: string;
  name: string;
  navy: Navy;
  era_from: SV;
  mass: SV;
  stages: MissileStage[];
  max_coast: SV;
  standoff: SV;
  beams: SV;
  hit_fraction: SV;
  damage_per_beam: SV;
  reported_burnout_c: SV | null;
  guidance_allowed: Array<'shipboard' | 'apollo' | 'autonomous'>;
  note: string;
}

export interface PodLoad {
  id: string;
  name: string;
  profile: string;
  attack_ew: number;
  controller: number;
  evidence: EvidenceLabel;
  source_id: string;
  locator: string;
  era_from: number;
}

export interface Equipment { id: 'keyhole' | 'keyhole-ii'; name: string; era_from: SV; note: string }

export interface TechRegistry {
  classes: Record<string, ShipClass>;
  missiles: Record<string, MissileProfile>;
  podLoads: Record<string, PodLoad>;
  equipment: Record<string, Equipment>;
  eras: Record<string, { label: string; year_from: number; year_to: number }>;
}

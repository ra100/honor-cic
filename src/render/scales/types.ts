import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Frame, Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { TechRegistry } from '../../core/tech';
import type { Vec3 } from '../../core/vec';
import type { PlotInsets, ShipFraming } from '../framing';
import type { LabelSpec } from '../labels';

export type ScaleId = 'system' | 'engagement' | 'ship';

/** MTS §11.1 display layers. */
export const LAYERS = ['celestial', 'truth', 'commander', 'engagement', 'protection', 'comms', 'damage'] as const;
export type LayerId = (typeof LAYERS)[number];
export const LAYER_TEXT: Record<LayerId, { label: string; hint: string }> = {
  celestial: { label: 'Celestial map', hint: 'Stars, planets, orbits and hyper limits' },
  truth: { label: 'Ground truth', hint: 'Actual positions and events' },
  commander: { label: 'Commander picture', hint: 'Delayed contacts with age and uncertainty' },
  engagement: { label: 'Engagement', hint: 'Missile packets, drive phases and attacks' },
  protection: { label: 'Protection', hint: 'Wedges, sidewalls and exposed aspects' },
  comms: { label: 'Communications', hint: 'Apollo control links and update age' },
  damage: { label: 'Damage', hint: 'Ship status and lost subsystems' },
};

export interface ViewContext {
  replay: Replay;
  pack: ScenarioPack;
  tech: TechRegistry;
  frame: Frame;
  layers: Record<LayerId, boolean>;
  perceived: { enabled: boolean; side: string };
  density: number;
  theater: string;
  selectedShip: number | null;
  selectedClass: string | null;
  reducedMotion: boolean;
  plotInsets?: PlotInsets;
  shipFraming?: ShipFraming;
}

export interface ViewStatus {
  /** Missile sampling readout, e.g. "Sampling 1:4, 62,208 missiles in flight". */
  samplingText: string | null;
  scaleNote: string;
  /** Empty-state message for the plot, e.g. the perceived view before any light arrives. */
  notice: string | null;
}

export interface ScaleView {
  readonly id: ScaleId;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Free-camera input; the viewer disables it for inactive views and in director mode. */
  readonly controls: OrbitControls | null;
  /** Call setPose before update: views draw relative to the pose's floating origin. */
  update(ctx: ViewContext): void;
  /** Camera pose from physical km (director shots). */
  setPose(eyeKm: Vec3, targetKm: Vec3): void;
  /** Move the look-at point to this physical position, keeping the user's angle and distance. */
  followTarget(targetKm: Vec3): void;
  labels(): LabelSpec[];
  /** Ship index under the pointer, or null. */
  pick(ndcX: number, ndcY: number): number | null;
  status(): ViewStatus;
  dispose(): void;
}

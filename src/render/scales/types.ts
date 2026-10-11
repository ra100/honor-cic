import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Frame, Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { TechRegistry } from '../../core/tech';
import type { Vec3 } from '../../core/vec';
import type { PlotInsets, PlotRect } from '../framing';
import type { GradeProfile } from '../grade';
import type { LabelSpec } from '../labels';

export type ScaleId = 'system' | 'engagement' | 'ship';
/** Site B system camera presets, generic across packs: origin star, companion star, both stars with the terminus, outer orbits. */
export type SystemFocus = 'primary' | 'secondary' | 'binary' | 'outer';
export const SYSTEM_FOCUS: readonly SystemFocus[] = ['primary', 'secondary', 'binary', 'outer'];

/** Site B ship display toggles. fireT counts seconds since the fire/defense demo started; null when idle. */
export interface ShipToggles { roll: boolean; pods: boolean; sails: boolean; fireT: number | null }
export const FIRE_DEMO_S = 20;

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
  /** Unit index the free camera follows, when it follows a single unit; range rings centre on it when it is mine. */
  followUnit?: number | null;
  selectedClass: string | null;
  reducedMotion: boolean;
  plotInsets?: PlotInsets;
  /** HUD boxes floating over the plot (caption, tools, scale bar), in canvas pixels; labels keep clear of them. */
  obstacles?: PlotRect[];
  /** "My side": the commander's side in the perceived picture, else the first declared side. Range rings centre on its fleet. */
  focusSide: string;
  systemFocus: SystemFocus;
  ship: ShipToggles;
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
  /** How the engine develops this view; the cinematic profile when absent. */
  readonly grade?: GradeProfile;
  /** Physical km per scene unit, for the HUD scale bar; no scale bar when absent. */
  readonly kmPerUnit?: number;
  /** True while view-owned animation (demos, pod drift, turntable) needs frames although the replay is paused. */
  animating?(): boolean;
  /** Called before the first update after the viewer switches to this view from another scale (or first shows it). */
  onShow?(): void;
  /** Call setPose before update: views draw relative to the pose's floating origin. */
  update(ctx: ViewContext): void;
  /** Camera pose from physical km (director shots). */
  setPose(eyeKm: Vec3, targetKm: Vec3): void;
  /** Move the look-at point to this physical position, keeping the user's angle and distance. */
  followTarget(targetKm: Vec3): void;
  /** Frames a unit picked to follow on the next update when it is off the plot or too small to read. */
  frameUnit?(unit: number): void;
  labels(): LabelSpec[];
  /** Ship index under the pointer, or null. */
  pick(ndcX: number, ndcY: number): number | null;
  status(): ViewStatus;
  dispose(): void;
}

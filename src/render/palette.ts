import { ShipStatus, DrivePhase, type Replay } from '../core/replay';

/** DESIGN.md tokens. Colour is a data channel: one meaning per hue. */
export const PALETTE = {
  void: 0x020208, ink: 0xd6e6f3, inkDim: 0x8199b0, inkFaint: 0x4f6378,
  allied: 0x00ff66, hostile: 0xff0033, wedge: 0x00d2ff, amber: 0xffb300, violet: 0x8a2be2, flash: 0xffe7ad,
} as const;

export const hexToNum = (hex: string): number => parseInt(hex.replace('#', ''), 16);

export function sideColor(r: Replay, side: string): number {
  return hexToNum(r.sides.find((s) => s.id === side)?.color ?? '#d6e6f3');
}

export const STATUS_BRIGHTNESS: Record<ShipStatus, number> = {
  [ShipStatus.Operational]: 1, [ShipStatus.Degraded]: 0.8, [ShipStatus.MissionKill]: 0.55,
  [ShipStatus.Destroyed]: 0.22, [ShipStatus.Escaped]: 0, [ShipStatus.Captured]: 0.6, [ShipStatus.Absent]: 0,
};

/** Terminal-phase missiles are bright enough to bloom; coasting ones are dim (their drive is off). */
export const PHASE_BRIGHTNESS: Record<DrivePhase, number> = {
  [DrivePhase.Boost]: 0.75, [DrivePhase.Coast]: 0.35, [DrivePhase.Terminal]: 1.6, [DrivePhase.Gone]: 0,
};

export function rgbOf(color: number, k: number): [number, number, number] {
  return [((color >> 16) & 255) / 255 * k, ((color >> 8) & 255) / 255 * k, (color & 255) / 255 * k];
}

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

/** Drive phase controls head luminance, not the packet's physical count. */
export const PHASE_BRIGHTNESS: Record<DrivePhase, number> = {
  [DrivePhase.Boost]: 0.6, [DrivePhase.Coast]: 0.3, [DrivePhase.Terminal]: 1.05, [DrivePhase.Gone]: 0,
};

const linearChannel = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const MAX_EMISSION = 4;
export const CELESTIAL_HALO_GAIN = 0.08;

/** Vertex colours share Three's linear working space; hex tokens are sRGB. */
export function rgbOf(color: number, k: number): [number, number, number] {
  const gain = Number.isFinite(k) ? Math.max(0, Math.min(MAX_EMISSION, k)) : 0;
  return [
    linearChannel(((color >> 16) & 255) / 255) * gain,
    linearChannel(((color >> 8) & 255) / 255) * gain,
    linearChannel((color & 255) / 255) * gain,
  ];
}

/** Callout ink from the side colour; other sides are lifted toward white for legibility, as DESIGN's hostile ink is. */
export function inkOf(hex: number, ally: boolean, alpha: number): string {
  const k = ally ? 0 : 0.3;
  const ch = (shift: number) => Math.round(((hex >> shift) & 255) + (255 - ((hex >> shift) & 255)) * k);
  return `rgba(${ch(16)}, ${ch(8)}, ${ch(0)}, ${alpha})`;
}

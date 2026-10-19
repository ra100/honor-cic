import type { Role, ShipClass } from '../core/tech';
import { SHAPE } from './points';

export interface ShipGlyph { size: number; shape: number }

export function shipGlyph(cls: ShipClass | undefined, role: Role, selected = false, killed = false): ShipGlyph {
  const hull = cls?.hull;
  const shape = killed ? SHAPE.ring
    : hull === 'LAC' || role === 'lac' ? SHAPE.lac
      : hull === 'CLAC' || role === 'carrier' ? SHAPE.carrier
        : hull === 'SD(P)' || hull === 'BC(P)' ? SHAPE.podWall
          : role === 'screen' ? SHAPE.screen : SHAPE.wall;
  const size = hull === 'LAC' || hull === 'CB' || role === 'lac' ? 4.5
    : hull === 'CLAC' || role === 'carrier' ? 10
      : hull === 'SD' || hull === 'SD(P)' ? 9
        : hull === 'BC' || hull === 'BC(P)' || hull === 'Q' ? 7.5
          : hull === 'CA' ? 6.5 : 5.5;
  return { shape, size: Math.min(14, size + (selected ? 3 : 0)) };
}

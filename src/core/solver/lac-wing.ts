import { rngFor } from '../rng';
import type { Vec3 } from '../vec';

/** LACs fly in squadrons of twelve (A report §4.4), laid out as 4 × 3 blocks. */
export const SQUADRON_SIZE = 12;
const SQUADRON_COLS = 4;
/** Spacing inside a squadron, in multiples of the pack's LAC spacing. S. */
export const IN_SQUADRON_SPACING = 2;
/** Distance between squadron centres across the front, in multiples of the pack's LAC spacing. S. */
export const SQUADRON_PITCH = 20;
/** Depth stagger between squadrons along the threat axis, in multiples of the pack's LAC spacing. S. */
const SQUADRON_STAGGER = 1;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export interface LacWing {
  /** Offsets [forward, starboard, up] in km from the group's centre; starboard points at the threat, as for walls. */
  slots: Vec3[];
  squadron: Int32Array;
  /** Slot i is alive while the group's count exceeds lossRank[i]. */
  lossRank: Int32Array;
  /** Radius of the front the squadrons cover, km. */
  front: number;
}

/** Radius of the front a LAC group of `count` spreads its squadrons across (S). */
export function lacFront(count: number, spacingKm: number): number {
  const squadrons = Math.ceil(Math.max(0, count) / SQUADRON_SIZE);
  return SQUADRON_PITCH * spacingKm * Math.sqrt(squadrons / Math.PI);
}

/**
 * Squadrons on a sunflower disc across the threat axis; each a 4 × 3 block. The layout is fixed by the starting
 * count, so a wing thins as it takes losses instead of shrinking; a seeded order decides which LACs go.
 */
export function lacWing(id: string, count: number, spacingKm: number): LacWing {
  const n = Math.max(0, Math.floor(count));
  const squadrons = Math.ceil(n / SQUADRON_SIZE);
  const front = lacFront(n, spacingKm);
  const inner = IN_SQUADRON_SPACING * spacingKm;
  const rows = SQUADRON_SIZE / SQUADRON_COLS;
  const rng = rngFor('lac-wing', id);
  const slots: Vec3[] = [];
  const squadron = new Int32Array(n);
  for (let q = 0; q < squadrons; q++) {
    const r = front * Math.sqrt((q + 0.5) / squadrons);
    const a = q * GOLDEN;
    const cf = r * Math.cos(a);
    const cu = r * Math.sin(a);
    const depth = (rng() - 0.5) * 2 * SQUADRON_STAGGER * spacingKm;
    for (let k = 0; k < SQUADRON_SIZE && slots.length < n; k++) {
      const c = k % SQUADRON_COLS;
      const row = Math.floor(k / SQUADRON_COLS);
      squadron[slots.length] = q;
      slots.push([cf + (c - (SQUADRON_COLS - 1) / 2) * inner, depth, cu + (row - (rows - 1) / 2) * inner]);
    }
  }
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const lossRank = new Int32Array(n);
  order.forEach((slot, rank) => { lossRank[slot] = rank; });
  return { slots, squadron, lossRank, front };
}

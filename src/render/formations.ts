import * as THREE from 'three';
import { rngFor } from '../core/rng';
import { formationOffsets } from '../core/solver/formation';
import type { Role } from '../core/tech';
import type { PlotRect } from './framing';

export const MAX_FORMATION_RADIUS_PX = 180;
const GLYPH_GAP_PX = 3;
const ROLE_ORDER = { wall: 0, screen: 1, lac: 2, carrier: 3 } as const;

export interface FormationGlyph {
  ship: number;
  role: Role;
  classId: string;
  flagship: boolean;
  size: number;
  pos: THREE.Vector3;
}

export interface DisplayFormation {
  positions: THREE.Vector3[];
  schematic: boolean;
  radiusPx: number;
  bounds: THREE.Vector3[];
}

function crowded(points: THREE.Vector3[], glyphs: FormationGlyph[], width: number, height: number): boolean {
  const cell = Math.max(...glyphs.map((g) => g.size)) + GLYPH_GAP_PX;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.z < -1 || p.z > 1) continue;
    const x = p.x * width / 2, y = p.y * height / 2;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of buckets.get(`${cx + dx}:${cy + dy}`) ?? []) {
        if (Math.hypot(x - points[j].x * width / 2, y - points[j].y * height / 2) < (glyphs[i].size + glyphs[j].size) / 2 + GLYPH_GAP_PX) return true;
      }
    }
    const key = `${cx}:${cy}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(i);
    buckets.set(key, bucket);
  }
  return false;
}

export function fleetDisplayFormation(
  glyphs: FormationGlyph[], centre: THREE.Vector3, camera: THREE.Camera,
  width: number, height: number, safe: PlotRect, seed: string, radiusBudget = MAX_FORMATION_RADIUS_PX,
  footprint?: { halfWidth: number; halfHeight: number },
): DisplayFormation {
  const physical = glyphs.map((g) => g.pos.clone());
  const unchanged: DisplayFormation = { positions: physical, schematic: false, radiusPx: 0, bounds: [] };
  if (glyphs.length < 2) return unchanged;
  camera.updateMatrixWorld();
  const origin = centre.clone().project(camera);
  if (origin.z < -1 || origin.z > 1 || !crowded(physical.map((p) => p.clone().project(camera)), glyphs, width, height)) return unchanged;

  const slots = formationOffsets('wall', glyphs.length, 1, rngFor('display-formation', seed))
    .map(([x, , z]) => new THREE.Vector2(x, z / 0.6));
  const mean = slots.reduce((sum, p) => sum.add(p), new THREE.Vector2()).divideScalar(slots.length);
  slots.forEach((p) => p.sub(mean));
  const remaining = [...slots];
  const offsets = new Map<number, THREE.Vector2>();
  const carriers = glyphs.filter((g) => g.role === 'carrier').sort((a, b) => a.ship - b.ship);
  remaining.sort((a, b) => a.x - b.x || Math.abs(a.y) - Math.abs(b.y));
  carriers.forEach((g) => offsets.set(g.ship, remaining.shift()!));
  remaining.sort((a, b) => a.lengthSq() - b.lengthSq() || a.y - b.y || a.x - b.x);
  glyphs.filter((g) => g.role !== 'carrier')
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || Number(b.flagship) - Number(a.flagship) || a.classId.localeCompare(b.classId) || a.ship - b.ship)
    .forEach((g, i) => offsets.set(g.ship, remaining[i]));

  const rawRadius = Math.max(...slots.map((p) => p.length()));
  const rawWidth = Math.max(...slots.map((p) => Math.abs(p.x)));
  const rawHeight = Math.max(...slots.map((p) => Math.abs(p.y)));
  const x = (origin.x + 1) * width / 2, y = (1 - origin.y) * height / 2;
  const pad = Math.max(...glyphs.map((g) => g.size)) / 2 + GLYPH_GAP_PX;
  const clearWidth = Math.min(x - safe.x, safe.x + safe.width - x);
  const clearHeight = Math.min(y - safe.y, safe.y + safe.height - y);
  if (Math.min(clearWidth, clearHeight) <= pad) return unchanged;
  const widthBudget = Math.max(0, Math.min(clearWidth, footprint?.halfWidth ?? Infinity, safe.width * 0.42) - pad);
  const heightBudget = Math.max(0, Math.min(clearHeight, footprint?.halfHeight ?? Infinity, safe.height * 0.42) - pad);
  const radius = Math.max(0, Math.min(radiusBudget, MAX_FORMATION_RADIUS_PX) - pad);
  const spacing = Math.min(
    Math.max(...glyphs.map((g) => g.size)) + GLYPH_GAP_PX,
    widthBudget / Math.max(Number.EPSILON, rawWidth),
    heightBudget / Math.max(Number.EPSILON, rawHeight),
    radius / rawRadius,
  );
  const unproject = (x: number, y: number) => new THREE.Vector3(origin.x + x * 2 / width, origin.y - y * 2 / height, origin.z).unproject(camera);
  const positions = glyphs.map((g) => {
    const p = offsets.get(g.ship)!;
    return unproject(p.x * spacing, p.y * spacing);
  });
  const xs = slots.map((p) => p.x * spacing), ys = slots.map((p) => p.y * spacing);
  const left = Math.min(...xs) - pad, right = Math.max(...xs) + pad;
  const top = Math.min(...ys) - pad, bottom = Math.max(...ys) + pad;
  return { positions, schematic: true, radiusPx: rawRadius * spacing, bounds: [unproject(left, top), unproject(right, bottom)] };
}

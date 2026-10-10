import * as THREE from 'three';
import { baseValue } from '../core/evidence';
import type { MountKey, ShipClass } from '../core/tech';
import { B_HULL_LENGTH, railOffset } from './ship/site-b';

export interface HullSection { x: number; beam: number; height: number }
export interface SchematicMount { kind: MountKey; aspect: 'port' | 'starboard' | 'fore' | 'aft'; position: THREE.Vector3 }
export interface HullSchematic {
  dimensionsKm: [number, number, number];
  placeholder: boolean;
  sections: HullSection[];
  geometry: THREE.BufferGeometry;
  mounts: SchematicMount[];
  bays: THREE.Vector3[];
}

export const HULL_KM_PER_UNIT = 0.01;
export const MOUNT_KINDS: MountKey[] = ['missile', 'graser', 'laser', 'energy_torpedo', 'cm', 'pd', 'pod_lanes'];
const CROSS_SECTION = [[-1, -0.6], [-0.6, -1], [0.6, -1], [1, -0.6], [1, 0.6], [0.6, 1], [-0.6, 1], [-1, 0.6]];
/** Site B's broadside rhythm (B report §4.4): mount kinds of 22 or more share 22 columns and stack into ticks. */
const TICK_COLUMNS = 22;
/** Vertical spacing of interleaved mount rows and the mount dot radius, in Site B units of a 10.237-unit hull. */
const ROW_PITCH = 0.045;
const DOT = 0.025;

export function hullSections(cls: ShipClass): HullSection[] {
  const profile = cls.hull === 'LAC'
    ? [[-0.5, 0.6, 0.65], [-0.4, 0.92, 0.92], [-0.25, 1, 1], [0.24, 1, 1], [0.4, 0.72, 0.76], [0.5, 0.4, 0.4]]
    : cls.hull === 'CLAC'
      ? [[-0.5, 0.75, 0.75], [-0.46, 1, 1], [-0.35, 1, 1], [-0.29, 0.85, 0.84], [0.29, 0.85, 0.84], [0.35, 1, 1], [0.46, 1, 1], [0.5, 0.75, 0.75]]
      : [[-0.5, 0.75, 0.75], [-0.46, 1, 1], [-0.38, 1, 1], [-0.31, 0.64, 0.66], [0.31, 0.64, 0.66], [0.38, 1, 1], [0.46, 1, 1], [0.5, 0.75, 0.75]];
  return profile.map(([x, beam, height]) => ({ x, beam, height }));
}

export function sectionAt(sections: HullSection[], x: number): HullSection {
  const right = sections.findIndex((s) => s.x >= x);
  if (right <= 0) return sections[right === 0 ? 0 : sections.length - 1];
  const a = sections[right - 1];
  const b = sections[right];
  const k = (x - a.x) / (b.x - a.x);
  return { x, beam: a.beam + (b.beam - a.beam) * k, height: a.height + (b.height - a.height) * k };
}

export function hullRing(section: HullSection, dimensionsU: number[]): THREE.Vector3[] {
  return CROSS_SECTION.map(([y, z]) => new THREE.Vector3(section.x * dimensionsU[0], y * section.beam * dimensionsU[1] / 2, z * section.height * dimensionsU[2] / 2));
}

function hullGeometry(sections: HullSection[], dimensionsU: number[]): THREE.BufferGeometry {
  const vertices = sections.flatMap((s) => hullRing(s, dimensionsU).flatMap((v) => v.toArray()));
  const indices: number[] = [];
  for (let j = 0; j < sections.length - 1; j++) {
    for (let i = 0; i < CROSS_SECTION.length; i++) {
      const a = j * 8 + i;
      const b = j * 8 + (i + 1) % 8;
      indices.push(a, b, a + 8, b, b + 8, a + 8);
    }
  }
  for (const [ring, reverse] of [[0, true], [(sections.length - 1) * 8, false]] as const) {
    const centre = vertices.length / 3;
    vertices.push(vertices[ring * 3], 0, 0);
    for (let i = 0; i < 8; i++) {
      const next = ring + (i + 1) % 8;
      indices.push(centre, reverse ? next : ring + i, reverse ? ring + i : next);
    }
  }
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  smoothAround(geometry, sections.length - 1);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Rounds the shading around the hull while keeping the creases between sections and at the end caps,
 * so the lit metal carries one long specular streak as in Site B (B report §4.2).
 */
function smoothAround(geometry: THREE.BufferGeometry, bands: number): void {
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!normal) return;
  const n = CROSS_SECTION.length;
  const quad = (j: number, i: number) => {
    const q = (j * n + ((i % n) + n) % n) * 6;
    return new THREE.Vector3().fromBufferAttribute(normal, q).add(new THREE.Vector3().fromBufferAttribute(normal, q + 3)).normalize();
  };
  for (let j = 0; j < bands; j++) {
    const ring = Array.from({ length: n }, (_, i) => quad(j, i - 1).add(quad(j, i)).normalize());
    for (let i = 0; i < n; i++) {
      const q = (j * n + i) * 6;
      [i, i + 1, i, i + 1, i + 1, i].forEach((r, v) => normal.setXYZ(q + v, ...ring[r % n].toArray()));
    }
  }
  normal.needsUpdate = true;
}

/** A point on the hull surface at axial fraction x and height zU, lifted off the broadside face by `lift`. */
function broadsidePoint(sections: HullSection[], dimensionsU: number[], x: number, side: number, zU: number, lift: number): THREE.Vector3 {
  const cross = sectionAt(sections, x);
  const halfH = cross.height * dimensionsU[2] / 2;
  const row = Math.max(-1, Math.min(1, zU / halfH));
  const y = Math.min(dimensionsU[1] / 2, Math.min(1, 1.6 - Math.abs(row)) * cross.beam * dimensionsU[1] / 2 + lift);
  return new THREE.Vector3(x * dimensionsU[0], side * y, row * halfH);
}

/**
 * One broadside in Site B's rhythm: kinds of 22 mounts or more share 22 columns and interleave their rows into
 * vertical ticks (Invictus: CM and PD make seven-dot ticks); smaller kinds run in single rows, the first on the
 * centre line between the ticks and the rest above and below them, so no two mounts coincide.
 */
function broadsideMounts(cls: ShipClass, sections: HullSection[], dimensionsU: number[], side: number): SchematicMount[] {
  const k = dimensionsU[0] / B_HULL_LENGTH;
  const count = (kind: MountKey) => cls.broadside[kind].value ?? 0;
  const kinds = MOUNT_KINDS.filter((kind) => count(kind) > 0);
  const rows = (kind: MountKey) => Math.ceil(count(kind) / TICK_COLUMNS);
  const ticks = kinds.filter((kind) => count(kind) >= TICK_COLUMNS);
  const slots: string[] = [];
  for (let row = 0; row < Math.max(0, ...ticks.map(rows)); row++) for (const kind of ticks) if (row < rows(kind)) slots.push(`${kind}:${row}`);
  const small = kinds.some((kind) => count(kind) < TICK_COLUMNS);
  // An odd stack would put a tick row on the centre line, under the single rows; nudge it half a row off.
  const nudge = small && slots.length % 2 ? 0.5 : 0;
  const height = new Map(slots.map((slot, j) => [slot, (j - (slots.length - 1) / 2 + nudge) * ROW_PITCH]));
  const edge = Math.max(0, (slots.length - 1) / 2 + nudge) * ROW_PITCH;
  kinds.filter((kind) => count(kind) < TICK_COLUMNS).forEach((kind, m) => {
    height.set(`${kind}:0`, m === 0 ? 0 : (m % 2 ? 1 : -1) * (edge + Math.ceil(m / 2) * 2 * ROW_PITCH));
  });
  const aspect = side < 0 ? 'starboard' : 'port';
  return kinds.flatMap((kind) => {
    const n = count(kind);
    const cols = Math.min(n, TICK_COLUMNS);
    return Array.from({ length: n }, (_, i): SchematicMount => ({
      kind, aspect,
      position: broadsidePoint(sections, dimensionsU, -0.3 + 0.6 * ((i % cols) + 0.5) / cols, side, height.get(`${kind}:${Math.floor(i / cols)}`)! * k, DOT * k * 0.5),
    }));
  });
}

/**
 * Bow and stern faces: stern pod lanes on Site B's two-row rail matrix (B report §4.9), a single graser on the
 * axis as a spinal mount, and every other kind on its own ring around the axis (Site B's tip rings, §4.4).
 */
function endMounts(cls: ShipClass, sections: HullSection[], dimensionsU: number[], aspect: 'fore' | 'aft'): SchematicMount[] {
  const k = dimensionsU[0] / B_HULL_LENGTH;
  const cross = aspect === 'fore' ? sections[sections.length - 1] : sections[0];
  const x = cross.x * dimensionsU[0];
  const halfB = cross.beam * dimensionsU[1] / 2;
  const halfH = cross.height * dimensionsU[2] / 2;
  const out: SchematicMount[] = [];
  const lanes = cls[aspect].pod_lanes.value ?? 0;
  if (lanes) {
    const offsets = Array.from({ length: lanes }, (_, i) => railOffset(i, lanes));
    const fit = Math.min(1, ...offsets.map(([dorsal, stbd]) => Math.min(
      0.8 * halfH / Math.max(1e-9, Math.abs(dorsal) * k), 0.8 * halfB / Math.max(1e-9, Math.abs(stbd) * k))));
    for (const [dorsal, stbd] of offsets) out.push({ kind: 'pod_lanes', aspect, position: new THREE.Vector3(x, -stbd * k * fit, dorsal * k * fit) });
  }
  const kinds = MOUNT_KINDS.filter((kind) => kind !== 'pod_lanes' && (cls[aspect][kind].value ?? 0) > 0);
  const spinal = kinds.find((kind) => kind === 'graser' && cls[aspect].graser.value === 1);
  if (spinal) out.push({ kind: spinal, aspect, position: new THREE.Vector3(x, 0, 0) });
  const rings = kinds.filter((kind) => kind !== spinal);
  const [lo, hi] = lanes ? [0.5, 0.72] : [0.22, 0.92];
  rings.forEach((kind, m) => {
    const n = cls[aspect][kind].value!;
    const r = lo + (hi - lo) * (m + 0.5) / rings.length;
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n + m * 0.4;
      out.push({ kind, aspect, position: new THREE.Vector3(x, Math.cos(a) * r * halfB, Math.sin(a) * r * halfH) });
    }
  });
  return out;
}

function surfacePoint(sections: HullSection[], dimensionsU: number[], x: number, side: number, row: number): THREE.Vector3 {
  const cross = sectionAt(sections, x);
  const y = Math.min(1, 1.6 - Math.abs(row)) * cross.beam * dimensionsU[1] / 2;
  return new THREE.Vector3(x * dimensionsU[0], side * y, row * cross.height * dimensionsU[2] / 2);
}

export function buildHullSchematic(cls: ShipClass): HullSchematic {
  const values = [baseValue(cls.length), baseValue(cls.beam), baseValue(cls.height)];
  const placeholder = values.some((v) => v === null);
  const placeholderKm = cls.hull === 'LAC' ? [0.07, 0.02, 0.02] : [1, 0.15, 0.14];
  const dimensionsKm = values.map((v, i) => v ?? placeholderKm[i]) as [number, number, number];
  const dimensionsU = dimensionsKm.map((v) => v / HULL_KM_PER_UNIT);
  const sections = hullSections(cls);
  const mounts: SchematicMount[] = [
    ...broadsideMounts(cls, sections, dimensionsU, -1),
    ...broadsideMounts(cls, sections, dimensionsU, 1),
    ...endMounts(cls, sections, dimensionsU, 'fore'),
    ...endMounts(cls, sections, dimensionsU, 'aft'),
  ];
  const bayCount = cls.lac_bays.value ?? 0;
  const bays = Array.from({ length: bayCount }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    const n = side < 0 ? Math.ceil(bayCount / 2) : Math.floor(bayCount / 2);
    const slot = Math.floor(i / 2);
    return surfacePoint(sections, dimensionsU, -0.28 + 0.56 * (slot + 0.5) / n, side, 0);
  });
  return { dimensionsKm, placeholder, sections, geometry: hullGeometry(sections, dimensionsU), mounts, bays };
}

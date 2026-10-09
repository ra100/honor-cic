import * as THREE from 'three';
import { baseValue } from '../core/evidence';
import type { MountKey, ShipClass } from '../core/tech';

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
const ROW = { missile: 0.48, graser: 0.12, laser: -0.18, energy_torpedo: -0.5, cm: 0.78, pd: -0.78, pod_lanes: 0 } as const;

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
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
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
  const mounts: SchematicMount[] = [];
  for (const side of [-1, 1]) {
    for (const kind of MOUNT_KINDS) {
      const n = cls.broadside[kind].value ?? 0;
      for (let i = 0; i < n; i++) {
        const x = -0.3 + 0.6 * (i + 0.5) / n;
        mounts.push({ kind, aspect: side < 0 ? 'starboard' : 'port', position: surfacePoint(sections, dimensionsU, x, side, ROW[kind]) });
      }
    }
  }
  for (const aspect of ['fore', 'aft'] as const) {
    const keys = MOUNT_KINDS.flatMap((kind) => Array.from({ length: cls[aspect][kind].value ?? 0 }, () => kind));
    const cross = aspect === 'fore' ? sections[sections.length - 1] : sections[0];
    const cols = Math.max(1, Math.ceil(Math.sqrt(keys.length * dimensionsU[1] / dimensionsU[2])));
    const rows = Math.max(1, Math.ceil(keys.length / cols));
    keys.forEach((kind, i) => {
      const z = ((Math.floor(i / cols) + 0.5) / rows - 0.5) * 1.6;
      const y = ((i % cols + 0.5) / cols - 0.5) * 1.6 * Math.min(1, 1.6 - Math.abs(z));
      mounts.push({
        kind, aspect,
        position: new THREE.Vector3(cross.x * dimensionsU[0], y * cross.beam * dimensionsU[1] / 2, z * cross.height * dimensionsU[2] / 2),
      });
    });
  }
  const bayCount = cls.lac_bays.value ?? 0;
  const bays = Array.from({ length: bayCount }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    const n = side < 0 ? Math.ceil(bayCount / 2) : Math.floor(bayCount / 2);
    const slot = Math.floor(i / 2);
    return surfacePoint(sections, dimensionsU, -0.28 + 0.56 * (slot + 0.5) / n, side, 0);
  });
  return { dimensionsKm, placeholder, sections, geometry: hullGeometry(sections, dimensionsU), mounts, bays };
}

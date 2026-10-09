import * as THREE from 'three';
import { safePlotRect, type PlotInsets, type PlotRect } from './framing';

export interface LabelSpec { key: string; text: string; sub?: string; cls: string; pos: THREE.Vector3; avoid?: THREE.Vector3[] }

export function projectedBounds(points: THREE.Vector3[], camera: THREE.Camera, width: number, height: number, margin = 10): PlotRect | null {
  camera.updateMatrixWorld();
  const visible = points.map((p) => p.clone().project(camera)).filter((p) => p.z >= -1 && p.z <= 1);
  if (!visible.length) return null;
  const xs = visible.map((p) => (p.x + 1) * width / 2);
  const ys = visible.map((p) => (1 - p.y) * height / 2);
  const x = Math.min(...xs) - margin, y = Math.min(...ys) - margin;
  return { x, y, width: Math.max(...xs) + margin - x, height: Math.max(...ys) + margin - y };
}

export function placeLabel(x: number, y: number, width: number, height: number, safe: PlotRect, occupied: PlotRect[], exclusions: PlotRect[] = []): PlotRect | null {
  if (x < safe.x || x > safe.x + safe.width || y < safe.y || y > safe.y + safe.height || height > safe.height) return null;
  const w = Math.min(width, safe.width);
  const candidates = [[x + 8, y - 7], [x - w - 8, y - 7], [x + 8, y + 10], [x + 8, y - height - 12], [x + 8, y + height + 14]];
  for (const rect of exclusions) candidates.push(
    [x - w / 2, rect.y - height - 6], [x - w / 2, rect.y + rect.height + 6],
    [rect.x - w - 6, y - height / 2], [rect.x + rect.width + 6, y - height / 2],
    [safe.x, safe.y], [safe.x, safe.y + safe.height - height],
    [safe.x + safe.width - w, safe.y], [safe.x + safe.width - w, safe.y + safe.height - height],
  );
  for (const [cx, cy] of candidates) {
    const box = { x: Math.max(safe.x, Math.min(cx, safe.x + safe.width - w)), y: Math.max(safe.y, Math.min(cy, safe.y + safe.height - height)), width: w, height };
    if ([...occupied, ...exclusions].every((other) => box.x + box.width + 5 <= other.x || other.x + other.width + 5 <= box.x || box.y + box.height + 5 <= other.y || other.y + other.height + 5 <= box.y)) return box;
  }
  return null;
}

const labelPriority = (spec: LabelSpec): number => /\b(selected|damage)\b/.test(spec.cls) ? 6 : /\bdemo\b/.test(spec.cls) ? 5 : /\btitle\b/.test(spec.cls) ? 4 : /\bspec\b/.test(spec.cls) ? 3 : /\bfleet\b/.test(spec.cls) ? 2 : 1;

/** Projected HTML labels with leader ticks (DESIGN.md identity motif). Elements are pooled by key. */
export class LabelLayer {
  private pool = new Map<string, HTMLDivElement>();
  private v = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {}

  update(specs: LabelSpec[], camera: THREE.Camera, width: number, height: number, insets?: PlotInsets): void {
    const safe = safePlotRect(width, height, insets);
    camera.updateMatrixWorld();
    const live = new Set<string>();
    const occupied: PlotRect[] = [];
    const exclusions = new Map<THREE.Vector3[], PlotRect[]>();
    for (const s of [...specs].sort((a, b) => labelPriority(b) - labelPriority(a))) {
      this.v.copy(s.pos).project(camera);
      if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.2 || Math.abs(this.v.y) > 1.2) continue;
      live.add(s.key);
      let el = this.pool.get(s.key);
      if (!el) {
        el = document.createElement('div');
        this.root.append(el);
        this.pool.set(s.key, el);
      }
      el.className = `lbl ${s.cls}`;
      if (el.dataset.text !== `${s.text}|${s.sub ?? ''}`) {
        el.dataset.text = `${s.text}|${s.sub ?? ''}`;
        el.textContent = s.text;
        if (s.sub) {
          const small = document.createElement('small');
          small.textContent = s.sub;
          el.append(small);
        }
      }
      el.hidden = false;
      const x = ((this.v.x + 1) / 2) * width;
      const y = ((1 - this.v.y) / 2) * height;
      el.style.boxSizing = 'border-box';
      el.style.maxWidth = `${safe.width}px`;
      let avoid: PlotRect[] = [];
      if (s.avoid) {
        if (!exclusions.has(s.avoid)) {
          const rect = projectedBounds(s.avoid, camera, width, height);
          exclusions.set(s.avoid, rect ? [rect] : []);
        }
        avoid = exclusions.get(s.avoid)!;
      }
      const box = placeLabel(x, y, el.offsetWidth, el.offsetHeight, safe, occupied, avoid);
      if (!box) { el.hidden = true; continue; }
      occupied.push(box);
      el.style.transform = `translate(${box.x}px, ${box.y}px)`;
    }
    for (const [key, el] of this.pool) if (!live.has(key)) el.hidden = true;
  }

  clear(): void {
    for (const el of this.pool.values()) el.remove();
    this.pool.clear();
  }
}

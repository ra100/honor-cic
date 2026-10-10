import * as THREE from 'three';
import { safePlotRect, type PlotInsets, type PlotRect } from './framing';

export interface LabelSpec {
  key: string; text: string; sub?: string; cls: string; pos: THREE.Vector3; avoid?: THREE.Vector3[];
  /** Site B callout: fixed pixel offset from the anchor, joined to it by a thin leader line. */
  offset?: [number, number];
  /** CSS colour for the text and its leader line. */
  color?: string;
}

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

/** A callout box centred on the anchor plus its offset, or null when it leaves the plot or overlaps a placed label. */
export function placeCallout(x: number, y: number, offset: [number, number], width: number, height: number, safe: PlotRect, occupied: PlotRect[]): PlotRect | null {
  const box = { x: x + offset[0] - width / 2, y: y + offset[1] - height / 2, width, height };
  if (box.x < safe.x || box.y < safe.y || box.x + width > safe.x + safe.width || box.y + height > safe.y + safe.height) return null;
  return occupied.every((o) => box.x + box.width + 4 <= o.x || o.x + o.width + 4 <= box.x || box.y + box.height + 4 <= o.y || o.y + o.height + 4 <= box.y) ? box : null;
}

const labelPriority = (spec: LabelSpec): number => /\b(selected|damage)\b/.test(spec.cls) ? 6 : /\bdemo\b/.test(spec.cls) ? 5 : /\btitle\b/.test(spec.cls) ? 4 : /\bspec\b/.test(spec.cls) ? 3 : /\bfleet\b/.test(spec.cls) ? 2 : 1;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Projected HTML labels: Site A two-line labels with a leader tick, Site B offset callouts with SVG leaders. Pooled by key. */
export class LabelLayer {
  private pool = new Map<string, HTMLDivElement>();
  private leaders = new Map<string, SVGLineElement>();
  private readonly svg: SVGSVGElement;
  private v = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'leaders');
    this.svg.setAttribute('aria-hidden', 'true');
    root.prepend(this.svg);
  }

  /** `obstacles` are HUD boxes over the plot (caption, tools, sheets) that labels must not sit under. */
  update(specs: LabelSpec[], camera: THREE.Camera, width: number, height: number, insets?: PlotInsets, obstacles: PlotRect[] = []): void {
    const safe = safePlotRect(width, height, insets);
    camera.updateMatrixWorld();
    const live = new Set<string>();
    const lines = new Set<string>();
    const occupied: PlotRect[] = [...obstacles];
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
      el.className = `lbl ${s.cls}${s.offset ? ' callout' : ''}`;
      el.style.color = s.color ?? '';
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
      let box: PlotRect | null;
      if (s.offset) {
        box = placeCallout(x, y, s.offset, el.offsetWidth, el.offsetHeight, safe, occupied);
      } else {
        let avoid: PlotRect[] = [];
        if (s.avoid) {
          if (!exclusions.has(s.avoid)) {
            const rect = projectedBounds(s.avoid, camera, width, height);
            exclusions.set(s.avoid, rect ? [rect] : []);
          }
          avoid = exclusions.get(s.avoid)!;
        }
        box = placeLabel(x, y, el.offsetWidth, el.offsetHeight, safe, occupied, avoid);
      }
      if (!box) { el.hidden = true; continue; }
      occupied.push(box);
      el.style.transform = `translate(${box.x}px, ${box.y}px)`;
      if (s.offset) {
        let line = this.leaders.get(s.key);
        if (!line) {
          line = document.createElementNS(SVG_NS, 'line');
          this.svg.append(line);
          this.leaders.set(s.key, line);
        }
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        line.setAttribute('x1', x.toFixed(1));
        line.setAttribute('y1', y.toFixed(1));
        line.setAttribute('x2', cx.toFixed(1));
        line.setAttribute('y2', cy.toFixed(1));
        line.setAttribute('stroke', s.color ?? 'currentColor');
        line.style.display = '';
        lines.add(s.key);
      }
    }
    for (const [key, el] of this.pool) if (!live.has(key)) el.hidden = true;
    for (const [key, line] of this.leaders) if (!lines.has(key)) line.style.display = 'none';
  }

  clear(): void {
    for (const el of this.pool.values()) el.remove();
    this.pool.clear();
    this.leaders.clear();
    this.svg.remove();
  }
}

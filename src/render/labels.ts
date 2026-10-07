import * as THREE from 'three';

export interface LabelSpec { key: string; text: string; sub?: string; cls: string; pos: THREE.Vector3 }

/** Projected HTML labels with leader ticks (DESIGN.md identity motif). Elements are pooled by key. */
export class LabelLayer {
  private pool = new Map<string, HTMLDivElement>();
  private v = new THREE.Vector3();

  constructor(private readonly root: HTMLElement) {}

  update(specs: LabelSpec[], camera: THREE.Camera, width: number, height: number): void {
    const live = new Set<string>();
    for (const s of specs) {
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
      el.style.transform = `translate(${((this.v.x + 1) / 2) * width + 8}px, ${((1 - this.v.y) / 2) * height - 7}px)`;
      el.hidden = false;
    }
    for (const [key, el] of this.pool) if (!live.has(key)) el.hidden = true;
  }

  clear(): void {
    for (const el of this.pool.values()) el.remove();
    this.pool.clear();
  }
}

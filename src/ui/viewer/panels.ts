import { logBetween, type Frame, type LogEntry, type Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { TechRegistry } from '../../core/tech';
import { clear, h } from '../dom';
import { logLine } from '../format';
import type { Store } from '../store';
import { forcesModel, inspectorModel, logModel, type ViewerState } from './model';

const LOG_LIMIT = 300;

/** An evidence-tagged value whose source opens on hover, tap and keyboard (DESIGN.md Reflow). */
export function evButton(value: string, source: string): HTMLElement {
  const src = h('span', { class: 'src', hidden: true }, source);
  const btn = h('button', {
    class: 'ev', type: 'button', title: source, 'aria-expanded': 'false',
    onclick: () => {
      src.hidden = !src.hidden;
      btn.setAttribute('aria-expanded', String(!src.hidden));
    },
  }, value);
  return h('span', null, btn, src);
}

export class ForcesPanel {
  readonly el: HTMLElement;
  private sig = '';

  constructor(private readonly replay: Replay, private readonly store: Store<ViewerState>) {
    this.el = h('aside', { class: 'forces panel', id: 'forces', 'aria-label': 'Forces' });
  }

  render(frame: Frame): void {
    const sides = forcesModel(this.replay, frame);
    const sig = JSON.stringify(sides.map((s) => s.units.map((u) => [u.presence, u.lacText, u.counts.map((c) => `${c.status}:${c.n}`)])));
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.el);
    this.el.append(h('h2', { class: 'panel-title' }, 'Forces'));
    for (const side of sides) {
      this.el.append(h('p', { class: `side-head ${side.ally ? 'allied' : 'hostile'}` }, side.name));
      for (const u of side.units) {
        const theater = this.replay.units[u.idx].theater;
        this.el.append(
          h('div', { class: 'unit', 'data-unit': this.replay.units[u.idx].id },
            h('h3', null, h('button', { type: 'button', onclick: () => this.store.set({ selectedShip: u.firstShip, theater }) }, u.name)),
            u.presence === 'arriving' ? h('p', { class: 'readout' }, 'Not in the system yet') : null,
            u.presence === 'departed' ? h('p', { class: 'readout' }, 'Departed') : null,
            u.lacText
              ? h('p', { class: 'readout' }, u.lacText)
              : h('ul', { class: 'pips' }, u.counts.map((c) => h('li', { class: `pip st-${c.status}` }, c.text)))),
        );
      }
    }
  }
}

export class LogPanel {
  readonly el: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly filter: HTMLSelectElement;
  private lastT = -Infinity;
  private lastSide = '';

  constructor(private readonly replay: Replay, store: Store<ViewerState>) {
    this.filter = h('select', { 'aria-label': 'Show log entries for', onchange: () => store.set({ logSide: this.filter.value }) },
      h('option', { value: 'all' }, 'All sides'),
      replay.sides.map((s) => h('option', { value: s.id }, s.name)));
    this.list = h('ol', { class: 'log-list', role: 'log', 'aria-live': 'off' });
    this.el = h('section', { class: 'log panel', id: 'log', 'aria-label': 'CIC log' },
      h('div', { class: 'transport-row' }, h('h2', { class: 'panel-title' }, 'CIC log'), this.filter),
      this.list);
  }

  private row(e: LogEntry): HTMLLIElement {
    const cls = e.side === null ? '' : e.side === this.replay.sides[0].id ? 'allied' : 'hostile';
    return h('li', { class: cls }, logLine(e));
  }

  render(t: number, side: string): void {
    if (this.filter.value !== side) this.filter.value = side;
    const atBottom = this.list.scrollTop + this.list.clientHeight >= this.list.scrollHeight - 4;
    if (t < this.lastT || side !== this.lastSide) {
      clear(this.list);
      for (const r of logModel(this.replay, t, side, LOG_LIMIT)) this.list.append(this.row(r.entry));
    } else if (t > this.lastT) {
      for (const e of logBetween(this.replay, this.lastT, t)) {
        if (side === 'all' || e.side === side || e.side === null) this.list.append(this.row(e));
      }
      while (this.list.childElementCount > LOG_LIMIT) this.list.firstElementChild!.remove();
    } else return;
    this.lastT = t;
    this.lastSide = side;
    if (atBottom) this.list.scrollTop = this.list.scrollHeight;
  }
}

export class InspectorPanel {
  readonly el: HTMLElement;
  private sig = '';

  constructor(
    private readonly pack: ScenarioPack,
    private readonly tech: TechRegistry,
    private readonly replay: Replay,
    private readonly store: Store<ViewerState>,
  ) {
    this.el = h('section', { class: 'inspector panel', 'aria-label': 'Selected ship', hidden: true });
  }

  render(ship: number | null, t: number): void {
    if (ship === null) {
      this.el.hidden = true;
      this.sig = '';
      return;
    }
    const m = inspectorModel(this.pack, this.tech, this.replay, ship, t);
    const sig = JSON.stringify([ship, m.status, m.subsystems.map((s) => s.text), m.hits]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.el.hidden = false;
    clear(this.el);
    this.el.append(
      h('h2', { class: 'panel-title' }, m.name),
      h('p', { class: 'readout' }, m.nameNote),
      h('dl', { class: 'figs' },
        h('dt', null, 'Class'), h('dd', null, m.className),
        h('dt', null, 'Side'), h('dd', null, m.side),
        h('dt', null, 'Status'), h('dd', null, m.status),
        h('dt', null, 'Hits, whole battle'), h('dd', { class: 'mono' }, String(m.hits)),
        m.equipment.length ? [h('dt', null, 'Equipment'), h('dd', null, m.equipment.join(', '))] : null),
      h('ul', { class: 'pips', 'aria-label': 'Subsystems' }, m.subsystems.map((s) => h('li', { class: s.ok ? 'sub-ok' : 'sub-lost' }, `${s.label}: ${s.text}`))),
      h('dl', { class: 'figs' }, m.figures.map((f) => [h('dt', null, f.label), h('dd', null, evButton(f.value, f.source))])),
      h('div', { class: 'group' },
        h('button', { class: 'btn', type: 'button', onclick: () => this.store.set({ scale: 'ship', selectedClass: null, camera: 'free' }) }, 'Show class'),
        h('button', { class: 'btn', type: 'button', onclick: () => this.store.set({ selectedShip: null }) }, 'Clear selection')),
    );
  }
}

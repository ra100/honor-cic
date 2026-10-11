import { formatLabelled } from '../../core/evidence';
import { logBetween, shipStatusAt, ShipStatus, STATUS_TEXT, type Frame, type LogEntry, type Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { ShipClass, TechRegistry } from '../../core/tech';
import { clear, h } from '../dom';
import { fmtClock } from '../format';
import type { Store } from '../store';
import { forceUnits } from './hud-model';
import { inspectorModel, logModel, logVisible, scaleSelection, sourceText, type ViewerState } from './model';

const LOG_LIMIT = 300;
const MAJOR = new Set(['loss', 'surrender', 'transit', 'signal', 'arrival']);

/** A value with its evidence label; the source shows on hover and tap. */
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

/** Site A Forces column: per fleet, commander, limit status and role bars (A report §7.4). */
export class ForcesPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private sig = '';

  constructor(private readonly pack: ScenarioPack, private readonly replay: Replay, private readonly store: Store<ViewerState>) {
    this.body = h('div', { class: 'forces-body' });
    this.el = h('aside', { class: 'hud-panel panel', id: 'forces', 'aria-label': 'Forces' }, h('h2', null, 'Forces'), this.body);
  }

  render(frame: Frame, only: string | null = null): void {
    const units = forceUnits(this.pack, this.replay, frame, only);
    const sig = JSON.stringify([only, units.map((u) => [u.dormant, u.limit, u.bars.map((b) => [b.ok, b.crippled])])]);
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.body);
    for (const u of units) {
      this.body.append(h('div', { class: `fleet ${u.ally ? 'allied' : 'hostile'}${u.dormant ? ' dormant' : ''}`, 'data-unit': u.id },
        h('div', { class: 'fleet-h' },
          h('button', {
            class: 'fleet-n', type: 'button', title: `Follow ${u.name}`,
            onclick: () => this.store.set({ selectedShip: u.firstShip, selectedClass: null, theater: u.theater, camera: 'free', follow: true, followUnit: u.id }),
          }, u.name),
          u.limit ? h('span', { class: 'num note-star' }, u.limit) : null),
        u.commander ? h('div', { class: 'fleet-c' }, u.commander) : null,
        u.bars.map((b) => {
          const ok = b.total ? (b.ok / b.total) * 100 : 0;
          const cr = b.total ? (b.crippled / b.total) * 100 : 0;
          return h('div', { class: 'frow' },
            h('span', { class: 't' }, b.label),
            h('span', { class: 'bar' }, h('i', { class: 'ok', style: `width:${ok.toFixed(1)}%` }), h('i', { class: 'cr', style: `left:${ok.toFixed(1)}%;width:${cr.toFixed(1)}%` })),
            h('span', { class: 'n' }, `${(b.ok + b.crippled).toLocaleString('en-US')}/${b.total.toLocaleString('en-US')}`));
        })));
    }
  }
}

/** Site A CIC log: newest first, side-coloured, click to seek (A report §7.5). */
export class LogPanel {
  readonly el: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly count: HTMLElement;
  private readonly filter: HTMLSelectElement;
  private lastT = -Infinity;
  private lastKey = '';
  private shown = 0;

  constructor(private readonly replay: Replay, private readonly store: Store<ViewerState>) {
    this.filter = h('select', { class: 'log-filter', 'aria-label': 'Show log entries for', onchange: () => store.set({ logSide: this.filter.value }) },
      h('option', { value: 'all' }, 'All'),
      replay.sides.map((s) => h('option', { value: s.id }, s.name)));
    this.count = h('span', { class: 'num' });
    this.list = h('ol', { id: 'log', role: 'log', 'aria-label': 'CIC log entries', 'aria-live': 'off' });
    this.el = h('section', { id: 'logWrap', 'aria-label': 'CIC log' }, h('h2', null, h('span', null, 'CIC log'), h('span', { class: 'log-tools' }, this.filter, this.count)), this.list);
  }

  private row(e: LogEntry, fresh: boolean): HTMLLIElement {
    const cls = e.side === null ? 'sn' : e.side === this.replay.sides[0].id ? 's0' : 's1';
    return h('li', {
      class: `${cls}${MAJOR.has(e.kind) ? ' major' : ''}${fresh ? ' fresh' : ''}`,
      onclick: () => this.store.set({ t: Math.max(0, e.t - 3) }),
    }, h('span', { class: 'lt' }, fmtClock(e.t)), h('span', null, `${e.text} `, h('small', { class: 'evl' }, `[${e.evidence}]`)));
  }

  render(t: number, side: string, only: string | null = null): void {
    if (this.filter.value !== side) this.filter.value = side;
    this.filter.disabled = only !== null;
    const key = `${side}|${only ?? ''}`;
    if (t < this.lastT || key !== this.lastKey) {
      clear(this.list);
      const rows = logModel(this.replay, t, side, LOG_LIMIT, only);
      for (const r of rows.reverse()) this.list.append(this.row(r.entry, false));
      this.shown = rows.length;
    } else if (t > this.lastT) {
      for (const e of logBetween(this.replay, this.lastT, t)) {
        if (!logVisible(e, side, only)) continue;
        this.list.prepend(this.row(e, true));
        this.shown++;
      }
      while (this.list.childElementCount > LOG_LIMIT) this.list.lastElementChild!.remove();
    }
    this.lastT = t;
    this.lastKey = key;
    const total = this.replay.log.filter((e) => logVisible(e, side, only)).length;
    const text = `${Math.min(this.shown, total)}/${total}`;
    if (this.count.textContent !== text) this.count.textContent = text;
  }
}

const PILL: Record<ShipStatus, string> = {
  [ShipStatus.Operational]: 'ok', [ShipStatus.Degraded]: 'cr', [ShipStatus.MissionKill]: 'hz', [ShipStatus.Destroyed]: 'dead',
  [ShipStatus.Escaped]: 'dead', [ShipStatus.Captured]: 'hz', [ShipStatus.Absent]: 'dead',
};

/** Site A inspector card for the selected ship (A report §7.5). */
export class InspectorPanel {
  readonly el: HTMLElement;
  private sig = '';

  constructor(
    private readonly pack: ScenarioPack,
    private readonly tech: TechRegistry,
    private readonly replay: Replay,
    private readonly store: Store<ViewerState>,
  ) {
    this.el = h('section', { id: 'inspector', 'aria-label': 'Selected ship', hidden: true });
  }

  render(ship: number | null, t: number): void {
    if (ship === null) {
      this.el.hidden = true;
      this.sig = '';
      return;
    }
    const m = inspectorModel(this.pack, this.tech, this.replay, ship, t);
    const s = this.replay.ships[ship];
    const status = shipStatusAt(this.replay, s, t);
    const sig = JSON.stringify([ship, m.status, m.subsystems.map((x) => x.text), m.hits]);
    if (sig === this.sig) return;
    this.sig = sig;
    this.el.hidden = false;
    clear(this.el);
    const unit = this.replay.units[s.unit];
    this.el.append(
      h('div', { class: 'ins-h' },
        h('div', null, h('div', { class: 'ins-name' }, m.name), h('div', { class: 'ins-cls' }, `${m.className} · ${unit?.name ?? m.side}`)),
        h('button', { class: 'x', type: 'button', 'aria-label': 'Clear selection', onclick: () => this.store.set({ selectedShip: null }) }, '×')),
      h('div', { class: 'ins-state' }, h('span', { class: `pill ${PILL[status]}` }, STATUS_TEXT[status]), h('span', null, `${m.hits.toLocaleString('en-US')} hits taken`)),
      h('ul', null,
        m.subsystems.filter((x) => !x.ok || x.text !== 'intact').map((x) => h('li', { class: 'lost' }, `${x.label}: ${x.text}`)),
        m.figures.map((f) => h('li', null, `${f.label}: `, evButton(f.value, f.source))),
        m.equipment.length ? h('li', null, `Equipment: ${m.equipment.join(', ')}`) : null,
        h('li', { class: 'note' }, m.nameNote)),
      h('div', { class: 'ins-btns' },
        h('button', { class: 'tb', type: 'button', onclick: () => this.store.set({ camera: 'free', follow: true, followUnit: unit?.id ?? null, theater: unit?.theater ?? this.store.get().theater }) }, 'Follow'),
        h('button', { class: 'tb', type: 'button', onclick: () => this.store.set({ ...scaleSelection('ship'), selectedClass: null }) }, 'Ship detail')),
    );
  }
}

const mountsPerSide = (cls: ShipClass, key: 'cm' | 'pd' | 'missile' | 'graser'): string => formatLabelled(cls.broadside[key]);

/** Site B object panel for the ship detail view (B report §4.13). */
export class ShipPanel {
  readonly el: HTMLElement;
  private readonly kicker = h('p', { class: 'eyebrow' }, 'Hull & defensive geometry');
  private readonly title = h('h2', { class: 'obj-title' });
  private readonly type = h('p', { class: 'obj-type' });
  private readonly figures = h('dl', { class: 'obj-figs' });
  private readonly note = h('p', { class: 'technical-note' }, 'Hull dimensions and mount counts follow the class data; mount placement is schematic. Fields and event visibility are enlarged, and demo time is illustrative.');
  private readonly all = h('dl', { class: 'figs' });
  private key = '';

  constructor(private readonly pack: ScenarioPack, private readonly tech: TechRegistry, private readonly replay: Replay) {
    this.el = h('aside', { class: 'hud-panel panel object-panel', 'aria-label': 'Ship class' },
      this.kicker, this.title, this.type, this.figures, this.note,
      h('details', { class: 'class-details' }, h('summary', null, 'Class figures and sources'), this.all));
  }

  render(classId: string | null, selectedShip: number | null): void {
    const cls = classId ? this.tech.classes[classId] : undefined;
    const ship = selectedShip !== null ? this.replay.ships[selectedShip] : null;
    const key = `${classId}|${ship?.classId === classId ? ship?.idx : ''}`;
    if (key === this.key) return;
    this.key = key;
    this.title.textContent = cls?.name ?? classId ?? 'No class data';
    const named = ship && ship.classId === classId ? `${ship.name} · ` : '';
    this.type.textContent = cls ? `${named}${cls.hull}, ${cls.navy}${ship?.equipment.length ? ` · ${ship.equipment.join(', ')}` : ''}` : 'No published class data in this pack.';
    clear(this.figures);
    clear(this.all);
    if (!cls) return;
    const rows: Array<[string, string]> = [
      ['Length', formatLabelled(cls.length)],
      ['Mass', formatLabelled(cls.mass)],
      ['Max / normal accel.', `${formatLabelled(cls.accel_max)} / ${formatLabelled(cls.accel_normal)}`],
      ['Magazine / pods', formatLabelled(cls.pod_capacity)],
      ['Tubes, each side', mountsPerSide(cls, 'missile')],
      ['Grasers, each side', mountsPerSide(cls, 'graser')],
      ['CM launchers', `${mountsPerSide(cls, 'cm')} / broadside`],
      ['PD clusters', `${mountsPerSide(cls, 'pd')} / broadside`],
    ];
    for (const [label, value] of rows) this.figures.append(h('dt', null, label), h('dd', null, value));
    const full = [
      ['Beam', cls.beam], ['Height', cls.height], ['Pods per cycle', cls.pod_eject_count], ['Pod cycle', cls.pod_eject_cycle],
      ['LAC bays', cls.lac_bays], ['Hyper cycle', cls.hyper_cycle], ['Band length', cls.wedge.band_length], ['Band width', cls.wedge.band_width],
      ['Band offset', cls.wedge.band_offset], ['Sidewall offset', cls.wedge.sidewall_offset],
      ...([['fore', 'Bow'], ['aft', 'Stern']] as const).flatMap(([aspect, prefix]) =>
        ([['missile', 'tubes'], ['graser', 'grasers'], ['cm', 'CM'], ['pd', 'PD'], ['pod_lanes', 'pod lanes']] as const)
          .map(([k, name]) => [`${prefix} ${name}`, cls[aspect][k]] as const)),
    ] as const;
    for (const [label, value] of full) this.all.append(h('dt', null, label), h('dd', null, evButton(formatLabelled(value), sourceText(this.pack, value))));
  }
}

import { EVIDENCE_TEXT, type EvidenceLabel } from '../../core/evidence';
import type { Frame, Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { TechRegistry } from '../../core/tech';
import type { DirectorShot } from '../../render/director';
import { LAYER_TEXT, LAYERS, type ScaleId } from '../../render/scales/types';
import { clear, h } from '../dom';
import { fmtClock } from '../format';
import { CATALOG_HREF } from '../router';
import type { Store } from '../store';
import { DENSITIES, knownSide, nextPhase, prevPhase, SPEEDS, tickLabels, type PhaseMark, type Speed, type ViewerState } from './model';
import { ForcesPanel, InspectorPanel, LogPanel } from './panels';

export interface HudDeps {
  pack: ScenarioPack;
  tech: TechRegistry;
  replay: Replay;
  store: Store<ViewerState>;
  marks: PhaseMark[];
  shots: DirectorShot[];
  onResetView(): void;
  onFullscreen(): void;
}

export interface Live { frame: Frame; samplingText: string | null; scaleNote: string; notice: string | null }

export interface Hud {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  labels: HTMLElement;
  render(s: ViewerState, live: Live): void;
  dispose(): void;
}

const SCALES: Array<{ id: ScaleId; label: string }> = [
  { id: 'system', label: 'System' }, { id: 'engagement', label: 'Engagement' }, { id: 'ship', label: 'Ship' },
];
const KEYS: Array<[string, string]> = [
  ['Space', 'Play or pause'], ['← →', 'Step 1 s, with Shift 60 s'], ['[ ]', 'Previous or next phase'],
  ['+ −', 'Faster or slower'], ['1 2 3', 'System, Engagement or Ship scale'], ['D', 'Director camera'], ['F', 'Free camera'], ['G', 'Follow the selected fleet or the current engagement'],
  ['P', 'Switch between Actual and Perceived'], ['Esc', 'Close menus, then clear the selection'], ['?', 'This help'],
];
const speedText = (s: number): string => (s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`);
const INTERACTIVE = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY']);

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
function setAttr(el: Element, k: string, v: string): void {
  if (el.getAttribute(k) !== v) el.setAttribute(k, v);
}
function shiftSpeed(current: Speed, dir: 1 | -1): number {
  const i = current === 'auto' ? SPEEDS.indexOf(4) : Math.max(0, SPEEDS.findIndex((s) => s >= current));
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))];
}

export function buildHud(d: HudDeps): Hud {
  const { pack, replay, store } = d;
  const set = store.set;
  const togglePlay = () => {
    const s = store.get();
    if (!s.playing && s.t >= replay.duration_s) set({ t: 0, playing: true });
    else set({ playing: !s.playing });
  };

  const canvas = h('canvas', { class: 'plot', role: 'img', 'aria-label': `${pack.meta.title}: battle plot` });
  const labels = h('div', { class: 'labels', 'aria-hidden': 'true' });
  const notice = h('div', { class: 'notice panel', role: 'status', hidden: true });

  const tabs = SCALES.map((sc, i) =>
    h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', title: `${sc.label} scale (${i + 1})`, onclick: () => set({ scale: sc.id, camera: 'free' }) }, sc.label));
  const clock = h('div', { class: 'clock', 'aria-label': 'Battle clock' });
  const director = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', title: 'Director camera (D)', disabled: d.shots.length === 0, onclick: () => set({ camera: 'director' }) }, 'Director');
  const free = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', title: 'Free camera (F)', onclick: () => set({ camera: 'free' }) }, 'Free');
  const follow = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', title: 'Free camera follows the selected fleet or the current engagement (G)', onclick: () => set({ follow: !store.get().follow }) }, 'Follow');
  const theater = pack.meta.theaters.length > 1
    ? h('select', { 'aria-label': 'Theater', onchange: () => set({ theater: theater!.value, camera: 'free' }) }, pack.meta.theaters.map((t) => h('option', { value: t.id }, t.label)))
    : null;
  const menuBtn = (id: Exclude<ViewerState['menu'], 'none'>, label: string) =>
    h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': `menu-${id}`, onclick: () => set({ menu: store.get().menu === id ? 'none' : id }) }, label);
  const menuButtons: Partial<Record<ViewerState['menu'], HTMLButtonElement>> = {
    layers: menuBtn('layers', 'Layers'), view: menuBtn('view', 'View'), density: menuBtn('density', 'Density'),
    ...(d.shots.length ? { shots: menuBtn('shots', 'Shots') } : {}),
  };
  const drawerBtn = (id: 'forces' | 'log', label: string) =>
    h('button', { class: 'btn drawer-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': id === 'forces' ? 'forces' : 'right', onclick: () => set({ drawer: store.get().drawer === id ? 'none' : id }) }, label);
  const forcesToggle = drawerBtn('forces', 'Forces');
  const logToggle = drawerBtn('log', 'Log');

  const helpDlg = h('dialog', { class: 'dialog panel', 'aria-label': 'Help' });
  const notesDlg = h('dialog', { class: 'dialog panel', 'aria-label': 'Notes and sources' });
  const closeBtn = (dlg: HTMLDialogElement) => h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Close');
  helpDlg.append(
    h('h2', null, 'Controls'),
    h('dl', { class: 'figs' }, KEYS.map(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
    h('h2', null, 'Evidence labels'),
    h('dl', { class: 'figs' }, (Object.keys(EVIDENCE_TEXT) as EvidenceLabel[]).map((k) => [h('dt', null, `[${k}]`), h('dd', null, EVIDENCE_TEXT[k])])),
    h('p', { class: 'readout' }, 'Symbols are drawn at a fixed size. Distances, wedges and range rings are to scale. Missile dots are a labelled sample.'),
    closeBtn(helpDlg),
  );
  notesDlg.append(
    h('h2', null, `${pack.meta.title}: notes and sources`),
    h('div', { class: 'notes' }, pack.notes),
    h('h3', null, 'Sources'),
    h('ul', null, pack.meta.sources.map((s) => h('li', null, s.url ? h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title) : s.title, ` [${s.kind}]`))),
    closeBtn(notesDlg),
  );

  const topbar = h('header', { class: 'topbar panel' },
    h('a', { class: 'btn', href: CATALOG_HREF }, 'Back to catalog'),
    h('h1', { class: 'title' }, pack.meta.title),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Scale' }, tabs),
    clock,
    h('div', { class: 'group', role: 'group', 'aria-label': 'Camera' }, director, free, follow,
      h('button', { class: 'btn optional', type: 'button', onclick: d.onResetView }, 'Reset view'),
      h('button', { class: 'btn optional', type: 'button', onclick: d.onFullscreen }, 'Fullscreen')),
    theater,
    h('div', { class: 'group menus' }, Object.values(menuButtons),
      h('button', { class: 'btn', type: 'button', onclick: () => notesDlg.showModal() }, 'Notes'),
      h('button', { class: 'btn optional', type: 'button', onclick: () => helpDlg.showModal() }, 'Help')),
    h('div', { class: 'group' }, forcesToggle, logToggle));

  const layerBoxes = LAYERS.map((id) => {
    const box = h('input', { type: 'checkbox', onchange: () => set({ layers: { ...store.get().layers, [id]: box.checked } }) });
    return { id, box, el: h('label', null, box, h('span', null, LAYER_TEXT[id].label, h('small', null, LAYER_TEXT[id].hint))) };
  });
  const layersMenu = h('div', { class: 'menu panel', id: 'menu-layers', hidden: true },
    h('fieldset', null, h('legend', null, 'Layers'), layerBoxes.map((l) => l.el)));

  const setPerceived = (patch: Partial<ViewerState['perceived']>) => set({ perceived: { ...store.get().perceived, ...patch } });
  const actual = h('input', { type: 'radio', name: 'picture', onchange: () => setPerceived({ enabled: false }) });
  const perceived = h('input', { type: 'radio', name: 'picture', onchange: () => setPerceived({ enabled: true }) });
  const sideSel = h('select', { 'aria-label': 'Commander', onchange: () => setPerceived({ side: sideSel.value }) }, pack.meta.sides.map((s) => h('option', { value: s.id }, s.name)));
  const reduce = h('input', { type: 'checkbox', onchange: () => set({ reducedMotion: reduce.checked }) });
  const viewMenu = h('div', { class: 'menu panel', id: 'menu-view', hidden: true },
    h('fieldset', null, h('legend', null, 'Picture'),
      h('label', null, actual, h('span', null, 'Actual', h('small', null, 'Ground truth: where everything really is'))),
      h('label', null, perceived, h('span', null, 'Perceived', h('small', null, 'What one commander could know, delayed by light and FTL sensor lag'))),
      h('label', null, h('span', null, 'Commander'), sideSel)),
    h('fieldset', null, h('legend', null, 'Motion'),
      h('label', null, reduce, h('span', null, 'Reduce motion', h('small', null, 'No camera orbit; shots cut instead of easing')))));

  const densityRadios = DENSITIES.map((n) => {
    const r = h('input', { type: 'radio', name: 'density', onchange: () => set({ density: n }) });
    return { n, r, el: h('label', null, r, h('span', { class: 'mono' }, `1:${n}`)) };
  });
  const densityMenu = h('div', { class: 'menu panel', id: 'menu-density', hidden: true },
    h('fieldset', null, h('legend', null, 'Missile density'), densityRadios.map((x) => x.el)),
    h('small', null, 'One dot stands for N missiles. Above 250,000 dots the ratio doubles, and the readout under the plot shows the ratio in use.'));

  const shotsMenu = d.shots.length
    ? h('div', { class: 'menu panel', id: 'menu-shots', hidden: true },
        h('p', { class: 'panel-title' }, 'Director shots'),
        d.shots.map((s) => h('button', { class: 'btn shot', type: 'button', onclick: () => set({ t: s.t0, camera: 'director', menu: 'none' }) },
          h('span', null, `${fmtClock(s.t0)}  ${s.label}`, h('small', null, s.desc)))))
    : null;
  const menus: Partial<Record<ViewerState['menu'], HTMLElement>> = { layers: layersMenu, view: viewMenu, density: densityMenu, ...(shotsMenu ? { shots: shotsMenu } : {}) };

  const play = h('button', { class: 'btn play', type: 'button', 'aria-pressed': 'false', title: 'Play or pause (Space)', onclick: togglePlay }, 'Play');
  const speed = h('select', { 'aria-label': 'Playback speed', onchange: () => set({ speed: speed.value === 'auto' ? 'auto' : Number(speed.value) }) },
    h('option', { value: 'auto' }, 'Auto'), SPEEDS.map((s) => h('option', { value: String(s) }, speedText(s))));
  const demoBtn = (id: ViewerState['demo'], label: string) =>
    h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => set({ demo: store.get().demo === id ? 'none' : id, demoProgress: 0 }) }, label);
  const demoButtons = { roll: demoBtn('roll', 'Roll demo'), pods: demoBtn('pods', 'Pod demo'), broadside: demoBtn('broadside', 'Broadside demo') };
  const classIds = [...new Set(replay.ships.map((sh) => sh.classId))];
  const classSel = h('select', { 'aria-label': 'Ship class', onchange: () => set({ selectedClass: classSel.value || null }) },
    h('option', { value: '' }, 'Selected ship'), classIds.map((c) => h('option', { value: c }, d.tech.classes[c]?.name ?? c)));
  const shipGroup = h('div', { class: 'group', role: 'group', 'aria-label': 'Ship view', hidden: true }, classSel, demoButtons.roll, demoButtons.pods, demoButtons.broadside);
  const sampling = h('span', { class: 'readout' });
  const scaleNote = h('span', { class: 'readout optional' });
  let scrubbing = false;
  const scrub = h('input', {
    class: 'scrub', type: 'range', min: '0', max: String(replay.duration_s), step: '0.1', value: '0', 'aria-label': 'Battle time',
    oninput: () => set({ t: Number(scrub.value) }),
    onpointerdown: () => { scrubbing = true; },
    onpointerup: () => { scrubbing = false; },
    onchange: () => { scrubbing = false; },
  });
  // Phase labels need about 140 px each, so which labels fit depends on the timeline's rendered width.
  const ticks = h('div', { class: 'ticks', 'aria-hidden': 'true' });
  // Below 480 px only the marks are drawn; the phase buttons and the Shots menu carry the names.
  const renderTicks = (widthPx: number) => {
    clear(ticks);
    const endFrom = 100 * (1 - 150 / Math.max(150, widthPx));
    const shown: DOMRect[] = [];
    for (const m of tickLabels(d.marks, replay.duration_s, Math.min(1, 140 / Math.max(1, widthPx)))) {
      const el = h('span', { class: m.left > endFrom ? 'tick end' : 'tick', title: m.label, style: `left:${m.left}%` }, widthPx >= 480 && m.showLabel ? m.label : '');
      ticks.append(el);
      const box = el.getBoundingClientRect();
      if (!el.textContent || box.width === 0) continue;
      // Measured, not estimated: a label that would touch one already shown keeps only its mark.
      if (shown.some((b) => box.left < b.right + 6 && b.left < box.right + 6)) el.textContent = '';
      else shown.push(box);
    }
  };
  renderTicks(1200);
  const tickObserver = new ResizeObserver((entries) => renderTicks(entries[0].contentRect.width));
  tickObserver.observe(ticks);
  const transport = h('footer', { class: 'transport panel' },
    h('div', { class: 'transport-row' },
      h('button', { class: 'btn', type: 'button', title: 'Previous phase ([)', onclick: () => set({ t: prevPhase(d.marks, store.get().t) }) }, 'Previous phase'),
      play,
      h('button', { class: 'btn', type: 'button', title: 'Next phase (])', onclick: () => { const n = nextPhase(d.marks, store.get().t); if (n !== null) set({ t: n }); } }, 'Next phase'),
      h('label', { class: 'group' }, h('span', { class: 'readout' }, 'Speed'), speed),
      shipGroup, sampling, scaleNote),
    h('div', { class: 'timeline' }, ticks, scrub));

  const bottombar = h('nav', { class: 'bottombar', 'aria-label': 'Panels' },
    h('button', { class: 'btn', type: 'button', onclick: () => set({ drawer: store.get().drawer === 'forces' ? 'none' : 'forces' }) }, 'Forces'),
    h('button', { class: 'btn', type: 'button', onclick: () => set({ drawer: store.get().drawer === 'log' ? 'none' : 'log' }) }, 'Log'),
    h('button', { class: 'btn', type: 'button', onclick: () => set({ menu: store.get().menu === 'layers' ? 'none' : 'layers' }) }, 'Layers'),
    h('button', { class: 'btn', type: 'button', onclick: () => helpDlg.showModal() }, 'Info'));

  const forces = new ForcesPanel(replay, store);
  const log = new LogPanel(replay, store);
  const inspector = new InspectorPanel(pack, d.tech, replay, store);
  const right = h('div', { class: 'right', id: 'right' }, log.el, inspector.el);
  const root = h('div', { class: 'viewer' }, canvas, labels, notice,
    h('div', { class: 'hud' }, topbar, forces.el, right, bottombar, transport),
    Object.values(menus), helpDlg, notesDlg);

  const onKey = (e: KeyboardEvent) => {
    const s = store.get();
    if (e.key === 'Escape') {
      if (s.menu !== 'none' || s.drawer !== 'none') set({ menu: 'none', drawer: 'none' });
      else set({ selectedShip: null });
      return;
    }
    if (INTERACTIVE.has((e.target as HTMLElement).tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.shiftKey ? 60 : 1;
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); set({ t: Math.max(0, s.t - step) }); break;
      case 'ArrowRight': e.preventDefault(); set({ t: Math.min(replay.duration_s, s.t + step) }); break;
      case '[': set({ t: prevPhase(d.marks, s.t) }); break;
      case ']': { const n = nextPhase(d.marks, s.t); if (n !== null) set({ t: n }); break; }
      case '+': case '=': set({ speed: shiftSpeed(s.speed, 1) }); break;
      case '-': case '_': set({ speed: shiftSpeed(s.speed, -1) }); break;
      case '1': case '2': case '3': set({ scale: SCALES[Number(e.key) - 1].id, camera: 'free' }); break;
      case 'd': case 'D': if (d.shots.length) set({ camera: 'director' }); break;
      case 'f': case 'F': set({ camera: 'free' }); break;
      case 'g': case 'G': set({ follow: !s.follow }); break;
      case 'p': case 'P': set({ perceived: { ...s.perceived, enabled: !s.perceived.enabled } }); break;
      case '?': helpDlg.showModal(); break;
    }
  };
  const onDown = (e: PointerEvent) => {
    const open = store.get().menu;
    if (open === 'none') return;
    const target = e.target as Node;
    if (menus[open]?.contains(target) || menuButtons[open]?.contains(target)) return;
    if ((target as HTMLElement).closest?.('.bottombar')) return;
    set({ menu: 'none' });
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown);

  // Menus sit after the HUD in the DOM, so opening one moves focus into it and closing returns focus to its button (R-32).
  let lastMenu: ViewerState['menu'] = 'none';
  const syncMenuFocus = (menu: ViewerState['menu']) => {
    if (menu === lastMenu) return;
    const closed = lastMenu;
    lastMenu = menu;
    if (menu !== 'none') {
      menus[menu]?.querySelector<HTMLElement>('input, button, select')?.focus();
    } else if (closed !== 'none') {
      const active = document.activeElement;
      if (!active || active === document.body || menus[closed]?.contains(active)) menuButtons[closed]?.focus();
    }
  };

  return {
    root, canvas, labels,
    render(s, live) {
      root.dataset.scale = s.scale;
      setText(clock, fmtClock(live.frame.t));
      tabs.forEach((b, i) => setAttr(b, 'aria-selected', String(SCALES[i].id === s.scale)));
      setAttr(director, 'aria-pressed', String(s.camera === 'director'));
      setAttr(free, 'aria-pressed', String(s.camera === 'free'));
      setAttr(follow, 'aria-pressed', String(s.follow));
      follow.disabled = s.camera !== 'free' || s.scale === 'ship';
      if (theater && theater.value !== s.theater) theater.value = s.theater;
      for (const [id, btn] of Object.entries(menuButtons)) setAttr(btn!, 'aria-expanded', String(s.menu === id));
      for (const [id, el] of Object.entries(menus)) el!.hidden = s.menu !== id;
      syncMenuFocus(s.menu);
      for (const l of layerBoxes) l.box.checked = s.layers[l.id];
      actual.checked = !s.perceived.enabled;
      perceived.checked = s.perceived.enabled;
      if (sideSel.value !== s.perceived.side) sideSel.value = s.perceived.side;
      reduce.checked = s.reducedMotion;
      for (const x of densityRadios) x.r.checked = x.n === s.density;
      setAttr(play, 'aria-pressed', String(s.playing));
      setText(play, s.playing ? 'Pause' : 'Play');
      const sv = s.speed === 'auto' ? 'auto' : String(s.speed);
      if (speed.value !== sv) speed.value = sv;
      if (!scrubbing) scrub.value = String(live.frame.t);
      setAttr(scrub, 'aria-valuetext', fmtClock(live.frame.t));
      shipGroup.hidden = s.scale !== 'ship';
      setAttr(demoButtons.roll, 'aria-pressed', String(s.demo === 'roll'));
      setAttr(demoButtons.pods, 'aria-pressed', String(s.demo === 'pods'));
      setAttr(demoButtons.broadside, 'aria-pressed', String(s.demo === 'broadside'));
      if (classSel.value !== (s.selectedClass ?? '')) classSel.value = s.selectedClass ?? '';
      setText(sampling, live.samplingText ?? '');
      setText(scaleNote, live.scaleNote);
      notice.hidden = !live.notice;
      setText(notice, live.notice ?? '');
      forces.el.classList.toggle('open', s.drawer === 'forces');
      right.classList.toggle('open', s.drawer === 'log');
      setAttr(forcesToggle, 'aria-expanded', String(s.drawer === 'forces'));
      setAttr(logToggle, 'aria-expanded', String(s.drawer === 'log'));
      forces.render(live.frame, knownSide(s));
      log.render(live.frame.t, s.logSide, knownSide(s));
      inspector.render(s.selectedShip, live.frame.t);
    },
    dispose() {
      tickObserver.disconnect();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      root.remove();
    },
  };
}

import { EVIDENCE_TEXT, formatLabelled, type EvidenceLabel } from '../../core/evidence';
import type { Frame, Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { TechRegistry } from '../../core/tech';
import type { DirectorShot } from '../../render/director';
import type { PlotInsets } from '../../render/framing';
import { LAYER_TEXT, LAYERS, type ScaleId } from '../../render/scales/types';
import { clear, h } from '../dom';
import { fmtClock } from '../format';
import { renderNotes, safeNoteUrl } from '../notes';
import { CATALOG_HREF } from '../router';
import type { Store } from '../store';
import { occupiedPlotInsets, type PlotOccupancy } from './layout';
import {
  composition, DENSITIES, knownSide, nextPhase, prevPhase, scaleSelection, shipClassId, sourceText,
  SPEEDS, tickLabels, type PhaseMark, type Speed, type ViewerState,
} from './model';
import { evButton, ForcesPanel, InspectorPanel, LogPanel } from './panels';

export interface HudDeps {
  pack: ScenarioPack;
  tech: TechRegistry;
  replay: Replay;
  store: Store<ViewerState>;
  marks: PhaseMark[];
  shots: DirectorShot[];
  onResetView(): void;
  onFullscreen(): void;
  onLayoutChange(): void;
}

export interface Live { frame: Frame; samplingText: string | null; scaleNote: string; notice: string | null }

export interface Hud {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  labels: HTMLElement;
  render(s: ViewerState, live: Live): void;
  plotInsets(): PlotInsets;
  dispose(): void;
}

const SCALES: Array<{ id: ScaleId; label: string }> = [
  { id: 'system', label: 'System' }, { id: 'engagement', label: 'Engagement' }, { id: 'ship', label: 'Ship' },
];
const KEYS: Array<[string, string]> = [
  ['Space', 'Play or pause'], ['Left / Right', 'Step 1 s, with Shift 60 s'], ['[ ]', 'Previous or next phase'],
  ['+ / -', 'Faster or slower'], ['1 2 3', 'System, Engagement or Ship scale'], ['D', 'Director camera'],
  ['F', 'Free camera'], ['G', 'Follow the selected fleet or the current engagement'],
  ['P', 'Switch between Actual and Perceived'], ['Esc', 'Close a panel or menu, then clear the selection'], ['?', 'This help'],
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
  const compact = window.matchMedia('(max-width: 859px)');
  const floating = window.matchMedia('(min-width: 1100px)');
  const togglePlay = () => {
    const s = store.get();
    if (!s.playing && s.t >= replay.duration_s) set({ t: 0, playing: true });
    else set({ playing: !s.playing });
  };
  const selectScale = (id: ScaleId) => set(scaleSelection(id));
  const canvas = h('canvas', { class: 'plot', role: 'img', tabindex: '0', 'aria-label': `${pack.meta.title}: battle plot. Camera and replay controls follow the scale tabs.` });
  const labels = h('div', { class: 'labels', 'aria-hidden': 'true' });
  const notice = h('div', { class: 'notice panel', role: 'status', hidden: true });

  const tabs = SCALES.map((sc, i) => h('button', {
    id: `scale-${sc.id}`, type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'scale-workspace',
    tabindex: '-1', title: `${sc.label} scale (${i + 1})`, onclick: () => selectScale(sc.id),
  }, sc.label));
  const scaleTabs = h('div', {
    class: 'tabs', role: 'tablist', 'aria-label': 'Scale',
    onkeydown: (e: KeyboardEvent) => {
      const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0) return;
      let next = at;
      if (e.key === 'ArrowRight') next = (at + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (at + tabs.length - 1) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      else return;
      e.preventDefault();
      e.stopPropagation();
      selectScale(SCALES[next].id);
      tabs.forEach((tab, i) => { tab.tabIndex = i === next ? 0 : -1; });
      tabs[next].focus();
    },
  }, tabs);
  const clock = h('div', { class: 'clock', 'aria-label': 'Battle clock' });
  const cameraState = h('span', { class: 'readout camera-state' });
  const menuBtn = (id: Exclude<ViewerState['menu'], 'none'>, label: string) =>
    h('button', {
      class: 'btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': `menu-${id}`, 'aria-haspopup': 'dialog',
      onclick: () => set({ menu: store.get().menu === id ? 'none' : id, drawer: 'none' }),
    }, label);
  const menuButtons = {
    layers: menuBtn('layers', 'Layers'), view: menuBtn('view', 'View'), density: menuBtn('density', 'Density'),
    shots: menuBtn('shots', 'Shots'), controls: menuBtn('controls', 'Controls'),
  };
  const topbar = h('header', { class: 'topbar panel' },
    h('a', { class: 'btn catalog-link', href: CATALOG_HREF, 'aria-label': 'Back to catalog' }, 'Catalog'),
    h('h1', { class: 'title' }, pack.meta.title),
    scaleTabs, clock,
    h('div', { class: 'control-entry' }, cameraState, menuButtons.controls));

  const helpDlg = h('dialog', { class: 'dialog panel', 'aria-label': 'Help' });
  const notesDlg = h('dialog', { class: 'dialog panel', 'aria-label': 'Notes and sources' });
  let dialogReturn: HTMLElement | null = null;
  const returnFocus = (target: HTMLElement | null) => {
    if (target?.isConnected && target.getClientRects().length && !target.hidden) target.focus();
    else menuButtons.controls.focus();
  };
  const openDialog = (dlg: HTMLDialogElement) => {
    dialogReturn = document.activeElement as HTMLElement;
    set({ menu: 'none', drawer: 'none' });
    dlg.showModal();
  };
  const closeBtn = (dlg: HTMLDialogElement) => h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Close');
  const onDialogClose = () => returnFocus(dialogReturn);
  helpDlg.addEventListener('close', onDialogClose);
  notesDlg.addEventListener('close', onDialogClose);
  helpDlg.append(
    h('h2', null, 'Controls'),
    h('p', null, 'Scale tabs use Left, Right, Home and End. The selected scale is one Tab stop. Drag the plot to take the camera.'),
    h('dl', { class: 'figs' }, KEYS.map(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
    h('h2', null, 'Evidence labels'),
    h('dl', { class: 'figs' }, (Object.keys(EVIDENCE_TEXT) as EvidenceLabel[]).map((k) => [h('dt', null, `[${k}]`), h('dd', null, EVIDENCE_TEXT[k])])),
    h('p', null, 'Plot symbols use screen-sized markers. Distances and defensive envelopes use physical dimensions. Missile dots are a labelled sample. Ship mount placement is schematic.'),
    closeBtn(helpDlg),
  );
  notesDlg.append(
    h('h2', null, `${pack.meta.title}: notes and sources`), renderNotes(pack.notes),
    h('h3', null, 'Sources'),
    h('ul', { class: 'sources' }, pack.meta.sources.map((source) => {
      const url = source.url ? safeNoteUrl(source.url) : null;
      return h('li', null, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, source.title) : source.title, ` [${source.kind}]`);
    })),
    closeBtn(notesDlg),
  );

  const menu = (id: Exclude<ViewerState['menu'], 'none'>, title: string, ...content: HTMLElement[]) =>
    h('section', { class: 'menu panel', id: `menu-${id}`, role: 'dialog', 'aria-label': title, hidden: true },
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, title),
        h('button', { class: 'btn', type: 'button', 'aria-label': `Close ${title}`, onclick: () => set({ menu: 'none' }) }, 'Close')),
      content);
  const layerBoxes = LAYERS.map((id) => {
    const box = h('input', { type: 'checkbox', onchange: () => set({ layers: { ...store.get().layers, [id]: box.checked } }) });
    return { id, box, el: h('label', { class: 'choice' }, box, h('span', null, LAYER_TEXT[id].label, h('small', null, LAYER_TEXT[id].hint))) };
  });
  const layersMenu = menu('layers', 'Layers', h('fieldset', null, h('legend', null, 'Plot layers'), layerBoxes.map((layer) => layer.el)));

  const setPerceived = (patch: Partial<ViewerState['perceived']>) => set({ perceived: { ...store.get().perceived, ...patch } });
  const actual = h('input', { type: 'radio', name: 'picture', onchange: () => setPerceived({ enabled: false }) });
  const perceived = h('input', { type: 'radio', name: 'picture', onchange: () => setPerceived({ enabled: true }) });
  const sideSel = h('select', { 'aria-label': 'Commander', onchange: () => setPerceived({ side: sideSel.value }) }, pack.meta.sides.map((side) => h('option', { value: side.id }, side.name)));
  const reduce = h('input', { type: 'checkbox', onchange: () => set({ reducedMotion: reduce.checked, motionOverride: reduce.checked }) });
  const motionSource = h('p', { class: 'readout' });
  const useDevice = h('button', { class: 'btn', type: 'button', onclick: () => set({ motionOverride: null }) }, 'Use device setting');
  const viewMenu = menu('view', 'View',
    h('fieldset', null, h('legend', null, 'Picture'),
      h('label', { class: 'choice' }, actual, h('span', null, 'Actual', h('small', null, 'Ground truth: where everything really is'))),
      h('label', { class: 'choice' }, perceived, h('span', null, 'Perceived', h('small', null, 'One commander’s picture, delayed by light and FTL sensor lag'))),
      h('label', { class: 'select-label' }, h('span', null, 'Commander'), sideSel)),
    h('fieldset', null, h('legend', null, 'Motion'),
      h('label', { class: 'choice' }, reduce, h('span', null, 'Reduce motion', h('small', null, 'Camera cuts instead of easing. Ship demos can be stepped manually.'))),
      motionSource, useDevice));
  const densityRadios = DENSITIES.map((n) => {
    const radio = h('input', { type: 'radio', name: 'density', onchange: () => set({ density: n }) });
    return { n, radio, el: h('label', { class: 'choice' }, radio, h('span', { class: 'mono' }, `1:${n}`)) };
  });
  const densityMenu = menu('density', 'Missile density',
    h('fieldset', null, h('legend', null, 'Rendered sample'), densityRadios.map((item) => item.el)),
    h('p', null, 'One dot stands for N missiles. Above 250,000 dots the ratio doubles. The plot readout shows the ratio in use; physical counts do not change.'));
  const shotsMenu = menu('shots', 'Director shots',
    h('div', null, d.shots.length ? d.shots.map((shot) =>
      h('button', { class: 'btn shot', type: 'button', onclick: () => set({ t: shot.t0, camera: 'director', menu: 'none', drawer: 'none' }) },
        h('span', null, `${fmtClock(shot.t0)}  ${shot.label}`, h('small', null, shot.desc))))
      : h('p', null, 'This pack has no director shots. Use Free camera.')));

  const director = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', disabled: d.shots.length === 0, onclick: () => set({ camera: 'director', menu: 'none', drawer: 'none', demo: 'none' }) }, 'Director');
  const free = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => set({ camera: 'free' }) }, 'Free');
  const follow = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', title: 'Follow the selected fleet or current engagement (G)', onclick: () => set({ follow: !store.get().follow }) }, 'Follow');
  const replayToggle = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => set({ shipReplay: !store.get().shipReplay }) }, 'Replay controls');
  const theater = h('select', { 'aria-label': 'Theater', onchange: () => set({ theater: theater.value, camera: 'free', drawer: 'none' }) },
    pack.meta.theaters.map((item) => h('option', { value: item.id }, item.label)));
  const battleControls = h('div', { class: 'battle-controls group' },
    pack.meta.theaters.length > 1 ? h('label', { class: 'select-label' }, h('span', null, 'Theater'), theater) : null,
    menuButtons.density, menuButtons.shots);
  const battleSlot = h('fieldset', { class: 'battle-slot' }, h('legend', null, 'Battle'));
  const replaySlot = h('fieldset', null, h('legend', null, 'Battle replay'), replayToggle);
  const scaleDescription = h('p', { class: 'readout' });
  const controlsMenu = menu('controls', 'Controls',
    h('fieldset', null, h('legend', null, 'Camera'),
      h('div', { class: 'group' }, director, free, follow),
      h('div', { class: 'group' },
        h('button', { class: 'btn', type: 'button', onclick: d.onResetView }, 'Reset view'),
        h('button', { class: 'btn', type: 'button', onclick: d.onFullscreen }, 'Fullscreen'))),
    battleSlot, replaySlot,
    h('fieldset', null, h('legend', null, 'Information'),
      h('div', { class: 'group' },
        h('button', { class: 'btn', type: 'button', onclick: () => openDialog(notesDlg) }, 'Notes'),
        h('button', { class: 'btn', type: 'button', onclick: () => openDialog(helpDlg) }, 'Help')),
      scaleDescription));
  const menus = { layers: layersMenu, view: viewMenu, density: densityMenu, shots: shotsMenu, controls: controlsMenu };

  const drawerBtn = (id: Exclude<ViewerState['drawer'], 'none'>, label: string) =>
    h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'context-drawer', 'aria-haspopup': 'dialog',
      onclick: () => set({ drawer: store.get().drawer === id ? 'none' : id, menu: 'none' }) }, label);
  const drawerButtons = { forces: drawerBtn('forces', 'Forces'), log: drawerBtn('log', 'Log'), inspector: drawerBtn('inspector', 'Inspector') };
  const contextButtons = h('div', { class: 'battle-context group' }, drawerButtons.forces, drawerButtons.log, drawerButtons.inspector);
  const tools = h('nav', { class: 'plot-tools panel', 'aria-label': 'Panels' },
    contextButtons, battleControls, h('div', { class: 'view-tools group' }, menuButtons.layers, menuButtons.view));
  const systemContext = h('p', { class: 'system-context readout', hidden: true });

  const classIds = [...new Set(replay.ships.map((ship) => ship.classId))];
  const classSel = h('select', { 'aria-label': 'Ship class', onchange: () => set({ selectedClass: classSel.value || null, demoProgress: 0 }) },
    h('option', { value: '' }, 'Selected ship / default class'),
    classIds.map((id) => h('option', { value: id }, d.tech.classes[id]?.name ?? id)));
  const classTitle = h('h2', { class: 'ship-title' });
  const classIdentity = h('p', { class: 'readout ship-identity' });
  const framingHint = h('p', { class: 'readout framing-hint' });
  const hull = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'true', onclick: () => set({ shipFraming: 'hull' }) }, 'Hull');
  const defenses = h('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => set({ shipFraming: 'defenses', layers: { ...store.get().layers, protection: true } }) }, 'Defensive envelope');
  const demoBtn = (id: ViewerState['demo'], label: string) => h('button', {
    class: 'btn', type: 'button', 'aria-pressed': 'false',
    onclick: () => set({ demo: store.get().demo === id ? 'none' : id, demoProgress: store.get().reducedMotion ? 0.5 : 0 }),
  }, label);
  const demoButtons = { roll: demoBtn('roll', 'Roll demo'), pods: demoBtn('pods', 'Pod demo'), broadside: demoBtn('broadside', 'Broadside demo') };
  const demoPosition = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0', 'aria-label': 'Demo position',
    oninput: () => set({ demoProgress: Number(demoPosition.value) }) });
  const demoStep = h('label', { class: 'select-label demo-step', hidden: true }, h('span', null, 'Demo position'), demoPosition);
  const classFigures = h('dl', { class: 'figs' });
  const shipNote = h('p', { class: 'readout' });
  const shipWorkspace = h('section', { class: 'ship-workspace panel', 'aria-label': 'Ship inspection', hidden: true },
    classTitle, classIdentity,
    h('label', { class: 'select-label' }, h('span', null, 'Class'), classSel),
    h('div', { class: 'group framing', role: 'group', 'aria-label': 'Ship framing' }, hull, defenses),
    h('div', { class: 'group demos', role: 'group', 'aria-label': 'Ship demos' }, Object.values(demoButtons)),
    demoStep, framingHint,
    h('details', { class: 'class-details' }, h('summary', null, 'Class figures and sources'), classFigures, shipNote));
  let lastClass = '';
  const renderClass = (s: ViewerState) => {
    const id = shipClassId(replay, s);
    const cls = id === null ? undefined : d.tech.classes[id];
    const selected = s.selectedShip === null ? null : replay.ships[s.selectedShip];
    const matching = selected?.classId === id ? selected : null;
    setText(classTitle, cls?.name ?? id ?? 'No class data');
    setText(classIdentity, matching ? `${matching.name} [${matching.nameEvidence}]` : cls ? `${cls.hull}, ${cls.navy}. Class reference.` : 'No published class data is available in this pack.');
    if (lastClass === (id ?? '')) return;
    lastClass = id ?? '';
    clear(classFigures);
    if (cls) {
      const figures = [
        ['Length', cls.length], ['Beam', cls.beam], ['Height', cls.height], ['Mass', cls.mass],
        ['Maximum acceleration', cls.accel_max], ['Normal acceleration', cls.accel_normal],
        ...([['broadside', 'Broadside'], ['fore', 'Bow'], ['aft', 'Stern']] as const).flatMap(([aspect, prefix]) =>
          ([
            ['missile', 'tubes'], ['graser', 'grasers'], ['laser', 'lasers'], ['energy_torpedo', 'energy torpedoes'],
            ['cm', 'counter-missile tubes'], ['pd', 'point-defense clusters'], ['pod_lanes', 'pod lanes'],
          ] as const).map(([key, name]) => [`${prefix} ${name}${aspect === 'broadside' ? ', each side' : ''}`, cls[aspect][key]] as const)),
        ['Pod capacity', cls.pod_capacity], ['Pods per cycle', cls.pod_eject_count], ['Pod cycle', cls.pod_eject_cycle],
        ['LAC bays', cls.lac_bays], ['Band length', cls.wedge.band_length], ['Band width', cls.wedge.band_width],
        ['Band offset', cls.wedge.band_offset], ['Sidewall offset', cls.wedge.sidewall_offset],
      ] as const;
      for (const [label, value] of figures) classFigures.append(h('dt', null, label), h('dd', null, evButton(formatLabelled(value), sourceText(pack, value))));
    }
  };

  const play = h('button', { class: 'btn play', type: 'button', 'aria-pressed': 'false', title: 'Play or pause (Space)', onclick: togglePlay }, 'Play');
  const speed = h('select', { 'aria-label': 'Playback speed', onchange: () => set({ speed: speed.value === 'auto' ? 'auto' : Number(speed.value) }) },
    h('option', { value: 'auto' }, 'Auto'), SPEEDS.map((rate) => h('option', { value: String(rate) }, speedText(rate))));
  const previous = h('button', { class: 'btn phase-button', type: 'button', 'aria-label': 'Previous phase', title: 'Previous phase ([)', onclick: () => set({ t: prevPhase(d.marks, store.get().t) }) }, 'Prev');
  const next = h('button', { class: 'btn phase-button', type: 'button', 'aria-label': 'Next phase', title: 'Next phase (])', onclick: () => {
    const t = nextPhase(d.marks, store.get().t);
    if (t !== null) set({ t });
  } }, 'Next');
  const sampling = h('span', { class: 'readout sampling' });
  let scrubbing = false;
  const scrub = h('input', {
    class: 'scrub', type: 'range', min: '0', max: String(replay.duration_s), step: '0.1', value: '0', 'aria-label': 'Battle time',
    oninput: () => set({ t: Number(scrub.value) }), onpointerdown: () => { scrubbing = true; },
    onpointerup: () => { scrubbing = false; }, onpointercancel: () => { scrubbing = false; }, onchange: () => { scrubbing = false; },
  });
  const ticks = h('div', { class: 'ticks', 'aria-hidden': 'true' });
  const renderTicks = (width: number) => {
    clear(ticks);
    const endFrom = 100 * (1 - 150 / Math.max(150, width));
    const shown: DOMRect[] = [];
    for (const mark of tickLabels(d.marks, replay.duration_s, Math.min(1, 140 / Math.max(1, width)))) {
      const el = h('span', { class: mark.left > endFrom ? 'tick end' : 'tick', title: mark.label, style: `left:${mark.left}%` }, width >= 480 && mark.showLabel ? mark.label : '');
      ticks.append(el);
      const box = el.getBoundingClientRect();
      if (!el.textContent || box.width === 0) continue;
      if (shown.some((other) => box.left < other.right + 6 && other.left < box.right + 6)) el.textContent = '';
      else shown.push(box);
    }
  };
  const transport = h('footer', { class: 'transport panel', 'aria-label': 'Replay transport' },
    h('div', { class: 'transport-row' }, previous, play, next,
      h('label', { class: 'speed-label' }, h('span', { class: 'sr-only' }, 'Speed'), speed), sampling),
    h('div', { class: 'timeline' }, ticks, scrub));
  const forces = new ForcesPanel(replay, store);
  const log = new LogPanel(replay, store);
  const inspector = new InspectorPanel(pack, d.tech, replay, store);
  const right = h('div', { class: 'right', id: 'right' }, log.el, inspector.el);
  const contextTitle = h('h2', { class: 'panel-title' });
  const drawer = h('section', { class: 'context-drawer panel', id: 'context-drawer', role: 'dialog', 'aria-label': 'Battle context', hidden: true },
    h('div', { class: 'panel-head' }, contextTitle,
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Close panel', onclick: () => set({ drawer: 'none' }) }, 'Close')),
    forces.el, right);
  const workspace = h('div', { class: 'hud', id: 'scale-workspace', role: 'tabpanel', 'aria-labelledby': 'scale-engagement' },
    topbar, tools, systemContext, shipWorkspace, drawer, transport);
  const root = h('div', { class: 'viewer' }, canvas, labels, notice, workspace, Object.values(menus), helpDlg, notesDlg);
  const placeBattleControls = () => {
    if (compact.matches) battleSlot.append(battleControls);
    else tools.insertBefore(battleControls, tools.lastElementChild);
    d.onLayoutChange();
  };
  placeBattleControls();
  compact.addEventListener('change', placeBattleControls);
  floating.addEventListener('change', d.onLayoutChange);
  const tickObserver = new ResizeObserver((entries) => renderTicks(entries[0].contentRect.width));
  tickObserver.observe(ticks);
  const layoutObserver = new ResizeObserver(d.onLayoutChange);
  for (const element of [topbar, tools, shipWorkspace, transport, drawer, ...Object.values(menus)]) layoutObserver.observe(element);

  let lastMenu: ViewerState['menu'] = 'none';
  let lastDrawer: ViewerState['drawer'] = 'none';
  let drawerReturn: HTMLElement | null = null;
  const syncFocus = (s: ViewerState) => {
    if (s.menu !== lastMenu) {
      const closed = lastMenu;
      lastMenu = s.menu;
      if (s.menu !== 'none') menus[s.menu].querySelector<HTMLElement>('button, input, select')?.focus();
      else if (closed !== 'none' && !helpDlg.open && !notesDlg.open && (document.activeElement === document.body || menus[closed].contains(document.activeElement))) returnFocus(menuButtons[closed]);
    }
    if (s.drawer !== lastDrawer) {
      const wasOpen = lastDrawer !== 'none';
      lastDrawer = s.drawer;
      if (s.drawer !== 'none' && s.scale !== 'ship') {
        if (!wasOpen) drawerReturn = document.activeElement as HTMLElement;
        drawer.querySelector<HTMLElement>('button')?.focus();
      } else if (wasOpen && (document.activeElement === document.body || drawer.contains(document.activeElement))) returnFocus(drawerReturn);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (helpDlg.open || notesDlg.open) return;
    const s = store.get();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (s.menu !== 'none' || s.drawer !== 'none') set({ menu: 'none', drawer: 'none' });
      else set({ selectedShip: null });
      return;
    }
    const target = e.target as HTMLElement;
    if (INTERACTIVE.has(target.tagName) || target.isContentEditable || target.closest('.log-list') || e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.shiftKey ? 60 : 1;
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); set({ t: Math.max(0, s.t - step) }); break;
      case 'ArrowRight': e.preventDefault(); set({ t: Math.min(replay.duration_s, s.t + step) }); break;
      case '[': set({ t: prevPhase(d.marks, s.t) }); break;
      case ']': { const t = nextPhase(d.marks, s.t); if (t !== null) set({ t }); break; }
      case '+': case '=': set({ speed: shiftSpeed(s.speed, 1) }); break;
      case '-': case '_': set({ speed: shiftSpeed(s.speed, -1) }); break;
      case '1': case '2': case '3': selectScale(SCALES[Number(e.key) - 1].id); break;
      case 'd': case 'D': if (d.shots.length) set({ camera: 'director', menu: 'none', drawer: 'none', demo: 'none' }); break;
      case 'f': case 'F': set({ camera: 'free' }); break;
      case 'g': case 'G': if (s.scale !== 'ship' && s.camera === 'free') set({ follow: !s.follow }); break;
      case 'p': case 'P': setPerceived({ enabled: !s.perceived.enabled }); break;
      case '?': openDialog(helpDlg); break;
    }
  };
  const onDown = (e: PointerEvent) => {
    const s = store.get();
    const target = e.target as Node;
    if (s.menu !== 'none' && !menus[s.menu].contains(target) && !menuButtons[s.menu].contains(target)) set({ menu: 'none' });
    if (s.drawer !== 'none' && !drawer.contains(target) && !Object.values(drawerButtons).some((button) => button.contains(target))) set({ drawer: 'none' });
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown);

  const plotInsets = (): PlotInsets => {
    const topHeight = topbar.getBoundingClientRect().height;
    root.style.setProperty('--hud-top', `${topHeight + 16}px`);
    root.style.setProperty('--hud-tools', `${tools.getBoundingClientRect().height + 8}px`);
    root.style.setProperty('--hud-bottom', `${transport.hidden ? 8 : transport.getBoundingClientRect().height + 16}px`);
    const bounds = canvas.getBoundingClientRect();
    const occupied: PlotOccupancy[] = [];
    const add = (element: HTMLElement, edge: keyof PlotInsets) => {
      if (!element.hidden && element.getClientRects().length) occupied.push({ edge, rect: element.getBoundingClientRect() });
    };
    add(topbar, 'top');
    add(tools, floating.matches ? 'top' : 'bottom');
    add(systemContext, floating.matches ? 'top' : 'bottom');
    add(transport, 'bottom');
    add(shipWorkspace, floating.matches ? 'left' : 'bottom');
    add(drawer, compact.matches ? 'bottom' : 'right');
    for (const element of Object.values(menus)) add(element, compact.matches ? 'bottom' : 'right');
    const insets = occupiedPlotInsets(bounds, occupied);
    for (const [edge, value] of Object.entries(insets)) root.style.setProperty(`--plot-${edge}`, `${value}px`);
    return insets;
  };

  return {
    root, canvas, labels, plotInsets,
    render(s, live) {
      const parts = composition(s);
      root.dataset.scale = s.scale;
      setAttr(workspace, 'aria-labelledby', `scale-${s.scale}`);
      setText(clock, fmtClock(live.frame.t));
      setText(cameraState, s.camera === 'director' ? 'Director' : s.follow && !parts.ship ? 'Free + Follow' : 'Free');
      tabs.forEach((button, i) => {
        const active = SCALES[i].id === s.scale;
        setAttr(button, 'aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
      });
      setAttr(director, 'aria-pressed', String(s.camera === 'director'));
      setAttr(free, 'aria-pressed', String(s.camera === 'free'));
      setAttr(follow, 'aria-pressed', String(s.follow));
      follow.disabled = s.camera !== 'free' || parts.ship;
      if (theater.value !== s.theater) theater.value = s.theater;
      for (const [id, button] of Object.entries(menuButtons)) setAttr(button, 'aria-expanded', String(s.menu === id));
      for (const [id, element] of Object.entries(menus)) element.hidden = s.menu !== id;
      contextButtons.hidden = !parts.battle;
      drawerButtons.inspector.hidden = s.selectedShip === null;
      battleControls.hidden = !parts.battle;
      battleSlot.hidden = !parts.battle || !compact.matches;
      menuButtons.density.hidden = !parts.engagement;
      menuButtons.shots.hidden = !parts.battle || d.shots.length === 0;
      replaySlot.hidden = !parts.ship;
      setAttr(replayToggle, 'aria-pressed', String(s.shipReplay));
      systemContext.hidden = !parts.system;
      const picture = s.perceived.enabled ? `Perceived: ${pack.meta.sides.find((side) => side.id === s.perceived.side)?.name ?? s.perceived.side}` : 'Actual positions';
      setText(systemContext, `${pack.meta.location}. ${pack.meta.theaters.find((item) => item.id === s.theater)?.label ?? s.theater}. ${picture}.`);
      for (const layer of layerBoxes) layer.box.checked = s.layers[layer.id];
      actual.checked = !s.perceived.enabled;
      perceived.checked = s.perceived.enabled;
      if (sideSel.value !== s.perceived.side) sideSel.value = s.perceived.side;
      reduce.checked = s.reducedMotion;
      setText(motionSource, s.motionOverride === null ? 'Following the device motion setting.' : 'Using your motion choice for this replay.');
      useDevice.disabled = s.motionOverride === null;
      for (const item of densityRadios) item.radio.checked = item.n === s.density;
      setAttr(play, 'aria-pressed', String(s.playing));
      setText(play, s.playing ? 'Pause' : 'Play');
      const speedValue = s.speed === 'auto' ? 'auto' : String(s.speed);
      if (speed.value !== speedValue) speed.value = speedValue;
      if (!scrubbing) scrub.value = String(live.frame.t);
      setAttr(scrub, 'aria-valuetext', fmtClock(live.frame.t));
      previous.disabled = live.frame.t <= 0;
      next.disabled = nextPhase(d.marks, live.frame.t) === null;
      transport.hidden = !parts.transport;
      shipWorkspace.hidden = !parts.ship;
      if (parts.ship) renderClass(s);
      setAttr(hull, 'aria-pressed', String(s.shipFraming === 'hull'));
      setAttr(defenses, 'aria-pressed', String(s.shipFraming === 'defenses'));
      setText(framingHint, s.shipFraming === 'hull' ? 'Hull-focused inspection. Dimensions to scale; mount placement is schematic.' : 'Defensive envelope framing. Hull, stress bands and sidewalls use physical dimensions.');
      setText(shipNote, live.scaleNote);
      for (const [id, button] of Object.entries(demoButtons)) setAttr(button, 'aria-pressed', String(s.demo === id));
      demoStep.hidden = !parts.ship || !s.reducedMotion || s.demo === 'none';
      demoPosition.value = String(s.demoProgress);
      setAttr(demoPosition, 'aria-valuetext', `${Math.round(s.demoProgress * 100)}% of ${s.demo} demonstration`);
      if (classSel.value !== (s.selectedClass ?? '')) classSel.value = s.selectedClass ?? '';
      setText(sampling, parts.engagement ? live.samplingText ?? '' : '');
      sampling.hidden = !parts.engagement || !live.samplingText;
      setText(scaleDescription, live.scaleNote);
      notice.hidden = !live.notice;
      setText(notice, live.notice ?? '');
      drawer.hidden = !parts.battle || s.drawer === 'none';
      setText(contextTitle, s.drawer === 'forces' ? 'Forces' : s.drawer === 'log' ? 'CIC log' : 'Selected ship');
      for (const [id, button] of Object.entries(drawerButtons)) setAttr(button, 'aria-expanded', String(parts.battle && s.drawer === id));
      forces.render(live.frame, knownSide(s));
      log.render(live.frame.t, s.logSide, knownSide(s));
      inspector.render(s.selectedShip, live.frame.t);
      forces.el.hidden = s.drawer !== 'forces';
      right.hidden = s.drawer !== 'log' && s.drawer !== 'inspector';
      log.el.hidden = s.drawer !== 'log';
      inspector.el.hidden = s.drawer !== 'inspector' || s.selectedShip === null;
      syncFocus(s);
    },
    dispose() {
      tickObserver.disconnect();
      layoutObserver.disconnect();
      compact.removeEventListener('change', placeBattleControls);
      floating.removeEventListener('change', d.onLayoutChange);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      helpDlg.removeEventListener('close', onDialogClose);
      notesDlg.removeEventListener('close', onDialogClose);
      if (helpDlg.open) helpDlg.close();
      if (notesDlg.open) notesDlg.close();
      root.remove();
    },
  };
}

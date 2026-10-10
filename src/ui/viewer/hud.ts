import { EVIDENCE_TEXT, type EvidenceLabel } from '../../core/evidence';
import type { Frame, Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import type { TechRegistry } from '../../core/tech';
import { directorSpeed, type DirectorShot } from '../../render/director';
import type { PlotInsets, PlotRect } from '../../render/framing';
import { LAYER_TEXT, LAYERS, type ScaleId, type SystemFocus } from '../../render/scales/types';
import { clear, h } from '../dom';
import { fmtClock } from '../format';
import { renderNotes, safeNoteUrl } from '../notes';
import { CATALOG_HREF } from '../router';
import type { Store } from '../store';
import { CAPTION as SHIP_CAPTION } from '../../render/ship/site-b';
import { debrief, monthYear, phaseAt, phaseSpans, salvoTicks, scaleBar, shotNumbers, speedChip, tallies, type Debrief } from './hud-model';
import { occupiedPlotInsets, type PlotOccupancy } from './layout';
import { DENSITIES, knownSide, nextPhase, prevPhase, scaleSelection, shipClassId, SPEEDS, type PhaseMark, type Speed, type ViewerState } from './model';
import { ForcesPanel, InspectorPanel, LogPanel, ShipPanel } from './panels';

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

export interface Live { frame: Frame; samplingText: string | null; scaleNote: string; notice: string | null; rate?: number; kmPerPx?: number | null }

export interface Hud {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  labels: HTMLElement;
  render(s: ViewerState, live: Live): void;
  plotInsets(): PlotInsets;
  /** Canvas-relative boxes of HUD pieces floating over the plot, for the label layer to avoid. */
  labelObstacles(): PlotRect[];
  dispose(): void;
}

const SCALES: Array<{ id: ScaleId; label: string }> = [
  { id: 'system', label: 'System' }, { id: 'engagement', label: 'Engagement' }, { id: 'ship', label: 'Ship detail' },
];
const KEYS: Array<[string, string]> = [
  ['Space', 'Play or pause'], ['Left / Right', 'Step 1 s, with Shift 60 s'], ['[ ]', 'Previous or next phase'],
  ['+ / -', 'Faster or slower'], ['1 2 3', 'System, Engagement or Ship detail'], ['D', 'Director camera'],
  ['F', 'Free camera'], ['G', 'Follow the selected fleet or the current engagement'],
  ['P', 'Switch between Actual and Perceived'], ['Esc', 'Close a menu, then clear the selection'],
];
const LAYER_SWATCH: Record<(typeof LAYERS)[number], string> = {
  celestial: '#7ab0ff', truth: '#00ff66', commander: '#ffb300', engagement: '#28ff80', protection: '#00d2ff', comms: '#8a2be2', damage: '#c08060',
};
const ICON = {
  play: 'M4 2.5v11l9.5-5.5z', pause: 'M4 3h3v10H4zM9 3h3v10H9z', back: 'M8 3v3L3 8l5 2v3L1 8zM15 3v10L9 8z',
  full: 'M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4',
};
const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(d: string, stroke = false): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  if (stroke) {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
  }
  svg.append(path);
  return svg;
}
const speedText = (s: number): string => (s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`);
const ACTIVATES = new Set(['BUTTON', 'A', 'SUMMARY']);
/** Shortcuts yield to typing, to a focused control's own Space or Enter, and to the scrubber's arrows. */
function keyBelongsToTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement;
  const input = el instanceof HTMLInputElement ? el : null;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (input && !['range', 'checkbox', 'radio', 'button'].includes(input.type)) return true;
  if ((ACTIVATES.has(el.tagName) || input) && (e.key === ' ' || e.key === 'Enter')) return true;
  return input?.type === 'range' && e.key.startsWith('Arrow');
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
function setAttr(el: Element, k: string, v: string): void {
  if (el.getAttribute(k) !== v) el.setAttribute(k, v);
}
function toggleClass(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}
function shiftSpeed(current: Speed, dir: 1 | -1): number {
  const i = current === 'auto' ? SPEEDS.indexOf(4) : Math.max(0, SPEEDS.findIndex((s) => s >= current));
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))];
}
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Site A's CIC overlay (A report §7) with Site B's scale tabs, context tools and ship panel (B report §5). */
export function buildHud(d: HudDeps): Hud {
  const { pack, replay, store } = d;
  const set = store.set;
  const narrow = window.matchMedia('(max-width: 860px)');
  const togglePlay = () => {
    const s = store.get();
    if (!s.playing && s.t >= replay.duration_s) set({ t: 0, playing: true });
    else set({ playing: !s.playing });
  };
  const selectScale = (id: ScaleId) => set(scaleSelection(id));
  const canvas = h('canvas', { class: 'plot', tabindex: '0', 'aria-label': `${pack.meta.title}: 3D plot. Drag to orbit, scroll to zoom, right-drag to pan.` });
  const labels = h('div', { class: 'labels', 'aria-hidden': 'true' });
  const notice = h('div', { class: 'notice panel', role: 'status', hidden: true });

  // Top bar: identity and scale tabs | clock | tallies.
  const origin = pack.bodies.find((b) => b.id === pack.meta.frame.origin_body)?.name ?? pack.meta.location;
  const date = monthYear(pack);
  const theaterLine = h('div', { class: 'theater' });
  const tabs = SCALES.map((sc, i) => h('button', {
    id: `scale-${sc.id}`, class: 'tab', type: 'button', role: 'tab', 'aria-selected': 'false', title: `${sc.label} (${i + 1})`, onclick: () => selectScale(sc.id),
  }, sc.label));
  const ident = h('div', { class: 'ident' },
    h('p', { class: 'eyebrow' }, h('a', { class: 'cat-link', href: CATALOG_HREF }, 'Catalog'),
      h('span', { class: 'eyebrow-rest' }, ` · CIC tactical plot · ${pack.meta.location}${date ? ` · ${date}` : ''}`)),
    h('h1', null, pack.meta.title), theaterLine,
    h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Scale' }, tabs));
  const clockT = h('div', { class: 'clock-t num' });
  const phaseName = h('span', null);
  const chip = h('span', { class: 'chip' });
  const clock = h('div', { class: 'clock panel', 'aria-label': 'Battle clock' }, clockT, h('div', { class: 'clock-phase' }, phaseName, chip));
  const tally = (k: string) => {
    const v = h('div', { class: 'v' });
    const split = h('div', { class: 'split' });
    return { el: h('div', { class: 'tally' }, h('div', { class: 'k' }, k), v, split), v, split };
  };
  const tSpace = tally('Missiles in space');
  const tStopped = tally('Stopped by defenses');
  const tDetonated = tally('Laserheads detonated');
  const tLost = tally('Ships lost');
  const tallyPanel = h('div', { class: 'tallies panel' }, tSpace.el, tStopped.el, tDetonated.el, tLost.el);
  const top = h('header', { id: 'top', class: 'hud' }, ident, clock, tallyPanel);

  // Panels.
  const forces = new ForcesPanel(pack, replay, store);
  const log = new LogPanel(replay, store);
  const inspector = new InspectorPanel(pack, d.tech, replay, store);
  const side = h('aside', { id: 'side', class: 'hud-panel panel', 'aria-label': 'Inspector and CIC log' }, inspector.el, log.el);
  const shipPanel = new ShipPanel(pack, d.tech, replay);

  // Caption (director shot or free camera) and the one-line readout.
  const numbers = shotNumbers(d.shots, d.marks);
  const shotNo = h('div', { class: 'shot-no' });
  const shotName = h('div', { class: 'shot-name' });
  const shotDesc = h('div', { class: 'shot-desc' });
  const caption = h('div', { id: 'caption' }, shotNo, shotName, shotDesc);
  const readoutText = h('span', null);
  const readoutNote = h('div', { class: 'note' }, SHIP_CAPTION);
  const readout = h('div', { id: 'readout', class: 'num' }, readoutText, readoutNote);
  const scaleBarLine = h('i', null);
  const scaleBarText = h('span', null);
  const scaleBarEl = h('div', { id: 'scalebar', class: 'hud', 'aria-hidden': 'true' }, scaleBarLine, scaleBarText);
  let scaleBarWidth = '';

  // Site B context tools per scale.
  const stars = pack.bodies.filter((b) => b.kind === 'star');
  const primary = stars.find((b) => b.id === pack.meta.frame.origin_body) ?? stars[0];
  const secondary = stars.find((b) => b !== primary);
  const hasTerminus = pack.bodies.some((b) => b.kind === 'terminus');
  const presets: Array<{ id: SystemFocus; label: string }> = [
    { id: 'primary', label: primary?.name ?? 'Primary' },
    ...(secondary ? [{ id: 'secondary' as const, label: secondary.name }] : []),
    ...(secondary || hasTerminus ? [{ id: 'binary' as const, label: hasTerminus ? 'Binary & junction' : 'Binary' }] : []),
    { id: 'outer', label: 'Outer orbits' },
  ];
  const presetButtons = presets.map((p) => ({ ...p, el: h('button', { class: 'ctx', type: 'button', onclick: () => set({ systemFocus: p.id, camera: 'free', follow: false }) }, p.label) }));
  const followBtn = h('button', { class: 'ctx', type: 'button', title: 'Follow the selected fleet or the current engagement (G)', onclick: () => set({ follow: !store.get().follow, camera: 'free' }) }, 'Follow');
  const resetBtn = h('button', { class: 'ctx', type: 'button', onclick: () => d.onResetView() }, 'Reset view');
  const classIds = [...new Set([...replay.ships.map((ship) => ship.classId)])].filter((id) => d.tech.classes[id]);
  const classSel = h('select', { class: 'ctx-select', 'aria-label': 'Ship class', onchange: () => set({ selectedClass: classSel.value || null, fireStartedAt: null }) },
    h('option', { value: '' }, 'Flagship class'),
    classIds.map((id) => h('option', { value: id }, d.tech.classes[id]?.name ?? id)));
  const rollBtn = h('button', { class: 'ctx', type: 'button', onclick: () => set({ shipRoll: !store.get().shipRoll }) }, 'Belly-up roll');
  const podsBtn = h('button', { class: 'ctx', type: 'button', onclick: () => set({ shipPods: !store.get().shipPods }) }, 'Pods');
  const sailsBtn = h('button', { class: 'ctx', type: 'button', onclick: () => set({ shipSails: !store.get().shipSails, fireStartedAt: null }) }, 'Transit sails');
  const fireBtn = h('button', { class: 'ctx', type: 'button', onclick: () => set({ fireStartedAt: performance.now(), shipSails: false }) }, 'Fire / defense demo');
  const contextSystem = h('div', { class: 'ctx-row' }, presetButtons.map((p) => p.el));
  const contextBattle = h('div', { class: 'ctx-row' }, followBtn, resetBtn);
  const contextShip = h('div', { class: 'ctx-row' }, classSel, rollBtn, podsBtn, sailsBtn, fireBtn);
  const context = h('div', { id: 'context' }, contextSystem, contextBattle, contextShip);
  // Bottom left, stacked so a longer caption or a second row of tools pushes the rest up instead of overlapping.
  const dock = h('div', { id: 'dock', class: 'hud' }, readout, context, caption);

  // Transport (A report §7.7).
  const play = h('button', { class: 'tb icon', id: 'btnPlay', type: 'button', 'aria-label': 'Play', title: 'Play or pause (Space)', onclick: togglePlay }, icon(ICON.play));
  const back = h('button', { class: 'tb icon wide-only', type: 'button', 'aria-label': 'Back 30 seconds of battle time', onclick: () => set({ t: Math.max(0, store.get().t - 30) }) }, icon(ICON.back));
  const prev = h('button', { class: 'tb icon phone-hide', type: 'button', 'aria-label': 'Previous phase', title: 'Previous phase ([)', onclick: () => set({ t: prevPhase(d.marks, store.get().t) }) }, '‹');
  const next = h('button', { class: 'tb icon phone-hide', type: 'button', 'aria-label': 'Next phase', title: 'Next phase (])', onclick: () => { const t = nextPhase(d.marks, store.get().t); if (t !== null) set({ t }); } }, '›');
  const tclock = h('span', { class: 'tclock' });
  const phasesBar = h('div', { class: 'phases' }, phaseSpans(d.marks, replay.duration_s).map((span) =>
    h('div', { style: `width:${span.width}%`, title: span.label }, h('span', null, span.label))));
  const fill = h('div', { class: 'fill' });
  const ticks = h('div', { class: 'ticks' }, salvoTicks(replay).map((tk) => h('i', { class: tk.cls, style: `left:${tk.left}%` })));
  const head = h('div', { class: 'head' });
  let scrubbing = false;
  const scrubIn = h('input', {
    type: 'range', min: '0', max: String(replay.duration_s), step: '0.1', value: '0', 'aria-label': 'Battle time',
    oninput: () => set({ t: Number(scrubIn.value) }), onpointerdown: () => { scrubbing = true; },
    onpointerup: () => { scrubbing = false; }, onpointercancel: () => { scrubbing = false; }, onchange: () => { scrubbing = false; },
  });
  const scrub = h('div', { class: 'scrub' }, phasesBar, fill, ticks, head, scrubIn);
  const speed = h('select', { class: 'tb', 'aria-label': 'Replay speed', onchange: () => set({ speed: speed.value === 'auto' ? 'auto' : Number(speed.value) }) },
    h('option', { value: 'auto' }, 'Auto'), SPEEDS.map((rate) => h('option', { value: String(rate) }, speedText(rate))));
  const menuBtn = (id: Exclude<ViewerState['menu'], 'none'>, label: string, extra = '') => h('button', {
    class: `tb ${extra}`, type: 'button', 'aria-expanded': 'false', 'aria-controls': `menu-${id}`,
    onclick: () => set({ menu: store.get().menu === id ? 'none' : id }),
  }, label);
  const director = h('button', { class: 'tb', type: 'button', disabled: d.shots.length === 0, title: 'Director camera (D) or free camera (F)',
    onclick: () => set({ camera: store.get().camera === 'director' ? 'free' : 'director', menu: 'none' }) }, 'Director');
  const menuButtons = { shots: menuBtn('shots', 'Shots'), layers: menuBtn('layers', 'Layers'), key: menuBtn('key', 'Key') };
  const fullscreen = h('button', { class: 'tb icon phone-hide', type: 'button', 'aria-label': 'Fullscreen', title: 'Fullscreen', onclick: () => d.onFullscreen() }, icon(ICON.full, true));
  const transport = h('footer', { id: 'transport', class: 'hud' },
    play, back, prev, next, tclock, scrub, speed, director, menuButtons.shots, menuButtons.layers, menuButtons.key, fullscreen);

  // Narrow screens: Forces, Log and the ship's class data open as sheets.
  const sheetBtn = (id: Exclude<ViewerState['drawer'], 'none'>, label: string) => h('button', {
    class: 'tb', type: 'button', 'aria-expanded': 'false', onclick: () => set({ drawer: store.get().drawer === id ? 'none' : id, menu: 'none' }),
  }, label);
  const sheetButtons = { forces: sheetBtn('forces', 'Forces'), log: sheetBtn('log', 'Log'), ship: sheetBtn('ship', 'Class data') };
  const hudToggles = h('div', { id: 'hudToggles', class: 'hud' }, sheetButtons.forces, sheetButtons.log, sheetButtons.ship);

  // Menus (A report §7.8).
  const menu = (id: Exclude<ViewerState['menu'], 'none'>, title: string, ...content: Array<HTMLElement | HTMLElement[] | null>) =>
    h('section', { class: 'menu panel hud-panel', id: `menu-${id}`, 'aria-label': title, hidden: true },
      h('h2', null, h('span', null, title), h('button', { class: 'x', type: 'button', 'aria-label': `Close ${title}`, onclick: () => set({ menu: 'none' }) }, '×')),
      ...content);
  const shotItems = [...d.shots].sort((a, b) => a.t0 - b.t0).map((shot) => {
    const rate = directorSpeed(d.shots, shot.t0 + 0.5);
    const el = h('button', { class: 'mi', type: 'button', onclick: () => set({ t: shot.t0, camera: 'director', menu: 'none', playing: true }) },
      h('span', { class: 'no' }, numbers.get(shot.id)?.no ?? ''),
      h('span', null, h('span', { class: 'nm' }, shot.label), h('span', { class: 'ds' }, `${fmtClock(shot.t0)} · ${rate !== null && rate < 1 ? 'slow motion' : rate !== null ? `×${rate}` : 'auto'}`)));
    return { shot, el };
  });
  const sequences = new Map<string, HTMLElement[]>();
  for (const item of shotItems) {
    const seq = numbers.get(item.shot.id)?.sequence ?? '';
    sequences.set(seq, [...(sequences.get(seq) ?? []), item.el]);
  }
  const shotsMenu = menu('shots', 'Shot list',
    h('p', { class: 'help' }, d.shots.length ? 'The director camera follows the scenario camera script. Pick a shot to jump to it.' : 'This pack has no director shots. Use the free camera.'),
    [...sequences].flatMap(([seq, items], i) => [h('h3', null, `Sequence ${i + 1} · ${seq}`), ...items]));
  const layerToggles = LAYERS.map((id) => {
    const box = h('input', { type: 'checkbox', onchange: () => set({ layers: { ...store.get().layers, [id]: box.checked } }) });
    return { id, box, el: h('label', { class: 'tog' }, h('span', null, h('i', { class: 'sw', style: `background:${LAYER_SWATCH[id]}` }), LAYER_TEXT[id].label, h('small', null, LAYER_TEXT[id].hint)), box) };
  });
  const densityButtons = DENSITIES.map((n) => ({ n, el: h('button', { type: 'button', onclick: () => set({ density: n }) }, `1 : ${n}`) }));
  const setPerceived = (patch: Partial<ViewerState['perceived']>) => set({ perceived: { ...store.get().perceived, ...patch } });
  const actualBtn = h('button', { type: 'button', onclick: () => setPerceived({ enabled: false }) }, 'Actual');
  const perceivedBtn = h('button', { type: 'button', onclick: () => setPerceived({ enabled: true }) }, 'Perceived');
  const sideSel = h('select', { class: 'tb', 'aria-label': 'Commander', onchange: () => setPerceived({ side: sideSel.value }) },
    pack.meta.sides.map((sd) => h('option', { value: sd.id }, sd.name)));
  const theater = h('select', { class: 'tb', 'aria-label': 'Theater', onchange: () => set({ theater: theater.value, camera: 'free' }) },
    pack.meta.theaters.map((item) => h('option', { value: item.id }, item.label)));
  const reduce = h('input', { type: 'checkbox', onchange: () => set({ reducedMotion: reduce.checked, motionOverride: reduce.checked }) });
  const layersMenu = menu('layers', 'Layers',
    layerToggles.map((t) => t.el),
    h('h3', null, 'Missile density'), h('div', { class: 'seg' }, densityButtons.map((b) => b.el)),
    h('p', { class: 'help' }, 'One streak stands for N missiles. Physical counts never change.'),
    h('h3', null, 'Picture'), h('div', { class: 'seg' }, actualBtn, perceivedBtn),
    h('label', { class: 'tog' }, h('span', null, 'Commander'), sideSel),
    pack.meta.theaters.length > 1 ? h('label', { class: 'tog' }, h('span', null, 'Theater'), theater) : null,
    h('h3', null, 'Comfort'), h('label', { class: 'tog' }, h('span', null, 'Reduce motion', h('small', null, 'Camera cuts instead of easing')), reduce));
  const notesDlg = h('dialog', { class: 'dialog panel', 'aria-label': 'Notes and sources' });
  notesDlg.append(
    h('h2', null, `${pack.meta.title}: notes and sources`), renderNotes(pack.notes),
    h('h3', null, 'Sources'),
    h('ul', { class: 'sources' }, pack.meta.sources.map((source) => {
      const url = source.url ? safeNoteUrl(source.url) : null;
      return h('li', null, url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, source.title) : source.title, ` [${source.kind}]`);
    })),
    h('button', { class: 'tb', type: 'button', onclick: () => notesDlg.close() }, 'Close'));
  const legend = (svg: string, title: string, text: string) => {
    const wrap = h('span', { class: 'glyph', 'aria-hidden': 'true' });
    wrap.innerHTML = svg;
    return h('div', { class: 'legend-row' }, wrap, h('div', null, h('b', null, title), ' ', h('span', null, text)));
  };
  const svg = (body: string) => `<svg viewBox="0 0 18 18">${body}</svg>`;
  const keyMenu = menu('key', 'Key',
    h('h3', null, 'Ships and fleets'),
    legend(svg('<path d="M9 2 16 9 9 16 2 9z" fill="none" stroke="#00ff66" stroke-width="1.6"/>'), 'Allied ship', 'side colour; glyph shape by type'),
    legend(svg('<path d="M9 2 16 9 9 16 2 9z" fill="none" stroke="#ff4d6a" stroke-width="1.6"/>'), 'Hostile ship', 'side colour; glyph shape by type'),
    legend(svg('<g fill="#00ff66"><circle cx="4" cy="6" r="1.3"/><circle cx="9" cy="4" r="1.3"/><circle cx="14" cy="7" r="1.3"/><circle cx="6" cy="11" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="8" cy="15" r="1.3"/></g>'), 'LAC group', 'a swarm of dots in side colour'),
    legend(svg('<ellipse cx="8" cy="10" rx="6.5" ry="3.5" fill="none" stroke="#ff4d6a" stroke-width="1.2"/><path d="M8 10 16 4M16 4l-3.4.4M16 4l-1.4 3" stroke="#00c2ee" stroke-width="1.3" fill="none"/>'), 'Fleet ring and course', 'ring around the formation; cyan arrow shows its velocity'),
    legend(svg('<circle cx="9" cy="9" r="6.5" fill="none" stroke="#8199b0" stroke-dasharray="2 2"/><path d="M9 6 12 9 9 12 6 9z" fill="#ff4d6a"/>'), 'Contact', 'perceived picture: ring = position uncertainty, label = age of the data'),
    legend(svg('<path d="M2 6h14M2 12h14" stroke="#00d2ff" stroke-width="1.6"/>'), 'Impeller wedge', 'stress bands above and below the hull'),
    h('h3', null, 'Weapons and effects'),
    legend(svg('<path d="M2 13 13 4" stroke="#7dffb0" stroke-width="1.6"/><path d="M5 16 16 7" stroke="#ff9db0" stroke-width="1.6"/><circle cx="13" cy="4" r="1.6" fill="#fff"/><circle cx="16" cy="7" r="1.6" fill="#fff"/>'), 'Missiles', 'streaks from the firing ships in their side\'s colour; bright head = drive burning, faint = coasting'),
    legend(svg('<path d="M2 3 9 9M16 3 9 9M2 15 9 9M16 15 9 9" stroke="#c3ffe1" stroke-width="1.2"/><circle cx="9" cy="9" r="2.2" fill="#ffe7ad"/>'), 'Laserhead', 'rods converge on the target from stand-off range'),
    legend(svg('<path d="M1 9h16" stroke="#cbfff4" stroke-width="2"/>'), 'Graser or laser', 'beam at energy range'),
    legend(svg('<circle cx="5" cy="9" r="2.6" fill="#dcf8ff"/><circle cx="13" cy="9" r="2.6" fill="#ffdfad"/>'), 'Defensive kill', 'pale cyan: counter-missile; amber: point defense'),
    legend(svg('<circle cx="9" cy="9" r="3" fill="#ffad60"/><circle cx="9" cy="9" r="6.5" fill="none" stroke="#ffad60" stroke-opacity=".5"/>'), 'Hit and ship loss', 'hull hits spark orange; a destroyed ship leaves a fading glow and shock ring'),
    legend(svg('<path d="M2 15 15 3" stroke="#cb82ff" stroke-width="1.4" stroke-dasharray="2 2"/>'), 'Apollo telemetry', 'FTL control links to the missiles'),
    h('h3', null, 'Space'),
    legend(svg('<circle cx="9" cy="9" r="3" fill="none" stroke="#3aa6d8"/><circle cx="9" cy="9" r="6" fill="none" stroke="#3aa6d8"/><circle cx="9" cy="9" r="8.5" fill="none" stroke="#3aa6d8" stroke-width="1.6"/>'), 'Range rings', 'centred on my fleet: every 5 million km, heavier every 10, with 24 bearings'),
    legend(svg('<path d="M1 13 C5 7 13 7 17 13" fill="none" stroke="#c9a46a" stroke-width="1.6"/>'), 'Hyper limit', 'gold arc in Engagement, cyan globe in System; no hyper translation inside'),
    legend(svg('<path d="M2 4 16 9 2 14z" fill="#a77bff" fill-opacity=".35" stroke="#a77bff" stroke-opacity=".6"/>'), 'Resonance zone', 'cone toward the Junction where hyper translation is fatal [S]'),
    legend(svg('<circle cx="9" cy="9" r="6" fill="none" stroke="#b3daff" stroke-width="1.6"/>'), 'Hyper footprint', 'flash where a force translates in or out'),
    h('h3', null, 'Keyboard'),
    h('dl', { class: 'keys' }, KEYS.map(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])),
    h('h3', null, 'Evidence'),
    h('dl', { class: 'keys' }, (Object.keys(EVIDENCE_TEXT) as EvidenceLabel[]).map((k) => [h('dt', null, `[${k}]`), h('dd', null, EVIDENCE_TEXT[k])])),
    h('p', { class: 'help' }, 'Drag to orbit, scroll to zoom, right-drag to pan. Click a ship to inspect it, double-click to follow it. Symbols are screen-sized; distances are physical.'),
    h('button', { class: 'tb', type: 'button', onclick: () => { set({ menu: 'none' }); notesDlg.showModal(); } }, 'Notes and sources'));
  const menus = { shots: shotsMenu, layers: layersMenu, key: keyMenu };

  // Site A's after-action summary (JS:7597-7634), opened when playback reaches the end.
  const debriefEl = h('section', { id: 'debrief', class: 'hud panel', 'aria-label': 'After-action summary' });
  debriefEl.hidden = true;
  let debriefData: Debrief | null = null;
  const openDebrief = () => {
    const db = (debriefData ??= debrief(pack, replay));

    debriefEl.replaceChildren(
      h('h2', null, `Engagement terminated · ${fmtClock(replay.duration_s)}`),
      h('div', { class: 'dt' }, `${pack.meta.title}: after-action summary`),
      h('table', null,
        h('thead', null, h('tr', null, ...['Force', 'Strength', 'Destroyed', 'Crippled', 'Surrendered', 'Escaped'].map((x) => h('th', null, x)))),
        h('tbody', null, ...db.rows.map((r) => h('tr', { class: r.ally ? 'a' : 'h' },
          h('td', null, r.name, r.commander ? h('span', { class: 'cmd' }, r.commander) : null),
          h('td', null, `${fmt(r.strength)}${r.kind === 'lac' ? ' LACs' : ''}`), h('td', null, fmt(r.destroyed)),
          h('td', null, r.kind === 'lac' ? '' : fmt(r.crippled)), h('td', null, fmt(r.captured)),
          h('td', null, r.kind === 'lac' ? '' : fmt(r.escaped)))))),
      h('p', { class: 'help' },
        `Missiles launched: ${db.launched.map((x) => `${x.name} ${fmt(x.n)}`).join(', ')}. `,
        `Peak in space: ${fmt(db.peak.n)} at ${fmtClock(db.peak.t)}. Laserheads detonated: ${fmt(db.detonated)}.`),
      h('div', { class: 'btns' },
        h('button', { class: 'tb', type: 'button', onclick: () => { debriefEl.hidden = true; set({ camera: 'free' }); } }, 'Free look'),
        h('button', { class: 'tb on', type: 'button', onclick: () => { debriefEl.hidden = true; set({ t: 0, playing: true, menu: 'none', ...(d.shots.length ? { camera: 'director' as const } : {}) }); } }, 'Replay')));
    debriefEl.hidden = false;
  };

  const root = h('div', { class: 'viewer' }, canvas, labels, notice, top, forces.el, side, shipPanel.el, dock, scaleBarEl, hudToggles, transport,
    Object.values(menus), debriefEl, notesDlg);

  const layoutObserver = new ResizeObserver(d.onLayoutChange);
  for (const element of [top, transport, forces.el, side, shipPanel.el]) layoutObserver.observe(element);
  narrow.addEventListener('change', d.onLayoutChange);

  const onKey = (e: KeyboardEvent) => {
    if (notesDlg.open) return;
    const s = store.get();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!debriefEl.hidden) debriefEl.hidden = true;
      else if (s.menu !== 'none' || s.drawer !== 'none') set({ menu: 'none', drawer: 'none' });
      else set({ selectedShip: null });
      return;
    }
    if (keyBelongsToTarget(e) || e.metaKey || e.ctrlKey || e.altKey) return;
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
      case 'd': case 'D': if (d.shots.length) set({ camera: 'director', menu: 'none' }); break;
      case 'f': case 'F': set({ camera: 'free' }); break;
      case 'g': case 'G': if (s.scale !== 'ship') set({ follow: !s.follow, camera: 'free' }); break;
      case 'p': case 'P': setPerceived({ enabled: !s.perceived.enabled }); break;
      case '?': set({ menu: 'key' }); break;
    }
  };
  const onDown = (e: PointerEvent) => {
    const s = store.get();
    const target = e.target as Node;
    if (s.menu !== 'none' && !menus[s.menu].contains(target) && !menuButtons[s.menu].contains(target)) set({ menu: 'none' });
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown);

  const plotInsets = (): PlotInsets => {
    const bounds = canvas.getBoundingClientRect();
    const occupied: PlotOccupancy[] = [];
    const add = (element: HTMLElement, edge: keyof PlotInsets) => {
      if (!element.hidden && element.getClientRects().length && getComputedStyle(element).display !== 'none') occupied.push({ edge, rect: element.getBoundingClientRect() });
    };
    add(top, 'top');
    add(transport, 'bottom');
    if (!narrow.matches) {
      add(forces.el, 'left');
      add(side, 'right');
      add(shipPanel.el, 'right');
    }
    const insets = occupiedPlotInsets(bounds, occupied);
    for (const [edge, value] of Object.entries(insets)) root.style.setProperty(`--plot-${edge}`, `${value}px`);
    return insets;
  };

  const labelObstacles = (): PlotRect[] => {
    const bounds = canvas.getBoundingClientRect();
    const floating = [readout, context, caption, scaleBarEl, hudToggles, forces.el, side, shipPanel.el, debriefEl, ...Object.values(menus)];
    return floating.flatMap((el) => {
      if (el.hidden || !el.getClientRects().length || getComputedStyle(el).display === 'none') return [];
      const r = el.getBoundingClientRect();
      return r.width && r.height ? [{ x: r.left - bounds.left, y: r.top - bounds.top, width: r.width, height: r.height }] : [];
    });
  };

  let lastTallyT = -1;
  let lastPlaying: boolean | null = null;
  return {
    root, canvas, labels, plotInsets, labelObstacles,
    render(s, live) {
      const t = live.frame.t;
      root.dataset.scale = s.scale;
      root.dataset.camera = s.camera;
      root.dataset.drawer = s.drawer;
      const ship = s.scale === 'ship';
      // Top bar.
      setText(clockT, fmtClock(t));
      const phase = phaseAt(d.marks, t);
      setText(phaseName, phase?.label ?? '');
      setText(chip, speedChip(s.playing, s.speed, live.rate ?? (s.speed === 'auto' ? 1 : s.speed)));
      const theaterLabel = pack.meta.theaters.find((item) => item.id === s.theater)?.label ?? s.theater;
      setText(theaterLine, `${origin} · ${theaterLabel}${s.perceived.enabled ? ` · perceived by ${pack.meta.sides.find((sd) => sd.id === s.perceived.side)?.name ?? s.perceived.side}` : ''}`);
      tabs.forEach((button, i) => {
        const active = SCALES[i].id === s.scale;
        setAttr(button, 'aria-selected', String(active));
        toggleClass(button, 'active', active);
      });
      if (Math.abs(t - lastTallyT) > 1e-3) {
        lastTallyT = t;
        const tl = tallies(replay, live.frame);
        setText(tSpace.v, fmt(tl.inSpace));
        clear(tSpace.split);
        tSpace.split.append(...tl.inSpaceBySide.map((x) => h('span', { class: x.ally ? 'a' : 'h' }, `${replay.sides.find((sd) => sd.id === x.id)?.name.split(' ').pop() ?? x.id} ${fmt(x.n)}`)));
        setText(tStopped.v, fmt(tl.stopped));
        setText(tStopped.split, `${fmt(tl.launched)} launched`);
        setText(tDetonated.v, fmt(tl.detonated));
        setText(tDetonated.split, 'reached attack range');
        clear(tLost.v);
        tLost.v.append(h('span', { class: 'a' }, fmt(tl.lost.ally)), h('span', { class: 'sep' }, ' / '), h('span', { class: 'h' }, fmt(tl.lost.hostile)));
        setText(tLost.split, `${replay.sides[0]?.name ?? 'Allied'} / ${replay.sides[1]?.name ?? 'Hostile'}`);
      }
      // Panels.
      const only = knownSide(s);
      forces.render(live.frame, only);
      log.render(t, s.logSide, only);
      inspector.render(s.selectedShip, t);
      forces.el.hidden = ship;
      side.hidden = ship;
      shipPanel.el.hidden = !ship;
      if (ship) shipPanel.render(shipClassId(replay, s), s.selectedShip);
      // Caption and readout.
      const shot = s.camera === 'director' && !ship ? [...d.shots].reverse().find((x) => x.t0 <= t + 1e-6) ?? null : null;
      caption.hidden = ship;
      toggleClass(caption, 'free', !shot);
      if (shot) {
        const n = numbers.get(shot.id);
        setText(shotNo, `Shot ${n?.no ?? ''} · ${n?.sequence ?? ''}`);
        setText(shotName, shot.label);
        setText(shotDesc, shot.desc);
      } else {
        setText(shotNo, s.follow && s.scale !== 'ship' ? 'Free camera · following' : 'Free camera');
        setText(shotName, s.scale === 'system' ? 'System overview' : 'Engagement');
        setText(shotDesc, 'Drag to orbit, scroll to zoom, right-drag to pan. Click a ship to inspect it, double-click to follow it. Press Director to return to the shot list.');
      }
      const readoutLine = ship ? live.scaleNote : s.scale === 'engagement' ? live.samplingText ?? '' : '';
      setText(readoutText, readoutLine);
      readoutNote.hidden = !ship;
      readout.hidden = !readoutLine && !ship;
      const bar = live.kmPerPx ? scaleBar(live.kmPerPx) : null;
      scaleBarEl.hidden = !bar;
      if (bar) {
        const w = `${bar.widthPx}px`;
        if (w !== scaleBarWidth) scaleBarLine.style.width = scaleBarWidth = w;
        setText(scaleBarText, bar.label);
      }
      // Context tools.
      contextSystem.hidden = s.scale !== 'system';
      contextBattle.hidden = s.scale !== 'engagement';
      contextShip.hidden = !ship;
      for (const p of presetButtons) toggleClass(p.el, 'active', s.systemFocus === p.id && s.camera === 'free');
      toggleClass(followBtn, 'active', s.follow && s.camera === 'free');
      if (classSel.value !== (s.selectedClass ?? '')) classSel.value = s.selectedClass ?? '';
      toggleClass(rollBtn, 'active', s.shipRoll);
      toggleClass(podsBtn, 'active', s.shipPods);
      toggleClass(sailsBtn, 'active', s.shipSails);
      toggleClass(fireBtn, 'active', s.fireStartedAt !== null);
      // Debrief: open when playback runs out, close once the replay leaves the end.
      if (lastPlaying && !s.playing && t >= replay.duration_s - 1e-6) openDebrief();
      else if (!debriefEl.hidden && t < replay.duration_s - 0.01) debriefEl.hidden = true;
      // Transport.
      if (lastPlaying !== s.playing) {
        lastPlaying = s.playing;
        play.replaceChildren(icon(s.playing ? ICON.pause : ICON.play));
        setAttr(play, 'aria-label', s.playing ? 'Pause' : 'Play');
      }
      setText(tclock, fmtClock(t));
      const pct = Math.max(0, Math.min(100, (t / replay.duration_s) * 100));
      fill.style.width = `${pct}%`;
      head.style.left = `${pct}%`;
      if (!scrubbing) scrubIn.value = String(t);
      setAttr(scrubIn, 'aria-valuetext', fmtClock(t));
      prev.disabled = t <= 0;
      next.disabled = nextPhase(d.marks, t) === null;
      const speedValue = s.speed === 'auto' ? 'auto' : String(s.speed);
      if (speed.value !== speedValue) speed.value = speedValue;
      toggleClass(director, 'on', s.camera === 'director');
      for (const [id, button] of Object.entries(menuButtons)) {
        setAttr(button, 'aria-expanded', String(s.menu === id));
        toggleClass(button, 'on', s.menu === id);
      }
      for (const [id, element] of Object.entries(menus)) element.hidden = s.menu !== id;
      for (const [id, button] of Object.entries(sheetButtons)) {
        toggleClass(button, 'on', s.drawer === id);
        setAttr(button, 'aria-expanded', String(s.drawer === id));
        button.hidden = (id === 'ship') !== ship;
      }
      // Layers menu state.
      for (const layer of layerToggles) layer.box.checked = s.layers[layer.id];
      for (const b of densityButtons) toggleClass(b.el, 'on', b.n === s.density);
      toggleClass(actualBtn, 'on', !s.perceived.enabled);
      toggleClass(perceivedBtn, 'on', s.perceived.enabled);
      if (sideSel.value !== s.perceived.side) sideSel.value = s.perceived.side;
      if (theater.value !== s.theater) theater.value = s.theater;
      reduce.checked = s.reducedMotion;
      notice.hidden = !live.notice;
      setText(notice, live.notice ?? '');
    },
    dispose() {
      layoutObserver.disconnect();
      narrow.removeEventListener('change', d.onLayoutChange);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      if (notesDlg.open) notesDlg.close();
      root.remove();
    },
  };
}

import { SolveFailure, solveInWorker } from '../../app/solve-client';
import { createFrame, sampleFrame, type Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import { TECH } from '../../core/tech';
import { formatIssues } from '../../core/validate';
import { getPack } from '../../registry';
import { observerUnit } from '../../core/perceived';
import { CameraRig, directorPose, perceivedSubject, shotAt, shotsFor } from '../../render/director';
import { Engine, webglAvailable } from '../../render/engine';
import { LabelLayer } from '../../render/labels';
import { EngagementView } from '../../render/scales/engagement-view';
import { ShipView } from '../../render/scales/ship-view';
import { SystemView } from '../../render/scales/system-view';
import type { ScaleId, ScaleView, ViewContext } from '../../render/scales/types';
import { clear, h } from '../dom';
import { CATALOG_HREF } from '../router';
import { createStore, type Store } from '../store';
import { buildHud, type Live } from './hud';
import { advance, eventIndex, initialState, perceivedSelection, phaseMarks, type ViewerState } from './model';

declare global {
  interface Window { __honorCic?: { store: Store<ViewerState>; duration: number; view(): ScaleView | undefined } }
}

const WEBGL_TEXT = 'This viewer needs WebGL. Turn on hardware acceleration or try another browser.';
const SCRUB_CUT_S = 30;
const DEMO_PERIOD_S = 4;

function renderError(root: HTMLElement, lines: string[]): void {
  clear(root);
  root.append(
    h('main', { class: 'panel state', role: 'alert' },
      h('h1', null, 'This replay could not be computed'),
      h('pre', { class: 'errors' }, lines.slice(0, 20).join('\n')),
      h('p', null, h('a', { class: 'btn', href: CATALOG_HREF }, 'Back to catalog'))),
  );
}

export function mountViewer(root: HTMLElement, id: string): () => void {
  let disposed = false;
  let cleanup: () => void = () => {};
  clear(root);
  const pack = getPack(id);
  if (!pack) {
    renderError(root, [`No valid scenario pack has the id "${id}".`]);
    return () => {};
  }
  const bar = h('progress', { max: '1', value: '0', 'aria-label': 'Replay progress' });
  const phaseText = h('span', null, 'starting');
  root.append(h('main', { class: 'panel state', role: 'status' }, h('h1', null, pack.meta.title), h('p', null, 'Computing replay: ', phaseText), bar));
  solveInWorker(id, (phase, fraction) => {
    phaseText.textContent = phase;
    bar.value = fraction;
  })
    .then(({ replay }) => {
      if (!disposed) cleanup = startViewer(root, pack, replay);
    })
    .catch((err: unknown) => {
      if (disposed) return;
      const lines = err instanceof SolveFailure ? (err.issues.length ? formatIssues(err.issues).split('\n') : [err.message]) : [String(err)];
      renderError(root, lines);
    });
  return () => {
    disposed = true;
    cleanup();
  };
}

function startViewer(root: HTMLElement, pack: ScenarioPack, replay: Replay): () => void {
  clear(root);
  document.title = `${pack.meta.title}: honor-cic`;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const store = createStore<ViewerState>(initialState(pack, reduced));
  window.__honorCic = { store, duration: replay.duration_s, view: () => views.get(store.get().scale) };
  const shots = shotsFor(pack, replay);
  const marks = phaseMarks(pack, replay);
  const ix = eventIndex(replay);
  const frame = createFrame(replay);
  const rig = new CameraRig();
  const gl = webglAvailable();
  const views = new Map<ScaleId, ScaleView>();

  const hud = buildHud({
    pack, tech: TECH, replay, store, marks, shots,
    onResetView: () => resetView(),
    onFullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void hud.root.requestFullscreen?.();
    },
  });
  root.append(hud.root);

  const makeView = (id: ScaleId): ScaleView => {
    const v = id === 'system' ? new SystemView(pack, replay, hud.canvas) : id === 'engagement' ? new EngagementView(pack, replay, hud.canvas) : new ShipView(pack, replay, hud.canvas);
    v.controls?.addEventListener('start', () => {
      if (store.get().camera === 'director') store.set({ camera: 'free' });
    });
    return v;
  };
  const resetView = () => {
    if (!gl) return;
    const id = store.get().scale;
    views.get(id)?.dispose();
    views.set(id, makeView(id));
  };

  let engine: Engine | null = null;
  let labelLayer: LabelLayer | null = null;
  if (gl) {
    engine = new Engine(hud.canvas);
    labelLayer = new LabelLayer(hud.labels);
    for (const id of ['system', 'engagement', 'ship'] as const) views.set(id, makeView(id));
  } else {
    hud.canvas.hidden = true;
  }

  const ro = new ResizeObserver(() => engine?.resize());
  ro.observe(hud.canvas);

  let down: { x: number; y: number } | null = null;
  const onPointerDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = down;
    down = null;
    if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
    const r = hud.canvas.getBoundingClientRect();
    const hit = views.get(store.get().scale)?.pick(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    if (hit !== null && hit !== undefined) store.set({ selectedShip: hit });
  };
  hud.canvas.addEventListener('pointerdown', onPointerDown);
  hud.canvas.addEventListener('pointerup', onPointerUp);

  let last = performance.now();
  let prevT = store.get().t;
  let prevShot: { id: string; scale: string } | null = null;
  let raf = 0;
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    let s = store.get();
    if (s.playing) {
      store.set(advance(s, dt, ix, replay.duration_s));
      s = store.get();
    }
    if (s.demo !== 'none' && !s.reducedMotion) {
      store.set({ demoProgress: (s.demoProgress + dt / DEMO_PERIOD_S) % 1 });
      s = store.get();
    }
    sampleFrame(replay, s.t, frame);
    const known = perceivedSelection(replay, s);
    if (known !== s.selectedShip) {
      store.set({ selectedShip: known });
      s = store.get();
    }

    if (s.camera === 'director' && shots.length) {
      const shot = shotAt(shots, s.t)!;
      if (shot.scale !== s.scale || shot.theater !== s.theater) {
        store.set({ scale: shot.scale, theater: shot.theater });
        s = store.get();
      }
      const jumped = Math.abs(s.t - prevT) > SCRUB_CUT_S;
      const changed = prevShot !== null && prevShot.id !== shot.id;
      const snap = prevShot === null || jumped || (changed && (s.reducedMotion || prevShot.scale !== shot.scale));
      const obs = s.perceived.enabled ? observerUnit(replay, s.perceived.side, shot.theater, s.t) : null;
      const framed = perceivedSubject(shot, obs === null ? null : replay.units[obs].id, s.perceived.enabled);
      if (framed) rig.follow(directorPose(framed, replay, frame, s.reducedMotion), dt, snap);
      prevShot = { id: shot.id, scale: shot.scale };
      views.get(s.scale)?.setPose(rig.eye, rig.target);
    } else {
      prevShot = null;
    }
    prevT = s.t;

    let live: Live = { frame, samplingText: null, scaleNote: '', notice: gl ? null : WEBGL_TEXT };
    const view = views.get(s.scale);
    if (view && engine && labelLayer) {
      for (const [id, v] of views) if (v.controls) v.controls.enabled = id === s.scale;
      if (view instanceof ShipView) view.setDemo(s.demo, s.demoProgress);
      const ctx: ViewContext = {
        replay, pack, tech: TECH, frame, layers: s.layers, perceived: s.perceived, density: s.density, theater: s.theater,
        selectedShip: s.selectedShip, selectedClass: s.selectedClass, reducedMotion: s.reducedMotion,
      };
      view.update(ctx);
      engine.render(view.scene, view.camera);
      labelLayer.update(view.labels(), view.camera, hud.canvas.clientWidth, hud.canvas.clientHeight);
      const st = view.status();
      live = { frame, samplingText: st.samplingText, scaleNote: st.scaleNote, notice: st.notice };
    }
    hud.render(s, live);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    hud.canvas.removeEventListener('pointerdown', onPointerDown);
    hud.canvas.removeEventListener('pointerup', onPointerUp);
    for (const v of views.values()) v.dispose();
    labelLayer?.clear();
    engine?.dispose();
    hud.dispose();
    delete window.__honorCic;
  };
}

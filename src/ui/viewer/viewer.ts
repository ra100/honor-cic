import { SolveFailure, solveInWorker } from '../../app/solve-client';
import { createFrame, sampleFrame, type Replay } from '../../core/replay';
import type { ScenarioPack } from '../../core/schema';
import { TECH } from '../../core/tech';
import { formatIssues } from '../../core/validate';
import { dist } from '../../core/vec';
import { getPack } from '../../registry';
import { observerUnit } from '../../core/perceived';
import { continueOrbitDamping, snapshotCamera, type CameraSnapshot } from '../../render/camera-motion';
import { CameraRig, directorPose, directorSpeed, followSubjects, perceivedSubject, shotAt, shotsFor, subjectCentroid } from '../../render/director';
import { Engine, webglAvailable } from '../../render/engine';
import { LabelLayer } from '../../render/labels';
import { EngagementView } from '../../render/scales/engagement-view';
import { ShipView } from '../../render/scales/ship-view';
import { SystemView } from '../../render/scales/system-view';
import { FIRE_DEMO_S, type ScaleId, type ScaleView, type ViewContext } from '../../render/scales/types';
import { clear, h } from '../dom';
import { CATALOG_HREF } from '../router';
import { createStore, type Store } from '../store';
import { buildHud, type Live } from './hud';
import { advance, autoSpeed, eventIndex, initialState, knownSide, perceivedSelection, phaseMarks, type ViewerState } from './model';
import { watchReducedMotion } from './motion';
import { continuousScene, renderScheduler } from './scheduler';

declare global {
  interface Window { __honorCic?: { store: Store<ViewerState>; duration: number; view(): ScaleView | undefined; renderCount(): number } }
}

const WEBGL_TEXT = 'This viewer needs WebGL. Turn on hardware acceleration or try another browser.';
const SCRUB_CUT_S = 30;

function renderError(root: HTMLElement, lines: string[], title = 'This replay could not be computed'): void {
  clear(root);
  root.append(
    h('main', { class: 'panel state', role: 'alert' },
      h('h1', null, title),
      h('pre', { class: 'errors' }, lines.slice(0, 20).join('\n')),
      h('p', null, h('a', { class: 'btn', href: CATALOG_HREF }, 'Back to catalog'))),
  );
}

export function mountViewer(root: HTMLElement, id: string): () => void {
  let disposed = false;
  const abort = new AbortController();
  let computed = false;
  let cleanup: () => void = () => {};
  clear(root);
  const pack = getPack(id);
  if (!pack) {
    renderError(root, [`No valid scenario pack has the id "${id}".`]);
    return () => {};
  }
  const bar = h('progress', { max: '1', value: '0', 'aria-label': 'Replay progress' });
  const phaseText = h('span', null, 'starting');
  root.append(h('main', { class: 'panel state', role: 'status' },
    h('h1', null, pack.meta.title), h('p', null, 'Computing replay: ', phaseText), bar,
    h('p', null, h('a', { class: 'btn', href: CATALOG_HREF }, 'Back to catalog'))));
  solveInWorker(id, (phase, fraction) => {
    if (disposed) return;
    phaseText.textContent = phase;
    bar.value = fraction;
  }, abort.signal)
    .then(({ replay }) => {
      computed = true;
      if (!disposed) cleanup = startViewer(root, pack, replay);
    })
    .catch((err: unknown) => {
      if (disposed) return;
      const lines = err instanceof SolveFailure ? (err.issues.length ? formatIssues(err.issues).split('\n') : [err.message]) : [String(err)];
      renderError(root, lines, computed ? 'The replay viewer could not start' : undefined);
    });
  return () => {
    disposed = true;
    abort.abort();
    cleanup();
  };
}

function startViewer(root: HTMLElement, pack: ScenarioPack, replay: Replay): () => void {
  clear(root);
  document.title = `${pack.meta.title}: honor-cic`;
  const motionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
  const store = createStore<ViewerState>(initialState(pack, motionMedia.matches));
  const shots = shotsFor(pack, replay);
  const marks = phaseMarks(pack, replay);
  const ix = eventIndex(replay);
  const frame = createFrame(replay);
  const rig = new CameraRig();
  let gl = webglAvailable();
  const views = new Map<ScaleId, ScaleView>();
  const unbindControls = new Map<ScaleView, () => void>();
  const renderedCameras = new WeakMap<ScaleView, CameraSnapshot>();
  let scheduler: ReturnType<typeof renderScheduler> | null = null;
  let active = true;
  let drawing = false;
  let rendered = 0;
  let plotFailure: string | null = gl ? null : WEBGL_TEXT;
  let actionFailure: string | null = null;
  const invalidate = () => { if (active && !drawing) scheduler?.invalidate(); };

  const hud = buildHud({
    pack, tech: TECH, replay, store, marks, shots,
    onResetView: () => resetView(),
    onFullscreen: () => {
      actionFailure = null;
      if (!hud.root.requestFullscreen || !document.exitFullscreen) {
        actionFailure = 'Fullscreen is not available in this browser.';
        invalidate();
        return;
      }
      const request = document.fullscreenElement ? document.exitFullscreen() : hud.root.requestFullscreen();
      void request.catch((error: unknown) => {
        actionFailure = `Fullscreen could not start: ${error instanceof Error ? error.message : String(error)}`;
        invalidate();
      });
    },
    onLayoutChange: invalidate,
  });
  root.append(hud.root);

  const makeView = (id: ScaleId): ScaleView => {
    const v = id === 'system' ? new SystemView(pack, replay, hud.canvas) : id === 'engagement' ? new EngagementView(pack, replay, hud.canvas) : new ShipView(pack, replay, hud.canvas);
    const onStart = () => {
      if (store.get().camera === 'director') store.set({ camera: 'free' });
      invalidate();
    };
    const onChange = invalidate;
    if (v.controls) {
      v.controls.enabled = false;
      v.controls.addEventListener('start', onStart);
      v.controls.addEventListener('change', onChange);
      unbindControls.set(v, () => {
        v.controls?.removeEventListener('start', onStart);
        v.controls?.removeEventListener('change', onChange);
      });
    }
    return v;
  };
  const disposeView = (view: ScaleView) => {
    unbindControls.get(view)?.();
    unbindControls.delete(view);
    view.dispose();
  };
  const resetView = () => {
    if (!gl) return;
    const id = store.get().scale;
    const previous = views.get(id);
    if (previous) disposeView(previous);
    views.set(id, makeView(id));
    invalidate();
  };

  let engine: Engine | null = null;
  let labelLayer: LabelLayer | null = null;
  if (gl) {
    try {
      engine = new Engine(hud.canvas);
    } catch (error: unknown) {
      gl = false;
      plotFailure = `The plot could not start: ${error instanceof Error ? error.message : String(error)}. Replay controls, forces and the CIC log remain available.`;
    }
  }
  if (engine) {
    try {
      labelLayer = new LabelLayer(hud.labels);
      for (const id of ['system', 'engagement', 'ship'] as const) views.set(id, makeView(id));
    } catch (error: unknown) {
      for (const view of views.values()) disposeView(view);
      labelLayer?.clear();
      engine.dispose();
      hud.dispose();
      throw error;
    }
  } else {
    hud.canvas.hidden = true;
  }

  window.__honorCic = { store, duration: replay.duration_s, view: () => views.get(store.get().scale), renderCount: () => rendered };
  const stopMotion = watchReducedMotion(store, motionMedia);
  const ro = new ResizeObserver(() => { if (active) { engine?.resize(); invalidate(); } });
  ro.observe(hud.root);

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
    if (hit !== null && hit !== undefined) store.set({ selectedShip: hit, selectedClass: null, menu: 'none' });
  };
  // Site A: double-click a ship to follow it with the free camera.
  const onDoubleClick = (e: MouseEvent) => {
    const s = store.get();
    if (s.scale === 'ship') return;
    const r = hud.canvas.getBoundingClientRect();
    const hit = views.get(s.scale)?.pick(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    if (hit !== null && hit !== undefined) store.set({ selectedShip: hit, selectedClass: null, camera: 'free', follow: true, menu: 'none' });
  };
  hud.canvas.addEventListener('pointerdown', onPointerDown);
  hud.canvas.addEventListener('pointerup', onPointerUp);
  hud.canvas.addEventListener('dblclick', onDoubleClick);

  let prevT = store.get().t;
  let prevShot: { id: string; scale: string } | null = null;
  let live: Live = { frame, samplingText: null, scaleNote: '', notice: plotFailure };
  const renderScene = (dt: number): boolean => {
    let s = store.get();
    const cinematicRate = s.camera === 'director' && s.speed === 'auto' ? directorSpeed(shots, s.t) : null;
    const rate = s.speed === 'auto' ? cinematicRate ?? autoSpeed(ix, s.t) : s.speed;
    if (s.playing) {
      store.set(advance(s, dt, ix, replay.duration_s, cinematicRate));
      s = store.get();
    }
    sampleFrame(replay, s.t, frame);
    const known = perceivedSelection(replay, s);
    if (known !== s.selectedShip) {
      store.set({ selectedShip: known });
      s = store.get();
    }

    let directorMoving = false;
    if (s.camera === 'director' && shots.length) {
      const shot = shotAt(shots, s.t)!;
      if (shot.scale !== s.scale || shot.theater !== s.theater) {
        store.set({ scale: shot.scale, theater: shot.theater });
        s = store.get();
      }
      const jumped = Math.abs(s.t - prevT) > SCRUB_CUT_S;
      const changed = prevShot !== null && prevShot.id !== shot.id;
      const snap = s.reducedMotion || prevShot === null || jumped || (changed && prevShot!.scale !== shot.scale);
      const obs = s.perceived.enabled ? observerUnit(replay, s.perceived.side, shot.theater, s.t) : null;
      const framed = perceivedSubject(shot, obs === null ? null : replay.units[obs].id, s.perceived.enabled);
      if (framed) {
        const pose = directorPose(framed, replay, frame, s.reducedMotion);
        rig.follow(pose, dt, snap);
        const tolerance = Math.max(1e-6, dist(pose.eye, pose.target) * 1e-5);
        directorMoving = Math.max(dist(rig.eye, pose.eye), dist(rig.target, pose.target)) > tolerance;
        if (!directorMoving) rig.follow(pose, 0, true);
      }
      prevShot = { id: shot.id, scale: shot.scale };
      views.get(s.scale)?.setPose(rig.eye, rig.target);
    } else {
      prevShot = null;
      if (s.follow && s.scale !== 'ship') {
        const c = subjectCentroid(replay, frame, followSubjects(replay, shots, s.t, s.selectedShip, knownSide(s)));
        if (c) views.get(s.scale)?.followTarget(c);
      }
    }
    prevT = s.t;

    hud.render(s, { ...live, frame, rate, notice: actionFailure ?? live.notice });
    const plotInsets = hud.plotInsets();
    live = { frame, rate, samplingText: null, scaleNote: '', notice: actionFailure ?? plotFailure };
    const view = views.get(s.scale);
    let cameraMoving = false;
    let viewAnimating = false;
    if (view && engine && labelLayer) {
      for (const [id, v] of views) if (v.controls) v.controls.enabled = id === s.scale;
      const scaleView: ScaleView = view;
      const fireT = s.fireStartedAt === null ? null : (performance.now() - s.fireStartedAt) / 1000;
      if (fireT !== null && fireT > FIRE_DEMO_S) store.set({ fireStartedAt: null });
      const ctx: ViewContext = {
        replay, pack, tech: TECH, frame, layers: s.layers, perceived: s.perceived, density: s.density, theater: s.theater,
        selectedShip: s.selectedShip, selectedClass: s.selectedClass, reducedMotion: s.reducedMotion,
        plotInsets,
        focusSide: s.perceived.enabled ? s.perceived.side : pack.meta.sides[0].id,
        systemFocus: s.systemFocus,
        ship: { roll: s.shipRoll, pods: s.shipPods, sails: s.shipSails, fireT: fireT !== null && fireT <= FIRE_DEMO_S ? fireT : null },
      };
      // Compare rendered poses, not the unscaled director pose reapplied before each safe-area fit.
      const before = renderedCameras.get(view);
      view.update(ctx);
      if (view.controls && before) cameraMoving = continueOrbitDamping(view.camera, view.controls, before, hud.canvas.clientHeight);
      if (view.controls) renderedCameras.set(view, snapshotCamera(view.camera, view.controls.target));
      engine.render(view.scene, view.camera, scaleView.grade);
      rendered++;
      labelLayer.update(view.labels(), view.camera, hud.canvas.clientWidth, hud.canvas.clientHeight, plotInsets);
      const st = view.status();
      const focusU = view.controls ? view.camera.position.distanceTo(view.controls.target) : 0;
      const kmPerPx = scaleView.kmPerUnit && focusU > 0 && hud.canvas.clientHeight > 0
        ? (2 * focusU * Math.tan((view.camera.fov * Math.PI) / 360) * scaleView.kmPerUnit) / hud.canvas.clientHeight
        : null;
      live = { frame, rate, samplingText: st.samplingText, scaleNote: st.scaleNote, notice: actionFailure ?? st.notice, kmPerPx };
      viewAnimating = scaleView.animating?.() ?? false;
    }
    hud.render(s, live);
    return continuousScene(s, directorMoving || cameraMoving || viewAnimating);
  };
  const draw = (_now: number, dt: number): boolean => {
    drawing = true;
    try {
      return renderScene(dt);
    } finally {
      drawing = false;
    }
  };
  scheduler = renderScheduler(draw);
  const unsubscribe = store.subscribe(invalidate);
  const onVisibility = () => {
    if (!document.hidden) invalidate();
  };
  const onFullscreen = () => { engine?.resize(); invalidate(); };
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('fullscreenchange', onFullscreen);
  document.fonts?.addEventListener('loadingdone', invalidate);
  scheduler.invalidate();

  return () => {
    active = false;
    scheduler?.dispose();
    unsubscribe();
    stopMotion();
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('fullscreenchange', onFullscreen);
    document.fonts?.removeEventListener('loadingdone', invalidate);
    ro.disconnect();
    hud.canvas.removeEventListener('pointerdown', onPointerDown);
    hud.canvas.removeEventListener('pointerup', onPointerUp);
    hud.canvas.removeEventListener('dblclick', onDoubleClick);
    for (const v of views.values()) disposeView(v);
    labelLayer?.clear();
    engine?.dispose();
    hud.dispose();
    delete window.__honorCic;
  };
}

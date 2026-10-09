import type { ViewerState } from './model';

export function continuousScene(s: Pick<ViewerState, 'playing' | 'scale' | 'demo' | 'reducedMotion'>, cameraMoving = false): boolean {
  return s.playing || (s.scale === 'ship' && s.demo !== 'none' && !s.reducedMotion) || cameraMoving;
}

export interface FrameClock {
  request(callback: (now: number) => void): number;
  cancel(id: number): void;
}

export function renderScheduler(
  draw: (now: number, elapsed: number) => boolean,
  clock: FrameClock = { request: (fn) => requestAnimationFrame(fn), cancel: (id) => cancelAnimationFrame(id) },
): { invalidate(): void; dispose(): void } {
  let pending: number | null = null;
  let last: number | null = null;
  let drawing = false;
  let dirty = false;
  let disposed = false;
  const schedule = () => { pending = clock.request(frame); };
  const frame = (now: number) => {
    if (disposed) return;
    pending = null;
    dirty = false;
    drawing = true;
    let keepMoving: boolean;
    try {
      keepMoving = draw(now, last === null ? 0 : Math.max(0, (now - last) / 1000));
    } finally {
      drawing = false;
    }
    if (disposed) return;
    if (keepMoving || dirty) {
      last = now;
      schedule();
    } else last = null;
  };
  return {
    invalidate() {
      if (disposed) return;
      dirty = true;
      if (!drawing && pending === null) schedule();
    },
    dispose() {
      disposed = true;
      if (pending !== null) clock.cancel(pending);
      pending = null;
    },
  };
}

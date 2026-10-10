import { describe, expect, it, vi } from 'vitest';
import { continuousScene, renderScheduler, type FrameClock } from '../../src/ui/viewer/scheduler';

function frameClock() {
  let id = 0;
  const callbacks = new Map<number, (now: number) => void>();
  const clock: FrameClock = {
    request: (callback) => { callbacks.set(++id, callback); return id; },
    cancel: (key) => { callbacks.delete(key); },
  };
  return {
    clock, pending: () => callbacks.size,
    frame(now: number) {
      const entry = callbacks.entries().next().value;
      if (!entry) throw new Error('No scheduled frame');
      const [key, callback] = entry;
      callbacks.delete(key);
      callback(now);
    },
  };
}

describe('dirty-only rendering', () => {
  it('coalesces invalidations and stops completely after an unchanged paused frame', () => {
    const clock = frameClock();
    const draw = vi.fn(() => false);
    const scheduler = renderScheduler(draw, clock.clock);
    expect(clock.pending()).toBe(0);
    scheduler.invalidate();
    scheduler.invalidate();
    expect(clock.pending()).toBe(1);
    clock.frame(10);
    expect(draw).toHaveBeenCalledOnce();
    expect(draw).toHaveBeenCalledWith(10, 0);
    expect(clock.pending()).toBe(0);
    scheduler.invalidate();
    clock.frame(10_000);
    expect(draw).toHaveBeenLastCalledWith(10_000, 0);
    expect(clock.pending()).toBe(0);
  });

  it('continues active playback, demos or camera damping and measures wall time between frames', () => {
    const clock = frameClock();
    const draw = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
    const scheduler = renderScheduler(draw, clock.clock);
    scheduler.invalidate();
    clock.frame(1000);
    clock.frame(1100);
    clock.frame(1200);
    expect(draw).toHaveBeenLastCalledWith(1200, 0.1);
    expect(clock.pending()).toBe(0);
    const idle = { playing: false, scale: 'engagement' as const, fireStartedAt: null };
    expect(continuousScene(idle)).toBe(false);
    expect(continuousScene({ ...idle, playing: true })).toBe(true);
    expect(continuousScene({ ...idle, scale: 'ship', fireStartedAt: 1000 })).toBe(true);
    expect(continuousScene({ ...idle, fireStartedAt: 1000 })).toBe(false);
    expect(continuousScene(idle, true)).toBe(true);
  });

  it('preserves a new invalidation during rendering, and cancellation prevents every later callback', () => {
    const clock = frameClock();
    let frames = 0;
    const scheduler = renderScheduler(() => {
      if (++frames === 1) scheduler.invalidate();
      return false;
    }, clock.clock);
    scheduler.invalidate();
    clock.frame(100);
    expect(clock.pending()).toBe(1);
    clock.frame(120);
    expect(clock.pending()).toBe(0);
    scheduler.invalidate();
    scheduler.dispose();
    expect(clock.pending()).toBe(0);
    scheduler.invalidate();
    expect(clock.pending()).toBe(0);
  });

  it('does not draw a callback that arrives after disposal, including disposal during a draw', () => {
    let callback: ((now: number) => void) | null = null;
    const clock: FrameClock = { request: (fn) => { callback = fn; return 1; }, cancel: vi.fn() };
    const draw = vi.fn(() => true);
    const scheduler = renderScheduler(draw, clock);
    scheduler.invalidate();
    scheduler.dispose();
    callback!(100);
    expect(draw).not.toHaveBeenCalled();
    const active = renderScheduler(() => { active.dispose(); return true; }, clock);
    active.invalidate();
    callback!(120);
    expect(clock.cancel).toHaveBeenCalledOnce();
  });

  it('propagates drawing failures instead of reporting a successful frame or silently retrying', () => {
    const clock = frameClock();
    const draw = vi.fn().mockImplementationOnce(() => { throw new Error('Scene failed'); }).mockReturnValue(false);
    const scheduler = renderScheduler(draw, clock.clock);
    scheduler.invalidate();
    expect(() => clock.frame(100)).toThrow('Scene failed');
    expect(clock.pending()).toBe(0);
    scheduler.invalidate();
    clock.frame(120);
    expect(draw).toHaveBeenCalledTimes(2);
    expect(clock.pending()).toBe(0);
  });
});

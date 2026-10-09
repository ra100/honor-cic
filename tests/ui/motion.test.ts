import { describe, expect, it } from 'vitest';
import { getPack } from '../../src/registry';
import { createStore } from '../../src/ui/store';
import { initialState } from '../../src/ui/viewer/model';
import { watchReducedMotion } from '../../src/ui/viewer/motion';

function motionMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initial,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  return {
    media: media as unknown as MediaQueryList,
    change(matches: boolean) { media.matches = matches; for (const listener of listeners) listener(); },
    listenerCount: () => listeners.size,
  };
}

describe('live motion preference', () => {
  it('initializes and follows live device changes while no explicit override exists', () => {
    const store = createStore(initialState(getPack('training')!, false));
    const media = motionMedia(true);
    const stop = watchReducedMotion(store, media.media);
    expect(store.get().reducedMotion).toBe(true);
    media.change(false);
    expect(store.get().reducedMotion).toBe(false);
    media.change(true);
    expect(store.get().reducedMotion).toBe(true);
    stop();
    expect(media.listenerCount()).toBe(0);
    media.change(false);
    expect(store.get().reducedMotion).toBe(true);
  });

  it('never overwrites the user’s explicit full-motion or reduced-motion choice', () => {
    const store = createStore(initialState(getPack('training')!, false));
    const media = motionMedia(false);
    const stop = watchReducedMotion(store, media.media);
    store.set({ motionOverride: false, reducedMotion: false });
    media.change(true);
    expect(store.get().reducedMotion).toBe(false);
    store.set({ motionOverride: true, reducedMotion: true });
    media.change(false);
    expect(store.get().reducedMotion).toBe(true);
    store.set({ motionOverride: null });
    expect(store.get().reducedMotion).toBe(false);
    stop();
  });
});

import type { Store } from '../store';
import type { ViewerState } from './model';

export function watchReducedMotion(store: Store<ViewerState>, media: MediaQueryList): () => void {
  const sync = () => {
    if (store.get().motionOverride === null) store.set({ reducedMotion: media.matches });
  };
  sync();
  media.addEventListener('change', sync);
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.motionOverride === null && prev.motionOverride !== null) sync();
  });
  return () => {
    media.removeEventListener('change', sync);
    unsubscribe();
  };
}

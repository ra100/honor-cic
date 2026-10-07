import { describe, expect, it } from 'vitest';
import { createStore } from '../../src/ui/store';

describe('store', () => {
  it('merges patches and notifies with the previous state', () => {
    const s = createStore({ a: 1, b: 'x' });
    const seen: Array<[number, number]> = [];
    const off = s.subscribe((next, prev) => seen.push([prev.a, next.a]));
    s.set({ a: 2 });
    s.set((st) => ({ a: st.a + 1 }));
    off();
    s.set({ a: 9 });
    expect(seen).toEqual([[1, 2], [2, 3]]);
    expect(s.get()).toEqual({ a: 9, b: 'x' });
  });
  it('skips notification when nothing changed', () => {
    const s = createStore({ a: 1 });
    let n = 0;
    s.subscribe(() => n++);
    s.set({ a: 1 });
    expect(n).toBe(0);
  });
});

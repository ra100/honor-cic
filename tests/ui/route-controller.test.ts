import { describe, expect, it, vi } from 'vitest';
import { createRouteController } from '../../src/ui/route-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type BattleMount = (id: string) => () => void;

function views(loadBattle = vi.fn<() => Promise<BattleMount>>(async () => vi.fn(() => vi.fn()))) {
  return { catalog: vi.fn(), loading: vi.fn(), notFound: vi.fn(), failure: vi.fn(), loadBattle };
}

describe('lazy battle navigation', () => {
  it('does not load the viewer for catalog or unknown routes', async () => {
    const deps = views();
    const routes = createRouteController(deps);
    await routes.navigate({ page: 'catalog' });
    await routes.navigate({ page: 'not-found', hash: '#/missing' });
    expect(deps.catalog).toHaveBeenCalledOnce();
    expect(deps.notFound).toHaveBeenCalledOnce();
    expect(deps.loadBattle).not.toHaveBeenCalled();
  });

  it('ignores a lazy result after returning to the catalog', async () => {
    const pending = deferred<(id: string) => () => void>();
    const deps = views(vi.fn(() => pending.promise));
    const mount = vi.fn(() => vi.fn());
    const routes = createRouteController(deps);
    const loading = routes.navigate({ page: 'battle', id: 'training' });
    await routes.navigate({ page: 'catalog' });
    pending.resolve(mount);
    await loading;
    expect(mount).not.toHaveBeenCalled();
    expect(deps.loading).toHaveBeenCalledOnce();
  });

  it('mounts only the latest of rapid battle switches and cleans it up before the next route', async () => {
    const first = deferred<(id: string) => () => void>();
    const second = deferred<(id: string) => () => void>();
    const cleanup = vi.fn();
    const mount = vi.fn(() => cleanup);
    const deps = views(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    const routes = createRouteController(deps);
    const a = routes.navigate({ page: 'battle', id: 'manticore' });
    const b = routes.navigate({ page: 'battle', id: 'training' });
    second.resolve(mount);
    await b;
    first.resolve(mount);
    await a;
    expect(mount).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledWith('training');
    await routes.navigate({ page: 'catalog' });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('shows genuine load and mount failures, but never paints a stale failure over a newer route', async () => {
    const pending = deferred<(id: string) => () => void>();
    const deps = views(vi.fn(() => pending.promise));
    const routes = createRouteController(deps);
    const loading = routes.navigate({ page: 'battle', id: 'training' });
    const error = new Error('Viewer chunk failed');
    pending.reject(error);
    await loading;
    expect(deps.failure).toHaveBeenCalledWith(error);
    const mountError = new Error('Viewer mount failed');
    deps.loadBattle.mockResolvedValue(() => { throw mountError; });
    await routes.navigate({ page: 'battle', id: 'training' });
    expect(deps.failure).toHaveBeenLastCalledWith(mountError);
    const stale = deferred<(id: string) => () => void>();
    deps.loadBattle.mockReturnValue(stale.promise);
    const old = routes.navigate({ page: 'battle', id: 'manticore' });
    routes.dispose();
    stale.reject(new Error('Stale load failed'));
    await old;
    expect(deps.failure).toHaveBeenCalledTimes(2);
  });
});

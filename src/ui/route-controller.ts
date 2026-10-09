import type { Route } from './router';

export interface RouteViews {
  catalog(): void;
  loading(): void;
  notFound(): void;
  failure(error: unknown): void;
  loadBattle(): Promise<(id: string) => () => void>;
}

export function createRouteController(views: RouteViews): { navigate(route: Route): Promise<void>; dispose(): void } {
  let generation = 0;
  let unmount: (() => void) | null = null;
  return {
    async navigate(route) {
      const current = ++generation;
      unmount?.();
      unmount = null;
      if (route.page === 'catalog') { views.catalog(); return; }
      if (route.page === 'not-found') { views.notFound(); return; }
      views.loading();
      try {
        const mount = await views.loadBattle();
        if (current === generation) unmount = mount(route.id);
      } catch (error: unknown) {
        if (current === generation) views.failure(error);
      }
    },
    dispose() {
      generation++;
      unmount?.();
      unmount = null;
    },
  };
}

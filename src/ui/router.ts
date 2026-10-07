export type Route = { page: 'catalog' } | { page: 'battle'; id: string } | { page: 'not-found'; hash: string };

export const CATALOG_HREF = '#/';
export const battleHref = (id: string): string => `#/battle/${encodeURIComponent(id)}`;

export function parseRoute(hash: string): Route {
  if (hash === '' || hash === '#' || hash === '#/') return { page: 'catalog' };
  const m = /^#\/battle\/([^/]+)$/.exec(hash);
  if (m) return { page: 'battle', id: decodeURIComponent(m[1]) };
  return { page: 'not-found', hash };
}

/** Calls fn now and on every hash change. */
export function onRouteChange(fn: (r: Route) => void): () => void {
  const handler = () => fn(parseRoute(window.location.hash));
  window.addEventListener('hashchange', handler);
  handler();
  return () => window.removeEventListener('hashchange', handler);
}

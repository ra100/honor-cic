import { describe, expect, it } from 'vitest';
import { battleHref, CATALOG_HREF, parseRoute } from '../../src/ui/router';

describe('router', () => {
  it('maps hashes to pages', () => {
    expect(parseRoute('')).toEqual({ page: 'catalog' });
    expect(parseRoute('#/')).toEqual({ page: 'catalog' });
    expect(parseRoute('#/battle/manticore')).toEqual({ page: 'battle', id: 'manticore' });
    expect(parseRoute('#/battle/')).toEqual({ page: 'not-found', hash: '#/battle/' });
    expect(parseRoute('#/nowhere')).toEqual({ page: 'not-found', hash: '#/nowhere' });
  });
  it('round-trips ids through hrefs', () => {
    expect(parseRoute(battleHref('first-yeltsin'))).toEqual({ page: 'battle', id: 'first-yeltsin' });
    expect(CATALOG_HREF).toBe('#/');
  });
});

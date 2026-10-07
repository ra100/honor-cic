import type { CatalogEntry } from '../registry';
import { clear, h } from './dom';
import { fmtPdDate } from './format';
import { battleHref } from './router';

export const EMPTY_CATALOG_TEXT = 'No battles yet. Add a scenario pack under scenarios/, see README: Adding a scenario.';

export interface CatalogCard {
  id: string;
  title: string;
  dateText: string;
  place: string;
  summary: string;
  sides: Array<{ id: string; name: string; color: string }>;
  evidencePct: number;
  href: string;
  broken: boolean;
  errors: string[];
  stub: boolean;
}

export function catalogCards(entries: CatalogEntry[]): CatalogCard[] {
  return entries.map((e) => ({
    id: e.id,
    title: e.title,
    dateText: e.date ? `${fmtPdDate(e.date)} [${e.dateEvidence}]` : e.year_pd !== null ? `${e.year_pd} PD` : 'date unknown',
    place: e.location,
    summary: e.summary,
    sides: e.sides,
    evidencePct: Math.round(e.evidence * 100),
    href: battleHref(e.id),
    broken: !e.ok,
    errors: e.errors.slice(0, 3),
    stub: e.stub,
  }));
}

function cardEl(c: CatalogCard): HTMLElement {
  const side = c.broken
    ? h('div', { class: 'card-error', role: 'status' },
        h('p', { class: 'err-title' }, 'Pack failed validation'),
        h('ul', null, c.errors.map((e) => h('li', { class: 'mono' }, e))),
        h('p', null, 'Fix the pack files, then reload.'))
    : h('div', { class: 'card-side' },
        h('div', { class: 'meter', role: 'meter', 'aria-label': 'Evidence quality', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': c.evidencePct },
          h('span', { class: 'meter-bar', style: `width:${c.evidencePct}%` })),
        h('small', { class: 'meter-text' }, `${c.evidencePct}% of values are P or W`),
        h('a', { class: 'btn cta', href: c.href }, 'Open replay'));
  return h('li', { class: `panel card${c.broken ? ' broken' : ''}`, 'data-pack': c.id },
    h('div', { class: 'card-main' },
      h('h2', null, c.title),
      h('p', { class: 'meta' }, h('span', { class: 'mono' }, c.dateText), h('span', null, c.place)),
      c.summary ? h('p', { class: 'summary' }, c.summary) : null,
      c.sides.length ? h('ul', { class: 'sides' }, c.sides.map((s) => h('li', { style: `--side:${s.color}` }, s.name))) : null,
      c.stub ? h('p', { class: 'tag' }, 'Non-canon example') : null),
    side);
}

export function renderCatalog(root: HTMLElement, entries: CatalogEntry[]): void {
  clear(root);
  const cards = catalogCards(entries);
  document.title = 'honor-cic: Honorverse battle replays';
  root.append(
    h('main', { class: 'catalog' },
      h('header', { class: 'catalog-head' },
        h('p', { class: 'wordmark' }, 'honor-cic'),
        h('h1', null, 'Honorverse battle replays'),
        h('p', { class: 'lede' }, 'Fleet actions rebuilt from the novels and reference works. Every number carries its evidence: P primary, W wiki, D derived, S speculative.')),
      cards.length === 0
        ? h('section', { class: 'panel state' }, h('p', null, EMPTY_CATALOG_TEXT))
        : h('ol', { class: 'cards' }, cards.map(cardEl))),
  );
}

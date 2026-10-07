import './ui/styles.css';
import { listScenarios } from './registry';
import { renderCatalog } from './ui/catalog';
import { clear, h } from './ui/dom';
import { CATALOG_HREF, onRouteChange } from './ui/router';

const root = document.getElementById('app')!;

onRouteChange((route) => {
  if (route.page === 'catalog') {
    renderCatalog(root, listScenarios());
    return;
  }
  clear(root);
  root.append(
    h('main', { class: 'panel state' },
      h('h1', null, route.page === 'battle' ? 'Replay viewer not available yet' : 'Page not found'),
      h('p', null, h('a', { class: 'btn', href: CATALOG_HREF }, 'Back to catalog'))),
  );
});

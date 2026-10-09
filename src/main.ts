import './ui/styles.css';
import { listScenarios } from './registry';
import { renderCatalog } from './ui/catalog';
import { clear, h } from './ui/dom';
import { createRouteController } from './ui/route-controller';
import { CATALOG_HREF, onRouteChange } from './ui/router';

const root = document.getElementById('app')!;
const routes = createRouteController({
  catalog: () => renderCatalog(root, listScenarios()),
  loading: () => {
    clear(root);
    root.append(h('main', { class: 'panel state', role: 'status' },
      h('h1', null, 'Loading replay viewer'),
      h('p', null, 'Preparing the plot and replay controls.'),
      h('a', { class: 'btn', href: CATALOG_HREF }, 'Back to catalog')));
  },
  notFound: () => {
    clear(root);
    root.append(
      h('main', { class: 'panel state' },
        h('h1', null, 'Page not found'),
        h('p', null, h('a', { class: 'btn', href: CATALOG_HREF }, 'Back to catalog'))),
    );
  },
  failure: (error) => {
    clear(root);
    root.append(h('main', { class: 'panel state', role: 'alert' },
      h('h1', null, 'The replay viewer could not load'),
      h('p', { class: 'errors' }, error instanceof Error ? error.message : String(error)),
      h('p', null, 'Reload the page to retry, or return to the catalog.'),
      h('a', { class: 'btn', href: CATALOG_HREF }, 'Back to catalog')));
  },
  loadBattle: async () => {
    const { mountViewer } = await import('./ui/viewer/viewer');
    return (id) => mountViewer(root, id);
  },
});
const navigate = () => onRouteChange((route) => { void routes.navigate(route); });
let stopRouting = navigate();
window.addEventListener('pagehide', () => { stopRouting(); routes.dispose(); });
window.addEventListener('pageshow', (event) => { if (event.persisted) stopRouting = navigate(); });

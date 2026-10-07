import './ui/styles.css';
import { listScenarios } from './registry';
import { renderCatalog } from './ui/catalog';
import { clear, h } from './ui/dom';
import { CATALOG_HREF, onRouteChange } from './ui/router';
import { mountViewer } from './ui/viewer/viewer';

const root = document.getElementById('app')!;
let unmount: () => void = () => {};

onRouteChange((route) => {
  unmount();
  unmount = () => {};
  if (route.page === 'catalog') {
    renderCatalog(root, listScenarios());
  } else if (route.page === 'battle') {
    unmount = mountViewer(root, route.id);
  } else {
    clear(root);
    root.append(
      h('main', { class: 'panel state' },
        h('h1', null, 'Page not found'),
        h('p', null, h('a', { class: 'btn', href: CATALOG_HREF }, 'Back to catalog'))),
    );
  }
});

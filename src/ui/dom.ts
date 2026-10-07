export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> | null;

/** Small hyperscript helper. `on<event>` attributes become listeners; `true` sets a boolean attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

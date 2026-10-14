// Tiny DOM helpers for the dashboard page (no framework).

export type Child = Node | string | number | null | undefined | false;
export type Attributes = Record<string, unknown>;

/** Creates an element. `onX` keys add listeners; `value` is applied after children so <select> picks its option. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  let deferredValue: unknown;
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "value") deferredValue = value;
    else if (key.startsWith("on") && typeof value === "function") element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === "class") element.className = String(value);
    else if (key === "dataset" && typeof value === "object") Object.assign(element.dataset, value);
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === "number" ? String(child) : child);
  }
  if (deferredValue !== undefined) (element as unknown as { value: string }).value = String(deferredValue);
  return element;
}

export function clear(element: HTMLElement): void {
  element.replaceChildren();
}

/** Shorthand for the focus key that lets a re-render put the cursor back where it was. */
export function focusKey(key: string): { dataset: { focus: string } } {
  return { dataset: { focus: key } };
}

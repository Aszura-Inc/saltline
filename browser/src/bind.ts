import { start, type StartOptions, type StartResult } from './flow.ts';

const bound = new WeakSet<Element>();

/**
 * Binds `[data-saltline-start]` clicks to `start`; other `data-saltline-*` attrs become body fields.
 * e.g. `<button data-saltline-start="/start" data-saltline-provider="google">`. Returns an unbind.
 */
export function bind(
  root: ParentNode = document,
  defaults: Partial<Omit<StartOptions, 'url' | 'body'>> = {},
): () => void {
  const cleanups: Array<() => void> = [];

  for (const element of root.querySelectorAll<HTMLElement>('[data-saltline-start]')) {
    if (bound.has(element)) continue;
    bound.add(element);

    const onClick = (event: Event): void => {
      event.preventDefault();
      if (element.getAttribute('aria-busy') === 'true') return;
      element.setAttribute('aria-busy', 'true');

      start({ ...defaults, url: element.dataset.saltlineStart ?? '', body: bodyFrom(element) })
        .then((result: StartResult) => {
          // Stay busy while the page navigates away.
          if (defaults.navigate === false) element.removeAttribute('aria-busy');
          element.dispatchEvent(
            new CustomEvent('saltline:started', { bubbles: true, detail: result }),
          );
        })
        .catch((error: unknown) => {
          element.removeAttribute('aria-busy');
          element.dispatchEvent(
            new CustomEvent('saltline:error', { bubbles: true, detail: error }),
          );
        });
    };

    element.addEventListener('click', onClick);
    cleanups.push(() => {
      element.removeEventListener('click', onClick);
      bound.delete(element);
    });
  }

  return () => cleanups.forEach((cleanup) => cleanup());
}

function bodyFrom(element: HTMLElement): Record<string, string> {
  const body: Record<string, string> = {};
  for (const [name, value] of Object.entries(element.dataset)) {
    if (!name.startsWith('saltline') || name === 'saltlineStart' || value === undefined) continue;
    const field = name.slice('saltline'.length);
    if (field === '') continue;
    body[field.charAt(0).toLowerCase() + field.slice(1)] = value;
  }
  return body;
}

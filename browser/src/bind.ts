import { start, type FetchEndpointOptions, type StartOptions, type StartResult } from './flow.ts';

const bound = new WeakSet<Element>();

/**
 * Binds `[data-saltline-start]` clicks to `start`. `data-saltline-provider` is the provider,
 * `data-saltline-state` the state, and other `data-saltline-*` attrs become body fields.
 * e.g. `<button data-saltline-start="/start" data-saltline-provider="google">`. Returns an unbind.
 * fetch only: `send` can't come from an attribute.
 */
export function bind(
  root: ParentNode = document,
  defaults: Omit<FetchEndpointOptions, 'url' | 'send'> & Pick<StartOptions, 'navigate'> = {},
): () => void {
  const cleanups: Array<() => void> = [];

  for (const element of root.querySelectorAll<HTMLElement>('[data-saltline-start]')) {
    if (bound.has(element)) continue;
    bound.add(element);

    const onClick = (event: Event): void => {
      event.preventDefault();
      if (element.getAttribute('aria-busy') === 'true') return;
      element.setAttribute('aria-busy', 'true');

      start({ ...defaults, url: element.dataset.saltlineStart ?? '', ...fieldsFrom(element) })
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

function fieldsFrom(element: HTMLElement): Pick<StartOptions, 'provider' | 'state' | 'body'> {
  const body: Record<string, string> = {};
  let provider = '';
  let state: string | undefined;
  for (const [name, value] of Object.entries(element.dataset)) {
    if (!name.startsWith('saltline') || name === 'saltlineStart' || value === undefined) continue;
    const field = name.slice('saltline'.length);
    if (field === '') continue;
    const camel = field.charAt(0).toLowerCase() + field.slice(1);
    if (camel === 'provider') provider = value;
    else if (camel === 'state') state = value;
    else body[camel] = value;
  }
  return { provider, state, body };
}

// Script-tag build: sets window.Saltline and binds [data-saltline-start] on load. data-finish on the
// tag runs finish and fires saltline:finished / saltline:error on document.
import * as Saltline from './index.ts';

declare global {
  interface Window {
    Saltline: typeof Saltline;
  }
}

window.Saltline = Saltline;

const finishUrl = (document.currentScript as HTMLScriptElement | null)?.dataset.finish;

function boot(): void {
  Saltline.bind();
  if (finishUrl === undefined || finishUrl === '') return;
  Saltline.finish({ url: finishUrl })
    .then((result) => {
      if (result !== null) {
        document.dispatchEvent(new CustomEvent('saltline:finished', { detail: result }));
      }
    })
    .catch((error: unknown) => {
      document.dispatchEvent(new CustomEvent('saltline:error', { detail: error }));
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

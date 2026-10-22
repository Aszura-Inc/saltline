// createElement instead of JSX, so no JSX build step.
import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactElement,
} from 'react';

import {
  finish,
  start,
  type EndpointOptions,
  type FinishOptions,
  type FinishResult,
  type StartOptions,
  type StartResult,
} from './flow.ts';

export type UseSaltlineStartOptions = EndpointOptions & Pick<StartOptions, 'navigate'> & {
  /** Called on failure. */
  onError?: (error: unknown) => void;
};

/** Per-click extras for `start`. */
export type StartExtras = Pick<StartOptions, 'state' | 'body'>;

export interface UseSaltlineStart {
  /** Runs `start` for a provider; resolves undefined on failure (see `error`). */
  start: (provider: string, extras?: StartExtras) => Promise<StartResult | undefined>;
  /** True until the page leaves or the call fails. */
  pending: boolean;
  /** Last failure, cleared on the next start. */
  error: unknown;
}

/** Starts a connect or sign-in flow from a click. */
export function useSaltlineStart(options: UseSaltlineStartOptions): UseSaltlineStart {
  // Ref so an inline options object doesn't recreate `start`.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async (provider: string, extras: StartExtras = {}) => {
    setPending(true);
    setError(null);
    try {
      // Spread whole (start ignores onError): rest-destructuring would collapse the url|send union.
      const result = await start({ ...optionsRef.current, provider, ...extras });
      // Stay pending while the page navigates away.
      if (optionsRef.current.navigate === false) setPending(false);
      return result;
    } catch (caught) {
      setError(caught);
      setPending(false);
      optionsRef.current.onError?.(caught);
      return undefined;
    }
  }, []);

  return { start: run, pending, error };
}

export type UseSaltlineFinishOptions = FinishOptions & {
  /** `false` to defer. Default true. */
  enabled?: boolean;
};

export interface UseSaltlineFinish<T, S = unknown> {
  loading: boolean;
  /** Null until settled, or if the page wasn't a Saltline redirect. */
  result: FinishResult<T, S> | null;
  error: unknown;
}

/** Runs `finish` once on mount. Client-only: mark the component `'use client'` in Next.js. */
export function useSaltlineFinish<T = unknown, S = unknown>(
  options: UseSaltlineFinishOptions,
): UseSaltlineFinish<T, S> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Guards StrictMode's double effect; a second finish would find no verifier.
  const ran = useRef(false);
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<UseSaltlineFinish<T, S>>({
    loading: false,
    result: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true;
    setState({ loading: true, result: null, error: null });
    // Read from the ref, not deps, so a new `send` each render can't re-run it.
    finish<T, S>(optionsRef.current).then(
      (result) => setState({ loading: false, result, error: null }),
      (error: unknown) => setState({ loading: false, result: null, error }),
    );
  }, [enabled]);

  return state;
}

export type SaltlineButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onError'> &
  UseSaltlineStartOptions &
  StartExtras & {
    /** Provider key, e.g. `google`. */
    provider: string;
  };

/** Button that runs `start`; disabled while pending. Other props go to the `<button>`. */
export function SaltlineButton({
  url,
  headers,
  credentials,
  fetch,
  send,
  navigate,
  provider,
  state,
  body,
  onError,
  onClick,
  disabled,
  type = 'button',
  ...buttonProps
}: SaltlineButtonProps): ReactElement {
  const { start: run, pending } = useSaltlineStart({
    // start throws a TypeError if neither is given.
    ...(send === undefined ? { url: url as string, headers, credentials, fetch } : { send }),
    navigate,
    onError,
  });

  return createElement('button', {
    ...buttonProps,
    type,
    disabled: disabled || pending,
    'aria-busy': pending || undefined,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      void run(provider, { state, body });
    },
  });
}

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
  type FinishOptions,
  type FinishResult,
  type StartOptions,
  type StartResult,
} from './flow.ts';

export type UseSaltlineStartOptions = Omit<StartOptions, 'body'> & {
  /** Called on failure. */
  onError?: (error: unknown) => void;
};

export interface UseSaltlineStart {
  /** Runs `start`; resolves undefined on failure (see `error`). */
  start: (body?: Record<string, unknown>) => Promise<StartResult | undefined>;
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

  const run = useCallback(async (body?: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    try {
      const { onError: _onError, ...startOptions } = optionsRef.current;
      const result = await start({ ...startOptions, body });
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

export interface UseSaltlineFinish<T> {
  loading: boolean;
  /** Null until settled, or if the page wasn't a Saltline redirect. */
  result: FinishResult<T> | null;
  error: unknown;
}

/** Runs `finish` once on mount. */
export function useSaltlineFinish<T = unknown>(
  options: UseSaltlineFinishOptions,
): UseSaltlineFinish<T> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // Guards StrictMode's double effect; a second finish would find no verifier.
  const ran = useRef(false);
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<UseSaltlineFinish<T>>({
    loading: false,
    result: null,
    error: null,
  });

  useEffect(() => {
    if (!enabled || ran.current) return;
    ran.current = true;
    const { enabled: _enabled, ...finishOptions } = optionsRef.current;
    setState({ loading: true, result: null, error: null });
    finish<T>(finishOptions).then(
      (result) => setState({ loading: false, result, error: null }),
      (error: unknown) => setState({ loading: false, result: null, error }),
    );
  }, [enabled]);

  return state;
}

export type SaltlineButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onError'> &
  UseSaltlineStartOptions & {
    /** Start endpoint body, e.g. `{ provider: 'google' }`. */
    body?: Record<string, unknown>;
  };

/** Button that runs `start`; disabled while pending. Other props go to the `<button>`. */
export function SaltlineButton({
  url,
  headers,
  credentials,
  fetch,
  navigate,
  body,
  onError,
  onClick,
  disabled,
  type = 'button',
  ...buttonProps
}: SaltlineButtonProps): ReactElement {
  const { start: run, pending } = useSaltlineStart({
    url,
    headers,
    credentials,
    fetch,
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
      void run(body);
    },
  });
}

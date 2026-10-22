// The two endpoints @aszura/saltline-browser calls, ready to mount.
import type { Saltline } from './client.ts';
import { SaltlineError } from './errors.ts';
import type { AuthType, Connection, UserInfo } from './types.ts';

export interface FlowProviderOptions {
  /** Connections only. Default: the flow's `auth`. */
  auth?: AuthType;
  /** Only needed when the provider has several integrations and no default. */
  integrationKey?: string;
}

export interface FlowOptions {
  /** Allowlist: the only providers the browser can start or finish. */
  providers: readonly string[] | Record<string, FlowProviderOptions>;
  /** Where Saltline sends the user back: the page that runs the browser package's `finish`. */
  redirectUrl: string | ((provider: string) => string);
  /** Connections only. Default `oAuth2`. */
  auth?: AuthType;
  theme?: 'light' | 'dark';
}

/** Per-request facts for `start`, from your own session. */
export interface StartInit {
  /** Your own ID for the user, stored on the connection or session. */
  externalUserId?: string | null;
}

export type FlowInputErrorCode = 'UNKNOWN_PROVIDER' | 'INVALID_INPUT';

/** The browser sent something the flow can't use. Answer 400. */
export class FlowInputError extends Error {
  readonly status = 400;
  readonly code: FlowInputErrorCode;

  constructor(code: FlowInputErrorCode, message: string) {
    super(message);
    this.name = 'FlowInputError';
    this.code = code;
  }
}

export interface ConnectStarted {
  provider: string;
  connectionKey: string;
  authorizationUrl: string;
}
export interface ConnectClaimed {
  provider: string;
  connectionKey: string;
  connection: Connection;
}
export interface SignInStarted {
  provider: string;
  sessionKey: string;
  authorizationUrl: string;
}
export interface SignInClaimed {
  provider: string;
  sessionKey: string;
  user: UserInfo['user'];
  raw: UserInfo['raw'];
}

/** What a flow handler answers: the status and JSON body. */
export interface FlowReply {
  status: number;
  body: unknown;
}

// Express-shaped, without depending on Express. Next.js API routes fit too.
export interface ExpressRequest {
  /** Parsed JSON: mount `express.json()` first. */
  body?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
export interface ExpressResponse {
  status(code: number): { json(body: unknown): unknown };
}
export type ExpressNext = (error?: unknown) => void;
export type ExpressHandler<Req extends ExpressRequest = ExpressRequest> = (
  req: Req,
  res: ExpressResponse,
  next: ExpressNext,
) => void;

/** Web-standard handler: Next.js App Router, Remix, Hono, SvelteKit, Workers. */
export type WebHandler = (request: Request) => Promise<Response>;

type StartInitFor<Ctx> = StartInit | ((context: Ctx) => StartInit | Promise<StartInit>);

interface Engine<Started, Claimed> {
  keyField: 'connectionKey' | 'sessionKey';
  init(provider: string, challenge: string, init: StartInit): Promise<Started>;
  claim(provider: string, key: string, codeVerifier: string): Promise<Claimed>;
}

// Saltline refusing the claim itself: the browser should start again.
const CLAIM_CODES = new Set([
  'CONNECTION_NOT_FOUND',
  'SESSION_NOT_FOUND',
  'CODE_VERIFIER_MISMATCH',
  'MISSING_PKCE_PARAMETERS',
]);

/**
 * Answers a failure the flow knows about: `FlowInputError` as 400, a claim Saltline refused as
 * 400 with Saltline's code, any other Saltline error as 502. Null for anything else.
 */
export function flowErrorReply(error: unknown): FlowReply | null {
  if (error instanceof FlowInputError) {
    return { status: 400, body: { code: error.code, error: error.message } };
  }
  if (error instanceof SaltlineError) {
    return {
      status: CLAIM_CODES.has(error.code) ? 400 : 502,
      body: { code: error.code, error: error.message, requestId: error.requestId },
    };
  }
  return null;
}

/** A start/finish pair for one kind of flow. Build one with `connectFlow` or `signInFlow`. */
export class Flow<Started, Claimed> {
  /** The allowlist, for rendering your buttons. */
  readonly providers: readonly string[];
  readonly #engine: Engine<Started, Claimed>;
  readonly #allowed: Set<string>;

  constructor(providers: readonly string[], engine: Engine<Started, Claimed>) {
    this.providers = [...providers];
    this.#allowed = new Set(providers);
    this.#engine = engine;
  }

  /**
   * Handles the browser's start payload `{ provider, codeChallenge, codeChallengeMethod }` and
   * returns the JSON to answer. Throws `FlowInputError` (400) or `SaltlineError`.
   */
  async start(input: unknown, init: StartInit = {}): Promise<Started> {
    const record = asRecord(input);
    const provider = this.provider(record);
    const challenge = text(record, 'codeChallenge');
    if (record.codeChallengeMethod !== 'S256') {
      throw new FlowInputError('INVALID_INPUT', 'codeChallengeMethod must be S256.');
    }
    return this.#engine.init(provider, challenge, init);
  }

  /**
   * Handles the browser's finish payload `{ provider, connectionKey | sessionKey, codeVerifier }`
   * and claims it. Store the result against your user, then answer whatever JSON you like.
   */
  async finish(input: unknown): Promise<Claimed> {
    const record = asRecord(input);
    const provider = this.provider(record);
    const key = text(record, this.#engine.keyField);
    const codeVerifier = text(record, 'codeVerifier');
    return this.#engine.claim(provider, key, codeVerifier);
  }

  /** Express (and Next.js API route) handlers. Mount `express.json()` and your login first. */
  readonly express = {
    start: <Req extends ExpressRequest = ExpressRequest>(
      init?: StartInitFor<Req>,
    ): ExpressHandler<Req> => {
      return (req, res, next) => {
        this.reply(async () => this.start(req.body, await resolveInit(init, req))).then(
          (reply) => res.status(reply.status).json(reply.body),
          next,
        );
      };
    },
    finish: <Req extends ExpressRequest = ExpressRequest>(
      onClaimed: (claimed: Claimed, req: Req) => unknown,
    ): ExpressHandler<Req> => {
      return (req, res, next) => {
        this.reply(() => this.finish(req.body).then((claimed) => onClaimed(claimed, req))).then(
          (reply) => res.status(reply.status).json(reply.body),
          next,
        );
      };
    },
  };

  /**
   * Web-standard handlers (`Request` in, `Response` out) for Next.js App Router, Remix, Hono,
   * SvelteKit and Workers. A `Response` your callback throws is returned as is, so a
   * "not signed in" redirect or 401 works the usual way.
   */
  readonly web = {
    start: (init?: StartInitFor<Request>): WebHandler => {
      return async (request) => {
        const reply = await this.reply(async () =>
          this.start(await readJson(request), await resolveInit(init, request)),
        ).catch(thrownResponse);
        return reply instanceof Response ? reply : Response.json(reply.body, { status: reply.status });
      };
    },
    finish: (onClaimed: (claimed: Claimed, request: Request) => unknown): WebHandler => {
      return async (request) => {
        const reply = await this.reply(async () =>
          onClaimed(await this.finish(await readJson(request)), request),
        ).catch(thrownResponse);
        return reply instanceof Response ? reply : Response.json(reply.body, { status: reply.status });
      };
    },
  };

  // Known failures become replies; anything else rejects so the framework handles it.
  private async reply(run: () => Promise<unknown>): Promise<FlowReply> {
    try {
      const body = await run();
      return { status: 200, body: body === undefined ? { ok: true } : body };
    } catch (error) {
      const reply = flowErrorReply(error);
      if (reply === null) throw error;
      return reply;
    }
  }

  private provider(record: Record<string, unknown>): string {
    const provider = record.provider;
    if (typeof provider !== 'string' || !this.#allowed.has(provider)) {
      throw new FlowInputError('UNKNOWN_PROVIDER', 'provider is not one this flow allows.');
    }
    return provider;
  }
}

export type ConnectFlow = Flow<ConnectStarted, ConnectClaimed>;
export type SignInFlow = Flow<SignInStarted, SignInClaimed>;

/** The start and finish endpoints for connecting a user's account. */
export function connectFlow(saltline: Saltline, options: FlowOptions): ConnectFlow {
  const providers = providerMap(options);
  return new Flow(Object.keys(providers), {
    keyField: 'connectionKey',
    async init(provider, codeChallenge, init) {
      const { auth, integrationKey } = providers[provider]!;
      const result = await saltline.connections.init(
        provider,
        {
          auth: auth ?? options.auth ?? 'oAuth2',
          redirectUrl: redirectUrlFor(options, provider),
          codeChallenge,
          codeChallengeMethod: 'S256',
          externalUserId: init.externalUserId ?? null,
          ...(options.theme === undefined ? {} : { theme: options.theme }),
        },
        { integrationKey },
      );
      return {
        provider,
        connectionKey: result.connectionKey,
        authorizationUrl: result.authorizationUrl,
      };
    },
    async claim(provider, connectionKey, codeVerifier) {
      const connection = await saltline.connections.claim(provider, connectionKey, codeVerifier);
      return { provider, connectionKey, connection };
    },
  });
}

/** The start and finish endpoints for signing a user in. */
export function signInFlow(saltline: Saltline, options: FlowOptions): SignInFlow {
  const providers = providerMap(options);
  return new Flow(Object.keys(providers), {
    keyField: 'sessionKey',
    async init(provider, codeChallenge, init) {
      const result = await saltline.sessions.init(
        provider,
        {
          auth: 'oAuth2',
          redirectUrl: redirectUrlFor(options, provider),
          codeChallenge,
          codeChallengeMethod: 'S256',
          externalUserId: init.externalUserId ?? null,
          ...(options.theme === undefined ? {} : { theme: options.theme }),
        },
        { integrationKey: providers[provider]!.integrationKey },
      );
      return { provider, sessionKey: result.sessionKey, authorizationUrl: result.authorizationUrl };
    },
    async claim(provider, sessionKey, codeVerifier) {
      const { user, raw } = await saltline.sessions.claim(provider, sessionKey, codeVerifier);
      return { provider, sessionKey, user, raw };
    },
  });
}

function providerMap(options: FlowOptions): Record<string, FlowProviderOptions> {
  const map: Record<string, FlowProviderOptions> = Array.isArray(options.providers)
    ? Object.fromEntries(options.providers.map((provider) => [provider, {}]))
    : { ...(options.providers as Record<string, FlowProviderOptions>) };
  if (Object.keys(map).length === 0) {
    throw new TypeError('Saltline: `providers` must name at least one provider.');
  }
  return map;
}

function redirectUrlFor(options: FlowOptions, provider: string): string {
  return typeof options.redirectUrl === 'function'
    ? options.redirectUrl(provider)
    : options.redirectUrl;
}

function resolveInit<Ctx>(
  init: StartInitFor<Ctx> | undefined,
  context: Ctx,
): StartInit | Promise<StartInit> {
  if (init === undefined) return {};
  return typeof init === 'function' ? init(context) : init;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new FlowInputError('INVALID_INPUT', 'Send a JSON object.');
  }
  return input as Record<string, unknown>;
}

function text(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value === '') {
    throw new FlowInputError('INVALID_INPUT', `${field} must be a non-empty string.`);
  }
  return value;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new FlowInputError('INVALID_INPUT', 'Send a JSON object.');
  }
}

function thrownResponse(error: unknown): Response {
  if (error instanceof Response) return error;
  throw error;
}

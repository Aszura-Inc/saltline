import { segment, type Transport } from '../transport.ts';
import type { JsonBody, Webhook } from '../types.ts';

export interface WebhookScope {
  /** The connection the webhook belongs to. */
  connectionKey: string;
  /** Only needed when the provider has several integrations and no default. */
  integrationKey?: string;
}

export interface WebhookWriteOptions extends WebhookScope {
  /** Provider API version to pin. */
  version?: string;
  /** Kind-specific values for the provider call. */
  body?: Record<string, unknown>;
}

/** Provider webhook subscriptions. */
export class Webhooks {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** Registers a webhook at the provider. */
  register(
    provider: string,
    options: WebhookWriteOptions & {
      /** Provider webhook kind. */
      kind?: string;
      /** Custom key. Some words, e.g. `init`, are reserved. */
      webhookKey?: string;
      /** Up to 1 KB, echoed on deliveries as `x-saltline-metadata`. */
      metadata?: string;
    },
  ): Promise<JsonBody<'registerWebhook'>> {
    return this.#transport.json({
      method: 'POST',
      path: `webhooks/${segment(provider)}`,
      headers: {
        ...scopeHeaders(options),
        'x-saltline-version': options.version,
        'x-saltline-webhook-kind': options.kind,
        'x-saltline-webhook-key': options.webhookKey,
        'x-saltline-metadata': options.metadata,
      },
      body: options.body ?? {},
    });
  }

  /** Lists the connection's webhooks for this provider. */
  async list(provider: string, scope: WebhookScope): Promise<Webhook[]> {
    const result = await this.#transport.json<JsonBody<'listWebhooks'>>({
      method: 'GET',
      path: `webhooks/${segment(provider)}`,
      headers: scopeHeaders(scope),
    });
    return result.webhooks;
  }

  /** Reads one webhook. */
  async get(provider: string, webhookKey: string, scope: WebhookScope): Promise<Webhook> {
    const result = await this.#transport.json<JsonBody<'getWebhook'>>({
      method: 'GET',
      path: `webhooks/${segment(provider)}/${segment(webhookKey)}`,
      headers: scopeHeaders(scope),
    });
    return result.webhook;
  }

  /** Updates a webhook at the provider. */
  update(
    provider: string,
    webhookKey: string,
    options: WebhookWriteOptions,
  ): Promise<JsonBody<'updateWebhook'>> {
    return this.#transport.json({
      method: 'PATCH',
      path: `webhooks/${segment(provider)}/${segment(webhookKey)}`,
      headers: { ...scopeHeaders(options), 'x-saltline-version': options.version },
      body: options.body ?? {},
    });
  }

  /** Unregisters a webhook at the provider and marks it revoked. */
  delete(
    provider: string,
    webhookKey: string,
    options: WebhookScope & { version?: string },
  ): Promise<JsonBody<'deleteWebhook'>> {
    return this.#transport.json({
      method: 'DELETE',
      path: `webhooks/${segment(provider)}/${segment(webhookKey)}`,
      headers: { ...scopeHeaders(options), 'x-saltline-version': options.version },
    });
  }

  /**
   * Starts a manual registration: paste `ingressUrl` in the provider's dashboard, then send the
   * user to `setupUrl`.
   */
  initManual(
    provider: string,
    options: WebhookScope & { redirectUrl?: string },
  ): Promise<JsonBody<'initManualWebhook'>> {
    return this.#transport.json({
      method: 'POST',
      path: `webhooks/${segment(provider)}/init`,
      headers: scopeHeaders(options),
      body: options.redirectUrl === undefined ? {} : { redirectUrl: options.redirectUrl },
    });
  }
}

function scopeHeaders(scope: WebhookScope): Record<string, string | undefined> {
  return {
    'x-saltline-connection-key': scope.connectionKey,
    'x-saltline-integration-key': scope.integrationKey,
  };
}

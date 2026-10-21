import { Connections } from './resources/connections.ts';
import { Environment } from './resources/environment.ts';
import { ProviderProxy } from './resources/proxy.ts';
import { Sessions } from './resources/sessions.ts';
import { Webhooks } from './resources/webhooks.ts';
import { Transport, type SaltlineOptions } from './transport.ts';

/** Saltline API client. Server-side only: it holds your secret API key. */
export class Saltline {
  /** Users' connected accounts. */
  readonly connections: Connections;
  /** End-user sign-in sessions. */
  readonly sessions: Sessions;
  /** Provider webhook subscriptions. */
  readonly webhooks: Webhooks;
  /** Calls to provider APIs. */
  readonly proxy: ProviderProxy;
  /** Integrations and identity providers. */
  readonly environment: Environment;
  /** Base URL, including `/v1`. */
  readonly baseUrl: string;

  constructor(options: SaltlineOptions) {
    const transport = new Transport(options);
    this.baseUrl = transport.baseUrl;
    this.connections = new Connections(transport);
    this.sessions = new Sessions(transport);
    this.webhooks = new Webhooks(transport);
    this.proxy = new ProviderProxy(transport);
    this.environment = new Environment(transport);
  }
}

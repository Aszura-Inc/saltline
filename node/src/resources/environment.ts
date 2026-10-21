import type { Transport } from '../transport.ts';
import type { IdentityProvider, Integration, JsonBody } from '../types.ts';

/** Read-only information about your environment. */
export class Environment {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /** The integrations set up in your environment, with public provider details. */
  async integrations(): Promise<Integration[]> {
    const result = await this.#transport.json<JsonBody<'listIntegrations'>>({
      method: 'GET',
      path: 'environment/integrations',
    });
    return result.integrations;
  }

  /** The providers enabled for sign-in, with their active integrations. */
  async identityProviders(): Promise<IdentityProvider[]> {
    const result = await this.#transport.json<JsonBody<'listIdentityProviders'>>({
      method: 'GET',
      path: 'environment/identity-providers',
    });
    return result.identityProviders;
  }
}

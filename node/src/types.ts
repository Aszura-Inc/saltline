// Public types from openapi.gen.ts (generated; don't edit, run `npm run openapi:types`).

import type { components, operations } from './openapi.gen.ts';

type Schemas = components['schemas'];

/** An operation's JSON response body. */
export type JsonBody<Op extends keyof operations, Status extends number = 200> =
  operations[Op]['responses'] extends Record<Status, infer Response>
    ? Response extends { content: { 'application/json': infer Body } }
      ? Body
      : never
    : never;

/** An operation's JSON request body. */
export type RequestBody<Op extends keyof operations> =
  NonNullable<operations[Op]['requestBody']> extends { content: { 'application/json': infer Body } }
    ? Body
    : never;

export type Connection = Schemas['Connection'];
export type Session = Schemas['Session'];
export type Webhook = Schemas['Webhook'];
export type Integration = Schemas['Integration'];
export type IdentityProvider = Schemas['IdentityProvider'];
export type UserInfo = Schemas['UserInfo'];
export type FormField = Schemas['FormField'];
export type AuthType = Schemas['AuthType'];
export type CredentialStatus = Schemas['CredentialStatus'];

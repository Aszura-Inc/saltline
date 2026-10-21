<?php

declare(strict_types=1);

namespace Saltline\Resources;

use Saltline\SaltlineException;
use Saltline\Transport;

/**
 * Verify deliveries with Signature::verifyWebhook().
 *
 * @phpstan-type Webhook array{webhookKey: string, kind?: string|null, status: string, providerWebhookId?: string|null, connectionKey?: string|null, metadata?: string|null, webhookData?: array<string, mixed>, registeredAt?: string|null, lastError?: string|null, lastErrorAt?: string|null, lastDeliveredAt?: string|null, createdAt: string, updatedAt: string}
 * @phpstan-type WebhookMutation array{success: true, webhookKey: string, providerWebhookId?: string|null, kind?: string|null}
 */
final class Webhooks
{
    public function __construct(private readonly Transport $transport)
    {
    }

    /**
     * Registers a webhook at the provider.
     *
     * @param array<string, mixed> $body
     * @param string|null          $kind
     * @param string|null          $webhookKey Optional; a few words, like "init", are reserved.
     * @param string|null          $metadata   Max 1 KB, echoed as x-saltline-metadata.
     *
     * @return WebhookMutation
     *
     * @throws SaltlineException
     */
    public function register(
        string $provider,
        string $connectionKey,
        array $body = [],
        ?string $kind = null,
        ?string $webhookKey = null,
        ?string $metadata = null,
        ?string $version = null,
        ?string $integrationKey = null,
    ): array {
        /** @var WebhookMutation */
        return $this->transport->json(
            'POST',
            'webhooks/' . Transport::segment($provider),
            [
                ...self::scope($connectionKey, $integrationKey),
                'x-saltline-version' => $version,
                'x-saltline-webhook-kind' => $kind,
                'x-saltline-webhook-key' => $webhookKey,
                'x-saltline-metadata' => $metadata,
            ],
            body: (object) $body,
        );
    }

    /**
     * Lists the connection's webhooks.
     *
     * @return list<Webhook>
     *
     * @throws SaltlineException
     */
    public function list(string $provider, string $connectionKey, ?string $integrationKey = null): array
    {
        $result = $this->transport->json(
            'GET',
            'webhooks/' . Transport::segment($provider),
            self::scope($connectionKey, $integrationKey),
        );

        /** @var list<Webhook> */
        return $result['webhooks'];
    }

    /**
     * Reads one webhook.
     *
     * @return Webhook
     *
     * @throws SaltlineException
     */
    public function get(string $provider, string $webhookKey, string $connectionKey, ?string $integrationKey = null): array
    {
        $result = $this->transport->json(
            'GET',
            'webhooks/' . Transport::segment($provider) . '/' . Transport::segment($webhookKey),
            self::scope($connectionKey, $integrationKey),
        );

        /** @var Webhook */
        return $result['webhook'];
    }

    /**
     * Updates a webhook at the provider.
     *
     * @param array<string, mixed> $body
     *
     * @return WebhookMutation
     *
     * @throws SaltlineException
     */
    public function update(
        string $provider,
        string $webhookKey,
        string $connectionKey,
        array $body = [],
        ?string $version = null,
        ?string $integrationKey = null,
    ): array {
        /** @var WebhookMutation */
        return $this->transport->json(
            'PATCH',
            'webhooks/' . Transport::segment($provider) . '/' . Transport::segment($webhookKey),
            [...self::scope($connectionKey, $integrationKey), 'x-saltline-version' => $version],
            body: (object) $body,
        );
    }

    /**
     * Unregisters a webhook.
     *
     * @return array{success: true, webhookKey: string, providerWebhookId?: string|null}
     *
     * @throws SaltlineException
     */
    public function delete(
        string $provider,
        string $webhookKey,
        string $connectionKey,
        ?string $version = null,
        ?string $integrationKey = null,
    ): array {
        /** @var array{success: true, webhookKey: string, providerWebhookId?: string|null} */
        return $this->transport->json(
            'DELETE',
            'webhooks/' . Transport::segment($provider) . '/' . Transport::segment($webhookKey),
            [...self::scope($connectionKey, $integrationKey), 'x-saltline-version' => $version],
        );
    }

    /**
     * Starts a manual registration. Paste ingressUrl at the provider, finish at setupUrl.
     *
     * @return array{success: true, sessionId: string, webhookKey: string, setupUrl: string, ingressUrl: string, status: 'pending', fields: list<array<string, mixed>>}
     *
     * @throws SaltlineException
     */
    public function initManual(
        string $provider,
        string $connectionKey,
        ?string $redirectUrl = null,
        ?string $integrationKey = null,
    ): array {
        /** @var array{success: true, sessionId: string, webhookKey: string, setupUrl: string, ingressUrl: string, status: 'pending', fields: list<array<string, mixed>>} */
        return $this->transport->json(
            'POST',
            'webhooks/' . Transport::segment($provider) . '/init',
            self::scope($connectionKey, $integrationKey),
            body: $redirectUrl === null ? new \stdClass() : ['redirectUrl' => $redirectUrl],
        );
    }

    /** @return array<string, string|null> */
    private static function scope(string $connectionKey, ?string $integrationKey): array
    {
        return [
            'x-saltline-connection-key' => $connectionKey,
            'x-saltline-integration-key' => $integrationKey,
        ];
    }
}

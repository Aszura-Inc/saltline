<?php

declare(strict_types=1);

namespace Saltline\Resources;

use Saltline\SaltlineException;
use Saltline\Transport;

/** Read-only environment info. */
final class Environment
{
    public function __construct(private readonly Transport $transport)
    {
    }

    /**
     * Lists the environment's integrations.
     *
     * @return list<array<string, mixed>>
     *
     * @throws SaltlineException
     */
    public function integrations(): array
    {
        /** @var list<array<string, mixed>> */
        return $this->transport->json('GET', 'environment/integrations')['integrations'];
    }

    /**
     * Lists providers enabled for sign-in.
     *
     * @return list<array<string, mixed>>
     *
     * @throws SaltlineException
     */
    public function identityProviders(): array
    {
        /** @var list<array<string, mixed>> */
        return $this->transport->json('GET', 'environment/identity-providers')['identityProviders'];
    }
}

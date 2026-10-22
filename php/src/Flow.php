<?php

declare(strict_types=1);

namespace Saltline;

/**
 * The two endpoints @aszura/saltline-browser calls. Build a ConnectFlow or SignInFlow, then:
 *
 *  - start($input, $externalUserId) / finish($input): the work, throwing on failure;
 *  - replyStart() / replyFinish(): the same as ['status' => int, 'body' => array], for any framework;
 *  - serveStart() / serveFinish(): plain PHP, reading php://input and echoing JSON.
 *
 * @phpstan-type ProviderOptions array{auth?: string, integrationKey?: string|null}
 * @phpstan-type Reply array{status: int, body: array<string, mixed>}
 */
abstract class Flow
{
    /** Saltline refusing the claim itself: the browser should start again. */
    private const CLAIM_CODES = ['CONNECTION_NOT_FOUND', 'SESSION_NOT_FOUND', 'CODE_VERIFIER_MISMATCH', 'MISSING_PKCE_PARAMETERS'];

    /** @var array<string, ProviderOptions> */
    private readonly array $providers;

    /**
     * @param list<string>|array<string, ProviderOptions> $providers   Allowlist, optionally with per-provider options.
     * @param string|\Closure(string): string             $redirectUrl Where Saltline sends the user back, or a function of the provider.
     * @param 'light'|'dark'|null                         $theme
     */
    public function __construct(
        array $providers,
        private readonly string|\Closure $redirectUrl,
        private readonly ?string $theme = null,
    ) {
        $map = [];
        foreach ($providers as $name => $options) {
            if (is_int($name)) {
                [$name, $options] = [$options, []];
            }
            if (!is_string($name) || $name === '' || !is_array($options)) {
                throw new \InvalidArgumentException('Saltline: $providers must be provider names, or names mapped to options.');
            }
            $map[$name] = $options;
        }
        if ($map === []) {
            throw new \InvalidArgumentException('Saltline: $providers must name at least one provider.');
        }
        $this->providers = $map;
    }

    /**
     * The allowlist, for rendering your buttons.
     *
     * @return list<string>
     */
    public function providers(): array
    {
        return array_keys($this->providers);
    }

    /**
     * Handles the browser's start payload {provider, codeChallenge, codeChallengeMethod} and returns
     * the JSON to answer.
     *
     * @return array<string, mixed>
     *
     * @throws FlowInputException|SaltlineException
     */
    public function start(mixed $input, ?string $externalUserId = null): array
    {
        $in = self::record($input);
        $provider = $this->provider($in);
        $challenge = self::text($in, 'codeChallenge');
        if (($in['codeChallengeMethod'] ?? null) !== 'S256') {
            throw new FlowInputException('codeChallengeMethod must be S256.', 'INVALID_INPUT');
        }

        return $this->init($provider, $this->providers[$provider], $challenge, $externalUserId);
    }

    /**
     * Handles the browser's finish payload {provider, connectionKey|sessionKey, codeVerifier} and
     * claims it. Store the result against your user, then answer whatever JSON you like.
     *
     * @return array<string, mixed>
     *
     * @throws FlowInputException|SaltlineException
     */
    public function finish(mixed $input): array
    {
        $in = self::record($input);
        $provider = $this->provider($in);
        $key = self::text($in, $this->keyField());
        $codeVerifier = self::text($in, 'codeVerifier');

        return $this->claim($provider, $key, $codeVerifier);
    }

    /**
     * start() as a status and body. Known failures become 400 (bad input, or a claim Saltline
     * refused, with Saltline's code) or 502 (any other Saltline error); anything else throws.
     *
     * @return Reply
     */
    public function replyStart(mixed $input, ?string $externalUserId = null): array
    {
        return $this->reply(fn (): array => $this->start($input, $externalUserId));
    }

    /**
     * finish() as a status and body. $onClaimed gets the claim result and returns the JSON to
     * answer (null answers ['ok' => true]).
     *
     * @param callable(array<string, mixed>): (array<string, mixed>|null) $onClaimed
     *
     * @return Reply
     */
    public function replyFinish(mixed $input, callable $onClaimed): array
    {
        return $this->reply(fn (): ?array => $onClaimed($this->finish($input)));
    }

    /** Plain PHP: reads the JSON request body, answers with status, header and JSON. */
    public function serveStart(?string $externalUserId = null, ?string $rawInput = null): void
    {
        self::emit($this->replyStart(self::decode($rawInput), $externalUserId));
    }

    /**
     * Plain PHP: reads the JSON request body, claims, answers with what $onClaimed returns.
     *
     * @param callable(array<string, mixed>): (array<string, mixed>|null) $onClaimed
     */
    public function serveFinish(callable $onClaimed, ?string $rawInput = null): void
    {
        self::emit($this->replyFinish(self::decode($rawInput), $onClaimed));
    }

    /**
     * A failure the flow knows about as a reply; null for anything else.
     *
     * @return Reply|null
     */
    public static function errorReply(\Throwable $error): ?array
    {
        if ($error instanceof FlowInputException) {
            return ['status' => 400, 'body' => ['code' => $error->errorCode, 'error' => $error->getMessage()]];
        }
        if ($error instanceof SaltlineException) {
            return [
                'status' => in_array($error->errorCode, self::CLAIM_CODES, true) ? 400 : 502,
                'body' => ['code' => $error->errorCode, 'error' => $error->getMessage(), 'requestId' => $error->requestId],
            ];
        }

        return null;
    }

    /** @return 'connectionKey'|'sessionKey' */
    abstract protected function keyField(): string;

    /**
     * @param ProviderOptions $options
     *
     * @return array<string, mixed>
     */
    abstract protected function init(string $provider, array $options, string $codeChallenge, ?string $externalUserId): array;

    /** @return array<string, mixed> */
    abstract protected function claim(string $provider, string $key, string $codeVerifier): array;

    protected function redirectUrl(string $provider): string
    {
        return is_string($this->redirectUrl) ? $this->redirectUrl : ($this->redirectUrl)($provider);
    }

    /** @return array{theme?: string} */
    protected function themeField(): array
    {
        return $this->theme === null ? [] : ['theme' => $this->theme];
    }

    /**
     * @param callable(): (array<string, mixed>|null) $run
     *
     * @return Reply
     */
    private function reply(callable $run): array
    {
        try {
            return ['status' => 200, 'body' => $run() ?? ['ok' => true]];
        } catch (\Throwable $error) {
            return self::errorReply($error) ?? throw $error;
        }
    }

    /** @param array<string, mixed> $in */
    private function provider(array $in): string
    {
        $provider = $in['provider'] ?? null;
        if (!is_string($provider) || !isset($this->providers[$provider])) {
            throw new FlowInputException('provider is not one this flow allows.', 'UNKNOWN_PROVIDER');
        }

        return $provider;
    }

    /** @return array<string, mixed> */
    private static function record(mixed $input): array
    {
        if (!is_array($input) || ($input !== [] && array_is_list($input))) {
            throw new FlowInputException('Send a JSON object.', 'INVALID_INPUT');
        }

        /** @var array<string, mixed> $input */
        return $input;
    }

    /** @param array<string, mixed> $in */
    private static function text(array $in, string $field): string
    {
        $value = $in[$field] ?? null;
        if (!is_string($value) || $value === '') {
            throw new FlowInputException("{$field} must be a non-empty string.", 'INVALID_INPUT');
        }

        return $value;
    }

    private static function decode(?string $raw): mixed
    {
        try {
            return json_decode($raw ?? (string) file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }
    }

    /** @param Reply $reply */
    private static function emit(array $reply): void
    {
        http_response_code($reply['status']);
        header('Content-Type: application/json');
        echo json_encode($reply['body'], JSON_THROW_ON_ERROR);
    }
}

<?php

declare(strict_types=1);

namespace Saltline\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Saltline\SaltlineException;
use Saltline\Signature;

/** Shared fixtures in ../../tests/fixtures; the Node SDK runs the same cases. */
final class FixturesTest extends TestCase
{
    /** @return array<string, mixed> */
    private static function fixture(string $name): array
    {
        return json_decode(
            (string) file_get_contents(__DIR__ . '/../../tests/fixtures/' . $name),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
    }

    /** @return iterable<string, array{array<string, mixed>, int}> */
    public static function signatureCases(): iterable
    {
        $fixture = self::fixture('signatures.json');
        foreach ($fixture['cases'] as $case) {
            yield $case['name'] => [$case, $fixture['toleranceSeconds']];
        }
    }

    /** @param array<string, mixed> $case */
    #[DataProvider('signatureCases')]
    public function testSignature(array $case, int $tolerance): void
    {
        $result = Signature::verify(
            $case['body'],
            $case['timestamp'],
            $case['signature'],
            $case['secrets'],
            $tolerance,
            new \DateTimeImmutable($case['now']),
        );

        self::assertSame($case['valid'], $result);
    }

    public function testVerifyWebhookReadsHeadersCaseInsensitively(): void
    {
        $valid = self::fixture('signatures.json')['cases'][0];

        self::assertTrue(Signature::verifyWebhook(
            ['X-Saltline-Timestamp' => $valid['timestamp'], 'x-saltline-hmac-256' => [$valid['signature']]],
            $valid['body'],
            $valid['secrets'],
            now: new \DateTimeImmutable($valid['now']),
        ));
    }

    public function testMalformedSecretFailsClosed(): void
    {
        $valid = self::fixture('signatures.json')['cases'][0];

        self::assertFalse(Signature::verify(
            $valid['body'],
            $valid['timestamp'],
            $valid['signature'],
            '%%%not-base64',
            now: new \DateTimeImmutable($valid['now']),
        ));
    }

    /** @return iterable<string, array{array<string, mixed>}> */
    public static function errorCases(): iterable
    {
        foreach (self::fixture('errors.json')['cases'] as $case) {
            yield $case['name'] => [$case];
        }
    }

    /** @param array<string, mixed> $case */
    #[DataProvider('errorCases')]
    public function testError(array $case): void
    {
        $error = SaltlineException::fromParts($case['status'], $case['headers'], $case['body']);

        self::assertSame($case['expected']['status'], $error->status);
        self::assertSame($case['expected']['code'], $error->errorCode);
        self::assertSame($case['expected']['message'], $error->getMessage());
        self::assertSame($case['expected']['requestId'], $error->requestId);
    }
}

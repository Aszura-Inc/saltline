<?php

declare(strict_types=1);

namespace Saltline;

/** @internal Case-insensitive header lookup. */
final class Headers
{
    /** @param array<string, string|list<string>|null> $headers */
    public static function get(array $headers, string $name): ?string
    {
        foreach ($headers as $key => $value) {
            if (strcasecmp((string) $key, $name) !== 0) {
                continue;
            }
            if (is_array($value)) {
                $value = $value[0] ?? null;
            }

            return is_string($value) ? $value : null;
        }

        return null;
    }
}

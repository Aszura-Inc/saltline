<?php

declare(strict_types=1);

namespace Saltline;

/** The browser sent something the flow can't use. Answer 400. */
final class FlowInputException extends \InvalidArgumentException
{
    public readonly int $status;

    /** @param 'UNKNOWN_PROVIDER'|'INVALID_INPUT' $errorCode */
    public function __construct(string $message, public readonly string $errorCode)
    {
        parent::__construct($message, 400);
        $this->status = 400;
    }
}

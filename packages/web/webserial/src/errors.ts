import { DOMException } from '@gjsify/dom-exception';

export type SerialErrorName =
    | 'InvalidStateError'
    | 'NetworkError'
    | 'NotFoundError'
    | 'NotSupportedError'
    | 'SecurityError';

export function serialError(name: SerialErrorName, message: string, cause?: unknown): DOMException {
    const error = new DOMException(message, name);
    if (cause !== undefined) (error as { cause?: unknown }).cause = cause;
    return error;
}

/** A driver error becomes a DOMException; one already shaped like that passes through. */
export function asNetworkError(message: string, cause: unknown): DOMException {
    if (cause instanceof DOMException) return cause;
    const detail = cause instanceof Error ? cause.message : String(cause);
    return serialError('NetworkError', detail ? `${message} ${detail}` : message, cause);
}

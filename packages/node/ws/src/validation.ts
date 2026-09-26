// close() argument checks shared by the client and the server-side socket.
// Reference: refs/ws/lib/validation.js (isValidStatusCode) and
// refs/ws/lib/sender.js (Sender#close) — same rules, same errors.

import { Buffer } from '@gjsify/buffer';

/** The status codes ws lets an endpoint send: RFC 6455's defined codes minus
 *  the three that must never go on the wire (1004 reserved, 1005/1006
 *  local-only), plus the registered and private ranges. */
export function isValidStatusCode(code: number): boolean {
    return (
        (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ||
        (code >= 3000 && code <= 4999)
    );
}

/** Validate close(code, reason) the way ws does before anything is sent, and
 *  return the reason as a string. ws throws these to the caller of close();
 *  Soup would instead log a CRITICAL for 1005/1006 and send nothing. */
export function closeReason(code: unknown, reason: string | Buffer | undefined): string | undefined {
    if (code !== undefined && (typeof code !== 'number' || !isValidStatusCode(code))) {
        throw new TypeError('First argument must be a valid error code number');
    }
    if (reason === undefined) return undefined;
    const text = Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason);
    if (Buffer.byteLength(text) > 123) {
        throw new RangeError('The message must not be greater than 123 bytes');
    }
    return text;
}

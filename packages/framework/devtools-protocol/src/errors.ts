// @gjsify/devtools-protocol — typed error codes for the devtools envelope.
// Original implementation.

/**
 * Typed error codes carried in the devtools JSON envelope. The string code
 * travels over every transport (a DBus error-name suffix, a WS JSON
 * `error.code`) so the MCP bridge can map a failure to a clear, actionable
 * tool result.
 *
 * Convention: a method handler signals a typed failure by throwing a
 * {@link DevtoolsError} whose `code` is one of these; transports serialise
 * `code` + `message` and the bridge re-surfaces them verbatim.
 */
export type DevtoolsErrorCode =
    | 'paused' // a mutating call arrived while the host paused external control
    | 'human-only' // the call targets a human-only safety switch
    | 'unavailable' // cannot act (no window/engine, empty stack, …)
    | 'not-found' // unknown method, action, widget path, …
    | 'unsupported' // value/type not marshalable, capability absent
    | 'invalid-params' // malformed parameters
    | 'internal'; // unexpected failure

/** A failure a devtools method handler can throw to carry a typed code. */
export class DevtoolsError extends Error {
    override readonly name = 'DevtoolsError';
    readonly code: DevtoolsErrorCode;
    readonly data?: unknown;

    constructor(code: DevtoolsErrorCode, message: string, data?: unknown) {
        super(message);
        this.code = code;
        this.data = data;
    }
}

/** Narrow an unknown thrown value to the envelope's error payload shape. */
export function toErrorPayload(err: unknown): { code: DevtoolsErrorCode; message: string; data?: unknown } {
    if (err instanceof DevtoolsError) return { code: err.code, message: err.message, data: err.data };
    const message = err instanceof Error ? err.message : String(err);
    return { code: 'internal', message };
}

const ERROR_CODES: readonly DevtoolsErrorCode[] = [
    'paused',
    'human-only',
    'unavailable',
    'not-found',
    'unsupported',
    'invalid-params',
    'internal',
];

/**
 * Encode a code into an error message as a `"<code>: <message>"` prefix.
 * DBus carries only the message string of a thrown error, so the in-app DBus
 * adapter prefixes the code this way and the bridge recovers it with
 * {@link parseDbusErrorMessage} — the typed code survives the wire.
 */
export function formatDbusErrorMessage(code: DevtoolsErrorCode, message: string): string {
    return `${code}: ${message}`;
}

/** Recover a `{ code, message }` from a `"<code>: <message>"` DBus error string. */
export function parseDbusErrorMessage(raw: string): { code: DevtoolsErrorCode; message: string } {
    const idx = raw.indexOf(': ');
    if (idx > 0) {
        const maybe = raw.slice(0, idx);
        if ((ERROR_CODES as readonly string[]).includes(maybe)) {
            return { code: maybe as DevtoolsErrorCode, message: raw.slice(idx + 2) };
        }
    }
    return { code: 'internal', message: raw };
}

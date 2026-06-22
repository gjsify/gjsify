// @gjsify/devtools-protocol — the request/response envelope crossing any transport.
// Original implementation.

import type { DevtoolsErrorCode } from './errors.js';

/** A request crossing any devtools transport. JSON-serialisable. */
export interface DevtoolsRequest {
    /** Method/command name, e.g. "GetStatus", "ActivateAction". */
    method: string;
    /** Method parameters (method-specific). */
    params?: Record<string, unknown>;
    /** Correlation id for stream transports (WebSocket); DBus call/return ignores it. */
    id?: string | number;
}

export interface DevtoolsResponseOk {
    ok: true;
    result: unknown;
    id?: string | number;
}

export interface DevtoolsResponseErr {
    ok: false;
    error: { code: DevtoolsErrorCode; message: string; data?: unknown };
    id?: string | number;
}

export type DevtoolsResponse = DevtoolsResponseOk | DevtoolsResponseErr;

export function okResponse(result: unknown, id?: string | number): DevtoolsResponseOk {
    return { ok: true, result, id };
}

export function errResponse(error: DevtoolsResponseErr['error'], id?: string | number): DevtoolsResponseErr {
    return { ok: false, error, id };
}

// @gjsify/devtools-protocol — transport-agnostic method registry + pause-policy dispatcher.
// Original implementation.

import { errResponse, okResponse } from './envelope.js';
import type { DevtoolsRequest, DevtoolsResponse } from './envelope.js';
import { toErrorPayload } from './errors.js';
import type { MethodKind } from './methods.js';

export interface MethodEntry {
    /** Method name (unique within a registry). */
    name: string;
    /** Pause classification. */
    kind: MethodKind;
    /** Handler — receives params (defaulted to `{}`), returns the result value. */
    handler: (params: Record<string, unknown>) => unknown | Promise<unknown>;
}

export interface DispatchOptions {
    /** When true, `mutating` methods are rejected with a `paused` error. */
    paused?: boolean;
}

/**
 * Transport-agnostic method registry + policy dispatcher. The in-app
 * adapters (DBus / WebSocket) register handlers here and route inbound
 * requests through {@link dispatch}; the pause policy and the
 * unclassified-method guard live here so every transport enforces them
 * identically. Pure TS — unit-tested on Node + GJS.
 */
export class MethodRegistry {
    private readonly _methods = new Map<string, MethodEntry>();

    register(entry: MethodEntry): void {
        if (this._methods.has(entry.name)) {
            throw new Error(`Devtools method '${entry.name}' is already registered`);
        }
        this._methods.set(entry.name, entry);
    }

    has(name: string): boolean {
        return this._methods.has(name);
    }

    list(): { name: string; kind: MethodKind }[] {
        return [...this._methods.values()].map(({ name, kind }) => ({ name, kind }));
    }

    /** Dispatch a request through the pause policy. Never throws — failures become error responses. */
    async dispatch(req: DevtoolsRequest, opts: DispatchOptions = {}): Promise<DevtoolsResponse> {
        const entry = this._methods.get(req.method);
        if (!entry) {
            return errResponse({ code: 'not-found', message: `unknown devtools method '${req.method}'` }, req.id);
        }
        if (opts.paused && entry.kind === 'mutating') {
            return errResponse(
                {
                    code: 'paused',
                    message: `${req.method} rejected — external control is paused. Read-only methods keep working.`,
                },
                req.id,
            );
        }
        try {
            const result = await entry.handler(req.params ?? {});
            return okResponse(result, req.id);
        } catch (err) {
            return errResponse(toErrorPayload(err), req.id);
        }
    }
}

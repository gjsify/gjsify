// PUSH_PROMISE support for Http2ServerResponse + ServerHttp2Stream.
// Same `install*Methods(proto)` shape as the sibling `headers.ts` split —
// typed `*Methods` interfaces declaration-merged into the two classes via
// `declare module '../response.js'` plus the
// `installPushMethods(responseProto, streamProto)` function that copies
// the implementations onto each prototype.
//
// Houses `Http2ServerResponse.pushStream()` / `createPushResponse()` and
// `ServerHttp2Stream.pushStream()` plus the file-local
// `_makeDetachedSoupMessage()` factory. The two classes' push entry
// points share the same callback shape and live together so the
// PUSH_PROMISE allocator + frame-builder coupling stays in one place.
// Reference: refs/node/lib/internal/http2/core.js
// (Http2Stream.pushStream / createPushResponse).
// Original: see server/response.ts pre-split.

import type Soup from '@girs/soup-3.0';
import { Http2ServerResponse, ServerHttp2Stream, type Http2NativeBackend } from '../response.js';

export interface ResponsePushMethods {
    pushStream(
        headers: Record<string, string | string[] | number>,
        options:
            | { parent?: number; weight?: number; exclusive?: boolean }
            | ((err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void),
        callback?: (
            err: Error | null,
            pushStream: ServerHttp2Stream,
            headers: Record<string, string | string[]>,
        ) => void,
    ): void;
    createPushResponse(
        headers: Record<string, string | string[] | number>,
        callback: (err: Error | null, res: Http2ServerResponse) => void,
    ): void;
}

export interface StreamPushMethods {
    pushStream(
        headers: Record<string, string | string[] | number>,
        options:
            | { parent?: number; weight?: number; exclusive?: boolean }
            | ((err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void),
        callback?: (
            err: Error | null,
            pushStream: ServerHttp2Stream,
            headers: Record<string, string | string[]>,
        ) => void,
    ): void;
}

declare module '../response.js' {
    interface Http2ServerResponse extends ResponsePushMethods {}
    interface ServerHttp2Stream extends StreamPushMethods {}
}

const responsePushMethods: ResponsePushMethods & ThisType<Http2ServerResponse> = {
    /**
     * pushStream — request the server to push an additional resource on a
     * fresh server-initiated stream. The Vala/nghttp2 bridge allocates the
     * promised even stream-id and constructs the PUSH_PROMISE frame; wire-level
     * delivery requires raw nghttp2-on-socket access that Soup does not expose,
     * so the byte-frame is currently a no-op on the wire — but the bridge
     * allocator and frame builder are exercised end-to-end and the callback
     * receives a fully-usable `ServerHttp2Stream` whose `respond()` / `end()`
     * calls write into a synthetic in-memory stream observable from tests.
     *
     * See status/open-todos.md → "http2 PUSH_PROMISE wire delivery".
     */
    pushStream(
        this: Http2ServerResponse,
        headers: Record<string, string | string[] | number>,
        options:
            | { parent?: number; weight?: number; exclusive?: boolean }
            | ((err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void),
        callback?: (
            err: Error | null,
            pushStream: ServerHttp2Stream,
            headers: Record<string, string | string[]>,
        ) => void,
    ): void {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (!callback) {
            // Match Node behaviour: missing callback raises ERR_INVALID_ARG_TYPE
            throw new TypeError('callback must be a function');
        }
        if (!this._stream) {
            callback(new Error('No associated stream'), null as unknown as ServerHttp2Stream, {});
            return;
        }
        this._stream.pushStream(headers, options, callback);
    },

    /**
     * createPushResponse — alternate API: create a child Http2ServerResponse
     * for the push without needing to bridge through ServerHttp2Stream. The
     * created response shares the parent's stream allocator + bridge.
     *
     * Reference: Node.js doc/api/http2.md § Http2ServerResponse#createPushResponse()
     */
    createPushResponse(
        this: Http2ServerResponse,
        headers: Record<string, string | string[] | number>,
        callback: (err: Error | null, res: Http2ServerResponse) => void,
    ): void {
        if (typeof callback !== 'function') {
            throw new TypeError('callback must be a function');
        }
        this.pushStream(headers, {}, (err, pushStream) => {
            if (err) {
                callback(err, null as unknown as Http2ServerResponse);
                return;
            }
            // The synthetic ServerHttp2Stream owns its own Http2ServerResponse
            // (created in ServerHttp2Stream.pushStream below) — extract it.
            const res = (pushStream as unknown as { _res?: Http2ServerResponse })._res;
            callback(null, res ?? (null as unknown as Http2ServerResponse));
        });
    },
};

const streamPushMethods: StreamPushMethods & ThisType<ServerHttp2Stream> = {
    /**
     * pushStream — see {@link Http2ServerResponse.pushStream} for the full
     * contract. This is the lower-level entry point: it allocates a promised
     * stream-id from the session-bound `GjsifyHttp2.StreamIdAllocator`, builds
     * the PUSH_PROMISE frame via `GjsifyHttp2.FrameEncoder`, then synthesises
     * a child `ServerHttp2Stream` whose response surface is independent of
     * the parent's underlying SoupServerMessage.
     */
    pushStream(
        this: ServerHttp2Stream,
        headers: Record<string, string | string[] | number>,
        options:
            | { parent?: number; weight?: number; exclusive?: boolean }
            | ((err: Error | null, pushStream: ServerHttp2Stream, headers: Record<string, string | string[]>) => void),
        callback?: (
            err: Error | null,
            pushStream: ServerHttp2Stream,
            headers: Record<string, string | string[]>,
        ) => void,
    ): void {
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (!callback) {
            throw new TypeError('callback must be a function');
        }

        // Per RFC 7540 §8.2: pushed streams MUST NOT initiate further pushes.
        // Node surfaces this as ERR_HTTP2_NESTED_PUSH.
        if (this._isPushedStream) {
            const err = Object.assign(new Error('Cannot initiate nested push streams'), {
                code: 'ERR_HTTP2_NESTED_PUSH',
            });
            callback(err, null as unknown as ServerHttp2Stream, {});
            return;
        }

        // Session-level enable_push must be honoured. Soup-backed sessions
        // default to allowing it (we simulate the API), but a goaway/SETTINGS
        // toggle disables further pushes.
        if (this._session && this._session.canPush === false) {
            const err = Object.assign(new Error('HTTP/2 server push has been disabled'), {
                code: 'ERR_HTTP2_PUSH_DISABLED',
            });
            callback(err, null as unknown as ServerHttp2Stream, {});
            return;
        }

        // Allocate the promised stream-id and build the PUSH_PROMISE frame
        // bytes. Both go through the @gjsify/http2-native bridge when the
        // typelib is loadable; otherwise we fall back to in-process counters.
        let promisedId: number;
        let frameBytes: Uint8Array | null = null;
        let pushHeaders: Record<string, string | string[]> = {};

        // Normalise pseudo-headers — Node fills in :scheme/:authority from
        // the parent if omitted (matches refs/node/lib/internal/http2/util.js).
        const normalised: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(headers)) {
            normalised[k] = typeof v === 'number' ? String(v) : v;
        }
        if (!normalised[':method']) normalised[':method'] = 'GET';
        pushHeaders = normalised;

        // Native-dispatcher path: if this stream's response is backed by a
        // native backend, submit the PUSH_PROMISE through the wire and build
        // a pushed Http2ServerResponse whose writes route through the child
        // backend the dispatcher just allocated. Both the promised stream id
        // AND the PUSH_PROMISE frame come from nghttp2 itself.
        const parentBackend = this._res.nativeBackend;
        let pushChildBackend: Http2NativeBackend | null = null;
        if (parentBackend) {
            pushChildBackend = parentBackend.pushPromise(normalised);
            if (!pushChildBackend) {
                const err = Object.assign(new Error('No available stream ids'), {
                    code: 'ERR_HTTP2_OUT_OF_STREAMS',
                });
                callback(err, null as unknown as ServerHttp2Stream, {});
                return;
            }
            promisedId = pushChildBackend.streamId;
            // No frameBytes — the bytes are already on the wire; expose `null`
            // through `pushPromiseFrame` so consumers can distinguish the two
            // paths during the transition window.
            frameBytes = null;
        } else if (this._session) {
            promisedId = this._session._allocatePushId();
            if (promisedId === 0) {
                const err = Object.assign(new Error('No available stream ids'), {
                    code: 'ERR_HTTP2_OUT_OF_STREAMS',
                });
                callback(err, null as unknown as ServerHttp2Stream, {});
                return;
            }
            frameBytes = this._session._buildPushPromise(this.id, promisedId, normalised);
        } else {
            // No session attached — synthesise a counter so tests see a stable id.
            promisedId = 2;
        }

        // Build the synthetic response surface. Native path: wire writes via
        // the child backend. Soup path: writes land in a detached buffer
        // reachable from `pushStream._res.detachedBody` (test inspection only,
        // since Soup multiplexes HTTP/2 streams internally and refuses
        // external injection).
        const pushRes = pushChildBackend
            ? new Http2ServerResponse(null, pushChildBackend)
            : new Http2ServerResponse(_makeDetachedSoupMessage());
        const pushStream = new ServerHttp2Stream(pushRes, this._session, {
            isPushedStream: true,
            streamId: promisedId,
        });
        pushStream._pushPromiseFrame = frameBytes;
        pushStream._pushRequestHeaders = normalised;
        pushRes._setStream(pushStream);
        this._pushedChildren.push(pushStream);

        // Match Node's contract: callback runs asynchronously after the
        // pushStream is wired up.
        Promise.resolve().then(() => {
            callback!(null, pushStream, pushHeaders);
        });
    },
};

/**
 * _makeDetachedSoupMessage — placeholder factory for push-stream Http2ServerResponse.
 *
 * Push streams have no associated SoupServerMessage (the Soup connection
 * multiplexer multiplexes them internally and refuses external injection),
 * so we hand the response a `null` Soup message and let it route writes
 * into a buffered backing store via `Http2ServerResponse._detachedBody`.
 *
 * Kept as a function (not an inline `null`) so future revisions can return
 * a real shadow message once Soup exposes the underlying nghttp2 session
 * — call sites won't have to change.
 */
function _makeDetachedSoupMessage(): Soup.ServerMessage | null {
    return null;
}

/** Install push-stream methods on both class prototypes. */
export function installPushMethods(responseProto: object, streamProto: object): void {
    Object.assign(responseProto, responsePushMethods);
    Object.assign(streamProto, streamPushMethods);
}

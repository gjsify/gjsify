// InspectorProtocolClient — a JSON-RPC client for the WebKit Remote Inspector
// Protocol (the CDP-shaped protocol WebKitGTK speaks over a per-target
// WebSocket). It correlates request ids to responses, fans pushed events out to
// listeners + a bounded ring buffer (so a stateless MCP bridge can poll them),
// and exposes `enableDomains()` for the usual Inspector/Runtime/DOM/Console
// bootstrap.
//
// It is written against a minimal {@link WebSocketLike} surface (the W3C subset
// `@gjsify/websocket` and browsers both provide) + an injectable factory, so the
// whole protocol layer is unit-testable headless with a mock socket — no real
// libsoup connection, no running inspector. The app wiring (set
// `WEBKIT_INSPECTOR_HTTP_SERVER`, default the factory to the global `WebSocket`)
// lands in a later phase; this module stays transport-pure.

/** The minimal WebSocket surface the client uses (W3C `WebSocket` subset). */
export interface WebSocketLike {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    /** W3C ready states: 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED. */
    readyState: number;
    addEventListener(type: 'open', listener: () => void): void;
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    addEventListener(type: 'close', listener: (event: { code?: number; reason?: string }) => void): void;
    addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

/** Builds a {@link WebSocketLike} for a `ws://…` URL. Defaults to the global `WebSocket`. */
export type WebSocketFactory = (url: string) => WebSocketLike;

/** A pushed protocol event (`{method, params}` with no `id`). */
export interface ProtocolEvent {
    method: string;
    params: unknown;
}

/** A protocol error as surfaced to the caller (from `{error:{code,message}}` or `{error:"…"}`). */
export class ProtocolError extends Error {
    readonly code?: number;
    constructor(message: string, code?: number) {
        super(message);
        this.name = 'ProtocolError';
        this.code = code;
    }
}

/** A per-method event listener; receives the event's `params`. */
export type ProtocolEventListener = (params: unknown) => void;

export interface InspectorProtocolClientOptions {
    /** WebSocket factory (default: `globalThis.WebSocket`). Inject a mock for tests. */
    createWebSocket?: WebSocketFactory;
    /** Max events retained in the drain ring buffer; oldest dropped past this. Default 1000. */
    maxBufferedEvents?: number;
    /** Default per-request timeout in ms (0 disables). Default 30000. */
    requestTimeoutMs?: number;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

interface RawMessage {
    id?: number;
    result?: unknown;
    error?: { code?: number; message?: string } | string;
    method?: string;
    params?: unknown;
}

const DEFAULT_MAX_BUFFERED = 1000;
const DEFAULT_REQUEST_TIMEOUT = 30000;

function defaultFactory(url: string): WebSocketLike {
    const ctor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
    if (!ctor) {
        throw new Error(
            'InspectorProtocolClient: no global WebSocket — pass options.createWebSocket (GJS: register @gjsify/websocket)',
        );
    }
    return new ctor(url);
}

/**
 * Connect to a single inspector target's WebSocket and drive its JSON-RPC
 * protocol. One client == one WS == one target (WebKit has no session
 * multiplexing — see {@link discoverInspectorTargets}).
 */
export class InspectorProtocolClient {
    private readonly url: string;
    private readonly factory: WebSocketFactory;
    private readonly maxBuffered: number;
    private readonly requestTimeoutMs: number;

    private ws: WebSocketLike | null = null;
    private nextId = 1;
    private readonly pending = new Map<number, PendingRequest>();
    private readonly listeners = new Map<string, Set<ProtocolEventListener>>();
    private readonly eventBuffer: ProtocolEvent[] = [];
    private connectPromise: Promise<void> | null = null;
    private closed = false;

    constructor(url: string, options: InspectorProtocolClientOptions = {}) {
        this.url = url;
        this.factory = options.createWebSocket ?? defaultFactory;
        this.maxBuffered = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;
    }

    /** True once the socket is OPEN and not yet closed. */
    get connected(): boolean {
        return !this.closed && this.ws !== null && this.ws.readyState === 1;
    }

    /** Open the WebSocket; resolves on `open`, rejects on `error`/`close` before open. Idempotent. */
    connect(): Promise<void> {
        if (this.connectPromise) return this.connectPromise;
        this.connectPromise = new Promise<void>((resolve, reject) => {
            let settled = false;
            const ws = this.factory(this.url);
            this.ws = ws;
            ws.addEventListener('open', () => {
                settled = true;
                resolve();
            });
            ws.addEventListener('message', (event) => this.onMessage(event.data));
            ws.addEventListener('error', (event) => {
                if (!settled) {
                    settled = true;
                    reject(new Error(`InspectorProtocolClient: WebSocket error before open (${this.url})`));
                }
                this.failAllPending(event);
            });
            ws.addEventListener('close', (event) => {
                if (!settled) {
                    settled = true;
                    reject(
                        new Error(`InspectorProtocolClient: WebSocket closed before open (code ${event.code ?? '?'})`),
                    );
                }
                this.onClose();
            });
        });
        return this.connectPromise;
    }

    /**
     * Send a `Domain.command` and resolve with its `result` (rejects with a
     * {@link ProtocolError} on a protocol `error`, or a timeout error).
     */
    send(method: string, params?: Record<string, unknown>): Promise<unknown> {
        if (this.closed) return Promise.reject(new Error('InspectorProtocolClient: client is closed'));
        if (!this.ws) return Promise.reject(new Error('InspectorProtocolClient: connect() not called'));
        const id = this.nextId++;
        const payload = JSON.stringify(params === undefined ? { id, method } : { id, method, params });
        return new Promise<unknown>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            if (this.requestTimeoutMs > 0) {
                timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(
                        new Error(`InspectorProtocolClient: "${method}" timed out after ${this.requestTimeoutMs}ms`),
                    );
                }, this.requestTimeoutMs);
            }
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.ws!.send(payload);
            } catch (error) {
                this.pending.delete(id);
                if (timer) clearTimeout(timer);
                reject(error);
            }
        });
    }

    /** Subscribe to a `Domain.event`; returns an unsubscribe function. */
    on(method: string, listener: ProtocolEventListener): () => void {
        let set = this.listeners.get(method);
        if (!set) {
            set = new Set();
            this.listeners.set(method, set);
        }
        set.add(listener);
        return () => this.off(method, listener);
    }

    /** Remove a previously-registered event listener. */
    off(method: string, listener: ProtocolEventListener): void {
        this.listeners.get(method)?.delete(listener);
    }

    /** Resolve with the params of the next matching `method` event (optionally filtered). */
    awaitEvent(
        method: string,
        predicate?: (params: unknown) => boolean,
        timeoutMs = this.requestTimeoutMs,
    ): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            const off = this.on(method, (params) => {
                if (predicate && !predicate(params)) return;
                if (timer) clearTimeout(timer);
                off();
                resolve(params);
            });
            if (timeoutMs > 0) {
                timer = setTimeout(() => {
                    off();
                    reject(
                        new Error(`InspectorProtocolClient: awaitEvent("${method}") timed out after ${timeoutMs}ms`),
                    );
                }, timeoutMs);
            }
        });
    }

    /** Send `<Domain>.enable` for each domain (sequentially), tolerating domains with no `enable`. */
    async enableDomains(domains: readonly string[]): Promise<void> {
        for (const domain of domains) {
            try {
                await this.send(`${domain}.enable`);
            } catch {
                // Some domains have no enable() (or are already enabled) — non-fatal.
            }
        }
    }

    /** Return all buffered events and clear the ring buffer (the poll for stateless transports). */
    drainEvents(): ProtocolEvent[] {
        const events = this.eventBuffer.slice();
        this.eventBuffer.length = 0;
        return events;
    }

    /** Close the socket and reject every in-flight request. */
    close(): void {
        if (this.closed) return;
        this.closed = true;
        try {
            this.ws?.close();
        } catch {
            /* already closed */
        }
        this.onClose();
    }

    private onMessage(data: unknown): void {
        let msg: RawMessage;
        try {
            msg = JSON.parse(typeof data === 'string' ? data : String(data)) as RawMessage;
        } catch {
            return; // ignore non-JSON frames
        }
        if (typeof msg.id === 'number') {
            const pending = this.pending.get(msg.id);
            if (!pending) return;
            this.pending.delete(msg.id);
            if (pending.timer) clearTimeout(pending.timer);
            if (msg.error !== undefined) {
                const { message, code } = normalizeError(msg.error);
                pending.reject(new ProtocolError(message, code));
            } else {
                pending.resolve(msg.result);
            }
            return;
        }
        if (typeof msg.method === 'string') {
            const event: ProtocolEvent = { method: msg.method, params: msg.params };
            this.eventBuffer.push(event);
            if (this.eventBuffer.length > this.maxBuffered) this.eventBuffer.shift();
            const set = this.listeners.get(msg.method);
            // Snapshot the set so a listener that unsubscribes (e.g. awaitEvent) during
            // dispatch doesn't disturb iteration, and a listener added mid-dispatch isn't
            // invoked for the current event.
            if (set) for (const listener of Array.from(set)) listener(msg.params);
        }
    }

    private onClose(): void {
        this.failAllPending(new Error('InspectorProtocolClient: connection closed'));
    }

    private failAllPending(reason: unknown): void {
        for (const [, pending] of this.pending) {
            if (pending.timer) clearTimeout(pending.timer);
            pending.reject(reason instanceof Error ? reason : new Error('InspectorProtocolClient: socket error'));
        }
        this.pending.clear();
    }
}

function normalizeError(error: { code?: number; message?: string } | string): { message: string; code?: number } {
    if (typeof error === 'string') return { message: error };
    return { message: error.message ?? 'protocol error', code: error.code };
}

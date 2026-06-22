// @gjsify/devtools-protocol — the transport seam (DBus / WebSocket adapters implement these).
// Original implementation.

import type { DevtoolsRequest, DevtoolsResponse } from './envelope.js';

/** Handles an inbound request on the app (server) side. */
export type DevtoolsHandler = (req: DevtoolsRequest) => Promise<DevtoolsResponse>;

/**
 * App-side transport: exposes the control plane over some channel — a
 * `Gio.DBusExportedObject` (GTK), a WebSocket server (web) — by wiring a
 * handler. The same {@link MethodRegistry} feeds every transport.
 */
export interface DevtoolsServerTransport {
    serve(handler: DevtoolsHandler): Promise<void>;
    close(): Promise<void>;
}

/**
 * Bridge-side transport: dials a running app's control plane (a DBus client
 * for GTK, a WebSocket client for web) and issues request/response
 * round-trips. The MCP bridge talks the contract over whichever transport
 * it is given, so its tools are identical across runtimes.
 */
export interface DevtoolsClientTransport {
    connect(): Promise<void>;
    request(req: DevtoolsRequest): Promise<DevtoolsResponse>;
    close(): Promise<void>;
}

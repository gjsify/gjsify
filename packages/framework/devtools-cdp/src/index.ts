// @gjsify/devtools-cdp — WebKit Remote Inspector Protocol client for GJS.
// Pure named exports; no globalThis writes, no side effects at import.
//
// P1 surface: the transport-pure protocol client + target discovery. The in-app
// DBus bridge, the protocol→MCP tool generator, and the `cdpProfile` land in
// later phases.

export { InspectorProtocolClient, ProtocolError } from './inspector-protocol-client.js';
export type {
    InspectorProtocolClientOptions,
    ProtocolEvent,
    ProtocolEventListener,
    WebSocketFactory,
    WebSocketLike,
} from './inspector-protocol-client.js';

export { discoverInspectorTargets, parseInspectorTargetsHtml } from './target-discovery.js';
export type { DiscoverInspectorTargetsOptions, InspectorTarget } from './target-discovery.js';

export { inspectorProtocolExtension } from './inspector-protocol-extension.js';
export type { InspectorProtocolExtensionOptions } from './inspector-protocol-extension.js';

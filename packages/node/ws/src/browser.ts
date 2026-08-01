// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target.
//
// Reference: refs/ws/index.js (surface mirror)
//
// In the browser, the `ws` npm package's Client surface is replaced by the
// native `globalThis.WebSocket` — every npm consumer of `ws` for the client
// path already polyfills this routing themselves (this is the canonical
// `ws.browser` field in their package.json). The Server surface
// (`WebSocketServer`, `Server`) has no browser equivalent and degrades to an
// ENOTSUP-coded throw.
//
// Slot is `browser:"partial"` (NOT pure `"native"`) precisely because Client
// is native + Server is empty — neither slot alone would describe both
// halves accurately.

type ErrnoLike = Error & { code?: string; syscall?: string };

function notSupportedInBrowser(syscall: string): ErrnoLike {
    const err: ErrnoLike = new Error(
        `${syscall} is not available in the browser — ws's server surface has no browser equivalent. Use the native @gjsify/ws on GJS / Node.`,
    );
    err.code = 'ENOTSUP';
    err.syscall = syscall;
    return err;
}

// Native browser WebSocket — direct re-export. If `globalThis.WebSocket` is
// missing (e.g. a non-browser env that ended up here by misconfiguration),
// the named export still resolves; consumers that actually `new WebSocket(url)`
// will get the standard ReferenceError-equivalent, which is the correct
// failure mode.
const _NativeWebSocket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
export const WebSocket = _NativeWebSocket;
export default _NativeWebSocket;

// Server side — every method throws ENOTSUP. We expose the constructor +
// instance methods so static-property reads (`WebSocketServer.length`) don't
// crash before the throw hits.
export class WebSocketServer {
    constructor(_options?: unknown, _callback?: () => void) {
        throw notSupportedInBrowser('WebSocketServer');
    }
    address(): never {
        throw notSupportedInBrowser('WebSocketServer.address');
    }
    close(_cb?: (err?: Error) => void): never {
        throw notSupportedInBrowser('WebSocketServer.close');
    }
    handleUpgrade(): never {
        throw notSupportedInBrowser('WebSocketServer.handleUpgrade');
    }
    shouldHandle(): never {
        throw notSupportedInBrowser('WebSocketServer.shouldHandle');
    }
    on(_event: string, _listener: (...args: unknown[]) => void): never {
        throw notSupportedInBrowser('WebSocketServer.on');
    }
    once(_event: string, _listener: (...args: unknown[]) => void): never {
        throw notSupportedInBrowser('WebSocketServer.once');
    }
    off(_event: string, _listener: (...args: unknown[]) => void): never {
        throw notSupportedInBrowser('WebSocketServer.off');
    }
    emit(_event: string, ..._args: unknown[]): never {
        throw notSupportedInBrowser('WebSocketServer.emit');
    }
}

// `ws` alias — npm's `ws` exports `Server` as an alias of `WebSocketServer`.
export const Server = WebSocketServer;

// `createWebSocketStream` — Duplex bridge. The Duplex stream type itself
// isn't available in the browser without pulling our `@gjsify/stream`
// polyfill, so we throw too. Consumers reaching for this in a browser bundle
// are almost certainly mis-configured.
export function createWebSocketStream(): never {
    throw notSupportedInBrowser('createWebSocketStream');
}

// ws CommonJS-compat statics on the WebSocket constructor — preserves the
// `const ws = require('ws'); new ws(url)` + `const { WebSocketServer } =
// require('ws')` shape.
if (_NativeWebSocket) {
    const _C = _NativeWebSocket as typeof WebSocket & {
        WebSocket?: typeof WebSocket;
        WebSocketServer?: typeof WebSocketServer;
        Server?: typeof WebSocketServer;
        createWebSocketStream?: typeof createWebSocketStream;
    };
    _C.WebSocket = _NativeWebSocket;
    _C.WebSocketServer = WebSocketServer;
    _C.Server = WebSocketServer;
    _C.createWebSocketStream = createWebSocketStream;
}

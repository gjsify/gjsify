// @gjsify/http2 — server side.
//
// Reference: Node.js lib/internal/http2/compat.js, lib/_http_server.js
// Reimplemented for GJS using Soup.Server (HTTP/2 transparently via ALPN
// when TLS is used) + @gjsify/http2-native (cleartext h2 / raw nghttp2).
//
// Composition layout (see each module's header for details):
//   - server/request.ts        — Http2ServerRequest (Readable side)
//   - server/response.ts       — Http2ServerResponse + ServerHttp2Stream
//                                + Http2NativeBackend + _respondFromFD
//                                (tight cluster, kept in one module due
//                                to the Response↔Stream cycle)
//   - server/session.ts        — ServerHttp2Session (push-id allocator +
//                                PUSH_PROMISE frame builder via the
//                                @gjsify/http2-native bridge)
//   - server/http2-server.ts   — Http2Server + Http2SecureServer + TLS
//                                cert helpers (_toPemString,
//                                _createTlsCertificate)
//   - server.ts                — this file: re-exports
//
// Phase 1 limitations (resolved in Phase 2):
//   - createServer() serves HTTP/1.1 only (Soup does not support h2c/cleartext HTTP/2)
//   - createSecureServer() negotiates h2 via ALPN automatically when TLS cert is set
//   - pushStream(), respondWithFD(), respondWithFile() are stubs
//   - stream IDs are always 1 (Soup internal)
//
// Phase 2 (post-`@gjsify/http2-native`):
//   - respondWithFD()   — fully wired through fs.read on the FD into Soup's chunked write path
//   - respondWithFile() — fully wired through fs.createReadStream
//   - pushStream()      — accepts the call, allocates a stream-id via the
//                         GjsifyHttp2.StreamIdAllocator, builds the PUSH_PROMISE
//                         frame in-memory via GjsifyHttp2.FrameEncoder. Wire-level
//                         delivery still requires raw nghttp2-on-socket access
//                         that Soup does not expose — see STATUS.md "Open TODOs".
//                         The callback IS invoked with a usable ServerHttp2Stream
//                         so application code that fans out a "main + push" pair
//                         observes a working API contract.
//   - stream IDs        — sourced from the bridge allocator (server pushes use
//                         even ids starting at 2, client requests still appear
//                         as 1 via the Soup compat layer)

export type { Http2Settings } from './protocol.js';

export { Http2ServerRequest } from './server/request.js';
export type { Http2NativeBackend } from './server/response.js';
export { Http2ServerResponse, ServerHttp2Stream } from './server/response.js';
export { ServerHttp2Session } from './server/session.js';
export type { ServerOptions, SecureServerOptions } from './server/http2-server.js';
export { Http2Server, Http2SecureServer } from './server/http2-server.js';

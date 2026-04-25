// Reference: Node.js lib/http2.js, lib/internal/http2/core.js, lib/internal/http2/compat.js
// Reimplemented for GJS using Soup 3.0 (HTTP/2 transparently via ALPN when TLS is active)
//
// Phase 1: Compat layer backed by Soup.Server + Soup.Session.
// createServer() → HTTP/1.1 only (Soup does not support h2c/cleartext HTTP/2)
// createSecureServer() → HTTP/2 via ALPN when TLS cert is provided, else HTTP/1.1
// connect() → HTTP/2 over HTTPS automatically, HTTP/1.1 over plain HTTP
//
// Phase 2 (future, requires Vala/nghttp2): pushStream, stream IDs, flow control, GOAWAY

// ─── Protocol constants & settings ───────────────────────────────────────────

export {
  constants,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  type Http2Settings,
} from './protocol.js';

import { constants, getDefaultSettings, getPackedSettings, getUnpackedSettings, type Http2Settings } from './protocol.js';

// ─── Server-side classes ──────────────────────────────────────────────────────

export {
  Http2ServerRequest,
  Http2ServerResponse,
  ServerHttp2Stream,
  ServerHttp2Session,
  Http2Server,
  Http2SecureServer,
  type ServerOptions,
  type SecureServerOptions,
} from './server.js';

import {
  Http2ServerRequest,
  Http2ServerResponse,
  ServerHttp2Stream,
  ServerHttp2Session,
  Http2Server,
  Http2SecureServer,
  type ServerOptions,
  type SecureServerOptions,
} from './server.js';

// ─── Client-side classes ──────────────────────────────────────────────────────

export {
  Http2Session,
  ClientHttp2Session,
  ClientHttp2Stream,
  type ClientSessionOptions,
  type ClientStreamOptions,
} from './client-session.js';

import {
  Http2Session,
  ClientHttp2Session,
  ClientHttp2Stream,
  type ClientSessionOptions,
} from './client-session.js';

// ─── Factory functions ────────────────────────────────────────────────────────

export function createServer(
  options?: ServerOptions | ((req: Http2ServerRequest, res: Http2ServerResponse) => void),
  handler?: (req: Http2ServerRequest, res: Http2ServerResponse) => void,
): Http2Server {
  return new Http2Server(options, handler);
}

export function createSecureServer(
  options: SecureServerOptions,
  handler?: (req: Http2ServerRequest, res: Http2ServerResponse) => void,
): Http2SecureServer {
  return new Http2SecureServer(options, handler);
}

export function connect(
  authority: string | URL,
  options?: ClientSessionOptions | ((session: ClientHttp2Session, socket: any) => void),
  listener?: (session: ClientHttp2Session, socket: any) => void,
): ClientHttp2Session {
  const authorityStr = typeof authority === 'string' ? authority : authority.toString();
  if (typeof options === 'function') {
    listener = options;
    options = {};
  }
  const session = new ClientHttp2Session(authorityStr, (options ?? {}) as ClientSessionOptions);
  if (listener) session.once('connect', listener);
  return session;
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export const sensitiveHeaders = Symbol.for('nodejs.http2.sensitiveHeaders');

export function performServerHandshake(_socket: unknown): unknown {
  throw new Error('http2.performServerHandshake() is not yet implemented in GJS');
}

// ─── Default export ───────────────────────────────────────────────────────────

export default {
  constants,
  createServer,
  createSecureServer,
  connect,
  getDefaultSettings,
  getPackedSettings,
  getUnpackedSettings,
  sensitiveHeaders,
  performServerHandshake,
  Http2Session,
  Http2Server,
  Http2SecureServer,
  Http2ServerRequest,
  Http2ServerResponse,
  ServerHttp2Session,
  ServerHttp2Stream,
  ClientHttp2Session,
  ClientHttp2Stream,
};

// Node.js http module for GJS
// Server: Soup.Server, Client: Soup.Session
// Reference: Node.js lib/http.js

export { STATUS_CODES, METHODS } from './constants.js';
export { IncomingMessage } from './incoming-message.js';
export { OutgoingMessage, Server, ServerResponse } from './server.js';
export { ClientRequest } from './client-request.js';
export { validateHeaderName, validateHeaderValue } from './validators.js';
import { validateHeaderName, validateHeaderValue } from './validators.js';
import { IncomingMessage } from './incoming-message.js';
import { OutgoingMessage, Server, ServerResponse } from './server.js';
import { ClientRequest } from './client-request.js';
import type { ClientRequestOptions } from './client-request.js';
import { URL } from 'node:url';

export interface AgentOptions {
  keepAlive?: boolean;
  keepAliveMsecs?: number;
  maxSockets?: number;
  maxTotalSockets?: number;
  maxFreeSockets?: number;
  timeout?: number;
  scheduling?: 'fifo' | 'lifo';
}

/**
 * Agent class for connection pooling.
 * Soup.Session handles actual TCP connection pooling internally.
 * This class provides the Node.js-compatible API surface for frameworks.
 */
export class Agent {
  defaultPort = 80;
  protocol = 'http:';
  maxSockets: number;
  maxTotalSockets: number;
  maxFreeSockets: number;
  keepAliveMsecs: number;
  keepAlive: boolean;
  scheduling: 'fifo' | 'lifo';

  /** Pending requests per host (compatibility — Soup manages internally). */
  readonly requests: Record<string, unknown[]> = {};
  /** Active sockets per host (compatibility — Soup manages internally). */
  readonly sockets: Record<string, unknown[]> = {};
  /** Idle sockets per host (compatibility — Soup manages internally). */
  readonly freeSockets: Record<string, unknown[]> = {};

  constructor(options?: AgentOptions) {
    this.keepAlive = options?.keepAlive ?? false;
    this.keepAliveMsecs = options?.keepAliveMsecs ?? 1000;
    this.maxSockets = options?.maxSockets ?? Infinity;
    this.maxTotalSockets = options?.maxTotalSockets ?? Infinity;
    this.maxFreeSockets = options?.maxFreeSockets ?? 256;
    this.scheduling = options?.scheduling ?? 'lifo';
  }

  /** Destroy the agent and close idle connections. */
  destroy(): void {
    // Soup.Session handles cleanup on GC.
  }

  /** Return a connection pool key for the given options. */
  getName(options: { host?: string; port?: number; localAddress?: string; family?: number }): string {
    let name = options.host || 'localhost';
    if (options.port) name += ':' + options.port;
    if (options.localAddress) name += ':' + options.localAddress;
    if (options.family === 4 || options.family === 6) name += ':' + options.family;
    return name;
  }
}

export const globalAgent = new Agent();

/**
 * Create an HTTP server.
 */
export function createServer(options?: Record<string, unknown> | ((req: IncomingMessage, res: ServerResponse) => void), requestListener?: (req: IncomingMessage, res: ServerResponse) => void): Server {
  if (typeof options === 'function') {
    return new Server(options);
  }
  return new Server(requestListener);
}

/**
 * Make an HTTP request.
 *
 * @param url URL string, URL object, or request options
 * @param options Request options (if url is string/URL)
 * @param callback Response callback
 */
export function request(url: string | URL | ClientRequestOptions, options?: ClientRequestOptions | ((res: IncomingMessage) => void), callback?: (res: IncomingMessage) => void): ClientRequest {
  return new ClientRequest(url, options, callback);
}

/**
 * Make an HTTP GET request (convenience wrapper that calls req.end() automatically).
 */
export function get(url: string | URL | ClientRequestOptions, options?: ClientRequestOptions | ((res: IncomingMessage) => void), callback?: (res: IncomingMessage) => void): ClientRequest {
  // Normalize arguments
  let opts: ClientRequestOptions;
  let cb: ((res: IncomingMessage) => void) | undefined = callback;

  if (typeof url === 'string' || url instanceof URL) {
    opts = typeof options === 'object' ? { ...options, method: 'GET' } : { method: 'GET' };
    if (typeof options === 'function') cb = options;
  } else {
    opts = { ...url, method: 'GET' };
    if (typeof options === 'function') cb = options;
    url = opts as ClientRequestOptions;
  }

  const req = typeof url === 'string' || url instanceof URL
    ? new ClientRequest(url, { ...opts, method: 'GET' }, cb)
    : new ClientRequest({ ...opts, method: 'GET' }, cb);
  req.end();
  return req;
}

/** Max header size in bytes. */
export const maxHeaderSize = 16384;

/**
 * Set the maximum number of idle HTTP parsers. Soup.Session handles
 * connection pooling internally, so this is a no-op for compatibility.
 * @since v18.8.0
 */
export function setMaxIdleHTTPParsers(_max: number): void {}

import { STATUS_CODES as _STATUS_CODES, METHODS as _METHODS } from './constants.js';

export default {
  STATUS_CODES: _STATUS_CODES,
  METHODS: _METHODS,
  Server,
  IncomingMessage,
  OutgoingMessage,
  ServerResponse,
  ClientRequest,
  Agent,
  globalAgent,
  createServer,
  request,
  get,
  validateHeaderName,
  validateHeaderValue,
  maxHeaderSize,
  setMaxIdleHTTPParsers,
};

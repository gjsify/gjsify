// Node.js http module for GJS
// Server: Soup.Server, Client: Soup.Session
// Reference: Node.js lib/http.js

export { STATUS_CODES, METHODS } from './constants.js';
export { Server, IncomingMessage, ServerResponse } from './server.js';
import { Server, IncomingMessage, ServerResponse } from './server.js';

/**
 * Performs the low-level validations on the provided `name` that are done when `res.setHeader(name, value)` is called.
 * @since v14.3.0
 */
export function validateHeaderName(name: string) {
  if (!/^[\^`\-\w!#$%&'*+.|~]+$/.test(name)) {
    const error = new TypeError(`Header name must be a valid HTTP token ["${name}"]`);
    Object.defineProperty(error, 'code', { value: 'ERR_INVALID_HTTP_TOKEN' });
    throw error;
  }
}

/**
 * Performs the low-level validations on the provided `value` that are done when `res.setHeader(name, value)` is called.
 */
export function validateHeaderValue(name: string, value: any) {
  if (/[^\t\u0020-\u007E\u0080-\u00FF]/.test(value)) {
    const error = new TypeError(`Invalid character in header content ["${name}"]`);
    Object.defineProperty(error, 'code', { value: 'ERR_INVALID_CHAR' });
    throw error;
  }
}

/**
 * Agent class for connection pooling (stub — Soup.Session handles pooling internally).
 */
export class Agent {
  defaultPort = 80;
  protocol = 'http:';
  maxSockets = Infinity;
  maxFreeSockets = 256;
  keepAliveMsecs = 1000;
  keepAlive = false;

  constructor(_options?: any) {}

  destroy(): void {}
}

export const globalAgent = new Agent();

/**
 * Create an HTTP server.
 */
export function createServer(requestListener?: (req: IncomingMessage, res: ServerResponse) => void): Server {
  return new Server(requestListener);
}

/**
 * Make an HTTP request (stub — use @gjsify/fetch for now).
 */
export function request(_options: any, _callback?: (res: IncomingMessage) => void): any {
  throw new Error('http.request() is not yet fully implemented. Use @gjsify/fetch for HTTP requests.');
}

/**
 * Make an HTTP GET request (convenience wrapper).
 */
export function get(options: any, callback?: (res: IncomingMessage) => void): any {
  const opts = typeof options === 'string' ? { hostname: options, method: 'GET' } : { ...options, method: 'GET' };
  return request(opts, callback);
}

/** Max header size in bytes. */
export const maxHeaderSize = 16384;

export default {
  STATUS_CODES: undefined as any, // Will be set below
  METHODS: undefined as any,
  Server,
  IncomingMessage,
  ServerResponse,
  Agent,
  globalAgent,
  createServer,
  request,
  get,
  validateHeaderName,
  validateHeaderValue,
  maxHeaderSize,
};

// Lazy import to avoid circular
import { STATUS_CODES, METHODS } from './constants.js';
(exports.default as any).STATUS_CODES = STATUS_CODES;
(exports.default as any).METHODS = METHODS;

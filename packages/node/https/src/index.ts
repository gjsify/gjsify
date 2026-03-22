// Node.js https module for GJS
// Thin wrapper combining http and tls
// Reference: Node.js lib/https.js

import { validateHeaderName, validateHeaderValue } from 'http';
import { TLSSocket, createSecureContext } from 'tls';

export { TLSSocket, createSecureContext };

export interface RequestOptions {
  hostname?: string;
  host?: string;
  port?: number;
  path?: string;
  method?: string;
  headers?: Record<string, string | string[]>;
  ca?: string | Buffer | Array<string | Buffer>;
  cert?: string | Buffer | Array<string | Buffer>;
  key?: string | Buffer | Array<string | Buffer>;
  rejectUnauthorized?: boolean;
}

/**
 * HTTPS Agent for connection pooling (stub).
 */
export class Agent {
  defaultPort = 443;
  protocol = 'https:';
  maxSockets = Infinity;
  maxFreeSockets = 256;

  constructor(_options?: any) {}

  destroy(): void {}
}

export const globalAgent = new Agent();

/**
 * Make an HTTPS request (stub — delegates to TLS + HTTP when http module is complete).
 */
export function request(_options: RequestOptions | string, _callback?: (res: any) => void): any {
  // Full implementation requires @gjsify/http to be complete (ClientRequest, IncomingMessage)
  // For now, throw a descriptive error
  throw new Error('https.request() requires @gjsify/http to be fully implemented. Use @gjsify/fetch for HTTP requests.');
}

/**
 * Make an HTTPS GET request (convenience wrapper).
 */
export function get(options: RequestOptions | string, callback?: (res: any) => void): any {
  const opts = typeof options === 'string' ? { hostname: options, method: 'GET' } : { ...options, method: 'GET' };
  return request(opts, callback);
}

export default {
  Agent,
  globalAgent,
  request,
  get,
  TLSSocket,
  createSecureContext,
};

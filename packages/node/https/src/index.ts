// Node.js https module for GJS
// Thin wrapper — Soup.Session handles HTTPS natively via GnuTLS.
// Reference: Node.js lib/https.js

import { request as httpRequest, get as httpGet, ClientRequest, IncomingMessage } from 'http';
import { TLSSocket, createSecureContext } from 'tls';
import { URL } from 'url';

export { TLSSocket, createSecureContext };

export interface RequestOptions {
  protocol?: string;
  hostname?: string;
  host?: string;
  port?: number | string;
  path?: string;
  method?: string;
  headers?: Record<string, string | number | string[]>;
  timeout?: number;
  agent?: unknown;
  setHost?: boolean;
  ca?: string | Buffer | Array<string | Buffer>;
  cert?: string | Buffer | Array<string | Buffer>;
  key?: string | Buffer | Array<string | Buffer>;
  rejectUnauthorized?: boolean;
}

/**
 * HTTPS Agent for connection pooling (stub — Soup.Session handles TLS internally).
 */
export class Agent {
  defaultPort = 443;
  protocol = 'https:';
  maxSockets = Infinity;
  maxFreeSockets = 256;

  constructor(_options?: Record<string, unknown>) {}

  destroy(): void {}
}

export const globalAgent = new Agent();

/**
 * Make an HTTPS request.
 * Soup.Session handles TLS natively — we just ensure protocol is https:.
 */
export function request(url: string | URL | RequestOptions, options?: RequestOptions | ((res: IncomingMessage) => void), callback?: (res: IncomingMessage) => void): ClientRequest {
  if (typeof url === 'string') {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      return httpRequest(url, options as any, callback);
    }
    const opts: RequestOptions = { hostname: url, protocol: 'https:', port: 443 };
    if (typeof options === 'object') Object.assign(opts, options);
    if (typeof options === 'function') callback = options;
    return httpRequest(opts as any, callback);
  }

  if (url instanceof URL) {
    return httpRequest(url, options as any, callback);
  }

  // url is RequestOptions
  const opts = { protocol: 'https:', port: 443, ...url };
  if (typeof options === 'function') callback = options;
  return httpRequest(opts as any, callback);
}

/**
 * Make an HTTPS GET request (convenience wrapper).
 */
export function get(url: string | URL | RequestOptions, options?: RequestOptions | ((res: IncomingMessage) => void), callback?: (res: IncomingMessage) => void): ClientRequest {
  if (typeof url === 'string') {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      return httpGet(url, options as any, callback) as ClientRequest;
    }
    const opts: RequestOptions = { hostname: url, protocol: 'https:', port: 443 };
    if (typeof options === 'object') Object.assign(opts, options);
    if (typeof options === 'function') callback = options;
    return httpGet(opts as any, callback) as ClientRequest;
  }

  if (url instanceof URL) {
    return httpGet(url, options as any, callback) as ClientRequest;
  }

  const opts = { protocol: 'https:', port: 443, ...url, method: 'GET' };
  if (typeof options === 'function') callback = options;
  return httpGet(opts as any, callback) as ClientRequest;
}

export default {
  Agent,
  globalAgent,
  request,
  get,
  TLSSocket,
  createSecureContext,
};

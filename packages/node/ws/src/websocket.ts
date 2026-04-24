// WebSocket client — implements the `ws` npm package's WebSocket API by
// delegating to @gjsify/websocket's WebSocket class (Soup.WebsocketConnection
// on Gjs; re-exported native `globalThis.WebSocket` on Node 22+ via the
// package's `globals.mjs` shim that the Node alias map points at).
//
// Reference: refs/ws/lib/websocket.js
// Intent: consumers that `import { WebSocket } from 'ws'` or do
// `new (require('ws'))(url)` on Gjs get a functional WebSocket without us
// re-implementing the RFC 6455 protocol — Soup already handles frames,
// ping/pong, close handshake, UTF-8 validation, and permessage-deflate.
//
// Importing the native class explicitly (rather than reading
// `globalThis.WebSocket` at construction time) keeps the dependency graph
// visible to bundlers: tree-shakers drop this whole wrapper when nobody
// imports `ws`, and pull in the right transport automatically when they
// do — no need for the consumer to also add `WebSocket` to --globals.

import { EventEmitter } from '@gjsify/events';
import { Buffer } from '@gjsify/buffer';
import { WebSocket as NativeWebSocket } from '@gjsify/websocket';
import {
  BINARY_TYPES,
  CLOSED,
  CLOSING,
  CONNECTING,
  EMPTY_BUFFER,
  OPEN,
} from './constants.js';

export type BinaryType = 'nodebuffer' | 'arraybuffer' | 'fragments' | 'blob';

/** Options accepted by the ws constructor. Only a subset is honored on Gjs —
 *  see README for the support matrix. Unknown options are silently ignored
 *  to preserve drop-in compatibility with `ws`-calling code. */
export interface ClientOptions {
  protocol?: string;
  protocols?: string | string[];
  origin?: string;
  headers?: Record<string, string | string[]>;
  handshakeTimeout?: number;
  /** Enable permessage-deflate (RFC 7692). Defaults to true, matching the real
   *  ws npm package. Set to false to disable deflate negotiation (useful when
   *  the remote server has buggy deflate handling). */
  perMessageDeflate?: boolean;
  // Explicitly NOT honored on Gjs (documented in README):
  //   agent, rejectUnauthorized, ca, cert, key, passphrase, pfx, crl,
  //   ciphers, secureProtocol, maxPayload, followRedirects, maxRedirects,
  //   skipUTF8Validation, allowSynchronousEvents
}

type MessageHandler = (data: unknown, isBinary: boolean) => void;

/** Read-only getter type used below. */
type Getter<T> = () => T;

/** `ws.WebSocket` — EventEmitter-based WebSocket client.
 *
 *  Events (ws-compatible):
 *    - 'open'                          → ()
 *    - 'message'                       → (data: Buffer | ArrayBuffer | string, isBinary: boolean)
 *    - 'close'                         → (code: number, reason: Buffer)
 *    - 'error'                         → (error: Error)
 *    - 'ping' / 'pong'                 → NOT EMITTED on Gjs (Soup handles control
 *                                        frames internally; no JS hook exposed).
 *                                        Consumers that rely on 'ping'/'pong' for
 *                                        keep-alive application logic need to use
 *                                        data messages instead. Tracked as a
 *                                        known limitation in STATUS.md.
 *    - 'upgrade' / 'unexpected-response' / 'redirect'
 *                                      → NOT EMITTED on Gjs (Soup does not expose
 *                                        the raw HTTP upgrade response). Code
 *                                        that only branches on `open` vs `error`
 *                                        still works.
 *
 *  Also implements W3C DOM `EventTarget` methods (addEventListener /
 *  removeEventListener) so `ws` users who follow W3C-style handlers via the
 *  `ws.EventTarget` flag still work without special-casing the Gjs path.
 */
export class WebSocket extends EventEmitter {
  /** Static readyState constants — match the W3C and `ws` values. */
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  /** Instance-side copies for `ws.readyState === ws.OPEN` style code. */
  readonly CONNECTING = CONNECTING;
  readonly OPEN = OPEN;
  readonly CLOSING = CLOSING;
  readonly CLOSED = CLOSED;

  /** Per-instance state. Populated from the underlying native WebSocket as
   *  events arrive; exposed as properties so that ws-calling code like
   *  `if (ws.readyState === ws.OPEN)` works identically to Node's `ws`. */
  readyState: number = CONNECTING;
  url: string = '';
  protocol: string = '';
  extensions: string = '';
  bufferedAmount = 0;
  binaryType: BinaryType = 'nodebuffer';

  /** The real WebSocket we delegate to. Typed as `any` because the W3C
   *  ambient type comes from multiple realms depending on where this bundle
   *  ends up (GJS browser-like globals vs. Node's undici). */
  private _native: any = null;

  constructor(
    address: string | URL | null,
    protocols?: string | string[],
    options: ClientOptions = {},
  ) {
    super();
    // `new WebSocket(null)` is used by ws for pre-connected sockets fed via
    // options.socket (e.g. WebSocketServer-accepted clients). We don't support
    // that socket-adoption path yet; emit an error asynchronously.
    if (address === null) {
      queueMicrotask(() => this._fail('Constructing ws.WebSocket with null address is not supported on Gjs'));
      return;
    }

    this.url = typeof address === 'string' ? address : String(address);

    const protos = this._resolveProtocols(protocols, options);
    this._openNative(this.url, protos, options);
  }

  /** Merge `protocols` arg and `options.protocols` / `options.protocol`. */
  private _resolveProtocols(
    protocols: string | string[] | undefined,
    options: ClientOptions,
  ): string[] | undefined {
    if (protocols !== undefined) {
      return Array.isArray(protocols) ? protocols : [protocols];
    }
    if (options.protocols !== undefined) {
      return Array.isArray(options.protocols) ? options.protocols : [options.protocols];
    }
    if (options.protocol !== undefined) return [options.protocol];
    return undefined;
  }

  /** Lazy-open the underlying native WebSocket. Separated from the constructor
   *  so subclasses or future socket-adoption paths can bypass it. */
  private _openNative(url: string, protocols: string[] | undefined, options: ClientOptions): void {
    if (typeof NativeWebSocket !== 'function') {
      // @gjsify/websocket re-exports globalThis.WebSocket on Node — if Node
      // lacks native WebSocket (pre-22 or explicitly deleted), the import
      // binds to undefined. Surface a clear error in that edge case.
      queueMicrotask(() => this._fail(
        '@gjsify/websocket provided no WebSocket constructor. On Node.js 22+ ' +
        'globalThis.WebSocket is native; on older Node install `ws` directly, ' +
        'or ensure globalThis.WebSocket is set before @gjsify/ws is imported.',
      ));
      return;
    }

    // perMessageDeflate defaults to true (matches real ws npm package).
    // @gjsify/websocket's opt-in flag prevents the always-on Soup deflate
    // registration that can corrupt round-trips with local Soup.Server fixtures.
    // headers / origin / handshakeTimeout are forwarded to @gjsify/websocket
    // which wires them into the Soup upgrade request.
    const nativeOpts = {
      perMessageDeflate: options.perMessageDeflate !== false,
      headers: options.headers,
      origin: options.origin,
      handshakeTimeout: options.handshakeTimeout,
    };

    try {
      this._native = new (NativeWebSocket as any)(url, protocols, nativeOpts);
    } catch (err) {
      queueMicrotask(() => this._fail(err instanceof Error ? err : new Error(String(err))));
      return;
    }

    // Native WebSocket produces ArrayBuffer for binary messages; we convert
    // to Node Buffer by default (matches ws binaryType='nodebuffer' default).
    this._native.binaryType = 'arraybuffer';

    this._native.addEventListener('open', () => this._onOpen());
    this._native.addEventListener('message', (ev: any) => this._onMessage(ev));
    this._native.addEventListener('close', (ev: any) => this._onClose(ev));
    this._native.addEventListener('error', (ev: any) => this._onError(ev));
  }

  private _fail(err: string | Error): void {
    const error = typeof err === 'string' ? new Error(err) : err;
    this.readyState = CLOSED;
    this.emit('error', error);
    this._dispatchEvent('error', { error, message: error.message });
    // Match ws: emit a close after an error when no connection ever opened.
    this.emit('close', 1006, Buffer.from(error.message));
    this._dispatchEvent('close', { code: 1006, reason: error.message, wasClean: false });
  }

  private _onOpen(): void {
    this.readyState = OPEN;
    // protocol/extensions may not be exposed by every native WebSocket
    // implementation; read defensively.
    if (typeof this._native.protocol === 'string') this.protocol = this._native.protocol;
    if (typeof this._native.extensions === 'string') this.extensions = this._native.extensions;
    this.emit('open');
    this._dispatchEvent('open', {});
  }

  private _onMessage(ev: any): void {
    const raw = ev?.data;
    let data: unknown;
    let isBinary = false;

    if (typeof raw === 'string') {
      data = raw;
      isBinary = false;
    } else if (raw instanceof ArrayBuffer) {
      isBinary = true;
      data = this._decodeBinary(raw);
    } else if (ArrayBuffer.isView(raw)) {
      isBinary = true;
      data = this._decodeBinary((raw as ArrayBufferView).buffer as ArrayBuffer);
    } else {
      // Unexpected type — pass through.
      data = raw;
      isBinary = false;
    }

    this.emit('message', data, isBinary);
    this._dispatchEvent('message', { data, type: isBinary ? 'binary' : 'text' });
  }

  /** Convert an ArrayBuffer to the Buffer flavor requested by `binaryType`. */
  private _decodeBinary(buf: ArrayBuffer): unknown {
    switch (this.binaryType) {
      case 'arraybuffer': return buf;
      case 'fragments':   return [Buffer.from(buf)]; // one-fragment approximation
      case 'blob': {
        const BlobCtor = (globalThis as any).Blob;
        return BlobCtor ? new BlobCtor([new Uint8Array(buf)]) : Buffer.from(buf);
      }
      case 'nodebuffer':
      default:
        return Buffer.from(buf);
    }
  }

  private _onClose(ev: any): void {
    const code = typeof ev?.code === 'number' ? ev.code : 1006;
    const reason = typeof ev?.reason === 'string' ? ev.reason : '';
    this.readyState = CLOSED;
    this.emit('close', code, Buffer.from(reason));
    this._dispatchEvent('close', { code, reason, wasClean: !!ev?.wasClean });
  }

  private _onError(ev: any): void {
    const msg = ev?.message || 'WebSocket error';
    const err = ev?.error instanceof Error ? ev.error : new Error(msg);
    this.emit('error', err);
    this._dispatchEvent('error', { error: err, message: msg });
  }

  send(
    data: string | Buffer | ArrayBuffer | ArrayBufferView | Blob | number | boolean,
    optionsOrCb?: ((err?: Error) => void) | { mask?: boolean; binary?: boolean; compress?: boolean; fin?: boolean },
    cb?: (err?: Error) => void,
  ): void {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : cb;

    // Real npm ws throws synchronously when send() is called while CONNECTING
    // (or otherwise not OPEN). The callback form also throws; it's intended
    // to report *send*-time errors once CONNECTED. We match that semantic
    // rather than buffering, so consumers see consistent behavior across
    // runtimes.
    if (this.readyState === CONNECTING) {
      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    }

    if (this.readyState !== OPEN) {
      const err = new Error('WebSocket is not open: readyState ' + this.readyState);
      if (callback) queueMicrotask(() => callback(err));
      else queueMicrotask(() => this.emit('error', err));
      return;
    }

    this._nativeSend(data, callback);
  }

  private _nativeSend(data: unknown, cb?: (err?: Error) => void): void {
    try {
      // W3C WebSocket.send accepts string / Blob / ArrayBuffer / ArrayBufferView.
      // ws accepts additionally Node Buffer (which is a Uint8Array subclass, so
      // ArrayBufferView — passes through) and numbers/booleans (coerced to str).
      let payload: any = data;
      if (typeof data === 'number' || typeof data === 'boolean') {
        payload = String(data);
      } else if (Buffer.isBuffer(data as any)) {
        // Send the underlying bytes (not the Buffer wrapper) so Soup treats
        // it as binary, not text.
        const b = data as Buffer;
        payload = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
      this._native.send(payload);
      if (cb) queueMicrotask(() => cb());
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (cb) queueMicrotask(() => cb(e));
      else queueMicrotask(() => this.emit('error', e));
    }
  }

  private _sizeOf(data: unknown): number {
    if (typeof data === 'string') return data.length;
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return (data as ArrayBufferView).byteLength;
    return 0;
  }

  close(code?: number, reason?: string | Buffer): void {
    if (this.readyState === CLOSED) return;
    if (this.readyState === CLOSING) return;
    this.readyState = CLOSING;
    try {
      // W3C close only accepts string reasons; coerce Buffer to utf-8 string.
      const reasonStr = reason === undefined
        ? undefined
        : Buffer.isBuffer(reason as any)
          ? (reason as Buffer).toString('utf8')
          : String(reason);
      if (code === undefined) this._native?.close();
      else if (reasonStr === undefined) this._native?.close(code);
      else this._native?.close(code, reasonStr);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** ws-only: force-close without sending a Close frame. On Gjs we can't bypass
   *  Soup's close handshake, so terminate is approximated as close(1006).
   *  Known gap vs. ws semantics — documented. */
  terminate(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSING;
    try {
      this._native?.close(1006, 'terminated');
    } catch {
      // Swallow; we're tearing down anyway.
    }
  }

  /** Convenience: returns true if the socket is closed or closing. Matches
   *  ws.isPaused() / internal state checks that some consumers rely on. */
  get isPaused(): boolean {
    return this.readyState === CLOSING || this.readyState === CLOSED;
  }

  // --- W3C EventTarget compat surface -------------------------------------
  // ws uses EventEmitter by default, but exposes addEventListener-style
  // registration for consumers that prefer the W3C API. We mirror it to
  // stay compat.

  private _eventTargetListeners: Map<string, Set<(ev: any) => void>> = new Map();

  addEventListener(type: string, listener: (ev: any) => void): void {
    let set = this._eventTargetListeners.get(type);
    if (!set) {
      set = new Set();
      this._eventTargetListeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (ev: any) => void): void {
    this._eventTargetListeners.get(type)?.delete(listener);
  }

  private _dispatchEvent(type: string, detail: Record<string, unknown>): void {
    const set = this._eventTargetListeners.get(type);
    if (!set || set.size === 0) return;
    // Minimal event shape matching Node's ws: { type, target } + detail props.
    const ev = Object.assign({ type, target: this }, detail);
    for (const listener of set) {
      try { listener(ev); }
      catch (err) { queueMicrotask(() => this.emit('error', err)); }
    }
  }

  // Static list of accepted binary types — exposed for parity with ws.
  static get BINARY_TYPES() { return BINARY_TYPES; }
}

// Expose the ws constant on the constructor (matches `WebSocket.Server = WebSocketServer`
// pattern from ws/index.js — see server-side file).
(WebSocket as any).WebSocket = WebSocket;

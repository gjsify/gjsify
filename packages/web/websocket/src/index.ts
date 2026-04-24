// W3C WebSocket API for GJS
// Reimplemented for GJS using Soup 3.0 (Soup.WebsocketConnection)
// Reference: WHATWG WebSocket API (https://websockets.spec.whatwg.org/)

import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import { Event, EventTarget, CustomEvent, MessageEvent, CloseEvent } from '@gjsify/dom-events';

export { MessageEvent, CloseEvent };

// WebSocket readyState constants
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

// libsoup exposes an extension's spec name only as a class-level C field that
// GI doesn't surface on the JS object. Map by constructor for the one
// extension Soup ships today; fall back to the stripped GType name for any
// third-party extension registered against the session.
function extensionName(ext: Soup.WebsocketExtension): string {
  if (ext instanceof Soup.WebsocketExtensionDeflate) return 'permessage-deflate';
  const gtype = (ext.constructor as { $gtype?: { name?: string } }).$gtype?.name ?? '';
  return gtype.replace(/^SoupWebsocketExtension/, '').toLowerCase();
}

function serializeExtensions(exts: Soup.WebsocketExtension[] | null): string {
  if (!exts || exts.length === 0) return '';
  return exts
    .map((ext) => {
      const params = ext.get_response_params();
      return params ? `${extensionName(ext)}${params}` : extensionName(ext);
    })
    .join(', ');
}

/** Options for the WebSocket constructor. Extends the W3C spec with Soup-level knobs. */
export interface WebSocketOptions {
  /** Offer permessage-deflate (RFC 7692) during the WebSocket handshake.
   *  Defaults to false — Soup's loopback server behaviour with deflate enabled
   *  diverges across Fedora Soup 3.x builds (the server may accept but not
   *  decompress, surfacing compressed bytes to the message signal). Enable
   *  explicitly for servers known to handle deflate correctly (e.g. the
   *  Autobahn fuzzingserver). @gjsify/ws enables it by default, matching the
   *  real ws npm package. */
  perMessageDeflate?: boolean;
  /** Extra HTTP headers to send with the WebSocket upgrade request.
   *  Useful for authentication cookies, Authorization, or custom
   *  application-level headers. Array values are sent as repeated headers. */
  headers?: Record<string, string | string[]>;
  /** Value for the HTTP `Origin` header sent during the upgrade handshake.
   *  Passed directly as the `origin` argument to Soup's
   *  `websocket_connect_async`. `null` omits the header (default). */
  origin?: string | null;
  /** Abort the opening handshake after this many milliseconds. Fires an
   *  'error' event with message "Opening handshake has timed out". */
  handshakeTimeout?: number;
}

/**
 * W3C WebSocket API implementation using Soup 3.0.
 *
 * Usage:
 *   const ws = new WebSocket('ws://localhost:8080/');
 *   ws.onopen = () => ws.send('hello');
 *   ws.onmessage = (e) => console.log(e.data);
 *   ws.onclose = (e) => console.log('closed', e.code);
 */
export class WebSocket extends EventTarget {
  // readyState constants
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  readonly CONNECTING = CONNECTING;
  readonly OPEN = OPEN;
  readonly CLOSING = CLOSING;
  readonly CLOSED = CLOSED;

  readonly url: string;
  readyState: number = CONNECTING;
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  binaryType: 'blob' | 'arraybuffer' = 'blob';

  // Event handlers (attribute-style)
  onopen: ((this: WebSocket, ev: Event) => void) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => void) | null = null;
  onerror: ((this: WebSocket, ev: Event) => void) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => void) | null = null;

  private _connection: Soup.WebsocketConnection | null = null;
  private _session: Soup.Session;
  private _protocols: string[];
  private _cancellable: Gio.Cancellable | null = null;
  private _handshakeTimedOut = false;
  private _handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string | URL, protocols?: string | string[], options?: WebSocketOptions) {
    super();
    this.url = typeof url === 'string' ? url : url.toString();
    this._protocols = typeof protocols === 'string' ? [protocols] : (protocols ?? []);
    this._session = new Soup.Session();

    // Opt-in permessage-deflate (RFC 7692). Soup's loopback WebSocket server
    // may accept the extension in the HTTP handshake but then pass compressed
    // bytes through to the 'message' signal without decompressing, which
    // produces wrong data in round-trip tests. Enable only when the caller
    // knows the remote server handles deflate correctly (e.g. Autobahn suite).
    // @gjsify/ws enables it by default, matching real ws npm-package behaviour.
    //
    // Soup requires: (1) add WebsocketExtensionManager to the session first,
    // then (2) register the deflate extension type with the manager via
    // add_feature_by_type. Adding deflate without the manager first yields the
    // runtime warning "No feature manager for feature of type ...".
    if (options?.perMessageDeflate) {
      this._session.add_feature_by_type(Soup.WebsocketExtensionManager.$gtype);
      this._session.add_feature_by_type(Soup.WebsocketExtensionDeflate.$gtype);
    }

    // Connect asynchronously
    this._connect(options);
  }

  private _connect(options?: WebSocketOptions): void {
    const uri = GLib.Uri.parse(this.url, GLib.UriFlags.NONE);
    const msg = new Soup.Message({ method: 'GET', uri });

    // Apply custom upgrade-request headers (e.g. Cookie, Authorization).
    if (options?.headers) {
      const reqHeaders = msg.get_request_headers();
      for (const [name, value] of Object.entries(options.headers)) {
        if (Array.isArray(value)) {
          value.forEach(v => reqHeaders.append(name, v));
        } else {
          reqHeaders.replace(name, value);
        }
      }
    }

    // Set up handshake timeout via Gio.Cancellable so we can abort the async
    // connect operation after the caller-specified deadline.
    if (options?.handshakeTimeout) {
      this._cancellable = new Gio.Cancellable();
      const cancellable = this._cancellable;
      this._handshakeTimer = setTimeout(() => {
        this._handshakeTimedOut = true;
        this._handshakeTimer = null;
        cancellable.cancel();
      }, options.handshakeTimeout);
    }

    this._session.websocket_connect_async(
      msg,
      options?.origin ?? null,
      this._protocols.length > 0 ? this._protocols : null,
      GLib.PRIORITY_DEFAULT,
      this._cancellable,
      (_self: unknown, asyncRes: Gio.AsyncResult) => {
        if (this._handshakeTimer !== null) {
          clearTimeout(this._handshakeTimer);
          this._handshakeTimer = null;
        }

        try {
          this._connection = this._session.websocket_connect_finish(asyncRes);
          // Soup's built-in default is 128 KB — too low for large frames
          // (Autobahn 9.1.* sends single frames up to 16 MB; npm ws defaults
          // to 100 MB). Set before wiring signals so the limit is in place
          // before the first frame arrives. 0 = unlimited.
          this._connection.max_incoming_payload_size = 100 * 1024 * 1024;
          this.readyState = OPEN;
          this.protocol = this._connection.get_protocol() ?? '';
          this.extensions = serializeExtensions(this._connection.get_extensions());

          // Wire up Soup signals
          this._connection.connect('message', (_conn: Soup.WebsocketConnection, type: number, message: GLib.Bytes) => {
            this._onMessage(type, message);
          });

          this._connection.connect('closed', () => {
            this._onClosed();
          });

          this._connection.connect('error', (_conn: Soup.WebsocketConnection, error: GLib.Error) => {
            this._onError(error);
          });

          // Fire 'open' event
          const openEvent = new Event('open');
          this.dispatchEvent(openEvent);
          if (this.onopen) this.onopen.call(this, openEvent);
        } catch (error: unknown) {
          this.readyState = CLOSED;

          const errorMessage = this._handshakeTimedOut
            ? 'Opening handshake has timed out'
            : (error instanceof Error ? error.message : String(error));
          const err = new Error(errorMessage);

          // Attach error info to the event so wrapper layers (e.g. @gjsify/ws)
          // can surface a typed Error to their own 'error' listeners.
          const errorEvent = new Event('error');
          (errorEvent as any).error = err;
          (errorEvent as any).message = errorMessage;
          this.dispatchEvent(errorEvent);
          if (this.onerror) this.onerror.call(this, errorEvent);

          const closeEvent = new CloseEvent('close', {
            code: 1006,
            reason: errorMessage,
            wasClean: false,
          });
          this.dispatchEvent(closeEvent);
          if (this.onclose) this.onclose.call(this, closeEvent);
        }
      },
    );
  }

  private _onMessage(type: number, message: GLib.Bytes): void {
    let data: string | ArrayBuffer;

    if (type === Soup.WebsocketDataType.TEXT) {
      const decoder = new TextDecoder();
      data = decoder.decode(message.toArray());
    } else {
      // Binary data
      const arr = message.toArray();
      data = arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
    }

    const event = new MessageEvent('message', { data, origin: this.url });
    this.dispatchEvent(event);
    if (this.onmessage) this.onmessage.call(this, event);
  }

  private _onError(error: GLib.Error): void {
    const event = new Event('error');
    this.dispatchEvent(event);
    if (this.onerror) this.onerror.call(this, event);
  }

  private _onClosed(): void {
    const code = this._connection?.get_close_code() ?? 1006;
    const reason = this._connection?.get_close_data() ?? '';
    const wasClean = code === 1000;

    this.readyState = CLOSED;
    this._connection = null;

    const event = new CloseEvent('close', { code, reason, wasClean });
    this.dispatchEvent(event);
    if (this.onclose) this.onclose.call(this, event);
  }

  /**
   * Send data through the WebSocket connection.
   *
   * For strings, we intentionally route through `send_message(TEXT, bytes)`
   * rather than the simpler `send_text(str)` API. Reason: `send_text()`
   * takes a C `const char*` (null-terminated), so any embedded `\x00` in
   * the JS string gets truncated at the first NUL at the GI boundary —
   * Autobahn case 6.7.1 (single NUL in a text frame) was returned as an
   * empty string. Going through `GLib.Bytes` preserves the exact byte
   * sequence; Soup still sets the text-frame opcode because we pass
   * `Soup.WebsocketDataType.TEXT` explicitly.
   */
  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== OPEN) {
      throw new DOMException('WebSocket is not open', 'InvalidStateError');
    }
    if (!this._connection) return;

    if (typeof data === 'string') {
      // Encode the JS string as UTF-8 bytes and ship as a text-framed
      // message. TextEncoder has been a SpiderMonkey built-in since
      // SM52 — same rationale as the TextDecoder usage in _onMessage
      // above; no explicit register import needed.
      const bytes = new TextEncoder().encode(data);
      this._connection.send_message(Soup.WebsocketDataType.TEXT, new GLib.Bytes(bytes));
    } else {
      let bytes: Uint8Array;
      if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else {
        // ArrayBufferView (TypedArray or DataView)
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      this._connection.send_message(Soup.WebsocketDataType.BINARY, new GLib.Bytes(bytes));
    }
  }

  /**
   * Close the WebSocket connection.
   */
  close(code?: number, reason?: string): void {
    if (this.readyState === CLOSED || this.readyState === CLOSING) return;

    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
      throw new DOMException(
        `The code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
        'InvalidAccessError',
      );
    }

    this.readyState = CLOSING;

    if (this._connection) {
      this._connection.close(code ?? 1000, reason ?? null);
    } else {
      // Connection never established
      this.readyState = CLOSED;
      const event = new CloseEvent('close', { code: 1006, wasClean: false });
      this.dispatchEvent(event);
      if (this.onclose) this.onclose.call(this, event);
    }
  }
}

export default WebSocket;

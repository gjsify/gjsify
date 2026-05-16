// Native HTTP/2 client dispatcher — companion to `native-dispatcher.ts`.
//
// Phase 3: enables `connect('http://host:port/')` to talk h2c, plus surfaces
// server-pushed streams ('stream' event on the ClientHttp2Session) which
// Soup's high-level Session API doesn't expose. TLS-h2 still routes through
// Soup (works transparently via ALPN); h2c routes here.
//
// One `Http2NativeClientDispatcher` per `ClientHttp2Session.connect()` call
// that takes the native path. Owns a `Gio.SocketClient`-opened TCP socket
// plus a `SessionBridge.new_client()` driving the nghttp2 state machine.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {
  hasNativeHttp2,
  loadNativeHttp2,
  type SessionBridge as SessionBridgeT,
} from '@gjsify/http2-native';

const READ_BUFFER_SIZE = 16 * 1024;

/** Per-stream state on the client side. */
interface ClientStreamState {
  endStreamFromPeer: boolean;
  responseHeaders: Record<string, string | string[]> | null;
  bodyBuffer: Buffer[];
  bodyResolvers: Array<(value: IteratorResult<Buffer>) => void>;
  bodyClosed: boolean;
}

export interface NativeClientStreamEvent {
  streamId: number;
  headers: Record<string, string | string[]>;
  endStream: boolean;
  body: AsyncIterable<Buffer>;
}

export interface NativeClientPushPromiseEvent {
  parentStreamId: number;
  promisedStreamId: number;
  headers: Record<string, string | string[]>;
}

export interface NativeClientCallbacks {
  onResponse?: (event: NativeClientStreamEvent) => void;
  onPushPromise?: (event: NativeClientPushPromiseEvent) => void;
  onGoaway?: (lastStreamId: number, errorCode: number) => void;
  onClose?: () => void;
}

export class Http2NativeClientDispatcher {
  private _bridge: SessionBridgeT | null = null;
  private _connection: Gio.SocketConnection | null = null;
  private _inSource: GLib.Source | null = null;
  private _streams = new Map<number, ClientStreamState>();
  private _closed = false;
  private _callbacks: NativeClientCallbacks;
  private _connectError: Error | null = null;

  constructor(callbacks: NativeClientCallbacks = {}) {
    this._callbacks = callbacks;
  }

  static available(): boolean {
    return hasNativeHttp2();
  }

  /**
   * Synchronously connect to `host:port`. Throws on connection failure or
   * if the native bridge isn't loadable. The session preface + initial
   * SETTINGS are sent immediately.
   */
  connect(host: string, port: number): void {
    if (!hasNativeHttp2()) {
      throw new Error('@gjsify/http2-native prebuild not loadable — native client unavailable');
    }
    const native = loadNativeHttp2();
    if (!native) throw new Error('@gjsify/http2-native load failed');

    const bridge = native.SessionBridge.new_client();
    if (!bridge) throw new Error('SessionBridge.new_client() returned null');

    const client = new Gio.SocketClient();
    let connection: Gio.SocketConnection;
    try {
      // connect_to_host accepts a bare hostname AND a default port for when
      // host_and_port doesn't include one. We pass host directly.
      connection = client.connect_to_host(host, port, null);
    } catch (err) {
      this._connectError = err instanceof Error ? err : new Error(String(err));
      bridge.close();
      throw this._connectError;
    }
    const socket = connection.get_socket();
    socket.set_blocking(false);

    this._bridge = bridge;
    this._connection = connection;

    bridge.connect('headers-received', (_b: unknown, streamId: number, headersVar: GLib.Variant, endStream: boolean) => {
      this._onHeaders(streamId, headersVar, endStream);
    });
    bridge.connect('data-received', (_b: unknown, streamId: number, chunk: GLib.Bytes, endStream: boolean) => {
      this._onData(streamId, chunk, endStream);
    });
    bridge.connect('stream-closed', (_b: unknown, streamId: number, _errorCode: number) => {
      this._onStreamClosed(streamId);
    });
    bridge.connect('frame-send-ready', () => {
      this._flushOutput();
    });
    bridge.connect('goaway-received', (_b: unknown, lastStreamId: number, errorCode: number) => {
      if (this._callbacks.onGoaway) this._callbacks.onGoaway(lastStreamId, errorCode);
      this._close();
    });
    bridge.connect('push-promise-received', (_b: unknown, parentSid: number, promisedSid: number, headersVar: GLib.Variant) => {
      this._onPushPromise(parentSid, promisedSid, headersVar);
    });

    // Drain initial preface + SETTINGS to the server.
    this._flushOutput();

    const inStream = connection.get_input_stream() as unknown as Gio.PollableInputStream;
    const inSource = inStream.create_source(null);
    type PollableCallback = (_obj: unknown) => boolean;
    const cb: PollableCallback = () => {
      if (this._closed) return false;
      try {
        const bytes = (connection.get_input_stream() as Gio.InputStream).read_bytes(READ_BUFFER_SIZE, null);
        const n = bytes.get_size();
        if (n === 0) {
          this._close();
          return false;
        }
        bridge.feed_input(bytes);
        bridge.dispatch_pending();
        this._flushOutput();
      } catch (err) {
        if (err instanceof GLib.Error && err.matches(Gio.io_error_quark(), Gio.IOErrorEnum.WOULD_BLOCK)) {
          return true;
        }
        this._close();
        return false;
      }
      return true;
    };
    inSource.set_callback(cb as unknown as GLib.SourceFunc);
    inSource.attach(GLib.MainContext.default());
    this._inSource = inSource;
  }

  /**
   * Submit a new request stream. Returns the freshly-allocated odd client
   * stream id and an async iterator for response DATA. Headers arrive via
   * the `onResponse` callback once the server emits HEADERS.
   *
   * The caller is expected to follow up with `writeData()` (one or more
   * times, finally with `endStream: true`) if the request has a body.
   */
  submitRequest(headers: Record<string, string | string[]>, endStream: boolean): number {
    if (!this._bridge) throw new Error('Native client session is not connected');
    const { names, values } = headersRecordToArrays(headers);
    const streamId = this._bridge.submit_request(names, values, endStream);
    if (!streamId) return 0;
    this._streams.set(streamId, {
      endStreamFromPeer: false,
      responseHeaders: null,
      bodyBuffer: [],
      bodyResolvers: [],
      bodyClosed: false,
    });
    this._flushOutput();
    return streamId;
  }

  writeData(streamId: number, chunk: Buffer, endStream: boolean): void {
    if (!this._bridge) return;
    const bytes = GLib.Bytes.new(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    this._bridge.submit_data(streamId, bytes, endStream);
    this._flushOutput();
  }

  /** Iterate response body chunks for a given stream id. */
  body(streamId: number): AsyncIterable<Buffer> {
    const state = this._streams.get(streamId);
    if (!state) {
      return (async function* () {})();
    }
    return makeBodyIterator(state);
  }

  /** Read pseudo-headers + regular headers received for a stream. */
  responseHeaders(streamId: number): Record<string, string | string[]> | null {
    const state = this._streams.get(streamId);
    return state ? state.responseHeaders : null;
  }

  close(): void {
    this._close();
  }

  private _close(): void {
    if (this._closed) return;
    this._closed = true;
    try { this._bridge?.submit_goaway(0, 0); this._flushOutput(); } catch {}
    if (this._inSource) {
      try { this._inSource.destroy(); } catch {}
      this._inSource = null;
    }
    try { this._connection?.close(null); } catch {}
    this._connection = null;
    try { this._bridge?.close(); } catch {}
    this._bridge = null;
    for (const state of this._streams.values()) {
      state.bodyClosed = true;
      while (state.bodyResolvers.length > 0) {
        state.bodyResolvers.shift()!({ value: undefined as unknown as Buffer, done: true });
      }
    }
    if (this._callbacks.onClose) this._callbacks.onClose();
  }

  private _flushOutput(): void {
    if (this._closed || !this._bridge || !this._connection) return;
    const out = this._bridge.drain_output();
    if (out.get_size() === 0) return;
    const data = out.get_data() as Uint8Array;
    try {
      this._connection.get_output_stream().write(data, null);
    } catch {
      this._close();
    }
  }

  private _onHeaders(streamId: number, headersVar: GLib.Variant, endStream: boolean): void {
    const pairs = headersVar.deep_unpack() as Array<[string, string]>;
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of pairs) {
      if (name in headers) {
        const existing = headers[name];
        if (Array.isArray(existing)) existing.push(value);
        else headers[name] = [existing as string, value];
      } else {
        headers[name] = value;
      }
    }
    const state = this._streams.get(streamId);
    if (state) {
      state.responseHeaders = headers;
      if (endStream) state.bodyClosed = true;
    }
    if (this._callbacks.onResponse) {
      const stateForBody = state ?? this._registerStreamForPush(streamId);
      this._callbacks.onResponse({
        streamId,
        headers,
        endStream,
        body: makeBodyIterator(stateForBody),
      });
    }
  }

  private _onData(streamId: number, chunk: GLib.Bytes, endStream: boolean): void {
    const state = this._streams.get(streamId);
    if (!state) return;
    if (chunk.get_size() > 0) {
      const buf = Buffer.from(chunk.get_data() as Uint8Array);
      if (state.bodyResolvers.length > 0) {
        state.bodyResolvers.shift()!({ value: buf, done: false });
      } else {
        state.bodyBuffer.push(buf);
      }
    }
    if (endStream) {
      state.bodyClosed = true;
      while (state.bodyResolvers.length > 0) {
        state.bodyResolvers.shift()!({ value: undefined as unknown as Buffer, done: true });
      }
    }
  }

  private _onStreamClosed(streamId: number): void {
    const state = this._streams.get(streamId);
    if (state) {
      state.bodyClosed = true;
      while (state.bodyResolvers.length > 0) {
        state.bodyResolvers.shift()!({ value: undefined as unknown as Buffer, done: true });
      }
    }
    // Keep state alive briefly so any pending body iteration can drain.
    // The bridge has the final word on lifecycle.
  }

  private _onPushPromise(parentStreamId: number, promisedStreamId: number, headersVar: GLib.Variant): void {
    const pairs = headersVar.deep_unpack() as Array<[string, string]>;
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of pairs) headers[name] = value;
    // Register state for the promised stream so subsequent HEADERS/DATA
    // arrives on a known stream.
    this._registerStreamForPush(promisedStreamId);
    if (this._callbacks.onPushPromise) {
      this._callbacks.onPushPromise({ parentStreamId, promisedStreamId, headers });
    }
  }

  private _registerStreamForPush(streamId: number): ClientStreamState {
    let state = this._streams.get(streamId);
    if (!state) {
      state = {
        endStreamFromPeer: false,
        responseHeaders: null,
        bodyBuffer: [],
        bodyResolvers: [],
        bodyClosed: false,
      };
      this._streams.set(streamId, state);
    }
    return state;
  }
}

function makeBodyIterator(state: ClientStreamState): AsyncIterable<Buffer> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<Buffer> {
      return {
        next(): Promise<IteratorResult<Buffer>> {
          if (state.bodyBuffer.length > 0) {
            return Promise.resolve({ value: state.bodyBuffer.shift()!, done: false });
          }
          if (state.bodyClosed) {
            return Promise.resolve({ value: undefined as unknown as Buffer, done: true });
          }
          return new Promise<IteratorResult<Buffer>>((resolve) => {
            state.bodyResolvers.push(resolve);
          });
        },
      };
    },
  };
}

function headersRecordToArrays(
  headers: Record<string, string | number | string[]>,
): { names: string[]; values: string[] } {
  const names: string[] = [];
  const values: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        names.push(key);
        values.push(String(v));
      }
    } else {
      names.push(key);
      values.push(String(value));
    }
  }
  return { names, values };
}

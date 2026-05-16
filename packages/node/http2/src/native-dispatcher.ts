// Native HTTP/2 dispatcher backed by @gjsify/http2-native's SessionBridge.
//
// Phase 1 scope (this file):
//   • cleartext HTTP/2 (h2c) on plain TCP — `createServer({ allowHTTP1: false })`
//     and `createServer({ nativeDispatcher: 'force' })`.
//   • Soup is fully bypassed when the dispatcher takes a connection.
//
// Out of scope (Phase 2+):
//   • TLS+ALPN routing: dispatcher takes h2-negotiated TLS connections; Soup
//     keeps http/1.1. Lands once we wire `Gio.TlsServerConnection` on top
//     of the socket. The structural hooks are present below (see _wireTls).
//   • PUSH_PROMISE wire delivery — already submitted via
//     `SessionBridge.submit_push_promise()`, just needs the
//     `Http2ServerResponse` write paths to route via the dispatcher
//     (Phase 2 work).
//
// Lifecycle: one `Http2NativeDispatcher` per `Http2Server.listen()` call when
// the native path takes over. Owns a `Gio.SocketService` plus a Set of live
// `NativeConnection` records, each with its own `SessionBridge` + socket
// watches. GC pinning is mandatory — historical race in the gjsify codebase:
// SpiderMonkey would collect a SessionBridge while nghttp2 still held a
// reference, causing SIGSEGV in `g_source_unref_internal`.

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import {
  hasNativeHttp2,
  loadNativeHttp2,
  type SessionBridge as SessionBridgeT,
} from '@gjsify/http2-native';

/** Bytes the bridge needs to recognize the h2c client preface (RFC 7540 §3.5). */
const PREFACE_LEN = 24;

/** Read buffer size for socket IN-watch pumps. */
const READ_BUFFER_SIZE = 16 * 1024;

/**
 * The dispatcher emits incoming requests by invoking this handler. The shape
 * matches what `Http2Server._handleNativeStream()` consumes — explicit
 * separation so `server.ts` can keep its existing Soup hooks intact and the
 * native path just plugs into the same emitter surface.
 */
export interface NativeStreamHandler {
  (event: NativeStreamEvent): void;
}

/**
 * Per-stream submit handle the dispatcher hands to its caller. Used by
 * `@gjsify/http2`'s server.ts to route response writes, DATA frames, and
 * push-promise allocations through the SessionBridge that owns the
 * underlying TCP connection.
 *
 * Pushed streams reuse the parent's connection (single TCP socket per
 * HTTP/2 session) — `pushPromise()` allocates a server-side stream-id
 * via `SessionBridge.submit_push_promise()` and returns a sibling backend
 * the caller can use to dispatch the pushed response.
 */
export interface NativeStreamBackend {
  /** Connection-unique stream id this backend writes to. */
  readonly streamId: number;
  /** Submit a response (status + headers) back through the wire. */
  respond(headers: Record<string, string | number | string[]>, endStream: boolean): void;
  /** Submit a DATA frame for this stream. */
  writeData(chunk: Buffer, endStream: boolean): void;
  /** RST_STREAM to abort. */
  reset(errorCode?: number): void;
  /**
   * Submit a PUSH_PROMISE on this stream. Returns the freshly-allocated
   * pushed-stream backend (null on error / push disabled). The caller
   * then dispatches headers + body through the returned backend.
   */
  pushPromise(headers: Record<string, string | number | string[]>): NativeStreamBackend | null;
}

export interface NativeStreamEvent {
  /** Connection-unique stream id (odd, client-initiated). */
  streamId: number;
  /** Pseudo-headers + regular request headers, lower-cased names. */
  headers: Record<string, string | string[]>;
  /** %TRUE if the HEADERS frame also carried END_STREAM (no body to follow). */
  endStream: boolean;
  /** Remote peer address — populated for `req.socket` in the server adapter. */
  remoteAddress: string;
  /** Remote peer port. */
  remotePort: number;
  /** Local listening port. */
  localPort: number;
  /** Async iterator yielding DATA chunks for this stream. */
  body: AsyncIterable<Buffer>;
  /** Per-stream submit handle. Use this for response/data/push-promise. */
  backend: NativeStreamBackend;
}

interface NativeConnection {
  bridge: SessionBridgeT;
  socket: Gio.Socket;
  inStream: Gio.InputStream;
  outStream: Gio.OutputStream;
  inSource: GLib.Source | null;
  /** Active streams keyed by stream id. */
  streams: Map<number, NativeStreamState>;
  /** Bytes queued to write but not yet flushed (output stream backpressure). */
  pendingWrite: Uint8Array | null;
  closed: boolean;
  remoteAddress: string;
  remotePort: number;
}

interface NativeStreamState {
  endStreamFromPeer: boolean;
  bodyBuffer: Buffer[];
  bodyResolvers: Array<(value: IteratorResult<Buffer>) => void>;
  bodyClosed: boolean;
  responseSubmitted: boolean;
}

export class Http2NativeDispatcher {
  private _service: Gio.SocketService | null = null;
  private _connections = new Set<NativeConnection>();
  private _listenPort = 0;
  private _handler: NativeStreamHandler;
  /** When true, the dispatcher peeks 24 bytes per accepted socket and routes
   * non-preface connections back to the fallback callback (Soup HTTP/1.1). */
  private _prefaceGate: boolean;
  /** Called when the peeked bytes don't match the h2c preface — caller hands
   * the socket to Soup (or whatever the fallback path is). */
  private _onNonH2c: ((connection: Gio.SocketConnection, peeked: Uint8Array) => void) | null;

  constructor(opts: {
    handler: NativeStreamHandler;
    prefaceGate?: boolean;
    onNonH2c?: (connection: Gio.SocketConnection, peeked: Uint8Array) => void;
  }) {
    this._handler = opts.handler;
    this._prefaceGate = opts.prefaceGate ?? false;
    this._onNonH2c = opts.onNonH2c ?? null;
  }

  /** Whether the GjsifyHttp2 typelib is loadable in this process. */
  static available(): boolean {
    return hasNativeHttp2();
  }

  listen(port: number): number {
    if (!hasNativeHttp2()) {
      throw new Error('@gjsify/http2-native prebuild not loadable — dispatcher unavailable');
    }
    this._service = new Gio.SocketService();

    let chosenPort = port;
    if (port > 0) {
      const ok = this._service.add_inet_port(port, null);
      if (!ok) throw new Error(`Failed to bind native HTTP/2 dispatcher on port ${port}`);
    } else {
      // Ephemeral port: bind via add_address so we can observe the
      // assigned port through the returned out-pointer.
      const inetAddr = Gio.InetAddress.new_from_string('0.0.0.0')
        ?? Gio.InetAddress.new_any(Gio.SocketFamily.IPV4);
      const sockAddr = Gio.InetSocketAddress.new(inetAddr, 0);
      const [ok, effectiveAddr] = this._service.add_address(
        sockAddr,
        Gio.SocketType.STREAM,
        Gio.SocketProtocol.TCP,
        null,
      );
      if (!ok) throw new Error('Failed to bind native HTTP/2 dispatcher on ephemeral port');
      const inet = effectiveAddr as Gio.InetSocketAddress;
      if (inet && typeof inet.get_port === 'function') {
        chosenPort = inet.get_port();
      }
    }
    this._listenPort = chosenPort;

    this._service.connect('incoming', (_svc: Gio.SocketService, connection: Gio.SocketConnection) => {
      this._acceptConnection(connection);
      return true;
    });
    this._service.start();
    return chosenPort;
  }

  close(): void {
    if (this._service) {
      this._service.stop();
      try {
        this._service.close();
      } catch {
        // close() is missing on older Gio versions; the stop() above releases the listen socket.
      }
      this._service = null;
    }
    for (const conn of this._connections) this._closeConnection(conn);
    this._connections.clear();
  }

  private _acceptConnection(connection: Gio.SocketConnection): void {
    const socket = connection.get_socket();
    socket.set_blocking(false);
    const remote = connection.get_remote_address() as Gio.InetSocketAddress | null;
    const remoteAddress = remote ? (remote.get_address() as Gio.InetAddress).to_string() : '127.0.0.1';
    const remotePort = remote && typeof remote.get_port === 'function' ? remote.get_port() : 0;

    if (this._prefaceGate) {
      // Peek the first 24 bytes to decide h2c vs HTTP/1.1. GIR doesn't
      // surface MSG_PEEK; we actually consume the bytes and feed them into
      // the bridge below if they match the preface.
      try {
        const ready = socket.condition_check(GLib.IOCondition.IN);
        if (ready & GLib.IOCondition.IN) {
          const [n, buf] = (socket as unknown as { receive: (size: number, c: Gio.Cancellable | null) => [number, Uint8Array] }).receive(READ_BUFFER_SIZE, null);
          if (n >= PREFACE_LEN && bytesAreH2Preface(buf)) {
            this._setupNativeConnection(connection, socket, buf.slice(0, n), remoteAddress, remotePort);
            return;
          }
          if (this._onNonH2c) {
            this._onNonH2c(connection, buf.slice(0, n));
          }
          return;
        }
      } catch {
        // Fall through to default native handling.
      }
    }

    this._setupNativeConnection(connection, socket, null, remoteAddress, remotePort);
  }

  private _setupNativeConnection(
    connection: Gio.SocketConnection,
    socket: Gio.Socket,
    primedBytes: Uint8Array | null,
    remoteAddress: string,
    remotePort: number,
  ): void {
    const native = loadNativeHttp2();
    if (!native) {
      try { connection.close(null); } catch {}
      return;
    }
    const bridge = native.SessionBridge.new_server();
    if (!bridge) {
      try { connection.close(null); } catch {}
      return;
    }

    const conn: NativeConnection = {
      bridge,
      socket,
      inStream: connection.get_input_stream(),
      outStream: connection.get_output_stream(),
      inSource: null,
      streams: new Map(),
      pendingWrite: null,
      closed: false,
      remoteAddress,
      remotePort,
    };
    this._connections.add(conn);

    bridge.connect('headers-received', (_b: unknown, streamId: number, headersVar: GLib.Variant, endStream: boolean) => {
      this._onHeaders(conn, streamId, headersVar, endStream);
    });
    bridge.connect('data-received', (_b: unknown, streamId: number, chunk: GLib.Bytes, endStream: boolean) => {
      this._onData(conn, streamId, chunk, endStream);
    });
    bridge.connect('stream-closed', (_b: unknown, streamId: number, errorCode: number) => {
      this._onStreamClosed(conn, streamId, errorCode);
    });
    bridge.connect('frame-send-ready', () => {
      this._flushOutput(conn);
    });
    bridge.connect('goaway-received', () => {
      this._closeConnection(conn);
    });

    // If we already pre-read the preface bytes for the gate, feed them now.
    if (primedBytes && primedBytes.byteLength > 0) {
      bridge.feed_input(GLib.Bytes.new(primedBytes));
      bridge.dispatch_pending();
      this._flushOutput(conn);
    }

    // Drain the bridge's initial SETTINGS frame onto the wire.
    this._flushOutput(conn);

    // Set up an IN-readiness watch via the connection's PollableInputStream.
    // We can't use `Gio.Socket.create_source()` from JS — the GIR marks it
    // `introspectable=0` because the callback type GSocketSourceFunc can't
    // round-trip through introspection. `Gio.PollableInputStream.create_source()`
    // is introspectable (callback = GPollableSourceFunc with a single
    // `unowned Object` arg) and triggers identically for socket I/O on the
    // socket-backed GSocketInputStream.
    const pollableIn = conn.inStream as unknown as Gio.PollableInputStream;
    const inSource = pollableIn.create_source(null);
    type PollableCallback = (_obj: unknown) => boolean;
    const cb: PollableCallback = () => {
      if (conn.closed) return false; // GLib.SOURCE_REMOVE
      try {
        // `Gio.Socket.receive` is not JS-introspectable (caller-allocates
        // buffer rejected at runtime). `InputStream.read_bytes(count, cancellable)`
        // is — and since the pollable source has already signalled
        // readability, the read returns immediately with what's available.
        const bytes = conn.inStream.read_bytes(READ_BUFFER_SIZE, null);
        const n = bytes.get_size();
        if (n === 0) {
          this._closeConnection(conn);
          return false;
        }
        bridge.feed_input(bytes);
        bridge.dispatch_pending();
        this._flushOutput(conn);
      } catch (err) {
        if (err instanceof GLib.Error && err.matches(Gio.io_error_quark(), Gio.IOErrorEnum.WOULD_BLOCK)) {
          return true;
        }
        this._closeConnection(conn);
        return false;
      }
      return true; // GLib.SOURCE_CONTINUE
    };
    inSource.set_callback(cb as unknown as GLib.SourceFunc);
    inSource.attach(GLib.MainContext.default());
    conn.inSource = inSource;
  }

  private _flushOutput(conn: NativeConnection): void {
    if (conn.closed) return;
    const out = conn.bridge.drain_output();
    if (out.get_size() === 0) return;
    const data = out.get_data() as Uint8Array;
    try {
      // For now: blocking write. With the small frames produced by nghttp2
      // (mostly < 16 KiB) and a non-blocking socket plus the local TCP buffer,
      // this is rarely backpressure-limited in practice. Per-connection OUT
      // watch becomes load-bearing for large bodies — Phase 4 work.
      const written = conn.outStream.write(data, null);
      void written;
    } catch {
      this._closeConnection(conn);
    }
  }

  private _onHeaders(
    conn: NativeConnection,
    streamId: number,
    headersVar: GLib.Variant,
    endStream: boolean,
  ): void {
    const pairs = headersVar.deep_unpack() as Array<[string, string]>;
    const headers: Record<string, string | string[]> = {};
    for (const [name, value] of pairs) {
      const lower = name.toLowerCase();
      if (lower in headers) {
        const existing = headers[lower];
        if (Array.isArray(existing)) existing.push(value);
        else headers[lower] = [existing as string, value];
      } else {
        headers[lower] = value;
      }
    }

    const streamState: NativeStreamState = {
      endStreamFromPeer: endStream,
      bodyBuffer: [],
      bodyResolvers: [],
      bodyClosed: endStream,
      responseSubmitted: false,
    };
    conn.streams.set(streamId, streamState);

    const event: NativeStreamEvent = {
      streamId,
      headers,
      endStream,
      remoteAddress: conn.remoteAddress,
      remotePort: conn.remotePort,
      localPort: this._listenPort,
      body: this._makeBodyIterator(streamState),
      backend: this._makeBackend(conn, streamId),
    };

    // Defer the handler call by one tick — gives JS code a chance to wire up
    // body iteration before the first DATA chunk arrives.
    Promise.resolve().then(() => {
      try {
        this._handler(event);
      } catch (err) {
        const e = err as Error;
        // eslint-disable-next-line no-console
        console.error('Http2NativeDispatcher: handler threw:', e.message ?? String(err), e.stack ?? '');
      }
    });
  }

  private _onData(conn: NativeConnection, streamId: number, chunk: GLib.Bytes, endStream: boolean): void {
    const state = conn.streams.get(streamId);
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

  private _onStreamClosed(conn: NativeConnection, streamId: number, _errorCode: number): void {
    const state = conn.streams.get(streamId);
    if (state) {
      state.bodyClosed = true;
      while (state.bodyResolvers.length > 0) {
        state.bodyResolvers.shift()!({ value: undefined as unknown as Buffer, done: true });
      }
    }
    conn.streams.delete(streamId);
  }

  /**
   * Build a per-stream submit handle on the given connection. Pushed
   * streams (allocated via `submit_push_promise`) share the underlying
   * `SessionBridge` so they can reuse this same factory.
   */
  private _makeBackend(conn: NativeConnection, streamId: number): NativeStreamBackend {
    return {
      streamId,
      respond: (headers, endStream) => {
        this._submitResponse(conn, streamId, headers, endStream);
      },
      writeData: (chunk, endStream) => {
        this._submitData(conn, streamId, chunk, endStream);
      },
      reset: (errorCode = 0) => {
        try { conn.bridge.submit_rst_stream(streamId, errorCode); } catch {}
        this._flushOutput(conn);
      },
      pushPromise: (pushHeaders) => {
        const { names, values } = headersRecordToArrays(pushHeaders);
        const promised = conn.bridge.submit_push_promise(streamId, names, values);
        this._flushOutput(conn);
        if (!promised) return null;
        // Register a minimal stream state so subsequent submit_response /
        // submit_data flows through the standard `_submitResponse` /
        // `_submitData` path with the "responseSubmitted" guard intact.
        conn.streams.set(promised, {
          endStreamFromPeer: true,  // pushed streams have no inbound DATA
          bodyBuffer: [],
          bodyResolvers: [],
          bodyClosed: true,
          responseSubmitted: false,
        });
        return this._makeBackend(conn, promised);
      },
    };
  }

  private _submitResponse(
    conn: NativeConnection,
    streamId: number,
    headers: Record<string, string | number | string[]>,
    endStream: boolean,
  ): void {
    const state = conn.streams.get(streamId);
    if (!state || state.responseSubmitted) return;
    state.responseSubmitted = true;
    const { names, values } = headersRecordToArrays(headers);
    conn.bridge.submit_response(streamId, names, values, endStream);
    this._flushOutput(conn);
  }

  private _submitData(conn: NativeConnection, streamId: number, chunk: Buffer, endStream: boolean): void {
    if (chunk.length === 0 && !endStream) return;
    const bytes = GLib.Bytes.new(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    conn.bridge.submit_data(streamId, bytes, endStream);
    this._flushOutput(conn);
  }

  private _makeBodyIterator(state: NativeStreamState): AsyncIterable<Buffer> {
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

  private _closeConnection(conn: NativeConnection): void {
    if (conn.closed) return;
    conn.closed = true;
    // Submit a GOAWAY frame and flush it onto the wire BEFORE we tear down
    // the streams. Without the explicit flush the peer would see only EOF
    // (kernel FIN) and never receive the GOAWAY frame nghttp2 just queued.
    try { conn.bridge.submit_goaway(0, 0); } catch {}
    try { this._flushOutput(conn); } catch {}
    if (conn.inSource) {
      try { conn.inSource.destroy(); } catch {}
      conn.inSource = null;
    }
    // Half-close the write side so the kernel sends FIN AFTER the GOAWAY
    // bytes we just flushed. The peer drains its read side cleanly. Without
    // shutdown the abrupt close might drop the buffered GOAWAY.
    try {
      (conn.socket as unknown as { shutdown: (read: boolean, write: boolean) => boolean })
        .shutdown(false, true);
    } catch {}
    // Drain any pending body resolvers so awaiting iterators don't hang.
    for (const state of conn.streams.values()) {
      state.bodyClosed = true;
      while (state.bodyResolvers.length > 0) {
        state.bodyResolvers.shift()!({ value: undefined as unknown as Buffer, done: true });
      }
    }
    // Schedule the actual socket close on a later idle tick so the GOAWAY
    // bytes have time to leave our send buffer. shutdown alone doesn't
    // block; the peer is still reading at this point.
    const finalClose = () => {
      try { conn.outStream.close(null); } catch {}
      try { conn.inStream.close(null); } catch {}
      try { conn.socket.close(); } catch {}
      try { conn.bridge.close(); } catch {}
    };
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { finalClose(); return false; });
    this._connections.delete(conn);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PREFACE_BYTES = new Uint8Array([
  0x50, 0x52, 0x49, 0x20, 0x2a, 0x20, 0x48, 0x54,
  0x54, 0x50, 0x2f, 0x32, 0x2e, 0x30, 0x0d, 0x0a,
  0x0d, 0x0a, 0x53, 0x4d, 0x0d, 0x0a, 0x0d, 0x0a,
]);

function bytesAreH2Preface(buf: Uint8Array): boolean {
  if (buf.length < PREFACE_LEN) return false;
  for (let i = 0; i < PREFACE_LEN; i++) if (buf[i] !== PREFACE_BYTES[i]) return false;
  return true;
}

/**
 * Translate a Node-style headers record into the (names[], values[]) pair
 * shape `SessionBridge.submit_response()` / `submit_push_promise()` consume.
 * Pseudo-headers are kept in the order they appear in the input; HTTP/2
 * requires `:status` first for responses, but `submit_response()` accepts
 * any order — nghttp2 reorders internally.
 */
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

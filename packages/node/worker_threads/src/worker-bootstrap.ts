// GJS worker child-process bootstrap JS-as-string. Originally inlined in
// worker.ts pre-split; extracted because the template alone is ~330 LoC
// of subprocess-side IPC + SharedBuffer + cross-process MessagePort logic
// that runs in a completely separate runtime (spawned gjs child), making
// it a natural standalone unit — the parent-side Worker class never
// touches the body, only writes the encoded bytes to a temp .mjs file
// and hands the path to Gio.SubprocessLauncher.
//
// Reference: Node.js lib/internal/worker.js.

// GJS worker bootstrap script — runs in the child gjs process,
// sets up IPC via stdin/stdout pipes using gi:// imports.
//
// SharedBuffer side-channel: when init.sabSocketFd is a valid fd
// (always 3 in our spawn setup — child end of the parent's FdChannel
// socketpair), each JSON-side message that carries SharedBuffer
// placeholders is paired with exactly N preceding SCM_RIGHTS sends on
// fd 3. The parent always sends fds BEFORE writing the JSON line, and
// kernel buffering guarantees the fds are sitting in the side-channel
// socket buffer by the time the child reads the JSON. So after parsing
// each incoming message we count placeholders, call recv_fd that many
// times synchronously (returns immediately because data is ready),
// then materialise.
//
// Loading @gjsify/sab-native: the bootstrap can't `import` it (no
// module-resolution context in the spawned gjs -m), so it pulls the
// typelib directly via `imports.gi.GjsifySabNative` — same lazy
// pattern as the TS facade. If the typelib isn't on
// GI_TYPELIB_PATH (sab-native prebuild absent), the recv-loop stays
// dormant and any incoming __sab placeholder will fail loudly when
// resolveTag throws.
export const BOOTSTRAP_CODE = `\
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import System from 'system';

const loop = new GLib.MainLoop(null, false);

// Shutdown bookkeeping.
//
// \`loop.run()\` is the LAST statement of this module — it only starts after
// the worker's own script has finished. \`loop.quit()\` on a loop that is not
// running yet is a silent NO-OP, so every shutdown request that arrives while
// the worker script is still executing used to be lost: the module went on to
// call \`loop.run()\` afterwards and the child ran forever.
//
// The parent's death is exactly that case. When the spawner dies its end of
// our stdin pipe closes, the reader below sees EOF and asked the loop to quit
// — too early to matter. The child then sat in \`loop.run()\` with no armed
// source, or (when its script had a still-pending top-level await, which GJS
// services by spinning the job queue) burned a full core, forever. Node's
// workers are threads and die with the process that owns them; an orphan that
// outlives — and out-CPUs — its parent is never right.
//
// So: record the request (\`shuttingDown\`) and honour it at both ends —
// \`loop.run()\` is skipped when shutdown was already requested, and the EOF
// path exits the process outright so a worker script that never settles
// cannot keep the orphan alive either. \`terminate\`/\`parentPort.close()\`
// deliberately keep the softer flag-only path: their parent is alive and
// waiting on the exit event, and \`Worker.terminate()\` already has a
// \`force_exit()\` backstop for a wedged script.
let shuttingDown = false;
function requestShutdown() {
  shuttingDown = true;
  loop.quit();
}
const stdinStream = Gio.UnixInputStream.new(0, false);
const dataIn = Gio.DataInputStream.new(stdinStream);
const stdoutStream = Gio.UnixOutputStream.new(1, false);

const _encoder = new TextEncoder();

function send(obj) {
  const line = JSON.stringify(obj) + '\\n';
  stdoutStream.write_all(_encoder.encode(line), null);
}

// Try to load the sab-native typelib synchronously. Absent prebuild
// is fine — only fails the receive path when a SharedBuffer actually
// crosses the wire.
let SabNative = null;
try { SabNative = imports.gi.GjsifySabNative; } catch (_) { /* prebuild missing */ }

// Read init data (first line, blocking)
const [initLine] = dataIn.read_line_utf8(null);
const init = JSON.parse(initLine);

// fd → SharedBuffer cache keyed by tag. Filled by drainSabFds() right
// before materialise() walks the parsed JSON.
const sabFds = new Map();

// Count how many SharedBuffer placeholders sit in a parsed JSON value.
// The exact count is what we pass to drainSabFds().
function countSabPlaceholders(value) {
  if (value === null || typeof value !== 'object') return 0;
  if (typeof value.__sab === 'number' && typeof value.size === 'number') return 1;
  if (Array.isArray(value)) {
    let n = 0;
    for (const v of value) n += countSabPlaceholders(v);
    return n;
  }
  if (Object.prototype.toString.call(value) === '[object Object]') {
    let n = 0;
    for (const v of Object.values(value)) n += countSabPlaceholders(v);
    return n;
  }
  return 0;
}

// Synchronously drain exactly @count SCM_RIGHTS messages from fd 3,
// indexing each received fd by its sender-encoded tag. Called once per
// incoming JSON message that contains __sab placeholders. recv_fd
// blocks at most until the kernel has the message — and the sender
// always sends fds before writing to stdin, so by the time we get
// here every fd is already buffered.
function drainSabFds(count) {
  if (!SabNative || count <= 0) return;
  for (let i = 0; i < count; i++) {
    const [fd, tag] = SabNative.FdChannel.recv_fd(3);
    if (fd <= 0) throw new Error('FdChannel.recv_fd returned ' + fd + ' while draining ' + count + ' fds');
    sabFds.set(tag, fd);
  }
}

function materialise(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.__sab === 'number' && typeof value.size === 'number') {
    const fd = sabFds.get(value.__sab);
    if (fd === undefined) throw new Error('SharedBuffer placeholder \\'' + value.__sab + '\\' arrived before its fd');
    if (!SabNative) throw new Error('SharedBuffer placeholder arrived but @gjsify/sab-native typelib not loaded');
    const native = SabNative.SharedBuffer.from_fd(fd, value.size);
    sabFds.delete(value.__sab);
    return makeSharedBuffer(native);
  }
  if (isPortPlaceholder(value)) {
    return makeChildSidePort(value.portId);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = materialise(value[i]);
    return value;
  }
  if (Object.prototype.toString.call(value) === '[object Object]') {
    for (const k of Object.keys(value)) value[k] = materialise(value[k]);
    return value;
  }
  return value;
}

function makeSharedBuffer(native) {
  return {
    get byteLength() { return native.byte_length; },
    get fd() { return native.fd; },
    getUint8(off) { return native.get_u8(off); },
    setUint8(off, v) { native.set_u8(off, v); },
    getInt32LE(off) { return native.get_i32_le(off); },
    setInt32LE(off, v) { native.set_i32_le(off, v); },
    getUint32LE(off) { return native.get_u32_le(off); },
    setUint32LE(off, v) { native.set_u32_le(off, v); },
    getUint64LE(off) { return native.get_u64_le(off); },
    setUint64LE(off, v) { native.set_u64_le(off, v); },
    readBytes(off, len) {
      const bytes = native.read_bytes(off, len);
      const data = bytes.get_data();
      return data ? new Uint8Array(data) : new Uint8Array(0);
    },
    writeBytes(off, data) { native.write_bytes(off, new GLib.Bytes(data)); },
    get _nativeHandle() { return native; },
    get constructor() { return { name: 'SharedBuffer' }; },
  };
}

// Cross-process MessagePort support (child side).
//
// When a parent's Worker.postMessage(value, [port2]) transfers a
// MessagePort, the parent encodes the port as a placeholder
// { __gjsifyTransferredPort: true, portId: <id> } and ships the rest of
// the value as JSON. On this side, materialise() walks the parsed JSON
// and substitutes each placeholder for a fresh "child-side port" — an
// inline EventEmitter-shaped object that mirrors the worker_threads
// MessagePort surface enough for user code (postMessage / on('message') /
// on('close') / close()). Outbound traffic via this port travels over
// stdout as { __msgport, op: 'send', data } JSON lines, which the parent's
// stdout-reader routes back to the kept end via the parent-side registry.
//
// transferList chaining (port-in-port) is intentionally not supported
// on the cross-process path in v1 — see status/open-todos.md.
const childPortRegistry = new Map();

function makeChildSidePort(portId) {
  const listeners = new Map();
  let closed = false;

  function emit(ev /* , ...args */) {
    const args = Array.prototype.slice.call(arguments, 1);
    const fns = (listeners.get(ev) || []).slice();
    for (const fn of fns) {
      try { fn.apply(null, args); } catch (_) { /* swallow */ }
    }
  }

  const port = {
    _portId: portId,
    /** @internal Wire-side delivery — called by the bootstrap stdin
     *  dispatcher when it receives a {__msgport: portId, op: 'send'}
     *  line. Schedules dispatch on a microtask so listeners fire after
     *  the current call stack unwinds — matches in-process MessagePort
     *  semantics. */
    _receive(data) {
      if (closed) return;
      Promise.resolve().then(() => { if (!closed) emit('message', data); });
    },
    /** @internal Called by the dispatcher when the parent sends
     *  {__msgport: portId, op: 'close'}. Fires the local 'close' event
     *  and stops accepting further messages. */
    _internalClose() {
      if (closed) return;
      closed = true;
      childPortRegistry.delete(portId);
      Promise.resolve().then(() => emit('close'));
    },
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
      return port;
    },
    once(ev, fn) {
      const w = function () { port.off(ev, w); fn.apply(null, arguments); };
      return port.on(ev, w);
    },
    off(ev, fn) {
      const arr = listeners.get(ev);
      if (arr) listeners.set(ev, arr.filter(function (f) { return f !== fn; }));
      return port;
    },
    addListener(ev, fn) { return port.on(ev, fn); },
    removeListener(ev, fn) { return port.off(ev, fn); },
    emit(ev /* , ...args */) {
      emit.apply(null, Array.prototype.slice.call(arguments));
      return port;
    },
    postMessage(data) {
      if (closed) return;
      send({ __msgport: portId, op: 'send', data });
    },
    close() {
      if (closed) return;
      closed = true;
      try { send({ __msgport: portId, op: 'close' }); } catch (_) {}
      childPortRegistry.delete(portId);
      Promise.resolve().then(() => emit('close'));
    },
    start() { /* no-op — child-side port dispatches on receive */ },
    ref() { return port; },
    unref() { return port; },
    get _isCrossProcess() { return true; },
    get constructor() { return { name: 'MessagePort' }; },
  };

  childPortRegistry.set(portId, port);
  return port;
}

function isPortPlaceholder(value) {
  return value !== null && typeof value === 'object'
    && value.__gjsifyTransferredPort === true
    && typeof value.portId === 'number';
}

// Drain SharedBuffer fds attached to the init line (workerData may carry
// SharedBuffer instances) before materialise() runs against it.
if (init.sabSocketFd === 3) {
  try {
    drainSabFds(countSabPlaceholders(init.workerData));
  } catch (err) {
    send({ type: 'error', message: 'init fd drain failed: ' + (err && err.message ? err.message : err), stack: '' });
  }
}

// Simplified EventEmitter for parentPort
const _listeners = new Map();
const parentPort = {
  on(ev, fn) {
    if (!_listeners.has(ev)) _listeners.set(ev, []);
    _listeners.get(ev).push(fn);
    return this;
  },
  once(ev, fn) {
    const w = (...a) => { parentPort.off(ev, w); fn(...a); };
    return parentPort.on(ev, w);
  },
  off(ev, fn) {
    const a = _listeners.get(ev);
    if (a) _listeners.set(ev, a.filter(f => f !== fn));
    return this;
  },
  emit(ev, ...a) { (_listeners.get(ev) || []).forEach(fn => fn(...a)); },
  postMessage(data) { send({ type: 'message', data }); },
  close() { send({ type: 'exit', code: 0 }); requestShutdown(); },
  removeAllListeners(ev) {
    if (ev) _listeners.delete(ev); else _listeners.clear();
    return this;
  },
};

// Set worker context globals (read by @gjsify/worker_threads when imported by user script)
globalThis.__gjsify_worker_context = {
  isMainThread: false,
  parentPort,
  workerData: materialise(init.workerData ?? null),
  threadId: init.threadId ?? 0,
};

send({ type: 'online' });

// Async stdin reader for messages from parent
function readNext() {
  dataIn.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
    try {
      const [line] = source.read_line_finish_utf8(result);
      if (line === null) {
        // EOF on stdin = the spawner is gone. Nothing can reach us again and
        // nobody is left to observe an exit code, so leave immediately —
        // even from inside the worker script's own pending top-level await.
        requestShutdown();
        System.exit(0);
        return;
      }
      const msg = JSON.parse(line);
      if (typeof msg.__msgport === 'number') {
        // Cross-process MessagePort traffic — route to the local child-
        // side port from childPortRegistry by portId. Both 'send' and
        // 'close' dispatch on a microtask inside the port's helpers, so
        // user listeners fire after the current stdin-callback unwinds.
        const cpPort = childPortRegistry.get(msg.__msgport);
        if (cpPort) {
          if (msg.op === 'send') cpPort._receive(msg.data);
          else if (msg.op === 'close') cpPort._internalClose();
        }
        // Unknown portId or op silently dropped — could happen mid-close
        // race where the parent sends a final message after the child has
        // already torn down the local port.
      }
      else if (msg.type === 'message') {
        // Drain fds for any SharedBuffer placeholders BEFORE materialise.
        // recv_fd is synchronous but the sender always wrote the SCM_RIGHTS
        // messages before writing this stdin line, so they're already
        // buffered.
        if (init.sabSocketFd === 3) drainSabFds(countSabPlaceholders(msg.data));
        parentPort.emit('message', materialise(msg.data));
      }
      else if (msg.type === 'terminate') { send({ type: 'exit', code: 1 }); requestShutdown(); return; }
      readNext();
    } catch (err) {
      try {
        send({ type: 'error', message: 'bootstrap message error: ' + (err && err.message ? err.message : err), stack: err && err.stack || '' });
      } catch (_) { /* parent's end of stdout is gone too — nothing to report to */ }
      requestShutdown();
    }
  });
}
readNext();

// Execute worker code
try {
  if (init.eval) {
    const AsyncFn = Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFn('parentPort', 'workerData', 'threadId', init.code)(
      parentPort, globalThis.__gjsify_worker_context.workerData, init.threadId
    );
  } else {
    await import(init.filename);
  }
} catch (error) {
  send({ type: 'error', message: error.message, stack: error.stack || '' });
}

// Skip the loop entirely when shutdown was requested while the script above
// was still running — otherwise that lost quit() strands the child forever.
if (!shuttingDown) loop.run();
`;

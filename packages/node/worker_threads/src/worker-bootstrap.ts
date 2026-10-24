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

// Tagged JSON codec for structured-clone types (mirrors structured-clone-wire.ts).
const __TYPED_ARRAYS = ['Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array'];
function __toB64(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s);}
function __fromB64(s){const bin=atob(s);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
function encodeWire(value, seen){
  if(value===null||value===undefined) return value;
  if(typeof value==='bigint') return {__gjsify:'BigInt', value:value.toString()};
  if(value===Infinity) return {__gjsify:'Infinity'};
  if(value===-Infinity) return {__gjsify:'NegInfinity'};
  if(typeof value==='number' && isNaN(value)) return {__gjsify:'NaN'};
  if(typeof value!=='object') return value;
  if(value instanceof Date) return {__gjsify:'Date', value:value.getTime()};
  if(value instanceof RegExp) return {__gjsify:'RegExp', source:value.source, flags:value.flags};
  if(value instanceof Error) return {__gjsify:'Error', name:value.name, message:value.message, stack:value.stack};
  if(value instanceof Map){const e=[];for(const [k,v] of value) e.push([encodeWire(k,seen),encodeWire(v,seen)]);return {__gjsify:'Map', entries:e};}
  if(value instanceof Set){const v=[];for(const x of value) v.push(encodeWire(x,seen));return {__gjsify:'Set', values:v};}
  const tag=Object.prototype.toString.call(value).slice(8,-1);
  if(tag==='ArrayBuffer') return {__gjsify:'ArrayBuffer', data:__toB64(value)};
  if(__TYPED_ARRAYS.indexOf(tag)!==-1){const ta=value;return {__gjsify:tag, data:__toB64(ta.buffer.slice(ta.byteOffset, ta.byteOffset+ta.byteLength))};}
  if(Array.isArray(value)) return value.map(function(x){return encodeWire(x,seen);});
  if(tag==='Object'){const out={};for(const k of Object.keys(value)) out[k]=encodeWire(value[k],seen);return out;}
  throw new Error('DataCloneError: value could not be cloned');
}
function decodeWire(value){
  if(value===null||value===undefined) return value;
  if(typeof value!=='object') return value;
  if(Array.isArray(value)) return value.map(decodeWire);
  const obj=value;
  if(typeof obj.__gjsify==='string'){
    switch(obj.__gjsify){
      case 'BigInt': return BigInt(obj.value);
      case 'Infinity': return Infinity;
      case 'NegInfinity': return -Infinity;
      case 'NaN': return NaN;
      case 'Date': return new Date(obj.value);
      case 'RegExp': return new RegExp(obj.source, obj.flags);
      case 'Error': {const e=new Error(obj.message); e.name=obj.name; if(obj.stack) e.stack=obj.stack; return e;}
      case 'Map': {const m=new Map(); for(const [k,v] of obj.entries) m.set(decodeWire(k),decodeWire(v)); return m;}
      case 'Set': {const s=new Set(); for(const v of obj.values) s.add(decodeWire(v)); return s;}
      case 'ArrayBuffer': return __fromB64(obj.data).buffer;
      default: {
        if(__TYPED_ARRAYS.indexOf(obj.__gjsify)!==-1){
          const bytes=__fromB64(obj.data);
          const Ctor=globalThis[obj.__gjsify];
          return new Ctor(bytes.buffer);
        }
        return value;
      }
    }
  }
  const tag=Object.prototype.toString.call(value).slice(8,-1);
  if(tag==='Object'){const out={};for(const k of Object.keys(obj)) out[k]=decodeWire(obj[k]);return out;}
  return value;
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
// on the cross-process path in v1 — see status/open-todos/README.md.
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
      Promise.resolve().then(() => { if (!closed) emit('message', decodeWire(data)); });
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
      send({ __msgport: portId, op: 'send', data: encodeWire(data) });
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
function _listenersChanged() { maybeExit(); }
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
    _listenersChanged();
    return this;
  },
  emit(ev, ...a) { (_listeners.get(ev) || []).forEach(fn => fn(...a)); },
  postMessage(data) { send({ type: 'message', data: encodeWire(data) }); },
  close() { send({ type: 'exit', code: 0 }); requestShutdown(); },
  removeAllListeners(ev) {
    if (ev) _listeners.delete(ev); else _listeners.clear();
    _listenersChanged();
    return this;
  },
};

// Worker-crash contract and the fallback timers behind it.
//
// GJS exposes no global error surface a bootstrap could catch into: measured
// on gjs 1.88.1, \`globalThis.addEventListener\` does not exist, an uncaught
// throw inside a GLib callback only prints a Gjs-CRITICAL while the loop keeps
// running, and \`System\` has no uncaughtException/unhandledRejection hook. So a
// worker that crashes outside a message handler is a silent orphan — the
// parent waits on \`error\`/\`exit\` and never gets either (issue #2336). Every
// crash path below funnels through \`crash()\`: one \`error\` line to the parent,
// then exit 1, which is Node's \`error\` then \`exit\` 1.
// Node ends a worker once its script is done and nothing keeps the event loop
// alive: no parentPort 'message' listener, no pending timer, no open
// MessagePort. The child is a subprocess that would otherwise park in
// \`loop.run()\` on its stdin forever, so its parent would never see \`exit\`.
// Only this bootstrap's own timers can be counted: a child whose timers were
// replaced by a richer provider (the globals register) or that has other
// handles we cannot see keeps the old parked behaviour.
let scriptDone = false;
const shimTimers = { nextId: 0, byId: new Map() };
let shimSetTimeout = null;
function maybeExit() {
  if (!scriptDone || shuttingDown) return;
  if (globalThis.setTimeout !== shimSetTimeout) return;
  if (shimTimers.byId.size > 0 || childPortRegistry.size > 0) return;
  for (const fns of _listeners.values()) if (fns.length > 0) return;
  requestShutdown();
  System.exit(0);
}

function crash(error) {
  try {
    send({ type: 'error', message: (error && error.message) ? error.message : String(error), stack: (error && error.stack) || '' });
  } catch (_) { /* parent's stdout is gone — the exit below is what it still sees */ }
  requestShutdown();
  System.exit(1);
}

// Set worker context globals (read by @gjsify/worker_threads when imported by user script)
globalThis.__gjsify_worker_context = {
  isMainThread: false,
  parentPort,
  workerData: materialise(decodeWire(init.workerData ?? null)),
  threadId: init.threadId ?? 0,
  // The crash contract. Called by the fallback shim below for a raw .mjs
  // child and by the timers provider in a bundled one (globals register).
  // Only ever referenced inside a worker child — the main thread has no
  // worker context, so its stderr-only reporting stays untouched.
  crash,
};

// Child-local timers for every spawned child.
//
// Bare gjs ships its own setTimeout from its ESM modules
// (\`resource:///org/gnome/gjs/modules/esm/_timers.js\`, measured on
// gjs 1.88.1), but a throw inside one of its
// callbacks only prints a Gjs-CRITICAL while the loop keeps running, so a
// crashing worker sits invisible. The shim OVERWRITES the built-in: its
// callbacks report through the crash contract and then the child dies the
// Node way. A richer provider (the timers register of a bundled child) still
// wins — it replaces these globals on import, and its dispatch carries the
// same contract (reportTimerThrow + context.crash).
{
  const timers = shimTimers;
  function clearById(id) {
    const gid = timers.byId.get(id);
    if (gid === undefined) return;
    timers.byId.delete(id);
    maybeExit();
    // g_source_remove has no throw path: a stale id logs a GLib CRITICAL and
    // returns false, it never raises (same contract the globals register
    // states for its own _cancel()).
    GLib.source_remove(gid);
  }
  globalThis.setTimeout = function (fn, delay) {
    if (typeof fn !== 'function') throw new TypeError('Callback must be a function. Received ' + typeof fn);
    const id = ++timers.nextId;
    const args = Array.prototype.slice.call(arguments, 2);
    const gid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, Number(delay) || 0), () => {
      timers.byId.delete(id);
      try { fn.apply(null, args); } catch (error) { crash(error); }
      maybeExit();
      return GLib.SOURCE_REMOVE;
    });
    timers.byId.set(id, gid);
    return id;
  };
  globalThis.setInterval = function (fn, delay) {
    if (typeof fn !== 'function') throw new TypeError('Callback must be a function. Received ' + typeof fn);
    const id = ++timers.nextId;
    const args = Array.prototype.slice.call(arguments, 2);
    const gid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, Number(delay) || 0), () => {
      try { fn.apply(null, args); } catch (error) { crash(error); return GLib.SOURCE_REMOVE; }
      return GLib.SOURCE_CONTINUE;
    });
    timers.byId.set(id, gid);
    return id;
  };
  shimSetTimeout = globalThis.setTimeout;
  globalThis.clearTimeout = clearById;
  globalThis.clearInterval = clearById;
}

send({ type: 'online' });

// Lines arriving on stdin before the worker script settles. The dynamic
// import below needs a quiet main loop to resolve (GJS quirk), so a line
// read while it is still pending is queued instead of dispatched into
// parentPort's message handler — drained once the script is done.
const pendingLines = [];

// Dispatch one parsed-as-JSON-eligible stdin line. Returns false for
// 'terminate', which requests shutdown and must not be followed by
// another read — the process is on its way out.
function dispatchLine(line) {
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
    parentPort.emit('message', materialise(decodeWire(msg.data)));
  }
  else if (msg.type === 'terminate') { send({ type: 'exit', code: 1 }); requestShutdown(); return false; }
  return true;
}

// Async stdin reader for messages from parent. Runs from the start rather
// than only once the worker script settles: EOF on stdin means the spawner
// is gone, and that can arrive while the script's own top-level await never
// settles on its own, so EOF has to be caught independently of dispatch.
//
// macOS's poll() never reports POLLHUP for a pipe whose write end closed —
// only POLLIN, backed by a zero-length read (measured on darwin; Linux sets
// both), so a HUP-only watch armed before the script settles never fires
// there and the orphan outlives its spawner. Reading the stream the normal
// way sees that same zero-length read as EOF on either OS, which is why
// this one reader replaces the separate HUP watch this bootstrap used to
// run alongside it.
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
      if (!scriptDone) {
        pendingLines.push(line);
        readNext();
        return;
      }
      if (dispatchLine(line)) readNext();
    } catch (err) {
      try {
        send({ type: 'error', message: 'bootstrap message error: ' + (err && err.message ? err.message : err), stack: err && err.stack || '' });
      } catch (_) { /* parent's end of stdout is gone too — nothing to report to */ }
      requestShutdown();
    }
  });
}
// Start the main loop so await import() has a running loop to resolve
// against, and run the worker code from an idle callback: idle_add fires
// as soon as the loop is running (even with pending I/O in the stdin
// buffer), whereas timeout_add(0) can be starved by a pending async read
// that never completes because import() hung.
if (!shuttingDown) {
  readNext();
  GLib.idle_add(GLib.PRIORITY_DEFAULT, function() {
    (async function() {
      try {
        if (init.eval) {
          const AsyncFn = Object.getPrototypeOf(async function(){}).constructor;
          await new AsyncFn('parentPort', 'workerData', 'threadId', init.code)(
            parentPort, globalThis.__gjsify_worker_context.workerData, init.threadId
          );
        } else {
          await import(init.filename);
        }
        scriptDone = true;
        // Drain whatever arrived on stdin while the import above was still
        // settling — queued instead of dispatched, see pendingLines above.
        for (const queued of pendingLines) {
          if (!dispatchLine(queued)) break;
        }
        pendingLines.length = 0;
        maybeExit();
      } catch (error) {
        // A crashed script limps no further: reporting the error and then
        // keeping the loop alive strands the parent on \`exit\` the same way the
        // silent orphan does. Node emits \`error\` and then \`exit\` 1 (the exit
        // reaches the parent through wait_async, not through a line).
        try { send({ type: 'error', message: error.message, stack: error.stack || '' }); } catch (_) {}
        requestShutdown();
        System.exit(1);
      }
    })();
    return GLib.SOURCE_REMOVE;
  });
  loop.run();
}
`;

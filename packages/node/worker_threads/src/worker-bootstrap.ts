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

// --- GJSIFY_WIRE_CODEC_BEGIN ---
// Tagged JSON codec for structured-clone types — the child-side MIRROR of
// structured-clone-wire.ts. Everything between the BEGIN/END markers is
// sliced out of this string by structured-clone-wire.spec.ts and run through
// the same case matrix as the TS copy, so the two cannot drift unnoticed.
// The spec citations live in the TS file; keep the behaviour identical.
const __TYPED_ARRAYS = ['Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array'];
const __ERROR_CTORS = {Error:Error,EvalError:EvalError,RangeError:RangeError,ReferenceError:ReferenceError,SyntaxError:SyntaxError,TypeError:TypeError,URIError:URIError};
// No btoa/atob here: this code is evaluated by a bare gjs. See the comment on
// toBase64 in structured-clone-wire.ts for what depending on them cost.
const __B64C='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const __B64D=new Uint8Array(128);for(let i=0;i<64;i++)__B64D[__B64C.charCodeAt(i)]=i;
function __toB64(buf){const b=new Uint8Array(buf);let s='';for(let i=0;i<b.length;i+=3){const h1=i+1<b.length,h2=i+2<b.length;const n=(b[i]<<16)|((h1?b[i+1]:0)<<8)|(h2?b[i+2]:0);s+=__B64C[(n>>18)&63]+__B64C[(n>>12)&63]+(h1?__B64C[(n>>6)&63]:'=')+(h2?__B64C[n&63]:'=');}return s;}
function __fromB64(s){let len=s.length;while(len>0&&s.charCodeAt(len-1)===61)len--;const out=new Uint8Array((len*3)>>2);let acc=0,bits=0,o=0;for(let i=0;i<len;i++){acc=(acc<<6)|__B64D[s.charCodeAt(i)];bits+=6;if(bits>=8){bits-=8;out[o++]=(acc>>bits)&255;}}return out;}
function __dataCloneError(message){
  if(typeof DOMException==='function'){const e=new DOMException(message,'DataCloneError');if(e.code===undefined){try{Object.defineProperty(e,'code',{value:25,configurable:true});}catch(_){}}return e;}
  const e=new Error(message);e.name='DataCloneError';e.code=25;return e;
}
function __isHole(v){return typeof v==='object'&&v!==null&&!Array.isArray(v)&&v.__gjsify==='Hole';}
function encodeWire(value, refs){
  if(refs===undefined) refs=new Map();
  if(value===null) return null;
  if(value===undefined) return {__gjsify:'Undefined'};
  const t=typeof value;
  if(t==='bigint') return {__gjsify:'BigInt', value:value.toString()};
  if(t==='number'){
    if(value===Infinity) return {__gjsify:'Infinity'};
    if(value===-Infinity) return {__gjsify:'NegInfinity'};
    if(isNaN(value)) return {__gjsify:'NaN'};
    if(Object.is(value,-0)) return {__gjsify:'NegZero'};
    return value;
  }
  if(t==='string'||t==='boolean') return value;
  if(t==='function'||t==='symbol') throw __dataCloneError(String(value)+' could not be cloned.');
  const seen=refs.get(value);
  if(seen!==undefined) return {__gjsify:'Ref', id:seen};
  refs.set(value, refs.size);
  if(value instanceof Date) return {__gjsify:'Date', value:value.getTime()};
  if(value instanceof RegExp) return {__gjsify:'RegExp', source:value.source, flags:value.flags};
  if(value instanceof Error){const n=__ERROR_CTORS[value.name]===undefined?'Error':value.name;return {__gjsify:'Error', name:n, message:value.message, stack:value.stack};}
  if(value instanceof Map){const e=[];for(const [k,v] of value) e.push([encodeWire(k,refs),encodeWire(v,refs)]);return {__gjsify:'Map', entries:e};}
  if(value instanceof Set){const v=[];for(const x of value) v.push(encodeWire(x,refs));return {__gjsify:'Set', values:v};}
  const tag=Object.prototype.toString.call(value).slice(8,-1);
  if(tag==='ArrayBuffer') return {__gjsify:'ArrayBuffer', data:__toB64(value)};
  if(tag==='DataView'||__TYPED_ARRAYS.indexOf(tag)!==-1){const ta=value;return {__gjsify:tag, data:__toB64(ta.buffer.slice(ta.byteOffset, ta.byteOffset+ta.byteLength))};}
  if(Array.isArray(value)){const out=[];for(let i=0;i<value.length;i++) out.push(i in value?encodeWire(value[i],refs):{__gjsify:'Hole'});return out;}
  if(tag==='Object'){const out={};for(const k of Object.keys(value)) out[k]=encodeWire(value[k],refs);if(typeof value.__gjsify==='string') return {__gjsify:'Object', value:out};return out;}
  throw __dataCloneError('value could not be cloned.');
}
function decodeWire(value, refs){
  if(refs===undefined) refs=[];
  if(value===null||value===undefined) return value;
  if(typeof value!=='object') return value;
  if(Array.isArray(value)){const out=[];out.length=value.length;refs.push(out);for(let i=0;i<value.length;i++){if(__isHole(value[i])) continue;out[i]=decodeWire(value[i],refs);}return out;}
  const obj=value;
  if(typeof obj.__gjsify==='string'){
    switch(obj.__gjsify){
      case 'Ref': return refs[obj.id];
      case 'Undefined': return undefined;
      case 'Hole': return undefined;
      case 'BigInt': return BigInt(obj.value);
      case 'Infinity': return Infinity;
      case 'NegInfinity': return -Infinity;
      case 'NaN': return NaN;
      case 'NegZero': return -0;
      case 'Date': {const d=new Date(obj.value);refs.push(d);return d;}
      case 'RegExp': {const r=new RegExp(obj.source, obj.flags);refs.push(r);return r;}
      case 'Error': {const C=__ERROR_CTORS[obj.name]||Error;const e=new C(obj.message);if(obj.stack) e.stack=obj.stack;refs.push(e);return e;}
      case 'Map': {const m=new Map();refs.push(m);for(const [k,v] of obj.entries) m.set(decodeWire(k,refs),decodeWire(v,refs));return m;}
      case 'Set': {const s=new Set();refs.push(s);for(const v of obj.values) s.add(decodeWire(v,refs));return s;}
      case 'ArrayBuffer': {const b=__fromB64(obj.data).buffer;refs.push(b);return b;}
      case 'DataView': {const d=new DataView(__fromB64(obj.data).buffer);refs.push(d);return d;}
      case 'Object': {const out={};refs.push(out);for(const k of Object.keys(obj.value)) out[k]=decodeWire(obj.value[k],refs);return out;}
      default: {
        if(__TYPED_ARRAYS.indexOf(obj.__gjsify)!==-1){
          const bytes=__fromB64(obj.data);
          const Ctor=globalThis[obj.__gjsify];
          const ta=new Ctor(bytes.buffer);
          refs.push(ta);
          return ta;
        }
        refs.push(value);
        return value;
      }
    }
  }
  const tag=Object.prototype.toString.call(value).slice(8,-1);
  if(tag==='Object'){const out={};refs.push(out);for(const k of Object.keys(obj)) out[k]=decodeWire(obj[k],refs);return out;}
  refs.push(value);
  return value;
}
// --- GJSIFY_WIRE_CODEC_END ---

// Walks the DECODED tree, so it has to cope with what the wire codec now
// reconstructs: shared and cyclic references (hence \`seen\`, or a self-
// referencing workerData recurses until the child dies) and sparse arrays
// (hence \`i in value\`, or every hole becomes an own \`undefined\` property and
// the array stops being sparse). The parent-side equivalents in
// sab-transfer.ts guard both already.
function materialise(value, seen) {
  if (seen === undefined) seen = new Set();
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
  if (seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (i in value) value[i] = materialise(value[i], seen);
    return value;
  }
  if (Object.prototype.toString.call(value) === '[object Object]') {
    for (const k of Object.keys(value)) value[k] = materialise(value[k], seen);
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

// Child-side MessagePort — ONE class for every port this child owns.
//
// A port is either linked to a peer in this process (made by the inline
// MessageChannel below) or routed over the wire (_wireId set): a port the
// parent transferred in, or the kept end of a channel this child sent to the
// parent. It offers both surfaces Node's worker_threads MessagePort has — the
// EventEmitter one (on/once/off/emit) and the DOM one (addEventListener,
// onmessage, start/close, MessageEvent-shaped {data}). Like Node, attaching a
// 'message' listener through either surface (or assigning onmessage) starts
// the port; messages that arrive earlier are queued, not dropped.
//
// Outbound wire traffic travels over stdout as { __msgport, op, data } lines,
// which the parent's stdout reader routes back by the same id. Ids are even
// here (2, 4, …) and odd on the parent, so the two namespaces never collide.
//
// Not supported: transferring a port THROUGH a port (port-in-port). It would
// need a per-message port table on both ends of the wire; throwing a
// DataCloneError says so loudly instead. See the step 4 notes in
// docs/reports/2026-10-30-web-worker-and-comlink-on-gjs.md.
const childPortRegistry = new Map();
let nextChildPortId = 2;
const PORT_TOKEN = {};

class MessagePort {
  constructor(token) {
    if (token !== PORT_TOKEN) throw new TypeError('Illegal constructor');
    this._ee = new Map();
    this._dom = new Map();
    this._onmessage = null;
    this._onmessageerror = null;
    this._started = false;
    this._closed = false;
    this._detached = false;
    this._queue = [];
    this._partner = null;
    this._wireId = 0;
  }

  // --- delivery -------------------------------------------------------------

  /** @internal An already-decoded value arrives; queued until start(). */
  _deliver(value) {
    if (this._closed) return;
    if (!this._started) { this._queue.push(value); return; }
    this._schedule(value);
  }

  _schedule(value) {
    Promise.resolve().then(() => {
      if (this._closed) return;
      this._emitEE('message', [value]);
      this._emitDom('message', value);
    });
  }

  /** @internal Wire delivery: the stdin dispatcher hands over the encoded payload. */
  _receive(data) {
    if (this._closed) return;
    // A payload this end cannot decode becomes 'messageerror' on the port.
    // Letting decodeWire throw here would reject a microtask, and GJS has no
    // unhandled-rejection surface — the message would vanish.
    let decoded;
    try { decoded = decodeWire(data); }
    catch (err) {
      Promise.resolve().then(() => {
        if (this._closed) return;
        this._emitEE('messageerror', [err instanceof Error ? err : new Error(String(err))]);
        this._emitDom('messageerror', null);
      });
      return;
    }
    this._deliver(decoded);
  }

  /** @internal The other end closed — no echo back. */
  _internalClose() { this._shutdown(false); }

  _emitEE(ev, args) {
    const fns = (this._ee.get(ev) || []).slice();
    for (const fn of fns) {
      try { fn.apply(this, args); } catch (_) { /* swallow */ }
    }
  }

  _emitDom(type, data) {
    const event = { type: type, data: data, target: this, currentTarget: this, ports: [], origin: '', lastEventId: '', source: null };
    const fns = (this._dom.get(type) || []).slice();
    for (const fn of fns) {
      try { if (typeof fn === 'function') fn.call(this, event); else fn.handleEvent(event); } catch (_) { /* swallow */ }
    }
    if (type === 'message' && typeof this._onmessage === 'function') {
      try { this._onmessage.call(this, event); } catch (_) { /* swallow */ }
    }
    if (type === 'messageerror' && typeof this._onmessageerror === 'function') {
      try { this._onmessageerror.call(this, event); } catch (_) { /* swallow */ }
    }
  }

  _shutdown(notifyPeer) {
    if (this._closed) return;
    this._closed = true;
    const peer = this._partner;
    this._partner = null;
    if (this._wireId) {
      if (notifyPeer) {
        try { send({ __msgport: this._wireId, op: 'close' }); } catch (_) { /* parent's stdout is gone */ }
      }
      childPortRegistry.delete(this._wireId);
    }
    // A local pair closes together, each end firing its own 'close'.
    if (peer) { peer._partner = null; peer._shutdown(false); }
    Promise.resolve().then(() => {
      this._emitEE('close', []);
      this._emitDom('close', undefined);
      this._ee.clear();
      this._dom.clear();
      maybeExit();
    });
  }

  // --- the port surface -----------------------------------------------------

  postMessage(data, transferList) {
    if (this._closed) return;
    if (transferList) {
      for (const item of transferList) {
        if (item instanceof MessagePort) {
          throw __dataCloneError('Transferring a MessagePort through a MessagePort is not supported in a worker child; send it with parentPort.postMessage(value, [port]).');
        }
      }
    }
    const encoded = encodeWire(data);
    if (this._wireId) {
      send({ __msgport: this._wireId, op: 'send', data: encoded });
      return;
    }
    const peer = this._partner;
    if (peer) peer._deliver(decodeWire(encoded));
  }

  start() {
    if (this._started || this._closed) return;
    this._started = true;
    for (const value of this._queue.splice(0)) this._schedule(value);
  }

  close() { this._shutdown(true); }
  ref() { return this; }
  unref() { return this; }

  // --- EventEmitter surface -------------------------------------------------

  on(ev, fn) {
    if (!this._ee.has(ev)) this._ee.set(ev, []);
    this._ee.get(ev).push(fn);
    if (ev === 'message') this.start();
    return this;
  }
  addListener(ev, fn) { return this.on(ev, fn); }
  once(ev, fn) {
    const self = this;
    const wrapper = function () { self.off(ev, wrapper); return fn.apply(self, arguments); };
    wrapper.listener = fn;
    return this.on(ev, wrapper);
  }
  off(ev, fn) {
    const arr = this._ee.get(ev);
    if (arr) this._ee.set(ev, arr.filter(function (f) { return f !== fn && f.listener !== fn; }));
    return this;
  }
  removeListener(ev, fn) { return this.off(ev, fn); }
  removeAllListeners(ev) {
    if (ev === undefined) this._ee.clear(); else this._ee.delete(ev);
    return this;
  }
  listenerCount(ev) { return (this._ee.get(ev) || []).length; }
  emit(ev /* , ...args */) {
    const had = (this._ee.get(ev) || []).length > 0;
    this._emitEE(ev, Array.prototype.slice.call(arguments, 1));
    return had;
  }

  // --- DOM surface ----------------------------------------------------------

  addEventListener(type, fn) {
    if (!fn) return;
    if (!this._dom.has(type)) this._dom.set(type, []);
    const arr = this._dom.get(type);
    if (arr.indexOf(fn) === -1) arr.push(fn);
    if (type === 'message') this.start();
  }
  removeEventListener(type, fn) {
    const arr = this._dom.get(type);
    if (arr) this._dom.set(type, arr.filter(function (f) { return f !== fn; }));
  }
  get onmessage() { return this._onmessage; }
  set onmessage(fn) {
    this._onmessage = typeof fn === 'function' ? fn : null;
    if (this._onmessage) this.start();
  }
  get onmessageerror() { return this._onmessageerror; }
  set onmessageerror(fn) { this._onmessageerror = typeof fn === 'function' ? fn : null; }
}

/** A port whose peer lives in the parent, routed by portId. */
function makeChildSidePort(portId) {
  const port = new MessagePort(PORT_TOKEN);
  port._wireId = portId;
  childPortRegistry.set(portId, port);
  return port;
}

class MessageChannel {
  constructor() {
    const a = new MessagePort(PORT_TOKEN);
    const b = new MessagePort(PORT_TOKEN);
    a._partner = b;
    b._partner = a;
    this.port1 = a;
    this.port2 = b;
  }
}

// Bare gjs has neither; a bundled child's globals register only fills what is
// still undefined, so these win there too and every child port is one class.
if (typeof globalThis.MessageChannel === 'undefined') globalThis.MessageChannel = MessageChannel;
if (typeof globalThis.MessagePort === 'undefined') globalThis.MessagePort = MessagePort;

// parentPort.postMessage(value, [port]): turn each listed child port into a
// wire port. The kept end (the peer) is rebound to a fresh even id and
// registered; the transferred end is detached. Returns the value with each
// port replaced by a placeholder plus a commit() that performs the side
// effects — run it only after the value encoded, so a DataCloneError leaves
// every port untouched.
function planPortTransfer(value, transferList) {
  const ports = [];
  for (const item of transferList) {
    if (!(item instanceof MessagePort)) continue;
    if (ports.indexOf(item) !== -1) throw __dataCloneError('Transfer list contains duplicate entries');
    if (item._closed || item._detached) throw __dataCloneError('MessagePort in transfer list is already detached');
    if (item._wireId) throw __dataCloneError('A MessagePort that already crosses the worker boundary cannot be transferred again.');
    ports.push(item);
  }
  if (ports.length === 0) return { value: value, commit: function () { return []; } };
  const placeholders = new Map();
  for (const port of ports) {
    placeholders.set(port, { __gjsifyTransferredPort: true, portId: nextChildPortId });
    nextChildPortId += 2;
  }
  function walk(v, seen) {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof MessagePort) return placeholders.has(v) ? placeholders.get(v) : v;
    if (seen.has(v)) return seen.get(v);
    if (Array.isArray(v)) {
      const out = [];
      seen.set(v, out);
      for (let i = 0; i < v.length; i++) if (i in v) out[i] = walk(v[i], seen);
      return out;
    }
    if (Object.prototype.toString.call(v) === '[object Object]') {
      const out = {};
      seen.set(v, out);
      for (const k of Object.keys(v)) out[k] = walk(v[k], seen);
      return out;
    }
    return v;
  }
  return {
    value: walk(value, new Map()),
    commit() {
      const lines = [];
      for (const port of ports) {
        const portId = placeholders.get(port).portId;
        const peer = port._partner;
        port._partner = null;
        port._detached = true;
        port._closed = true;
        if (peer) {
          peer._partner = null;
          peer._wireId = portId;
          childPortRegistry.set(portId, peer);
          // What the peer posted before the transfer waits in the detached
          // port's queue; it travels right behind the carrying message.
          for (const queued of port._queue.splice(0)) {
            lines.push({ __msgport: portId, op: 'send', data: encodeWire(queued) });
          }
        }
      }
      return lines;
    },
  };
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
    send({ type: 'error', name: 'Error', message: 'init fd drain failed: ' + (err && err.message ? err.message : err), stack: '' });
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
  postMessage(data, transferList) {
    let plan = null;
    if (transferList && transferList.length > 0) {
      plan = planPortTransfer(data, transferList);
      data = plan.value;
    }
    send({ type: 'message', data: encodeWire(data) });
    if (plan) for (const line of plan.commit()) send(line);
  },
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
    send({ type: 'error', name: (error && error.name) || 'Error', message: (error && error.message) ? error.message : String(error), stack: (error && error.stack) || '' });
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
  // A deliberate exit code, the way \`process.exit(n)\` ends a Node worker:
  // no \`error\`, just \`exit\` n. \`System.exit\` alone is deferred while the
  // main loop runs, so the loop has to be asked to quit first.
  exit(code) {
    requestShutdown();
    System.exit(code);
  },
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
    //
    // Deserialising is guarded, the emit is not: a message we cannot decode is
    // reported as 'messageerror' on parentPort and the worker stays alive,
    // whereas an exception from a user's 'message' listener still belongs in
    // readNext's catch (= the crash contract). Before this, BOTH went there,
    // so one undecodable message killed the worker with a 'bootstrap message
    // error'.
    let value;
    try {
      if (init.sabSocketFd === 3) drainSabFds(countSabPlaceholders(msg.data));
      value = materialise(decodeWire(msg.data));
    } catch (err) {
      parentPort.emit('messageerror', err instanceof Error ? err : new Error(String(err)));
      return true;
    }
    parentPort.emit('message', value);
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
        send({ type: 'error', name: 'Error', message: 'bootstrap message error: ' + (err && err.message ? err.message : err), stack: err && err.stack || '' });
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
        try { send({ type: 'error', name: (error && error.name) || 'Error', message: error.message, stack: error.stack || '' }); } catch (_) {}
        requestShutdown();
        System.exit(1);
      }
    })();
    return GLib.SOURCE_REMOVE;
  });
  loop.run();
}
`;

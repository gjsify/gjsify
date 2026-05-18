// Wire-encoding for the GJS ↔ WebKit.WebView postMessage bridge.
//
// WebKit's `script-message-handler.postMessage()` and our reverse
// `webView.evaluate_javascript()` round-trip both move payloads as JSON
// strings (the message handler accepts a JSCValue, but in practice it
// stringifies anything non-primitive — and our reverse path explicitly
// uses JSON.stringify because that's the only shape evaluate_javascript
// can ingest reliably). Plain JSON.stringify drops binary content (typed
// arrays serialise to `{}`, ArrayBuffer to `{}`), so we walk the value
// tree on the sending side, substitute binary leaves with base64
// placeholders, and reverse the walk on the receiving side.
//
// Placeholder shape: `{ __gjsifyBin: 'b64', type: 'Uint8Array', data: '<base64>' }`.
// The `type` tag preserves the original constructor (Uint8Array,
// Uint16Array, Int32Array, Float32Array, DataView, ArrayBuffer, …) so
// the receiver rebuilds the same shape — important for typed-array
// math + DataView byteOffset semantics.

const PLACEHOLDER_KEY = '__gjsifyBin';
const PLACEHOLDER_VAL = 'b64';

/** Supported binary types, in lookup-table order. */
const BINARY_CTORS = [
  'ArrayBuffer',
  'Uint8Array', 'Uint8ClampedArray',
  'Int8Array',
  'Uint16Array', 'Int16Array',
  'Uint32Array', 'Int32Array',
  'BigUint64Array', 'BigInt64Array',
  'Float32Array', 'Float64Array',
  'DataView',
] as const;

type BinaryTypeName = typeof BINARY_CTORS[number];

interface BinaryPlaceholder {
  readonly __gjsifyBin: typeof PLACEHOLDER_VAL;
  readonly type: BinaryTypeName;
  /** Base64-encoded raw bytes from byteOffset .. byteOffset+byteLength. */
  readonly data: string;
  /** Element count for typed arrays (so length is preserved through
   *  arbitrary byteOffset alignments). Omitted for ArrayBuffer/DataView. */
  readonly length?: number;
}

function classOf(value: unknown): string {
  return Object.prototype.toString.call(value).slice(8, -1);
}

function isBinaryType(name: string): name is BinaryTypeName {
  return (BINARY_CTORS as readonly string[]).includes(name);
}

/**
 * Encode a binary view to base64. Uses Uint8Array.prototype.toBase64()
 * where available (SM140+, Node 22+), falling back to a manual loop
 * + btoa. Stays self-contained so the bootstrap script can inline the
 * same logic without imports.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const u8 = bytes as Uint8Array & { toBase64?: () => string };
  if (typeof u8.toBase64 === 'function') return u8.toBase64();
  // Manual base64 — slower but works everywhere.
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  // `btoa` accepts only latin-1; the manual loop above guarantees latin-1.
  return (globalThis as { btoa?: (s: string) => string }).btoa!(s);
}

/**
 * Reverse: base64 → Uint8Array. Mirrors bytesToBase64's fallback chain.
 */
function base64ToBytes(b64: string): Uint8Array {
  const Ctor = Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array };
  if (typeof Ctor.fromBase64 === 'function') return Ctor.fromBase64(b64);
  const bin = (globalThis as { atob?: (s: string) => string }).atob!(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function makePlaceholder(value: ArrayBuffer | ArrayBufferView): BinaryPlaceholder {
  const type = classOf(value) as BinaryTypeName;
  if (value instanceof ArrayBuffer) {
    return { __gjsifyBin: PLACEHOLDER_VAL, type, data: bytesToBase64(new Uint8Array(value)) };
  }
  // For DataView: encode the byte window only.
  if (value instanceof DataView) {
    const window = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return { __gjsifyBin: PLACEHOLDER_VAL, type: 'DataView', data: bytesToBase64(window) };
  }
  // TypedArray: encode the element-byte window.
  const ta = value as Uint8Array;
  const window = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  return { __gjsifyBin: PLACEHOLDER_VAL, type, data: bytesToBase64(window), length: ta.length };
}

function reconstructFromPlaceholder(p: BinaryPlaceholder): ArrayBuffer | ArrayBufferView {
  const bytes = base64ToBytes(p.data);
  switch (p.type) {
    case 'ArrayBuffer': return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    case 'DataView':    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    case 'Uint8Array':  return bytes;
    case 'Uint8ClampedArray': return new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    case 'Int8Array':   return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    case 'Uint16Array': return new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    case 'Int16Array':  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    case 'Uint32Array': return new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    case 'Int32Array':  return new Int32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    case 'BigUint64Array': return new BigUint64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    case 'BigInt64Array':  return new BigInt64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    case 'Float32Array': return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    case 'Float64Array': return new Float64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
}

function isPlaceholder(value: unknown): value is BinaryPlaceholder {
  return (
    typeof value === 'object'
    && value !== null
    && (value as { __gjsifyBin?: unknown }).__gjsifyBin === PLACEHOLDER_VAL
    && typeof (value as { type?: unknown }).type === 'string'
    && typeof (value as { data?: unknown }).data === 'string'
  );
}

/**
 * Walk `value`, substituting any binary buffer/view with a base64
 * placeholder. Returns the substituted tree (copy-on-write — input
 * untouched). Cycles produce cycle-preserving output.
 */
export function encodeBinariesForJson(value: unknown): unknown {
  const seen = new WeakMap<object, unknown>();

  function walk(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v;

    const cls = classOf(v);
    if (isBinaryType(cls)) {
      return makePlaceholder(v as ArrayBuffer | ArrayBufferView);
    }

    if (seen.has(v as object)) return seen.get(v as object);

    if (Array.isArray(v)) {
      const out: unknown[] = [];
      seen.set(v, out);
      for (let i = 0; i < v.length; i++) out[i] = walk(v[i]);
      return out;
    }

    if (cls === 'Object') {
      const out: Record<string, unknown> = {};
      seen.set(v as object, out);
      for (const k of Object.keys(v as Record<string, unknown>)) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }

    // Other tagged objects (Map, Set, Date, …) pass through unchanged.
    return v;
  }

  return walk(value);
}

/**
 * Reverse of `encodeBinariesForJson`. Walks the tree in place and
 * replaces every placeholder with a reconstructed binary view. Returns
 * the same tree reference (for parity with the encoder's contract).
 */
export function decodeBinariesFromJson(value: unknown): unknown {
  const seen = new WeakSet<object>();

  function walk(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v;
    if (isPlaceholder(v)) return reconstructFromPlaceholder(v);
    if (seen.has(v as object)) return v;
    seen.add(v as object);

    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = walk(v[i]);
      return v;
    }
    const cls = classOf(v);
    if (cls === 'Object') {
      for (const k of Object.keys(v as Record<string, unknown>)) {
        (v as Record<string, unknown>)[k] = walk((v as Record<string, unknown>)[k]);
      }
      return v;
    }
    return v;
  }

  return walk(value);
}

/**
 * Inlined twin of the encode/decode pair as a string. Injected into the
 * WebView bootstrap so the WebKit-side window.postMessage override can
 * encode binaries before handing the JSON to GJS, and decode incoming
 * GJS-originated placeholders back into typed arrays before dispatching
 * MessageEvent.
 *
 * Kept in sync with the TS source above by manual review — small enough
 * to audit at a glance, and the alternative (build-time string template)
 * would tangle the bridge build pipeline for marginal gain.
 */
export const BINARY_SERIALIZER_INJECTED_SRC = `
  var __binKey = '${PLACEHOLDER_KEY}';
  var __binVal = '${PLACEHOLDER_VAL}';
  var __binCtors = ${JSON.stringify(BINARY_CTORS)};
  function __classOf(v){ return Object.prototype.toString.call(v).slice(8,-1); }
  function __isBin(n){ return __binCtors.indexOf(n) !== -1; }
  function __b64enc(bytes){
    if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
    var s=''; for (var i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function __b64dec(s){
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s);
    var bin = atob(s); var u = new Uint8Array(bin.length);
    for (var i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  function __mkPlaceholder(v){
    var t = __classOf(v);
    if (v instanceof ArrayBuffer) return {__gjsifyBin:__binVal, type:t, data:__b64enc(new Uint8Array(v))};
    if (v instanceof DataView)    return {__gjsifyBin:__binVal, type:'DataView', data:__b64enc(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))};
    var ta = v; return {__gjsifyBin:__binVal, type:t, data:__b64enc(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength)), length:ta.length};
  }
  function __reconstruct(p){
    var bytes = __b64dec(p.data);
    switch (p.type) {
      case 'ArrayBuffer': return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      case 'DataView':    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      case 'Uint8Array':  return bytes;
      case 'Uint8ClampedArray': return new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      case 'Int8Array':   return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      case 'Uint16Array': return new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      case 'Int16Array':  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      case 'Uint32Array': return new Uint32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      case 'Int32Array':  return new Int32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      case 'BigUint64Array': return new BigUint64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      case 'BigInt64Array':  return new BigInt64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      case 'Float32Array': return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      case 'Float64Array': return new Float64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
  }
  function __isPlaceholder(v){ return v && typeof v==='object' && v[__binKey]===__binVal && typeof v.type==='string' && typeof v.data==='string'; }
  function __encodeBin(v){
    if (v === null || typeof v !== 'object') return v;
    var c = __classOf(v);
    if (__isBin(c)) return __mkPlaceholder(v);
    if (Array.isArray(v)) { var o=[]; for (var i=0;i<v.length;i++) o[i]=__encodeBin(v[i]); return o; }
    if (c==='Object') { var o={}; for (var k in v) if (Object.prototype.hasOwnProperty.call(v,k)) o[k]=__encodeBin(v[k]); return o; }
    return v;
  }
  function __decodeBin(v){
    if (v === null || typeof v !== 'object') return v;
    if (__isPlaceholder(v)) return __reconstruct(v);
    if (Array.isArray(v)) { for (var i=0;i<v.length;i++) v[i]=__decodeBin(v[i]); return v; }
    if (__classOf(v)==='Object') { for (var k in v) if (Object.prototype.hasOwnProperty.call(v,k)) v[k]=__decodeBin(v[k]); return v; }
    return v;
  }
`;

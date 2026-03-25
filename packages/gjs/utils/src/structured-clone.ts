// structuredClone polyfill for GJS
// Reference: HTML Living Standard §2.7.1 StructuredSerializeInternal
// Reference: refs/deno/ext/web/02_structured_clone.js, refs/ungap-structured-clone/
// Reimplemented for GJS using standard JavaScript (SpiderMonkey 128)

const { toString } = Object.prototype;

/**
 * Get the internal [[Class]] tag of a value via Object.prototype.toString.
 * Returns e.g. "Array", "Date", "RegExp", "Map", "Error", "Uint8Array", etc.
 */
function classOf(value: unknown): string {
  return toString.call(value).slice(8, -1);
}

/**
 * Throw a DataCloneError. Uses DOMException if available, otherwise a plain Error.
 */
function throwDataCloneError(message: string): never {
  const DOMExceptionCtor = (globalThis as Record<string, unknown>).DOMException as
    (new (message: string, name: string) => Error) | undefined;
  if (typeof DOMExceptionCtor === 'function') {
    throw new DOMExceptionCtor(message, 'DataCloneError');
  }
  const error = new Error(message);
  error.name = 'DataCloneError';
  throw error;
}

/** Error constructors that can be cloned per the HTML spec. */
const ERROR_CONSTRUCTORS: Record<string, ErrorConstructor> = {
  Error,
  EvalError,
  RangeError,
  ReferenceError,
  SyntaxError,
  TypeError,
  URIError,
};

/** TypedArray constructors for reconstruction. */
const TYPED_ARRAY_TAGS = new Set([
  'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array',
  'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array',
  'BigInt64Array', 'BigUint64Array',
]);

/**
 * Internal recursive clone with circular/shared reference tracking.
 * The `seen` map stores original→clone mappings. It must be populated
 * with the clone BEFORE recursing into children to handle circular refs.
 */
function internalClone(value: unknown, seen: Map<object, unknown>): unknown {
  // Primitives (including null, undefined, boolean, number, string, bigint)
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'boolean' || type === 'number' || type === 'string' || type === 'bigint') {
    return value;
  }
  if (type === 'symbol') {
    throwDataCloneError('Symbol cannot be cloned');
  }
  if (type === 'function') {
    throwDataCloneError('Function cannot be cloned');
  }

  const obj = value as object;

  // Circular / shared reference — return existing clone
  if (seen.has(obj)) return seen.get(obj);

  const tag = classOf(obj);

  // --- Date ---
  if (tag === 'Date') {
    return new Date((obj as Date).getTime());
  }

  // --- RegExp (lastIndex always 0 in clone per spec) ---
  if (tag === 'RegExp') {
    return new RegExp((obj as RegExp).source, (obj as RegExp).flags);
  }

  // --- Wrapper objects: Boolean, Number, String ---
  if (tag === 'Boolean') return Object((obj as object).valueOf());
  if (tag === 'Number') return Object((obj as object).valueOf());
  if (tag === 'String') return Object((obj as object).valueOf());

  // --- BigInt wrapper object ---
  if (tag === 'BigInt') return Object(BigInt.prototype.valueOf.call(obj));

  // --- Error types ---
  // Note: Object.prototype.toString returns [object Error] for all error subtypes
  // in SpiderMonkey and V8, so we use instanceof + constructor.name to detect the specific type.
  if (obj instanceof Error) {
    const src = obj;
    const ctorName = src.constructor?.name;
    const Ctor = (ctorName && ERROR_CONSTRUCTORS[ctorName]) || ERROR_CONSTRUCTORS[src.name] || Error;
    const cloned = new Ctor(src.message);
    cloned.name = src.name;
    // Clone cause if present (ES2022)
    if ('cause' in src) {
      Object.defineProperty(cloned, 'cause', {
        value: internalClone(src.cause, seen),
        writable: true,
        enumerable: false,
        configurable: true,
      });
    }
    return cloned;
  }

  // --- DOMException ---
  if (tag === 'DOMException') {
    const DOMExceptionCtor = (globalThis as Record<string, unknown>).DOMException as
      (new (message: string, name: string) => Error) | undefined;
    if (typeof DOMExceptionCtor === 'function') {
      const src = obj as { message: string; name: string };
      return new DOMExceptionCtor(src.message, src.name);
    }
  }

  // --- ArrayBuffer ---
  if (tag === 'ArrayBuffer') {
    const src = obj as ArrayBuffer;
    const cloned = src.slice(0);
    seen.set(obj, cloned);
    return cloned;
  }

  // --- SharedArrayBuffer ---
  if (tag === 'SharedArrayBuffer') {
    // SharedArrayBuffer clones share the backing store (same memory)
    return obj;
  }

  // --- DataView ---
  if (tag === 'DataView') {
    const src = obj as DataView;
    const bufferClone = internalClone(src.buffer, seen) as ArrayBuffer;
    const cloned = new DataView(bufferClone, src.byteOffset, src.byteLength);
    seen.set(obj, cloned);
    return cloned;
  }

  // --- TypedArrays ---
  if (TYPED_ARRAY_TAGS.has(tag)) {
    const src = obj as { buffer: ArrayBuffer; byteOffset: number; length: number; constructor: new (buffer: ArrayBuffer, byteOffset: number, length: number) => unknown };
    const bufferClone = internalClone(src.buffer, seen) as ArrayBuffer;
    const Ctor = src.constructor as new (buffer: ArrayBuffer, byteOffset: number, length: number) => unknown;
    const cloned = new Ctor(bufferClone, src.byteOffset, src.length);
    seen.set(obj, cloned);
    return cloned;
  }

  // --- Map ---
  if (tag === 'Map') {
    const cloned = new Map();
    seen.set(obj, cloned);
    for (const [k, v] of obj as Map<unknown, unknown>) {
      cloned.set(internalClone(k, seen), internalClone(v, seen));
    }
    return cloned;
  }

  // --- Set ---
  if (tag === 'Set') {
    const cloned = new Set();
    seen.set(obj, cloned);
    for (const v of obj as Set<unknown>) {
      cloned.add(internalClone(v, seen));
    }
    return cloned;
  }

  // --- Blob / File (use instanceof for cross-environment compatibility) ---
  {
    const g = globalThis as Record<string, unknown>;
    const BlobCtor = g.Blob as (new (parts: unknown[], options?: { type?: string }) => { type: string; size: number }) | undefined;
    const FileCtor = g.File as (new (parts: unknown[], name: string, options?: { type?: string; lastModified?: number }) => { name: string; type: string; lastModified: number }) | undefined;
    if (typeof FileCtor === 'function' && obj instanceof (FileCtor as any)) {
      const src = obj as { name: string; type: string; lastModified: number };
      return new FileCtor([obj], src.name, { type: src.type, lastModified: src.lastModified });
    }
    if (typeof BlobCtor === 'function' && obj instanceof (BlobCtor as any)) {
      const src = obj as { type: string };
      return new BlobCtor([obj], { type: src.type });
    }
  }

  // --- Non-cloneable types ---
  if (obj instanceof WeakMap) throwDataCloneError('WeakMap cannot be cloned');
  if (obj instanceof WeakSet) throwDataCloneError('WeakSet cannot be cloned');
  if (obj instanceof WeakRef) throwDataCloneError('WeakRef cannot be cloned');
  if (typeof globalThis.Promise === 'function' && obj instanceof Promise) {
    throwDataCloneError('Promise cannot be cloned');
  }

  // --- Array ---
  if (tag === 'Array') {
    const src = obj as unknown[];
    const cloned: unknown[] = [];
    seen.set(obj, cloned);
    for (let i = 0; i < src.length; i++) {
      // Preserve holes in sparse arrays
      if (i in src) {
        cloned[i] = internalClone(src[i], seen);
      }
    }
    return cloned;
  }

  // --- Plain Object (or unknown object type — clone own enumerable string-keyed props) ---
  if (tag === 'Object' || typeof obj === 'object') {
    const cloned: Record<string, unknown> = {};
    seen.set(obj, cloned);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      cloned[key] = internalClone((obj as Record<string, unknown>)[key], seen);
    }
    return cloned;
  }

  throwDataCloneError(`${tag} cannot be cloned`);
}

/**
 * structuredClone polyfill implementing the HTML structured clone algorithm.
 *
 * Supports: primitives (incl. -0, NaN, Infinity, BigInt), wrapper objects,
 * Date, RegExp, Error types, ArrayBuffer, TypedArrays, DataView, Map, Set,
 * Blob, File, circular/shared references, plain objects and arrays.
 *
 * Throws DataCloneError for: functions, symbols, WeakMap, WeakSet, WeakRef, Promise.
 *
 * @param value The value to clone
 * @param _options Reserved for future transfer list support (currently ignored)
 */
export function structuredClone<T>(value: T, _options?: { transfer?: unknown[] }): T {
  return internalClone(value, new Map()) as T;
}

// structuredClone polyfill for GJS, which has no native one.
// Reference: HTML Living Standard §2.7.1 StructuredSerializeInternal
// Reference: refs/deno/ext/web/02_structured_clone.js, refs/ungap-structured-clone/
//
// The optional `transfer` array detaches transferable objects from the sender and
// reattaches them on the receiver; only `ArrayBuffer` is handled here (via
// `ArrayBuffer.prototype.transfer()`). `MessagePort` transfer belongs to the
// consumer (`@gjsify/worker_threads`) — this layer only encodes plain values.

const { toString } = Object.prototype;

/** The internal [[Class]] tag: "Array", "Date", "Map", "Uint8Array", … */
function classOf(value: unknown): string {
    return toString.call(value).slice(8, -1);
}

/** Throw a DataCloneError: a `DOMException` where one exists, else a plain `Error`. */
function throwDataCloneError(message: string): never {
    const DOMExceptionCtor = (globalThis as Record<string, unknown>).DOMException as
        | (new (message: string, name: string) => Error)
        | undefined;
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

/** The TypedArray [[Class]] tags this clone can reconstruct. */
const TYPED_ARRAY_TAGS = new Set([
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'Float32Array',
    'Float64Array',
    'BigInt64Array',
    'BigUint64Array',
]);

/**
 * Pre-detach metadata for a TypedArray / DataView whose buffer is being
 * transferred: once `ArrayBuffer.prototype.transfer()` runs the source view is
 * detached and reading `byteOffset` / `length` yields 0, so both must be captured
 * before the transfer step.
 */
interface ViewSnapshot {
    byteOffset: number;
    length: number;
    byteLength: number;
}
interface TransferContext {
    /** Original ArrayBuffer (sender side, will be detached) → transferred replacement */
    transferred: Map<ArrayBuffer, ArrayBuffer>;
    /** TypedArray/DataView source object → snapshot taken before its buffer was transferred */
    viewSnapshots: Map<object, ViewSnapshot>;
}

/**
 * Recursive clone. `seen` maps original→clone and MUST be populated with the clone
 * before recursing into children, or a circular reference recurses forever.
 */
function internalClone(value: unknown, seen: Map<object, unknown>, transfer?: TransferContext): unknown {
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

    if (seen.has(obj)) return seen.get(obj);

    const tag = classOf(obj);

    if (tag === 'Date') {
        return new Date((obj as Date).getTime());
    }

    // Per spec, `lastIndex` is 0 in the clone.
    if (tag === 'RegExp') {
        return new RegExp((obj as RegExp).source, (obj as RegExp).flags);
    }

    if (tag === 'Boolean') return Object((obj as object).valueOf());
    if (tag === 'Number') return Object((obj as object).valueOf());
    if (tag === 'String') return Object((obj as object).valueOf());

    if (tag === 'BigInt') return Object(BigInt.prototype.valueOf.call(obj));

    // `Object.prototype.toString` returns [object Error] for every error subtype on
    // SpiderMonkey and V8, so the subtype comes from instanceof + constructor.name.
    if (obj instanceof Error) {
        const src = obj;
        const ctorName = src.constructor?.name;
        const Ctor = (ctorName && ERROR_CONSTRUCTORS[ctorName]) || ERROR_CONSTRUCTORS[src.name] || Error;
        const cloned = new Ctor(src.message);
        cloned.name = src.name;
        // Clone cause if present (ES2022)
        if ('cause' in src) {
            Object.defineProperty(cloned, 'cause', {
                value: internalClone(src.cause, seen, transfer),
                writable: true,
                enumerable: false,
                configurable: true,
            });
        }
        return cloned;
    }

    if (tag === 'DOMException') {
        const DOMExceptionCtor = (globalThis as Record<string, unknown>).DOMException as
            | (new (message: string, name: string) => Error)
            | undefined;
        if (typeof DOMExceptionCtor === 'function') {
            const src = obj as { message: string; name: string };
            return new DOMExceptionCtor(src.message, src.name);
        }
    }

    if (tag === 'ArrayBuffer') {
        const src = obj as ArrayBuffer;
        // Transfer-list path: skip copy, reuse the already-transferred buffer.
        if (transfer && transfer.transferred.has(src)) {
            const transferred = transfer.transferred.get(src)!;
            seen.set(obj, transferred);
            return transferred;
        }
        // Reading from a detached buffer throws — surface as DataCloneError per spec.
        if (
            (src as { detached?: boolean }).detached === true ||
            (src.byteLength === 0 && (src as { detached?: boolean }).detached)
        ) {
            throwDataCloneError('ArrayBuffer is detached and cannot be cloned');
        }
        const cloned = src.slice(0);
        seen.set(obj, cloned);
        return cloned;
    }

    if (tag === 'SharedArrayBuffer') {
        // A shared backing store means the same instance survives the "clone".
        return obj;
    }

    // `@gjsify/sab-native`'s SharedBuffer, same pass-through semantics. Detected by
    // constructor name because `@gjsify/utils` sits below `@gjsify/sab-native` in the
    // dep graph and may not import it. Moving the underlying memfd across the IPC
    // boundary is the worker_threads layer's job.
    if (
        obj &&
        typeof obj === 'object' &&
        (obj as { constructor?: { name?: string } }).constructor?.name === 'SharedBuffer'
    ) {
        return obj;
    }

    if (tag === 'DataView') {
        const src = obj as DataView;
        const snapshot = transfer?.viewSnapshots.get(obj);
        const bufferClone = internalClone(src.buffer, seen, transfer) as ArrayBuffer;
        const byteOffset = snapshot ? snapshot.byteOffset : src.byteOffset;
        const byteLength = snapshot ? snapshot.byteLength : src.byteLength;
        const cloned = new DataView(bufferClone, byteOffset, byteLength);
        seen.set(obj, cloned);
        return cloned;
    }

    if (TYPED_ARRAY_TAGS.has(tag)) {
        const src = obj as {
            buffer: ArrayBuffer;
            byteOffset: number;
            length: number;
            constructor: new (buffer: ArrayBuffer, byteOffset: number, length: number) => unknown;
        };
        const snapshot = transfer?.viewSnapshots.get(obj);
        const bufferClone = internalClone(src.buffer, seen, transfer) as ArrayBuffer;
        const Ctor = src.constructor as new (buffer: ArrayBuffer, byteOffset: number, length: number) => unknown;
        const byteOffset = snapshot ? snapshot.byteOffset : src.byteOffset;
        const length = snapshot ? snapshot.length : src.length;
        const cloned = new Ctor(bufferClone, byteOffset, length);
        seen.set(obj, cloned);
        return cloned;
    }

    if (tag === 'Map') {
        const cloned = new Map();
        seen.set(obj, cloned);
        for (const [k, v] of obj as Map<unknown, unknown>) {
            cloned.set(internalClone(k, seen, transfer), internalClone(v, seen, transfer));
        }
        return cloned;
    }

    if (tag === 'Set') {
        const cloned = new Set();
        seen.set(obj, cloned);
        for (const v of obj as Set<unknown>) {
            cloned.add(internalClone(v, seen, transfer));
        }
        return cloned;
    }

    // Blob / File by instanceof: the constructors are host-provided, so a tag check
    // would miss them wherever they are not spelled exactly.
    {
        const g = globalThis as Record<string, unknown>;
        const BlobCtor = g.Blob as
            | (new (parts: unknown[], options?: { type?: string }) => { type: string; size: number })
            | undefined;
        const FileCtor = g.File as
            | (new (
                  parts: unknown[],
                  name: string,
                  options?: { type?: string; lastModified?: number },
              ) => { name: string; type: string; lastModified: number })
            | undefined;
        if (
            typeof FileCtor === 'function' &&
            obj instanceof (FileCtor as unknown as abstract new (...args: unknown[]) => unknown)
        ) {
            const src = obj as { name: string; type: string; lastModified: number };
            return new FileCtor([obj], src.name, { type: src.type, lastModified: src.lastModified });
        }
        if (
            typeof BlobCtor === 'function' &&
            obj instanceof (BlobCtor as unknown as abstract new (...args: unknown[]) => unknown)
        ) {
            const src = obj as { type: string };
            return new BlobCtor([obj], { type: src.type });
        }
    }

    if (obj instanceof WeakMap) throwDataCloneError('WeakMap cannot be cloned');
    if (obj instanceof WeakSet) throwDataCloneError('WeakSet cannot be cloned');
    if (obj instanceof WeakRef) throwDataCloneError('WeakRef cannot be cloned');
    if (typeof globalThis.Promise === 'function' && obj instanceof Promise) {
        throwDataCloneError('Promise cannot be cloned');
    }

    if (tag === 'Array') {
        const src = obj as unknown[];
        const cloned: unknown[] = [];
        seen.set(obj, cloned);
        for (let i = 0; i < src.length; i++) {
            // Preserve holes in sparse arrays
            if (i in src) {
                cloned[i] = internalClone(src[i], seen, transfer);
            }
        }
        return cloned;
    }

    // Plain or unknown object: own enumerable string keys only.
    if (tag === 'Object' || typeof obj === 'object') {
        const cloned: Record<string, unknown> = {};
        seen.set(obj, cloned);
        for (const key of Object.keys(obj as Record<string, unknown>)) {
            cloned[key] = internalClone((obj as Record<string, unknown>)[key], seen, transfer);
        }
        return cloned;
    }

    throwDataCloneError(`${tag} cannot be cloned`);
}

/**
 * structuredClone polyfill implementing the HTML structured clone algorithm.
 *
 * Throws DataCloneError for functions, symbols, WeakMap, WeakSet, WeakRef and
 * Promise; everything else the spec covers is cloned, circular and shared
 * references included.
 *
 * An `ArrayBuffer` in `options.transfer` is moved zero-copy via
 * `ArrayBuffer.prototype.transfer()` and the sender's buffer becomes detached.
 * Non-`ArrayBuffer` entries are accepted but IGNORED: transferables that are not
 * structured-clone primitives (`MessagePort`, `ReadableStream`, …) are the caller's
 * responsibility, e.g. `MessagePort.postMessage`.
 */
export function structuredClone<T>(value: T, options?: { transfer?: unknown[] }): T {
    const transferList = options?.transfer;
    if (!transferList || transferList.length === 0) {
        return internalClone(value, new Map()) as T;
    }

    // Only an already-detached input is rejected here; the rest of the validation
    // belongs to the caller layer.
    const arrayBuffersToTransfer = new Set<ArrayBuffer>();
    for (const item of transferList) {
        if (classOf(item) === 'ArrayBuffer') {
            const buf = item as ArrayBuffer & { detached?: boolean };
            if (buf.detached === true) {
                throwDataCloneError('ArrayBuffer in transfer list is detached');
            }
            arrayBuffersToTransfer.add(buf);
        }
    }

    // Snapshot view metadata BEFORE the transfer detaches the source views.
    const viewSnapshots = new Map<object, ViewSnapshot>();
    if (arrayBuffersToTransfer.size > 0) {
        snapshotViewsBackedByTransferredBuffers(value, arrayBuffersToTransfer, viewSnapshots, new Set());
    }

    // Detaches the source buffers.
    const transferred = new Map<ArrayBuffer, ArrayBuffer>();
    for (const buf of arrayBuffersToTransfer) {
        const ab = buf as ArrayBuffer & { transfer?: () => ArrayBuffer };
        if (typeof ab.transfer !== 'function') {
            throwDataCloneError('ArrayBuffer.prototype.transfer() not available — runtime is not SM140+');
        }
        transferred.set(buf, ab.transfer());
    }

    return internalClone(value, new Map(), { transferred, viewSnapshots }) as T;
}

/**
 * Walk `value`, recording byteOffset/length for every TypedArray and DataView
 * whose `.buffer` is in the transfer set. Must run BEFORE the transfer step.
 */
function snapshotViewsBackedByTransferredBuffers(
    value: unknown,
    transferSet: Set<ArrayBuffer>,
    out: Map<object, ViewSnapshot>,
    seen: Set<object>,
): void {
    if (value === null || typeof value !== 'object') return;
    const obj = value as object;
    if (seen.has(obj)) return;
    seen.add(obj);

    const tag = classOf(obj);

    if (tag === 'DataView') {
        const dv = obj as DataView;
        if (transferSet.has(dv.buffer as ArrayBuffer)) {
            out.set(obj, { byteOffset: dv.byteOffset, length: 0, byteLength: dv.byteLength });
        }
        return;
    }
    if (TYPED_ARRAY_TAGS.has(tag)) {
        const ta = obj as { buffer: ArrayBuffer; byteOffset: number; length: number; byteLength: number };
        if (transferSet.has(ta.buffer)) {
            out.set(obj, { byteOffset: ta.byteOffset, length: ta.length, byteLength: ta.byteLength });
        }
        return;
    }

    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            if (i in obj) snapshotViewsBackedByTransferredBuffers(obj[i], transferSet, out, seen);
        }
        return;
    }

    if (tag === 'Map') {
        for (const [k, v] of obj as Map<unknown, unknown>) {
            snapshotViewsBackedByTransferredBuffers(k, transferSet, out, seen);
            snapshotViewsBackedByTransferredBuffers(v, transferSet, out, seen);
        }
        return;
    }
    if (tag === 'Set') {
        for (const v of obj as Set<unknown>) {
            snapshotViewsBackedByTransferredBuffers(v, transferSet, out, seen);
        }
        return;
    }

    // Plain object — walk own enumerable string keys.
    if (tag === 'Object') {
        for (const key of Object.keys(obj as Record<string, unknown>)) {
            snapshotViewsBackedByTransferredBuffers((obj as Record<string, unknown>)[key], transferSet, out, seen);
        }
    }
}

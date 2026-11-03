// Tagged JSON codec for structured-clone values crossing the worker
// subprocess boundary. Node uses structured clone on the in-process path;
// here (parent↔child over JSON lines) we tag the types JSON cannot carry
// so they survive the round trip. The same logic is inlined in
// `worker-bootstrap.ts` (BOOTSTRAP_CODE) because the bootstrap runs in a
// separate runtime with no module resolution. Keep the two in sync — the
// drift guard in `structured-clone-wire.spec.ts` extracts the bootstrap copy
// between its marker comments and runs this file's case matrix against it.
//
// Reference: HTML Living Standard §2.7.3 StructuredSerializeInternal /
// StructuredDeserialize. The behaviour that is not obvious from the code —
// the shared-reference memory, which Error names are interned, what makes a
// value uncloneable — is cited at the branch that implements it.

const TYPED_ARRAYS = [
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
];

// The error names StructuredSerializeInternal interns. Any other `Error`
// subclass serialises with name "Error" (§2.7.3 step 26: "If name is not one
// of ... then set name to 'Error'"), so a custom subclass arrives as a plain
// Error rather than as a half-reconstructed impostor.
const ERROR_CTORS: Record<string, new (message?: string) => Error> = {
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,
};

/** An error rebuilt from a name and message sent as plain fields (the child's
 *  `error` line), with the same interned names as the codec's `Error` tag. */
export function createErrorByName(name: string | undefined, message: string): Error {
    const Ctor = (name === undefined ? undefined : ERROR_CTORS[name]) ?? Error;
    return new Ctor(message);
}

// Base64 WITHOUT `btoa`/`atob`. The mirror of this codec in BOOTSTRAP_CODE is
// raw JS evaluated by a BARE `gjs` — which has neither, and no module
// resolution to reach a polyfill. Measured on gjs 1.88.1: every typed array,
// ArrayBuffer and typed-array view crossing into a file-based worker died as
// `bootstrap message error: atob is not defined` while the child exited 0, so
// the parent saw a silent timeout. The parent half happened to work only
// because a `--globals auto` build injects `btoa` for it — an asymmetry that
// makes the same value encodable and undecodable on the one wire.
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_CODES = new Uint8Array(128);
for (let i = 0; i < 64; i++) B64_CODES[B64_CHARS.charCodeAt(i)] = i;

function toBase64(buf: ArrayBufferLike): string {
    const bytes = new Uint8Array(buf as ArrayBuffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const has1 = i + 1 < bytes.length;
        const has2 = i + 2 < bytes.length;
        const n = (b0 << 16) | ((has1 ? bytes[i + 1] : 0) << 8) | (has2 ? bytes[i + 2] : 0);
        s +=
            B64_CHARS[(n >> 18) & 63] +
            B64_CHARS[(n >> 12) & 63] +
            (has1 ? B64_CHARS[(n >> 6) & 63] : '=') +
            (has2 ? B64_CHARS[n & 63] : '=');
    }
    return s;
}

function fromBase64(s: string): Uint8Array {
    let len = s.length;
    while (len > 0 && s.charCodeAt(len - 1) === 61) len--; // trailing '='
    const out = new Uint8Array((len * 3) >> 2);
    let acc = 0;
    let bits = 0;
    let o = 0;
    for (let i = 0; i < len; i++) {
        acc = (acc << 6) | B64_CODES[s.charCodeAt(i)];
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[o++] = (acc >> bits) & 0xff;
        }
    }
    return out;
}

/** True for the array-hole marker the encoder writes for a missing index. */
function isHoleTag(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).__gjsify === 'Hole'
    );
}

/**
 * Encode `value` into a JSON-safe tree.
 *
 * `refs` is the serialisation memory of §2.7.3: every object gets an id the
 * first time it is reached, and a second sighting becomes a `Ref` to that id.
 * The ids are implicit — pre-order position, assigned by `refs.size` here and
 * by push order in `decode` — so sharing and cycles cost no extra bytes on the
 * wire and need no second pass over the tree.
 */
export function encode(value: unknown, refs = new Map<object, number>()): unknown {
    if (value === null) return null;
    // `undefined` survives in an array but a JSON object key holding it is
    // dropped entirely, so it needs a tag of its own.
    if (value === undefined) return { __gjsify: 'Undefined' };
    switch (typeof value) {
        case 'bigint':
            return { __gjsify: 'BigInt', value: value.toString() };
        case 'number':
            if (value === Infinity) return { __gjsify: 'Infinity' };
            if (value === -Infinity) return { __gjsify: 'NegInfinity' };
            if (Number.isNaN(value)) return { __gjsify: 'NaN' };
            // JSON.stringify writes -0 as `0`; the sign is only recoverable
            // from a tag, and structured clone preserves it.
            if (Object.is(value, -0)) return { __gjsify: 'NegZero' };
            return value;
        case 'string':
        case 'boolean':
            return value;
        case 'function':
        case 'symbol':
            // §2.7.3 step 4: a function or symbol throws DataCloneError at the
            // sender. Nothing is written to the wire.
            throw createDataCloneError(`${String(value)} could not be cloned.`);
        default:
            break;
    }

    const seen = refs.get(value as object);
    if (seen !== undefined) return { __gjsify: 'Ref', id: seen };
    // Register BEFORE recursing: a cycle reaches its own id this way, and the
    // decoder's push-before-recurse mirrors it.
    refs.set(value as object, refs.size);

    if (value instanceof Date) return { __gjsify: 'Date', value: value.getTime() };
    if (value instanceof RegExp) {
        const r = value as RegExp;
        return { __gjsify: 'RegExp', source: r.source, flags: r.flags };
    }
    if (value instanceof Error) {
        const e = value as Error;
        const name = ERROR_CTORS[e.name] === undefined ? 'Error' : e.name;
        return { __gjsify: 'Error', name, message: e.message, stack: e.stack };
    }
    if (value instanceof Map) {
        const entries: [unknown, unknown][] = [];
        for (const [k, v] of value as Map<unknown, unknown>) {
            entries.push([encode(k, refs), encode(v, refs)]);
        }
        return { __gjsify: 'Map', entries };
    }
    if (value instanceof Set) {
        const values: unknown[] = [];
        for (const v of value as Set<unknown>) values.push(encode(v, refs));
        return { __gjsify: 'Set', values };
    }
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    if (tag === 'ArrayBuffer') {
        return { __gjsify: 'ArrayBuffer', data: toBase64(value as ArrayBuffer) };
    }
    if (tag === 'DataView' || TYPED_ARRAYS.includes(tag)) {
        // The view only, not the whole backing buffer: two views of one buffer
        // therefore decode to two independent buffers. A known deviation from
        // §2.7.3, which clones the buffer once and keeps the views aliased.
        const view = value as { buffer: ArrayBufferLike; byteOffset: number; byteLength: number };
        const slice = (view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength);
        return { __gjsify: tag, data: toBase64(slice) };
    }
    if (Array.isArray(value)) {
        const out: unknown[] = [];
        for (let i = 0; i < value.length; i++) {
            // A hole is not `undefined` — JSON writes both as `null` and the
            // decoder could not tell them apart, so holes get their own tag.
            out.push(i in value ? encode(value[i], refs) : { __gjsify: 'Hole' });
        }
        return out;
    }
    if (tag === 'Object') {
        const src = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(src)) out[k] = encode(src[k], refs);
        // An own `__gjsify` string key would be read back as a tag; wrapping
        // keeps user data out of the tag namespace.
        if (typeof src.__gjsify === 'string') return { __gjsify: 'Object', value: out };
        return out;
    }
    // Anything else — boxed primitives, platform objects, WeakMap, Promise.
    throw createDataCloneError('value could not be cloned.');
}

/**
 * Decode a tree produced by `encode`. `refs` is the deserialisation memory:
 * each object is pushed in the same pre-order the encoder numbered it in, so
 * `Ref` ids resolve by index. Containers are pushed BEFORE their children so
 * that a cycle can point back at a half-built parent.
 */
export function decode(value: unknown, refs: unknown[] = []): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        // Set the length up front rather than pushing, so that trailing holes
        // keep the array's length instead of truncating it.
        const out: unknown[] = [];
        out.length = value.length;
        refs.push(out);
        for (let i = 0; i < value.length; i++) {
            if (isHoleTag(value[i])) continue; // leave the index unset
            out[i] = decode(value[i], refs);
        }
        return out;
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.__gjsify === 'string') {
        switch (obj.__gjsify) {
            // Tags below that yield a primitive must NOT touch `refs`: the
            // encoder did not number them either.
            case 'Ref':
                return refs[obj.id as number];
            case 'Undefined':
                return undefined;
            case 'Hole':
                // Only reachable when a hole marker is handed to `decode`
                // outside an array; the array branch above intercepts it.
                return undefined;
            case 'BigInt':
                return BigInt(obj.value as string);
            case 'Infinity':
                return Infinity;
            case 'NegInfinity':
                return -Infinity;
            case 'NaN':
                return NaN;
            case 'NegZero':
                return -0;
            case 'Date': {
                const d = new Date(obj.value as number);
                refs.push(d);
                return d;
            }
            case 'RegExp': {
                const r = new RegExp(obj.source as string, obj.flags as string);
                refs.push(r);
                return r;
            }
            case 'Error': {
                const Ctor = ERROR_CTORS[obj.name as string] ?? Error;
                const e = new Ctor(obj.message as string);
                if (obj.stack) e.stack = obj.stack as string;
                refs.push(e);
                return e;
            }
            case 'Map': {
                const m = new Map();
                refs.push(m);
                for (const [k, v] of obj.entries as [unknown, unknown][]) {
                    m.set(decode(k, refs), decode(v, refs));
                }
                return m;
            }
            case 'Set': {
                const s = new Set();
                refs.push(s);
                for (const v of obj.values as unknown[]) s.add(decode(v, refs));
                return s;
            }
            case 'ArrayBuffer': {
                const b = fromBase64(obj.data as string).buffer as ArrayBuffer;
                refs.push(b);
                return b;
            }
            case 'DataView': {
                const dv = new DataView(fromBase64(obj.data as string).buffer as ArrayBuffer);
                refs.push(dv);
                return dv;
            }
            case 'Object': {
                const src = obj.value as Record<string, unknown>;
                const out: Record<string, unknown> = {};
                refs.push(out);
                for (const k of Object.keys(src)) out[k] = decode(src[k], refs);
                return out;
            }
            default: {
                if (TYPED_ARRAYS.includes(obj.__gjsify)) {
                    const bytes = fromBase64(obj.data as string);
                    const Ctor = (globalThis as Record<string, unknown>)[obj.__gjsify] as new (
                        b: ArrayBuffer,
                    ) => unknown;
                    const ta = new Ctor(bytes.buffer as ArrayBuffer);
                    refs.push(ta);
                    return ta;
                }
                // Unknown tag from a newer sender: pass the data through, but
                // number it, or every later `Ref` id is off by one.
                refs.push(value);
                return value;
            }
        }
    }
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    if (tag === 'Object') {
        const out: Record<string, unknown> = {};
        refs.push(out);
        for (const k of Object.keys(obj)) out[k] = decode(obj[k], refs);
        return out;
    }
    refs.push(value);
    return value;
}

export function createDataCloneError(message: string): Error {
    const DOMExceptionCtor = (globalThis as Record<string, unknown>).DOMException as
        | (new (message: string, name: string) => Error)
        | undefined;
    if (typeof DOMExceptionCtor === 'function') {
        const err = new DOMExceptionCtor(message, 'DataCloneError');
        // Ensure the `code` property matches Node/W3C (25 = DATA_CLONE_ERR).
        if ((err as { code?: number }).code === undefined) {
            try {
                Object.defineProperty(err, 'code', { value: 25, configurable: true });
            } catch {
                /* ignore */
            }
        }
        return err;
    }
    const err = new Error(message);
    err.name = 'DataCloneError';
    (err as { code?: number }).code = 25;
    return err;
}

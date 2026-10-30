// Tagged JSON codec for structured-clone values crossing the worker
// subprocess boundary. Node uses structured clone on the in-process path;
// here (parent↔child over JSON lines) we tag the types JSON cannot carry
// so they survive the round trip. The same logic is inlined in
// `worker-bootstrap.ts` (BOOTSTRAP_CODE) because the bootstrap runs in a
// separate runtime with no module resolution. Keep the two in sync.

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

export function encode(value: unknown, seen = new Map<object, unknown>()): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return { __gjsify: 'BigInt', value: value.toString() };
    if (value === Infinity) return { __gjsify: 'Infinity' };
    if (value === -Infinity) return { __gjsify: 'NegInfinity' };
    if (typeof value === 'number' && Number.isNaN(value)) return { __gjsify: 'NaN' };
    if (typeof value !== 'object') return value;
    if (seen.has(value as object)) {
        // Circular reference — structured clone throws DataCloneError; mirror.
        throw new Error('DataCloneError: circular reference');
    }
    if (value instanceof Date) return { __gjsify: 'Date', value: (value as Date).getTime() };
    if (value instanceof RegExp) {
        const r = value as RegExp;
        return { __gjsify: 'RegExp', source: r.source, flags: r.flags };
    }
    if (value instanceof Error) {
        const e = value as Error;
        return { __gjsify: 'Error', name: e.name, message: e.message, stack: e.stack };
    }
    if (value instanceof Map) {
        seen.set(value, null);
        const entries: [unknown, unknown][] = [];
        for (const [k, v] of value as Map<unknown, unknown>) {
            entries.push([encode(k, seen), encode(v, seen)]);
        }
        return { __gjsify: 'Map', entries };
    }
    if (value instanceof Set) {
        seen.set(value, null);
        const values: unknown[] = [];
        for (const v of value as Set<unknown>) values.push(encode(v, seen));
        return { __gjsify: 'Set', values };
    }
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    if (tag === 'ArrayBuffer') {
        return { __gjsify: 'ArrayBuffer', data: toBase64(value as ArrayBuffer) };
    }
    if (TYPED_ARRAYS.includes(tag)) {
        const ta = value as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
        return { __gjsify: tag, data: toBase64(ta.buffer.slice(ta.byteOffset, ta.byteOffset + ta.byteLength)) };
    }
    if (Array.isArray(value)) {
        seen.set(value, null);
        return (value as unknown[]).map((v) => encode(v, seen));
    }
    if (tag === 'Object') {
        seen.set(value, null);
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>)) {
            out[k] = encode((value as Record<string, unknown>)[k], seen);
        }
        return out;
    }
    // Anything else (functions, symbols, ...) cannot be cloned.
    throw new Error('DataCloneError: value could not be cloned');
}

export function decode(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return value.map((v) => decode(v));
    }
    const obj = value as Record<string, unknown>;
    if (typeof obj.__gjsify === 'string') {
        switch (obj.__gjsify) {
            case 'BigInt':
                return BigInt(obj.value as string);
            case 'Infinity':
                return Infinity;
            case 'NegInfinity':
                return -Infinity;
            case 'NaN':
                return NaN;
            case 'Date':
                return new Date(obj.value as number);
            case 'RegExp':
                return new RegExp(obj.source as string, obj.flags as string);
            case 'Error': {
                const e = new Error(obj.message as string);
                e.name = obj.name as string;
                if (obj.stack) e.stack = obj.stack as string;
                return e;
            }
            case 'Map': {
                const m = new Map();
                for (const [k, v] of obj.entries as [unknown, unknown][]) {
                    m.set(decode(k), decode(v));
                }
                return m;
            }
            case 'Set': {
                const s = new Set();
                for (const v of obj.values as unknown[]) s.add(decode(v));
                return s;
            }
            case 'ArrayBuffer':
                return fromBase64(obj.data as string).buffer;
            default: {
                if (TYPED_ARRAYS.includes(obj.__gjsify)) {
                    const bytes = fromBase64(obj.data as string);
                    const Ctor = (globalThis as Record<string, unknown>)[obj.__gjsify] as new (
                        b: ArrayBuffer,
                    ) => unknown;
                    return new Ctor(bytes.buffer as ArrayBuffer);
                }
                return value;
            }
        }
    }
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    if (tag === 'Object') {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(obj)) {
            out[k] = decode(obj[k]);
        }
        return out;
    }
    return value;
}

export function createDataCloneError(message: string): Error {
    const DOMExceptionCtor = (globalThis as Record<string, unknown>).DOMException as
        | (new (message: string, name: string) => Error)
        | undefined;
    if (typeof DOMExceptionCtor === 'function') {
        const err = new DOMExceptionCtor(message, 'DataCloneError');
        return err;
    }
    const err = new Error(message);
    err.name = 'DataCloneError';
    (err as { code?: number }).code = 25;
    return err;
}

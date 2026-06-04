// String ↔ Uint8Array codec helpers for every supported `BufferEncoding`.
// Originally inlined in buffer.ts pre-split — extracted because the two
// functions account for ~120 LoC of pure switch-on-encoding logic and
// have no instance-state coupling to the Buffer class.
//
// Reference: Node.js lib/buffer.js (Buffer.from / .toString encode/decode).

import { base64Decode, btoaPolyfill as _btoa } from './base64.js';

// Lazily instantiated. A top-level `new TextEncoder()` runs at module-evaluation
// time — which on the NativeScript V8 runtime is BEFORE `@nativescript/core`
// registers the `TextEncoder` / `TextDecoder` globals, throwing and rejecting the
// whole bundle's evaluation on app start. Deferring construction to first use
// lets the globals exist by the time we need them. No behaviour change on GJS /
// Node / browser, where both globals already exist at eval time.
let _textEncoder: TextEncoder | undefined;
let _textDecoder: TextDecoder | undefined;
const textEncoder = (): TextEncoder => (_textEncoder ??= new TextEncoder());
const textDecoder = (): TextDecoder => (_textDecoder ??= new TextDecoder());

// ─── Encode string → Uint8Array ──────────────────────────────────────────

export function encodeString(str: string, encoding: BufferEncoding): Uint8Array {
    switch (encoding) {
        case 'utf8':
            return textEncoder().encode(str);

        case 'ascii': {
            const buf = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                buf[i] = str.charCodeAt(i) & 0x7f;
            }
            return buf;
        }

        case 'latin1': {
            const buf = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                buf[i] = str.charCodeAt(i) & 0xff;
            }
            return buf;
        }

        case 'base64': {
            const standard = str.replace(/-/g, '+').replace(/_/g, '/');
            return base64Decode(standard);
        }

        case 'base64url': {
            const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
            return encodeString(base64, 'base64');
        }

        case 'hex': {
            const bytes = str.length >>> 1;
            const buf = new Uint8Array(bytes);
            for (let i = 0; i < bytes; i++) {
                const hi = parseInt(str[i * 2], 16);
                const lo = parseInt(str[i * 2 + 1], 16);
                if (Number.isNaN(hi) || Number.isNaN(lo)) break;
                buf[i] = (hi << 4) | lo;
            }
            return buf;
        }

        case 'utf16le': {
            const buf = new Uint8Array(str.length * 2);
            for (let i = 0; i < str.length; i++) {
                const code = str.charCodeAt(i);
                buf[i * 2] = code & 0xff;
                buf[i * 2 + 1] = (code >> 8) & 0xff;
            }
            return buf;
        }

        default:
            return textEncoder().encode(str);
    }
}

// ─── Decode Uint8Array → string ──────────────────────────────────────────

export function decodeString(buf: Uint8Array, encoding: BufferEncoding, start?: number, end?: number): string {
    const slice = start !== undefined || end !== undefined ? buf.subarray(start ?? 0, end ?? buf.length) : buf;

    switch (encoding) {
        case 'utf8':
            return textDecoder().decode(slice);

        case 'ascii': {
            let result = '';
            for (let i = 0; i < slice.length; i++) {
                result += String.fromCharCode(slice[i] & 0x7f);
            }
            return result;
        }

        case 'latin1': {
            let result = '';
            for (let i = 0; i < slice.length; i++) {
                result += String.fromCharCode(slice[i]);
            }
            return result;
        }

        case 'base64': {
            let binary = '';
            for (let i = 0; i < slice.length; i++) {
                binary += String.fromCharCode(slice[i]);
            }
            return _btoa(binary);
        }

        case 'base64url': {
            const base64 = decodeString(slice, 'base64');
            return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }

        case 'hex': {
            let result = '';
            for (let i = 0; i < slice.length; i++) {
                result += slice[i].toString(16).padStart(2, '0');
            }
            return result;
        }

        case 'utf16le': {
            let result = '';
            for (let i = 0; i + 1 < slice.length; i += 2) {
                result += String.fromCharCode(slice[i] | (slice[i + 1] << 8));
            }
            return result;
        }

        default:
            return textDecoder().decode(slice);
    }
}

// ─── Range check helper ──────────────────────────────────────────────────

export function checkOffset(offset: number, ext: number, length: number): void {
    if (offset + ext > length) {
        throw new RangeError('Attempt to access memory outside buffer bounds');
    }
}

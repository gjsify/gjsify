// SPDX-License-Identifier: MIT OR LGPL-2.0-or-later
// SPDX-FileCopyrightText: 2017 Philip Chimento <philip.chimento@gmail.com>
//
// Adapted from GJS (refs/gjs/modules/script/byteArray.js + the native
// refs/gjs/gjs/byteArray.cpp `imports._byteArrayNative` functions). Copyright
// (c) 2017 Philip Chimento. MIT OR LGPL-2.0-or-later.
// Modifications: the legacy `imports.byteArray` module ported to
// @gjsify/node-gi. The native `fromGBytes`/`fromString`/`toString` are
// reimplemented in JS over the engine's boxed-GBytes surface and
// TextEncoder/TextDecoder, preserving GJS semantics:
//   - toString/fromString are ZERO-TERMINATED (data truncates at the first NUL
//     byte — gjs/text-encoding.cpp `zero_terminated_length`), and decoding is
//     FATAL (invalid sequences throw a TypeError, like gjs's fatal=true).
//   - fromGBytes/fromString return a COPY as a plain Uint8Array carrying the
//     legacy own `toString(encoding)` method gjs tacks on
//     (`define_legacy_tostring`), minus gjs's once-per-callsite deprecation
//     warning (stderr-only noise a byte-golden never sees).
//   - toGBytes routes through `new GLib.Bytes(array)` exactly as the gjs
//     script module does; GLib is loaded lazily so building `imports` never
//     pulls the namespace in.

// Truncate a byte array at the first NUL, per gjs's ZERO_TERMINATED handling
// (gjs/text-encoding.cpp zero_terminated_length).
function zeroTerminated(u8) {
    const nul = u8.indexOf(0);
    return nul === -1 ? u8 : u8.subarray(0, nul);
}

// gjs routes non-UTF-8 encodings through iconv; Node's TextDecoder (decode
// side) accepts WHATWG labels which cover the practical iconv set, so decoding
// just passes the label through. The ENCODE side has no general converter on
// Node — map the labels gjs consumers actually use onto Buffer encodings and
// throw a clear error for the rest.
const ENCODE_LABELS = new Map([
    ['latin1', 'latin1'],
    ['iso-8859-1', 'latin1'],
    ['iso8859-1', 'latin1'],
    ['ascii', 'ascii'],
    ['us-ascii', 'ascii'],
    ['utf-16', 'utf16le'],
    ['utf-16le', 'utf16le'],
    ['utf16le', 'utf16le'],
]);

function isUtf8Label(encoding) {
    const label = String(encoding).toLowerCase();
    return label === 'utf-8' || label === 'utf8';
}

// The legacy own `toString(encoding)` gjs defines on arrays returned by
// fromString/fromGBytes/fromArray (byteArray.cpp define_legacy_tostring).
function defineLegacyToString(u8, toString) {
    Object.defineProperty(u8, 'toString', {
        value(encoding = 'utf-8') {
            return toString(u8, encoding);
        },
        writable: true,
        enumerable: false,
        configurable: true,
    });
    return u8;
}

/**
 * Build the legacy `imports.byteArray` module bound to the L1 backend.
 * @param {(ns: string, version?: string) => Record<string, any>} requireGi
 * @returns {{ ByteArray: any, fromArray: Function, fromGBytes: Function, fromString: Function, toGBytes: Function, toString: Function }}
 */
export function createByteArray(requireGi) {
    /**
     * @param {Uint8Array} byteArray bytes to decode
     * @param {string} [encoding] a WHATWG/iconv label, default UTF-8
     * @returns {string} the decoded string, stopping at the first NUL byte
     */
    function toString(byteArray, encoding = 'utf-8') {
        // Plain Error, not TypeError — gjs raises these argument failures via
        // gjs_throw (Error); only the GBytes typecheck below is a TypeError.
        if (!(byteArray instanceof Uint8Array)) throw new Error('Argument to decode() must be a Uint8Array');
        const data = zeroTerminated(byteArray);
        if (data.length === 0) return '';
        // fatal:true mirrors gjs's fatal decode (invalid sequences throw).
        return new TextDecoder(encoding, { fatal: true }).decode(data);
    }

    /**
     * @param {string} string the string to encode
     * @param {string} [encoding] a WHATWG/iconv label, default UTF-8
     * @returns {Uint8Array} the encoded bytes, truncated at the first NUL byte
     */
    function fromString(string, encoding = 'utf-8') {
        if (typeof string !== 'string') throw new Error('Argument to fromString() must be a string');
        let encoded;
        if (isUtf8Label(encoding)) {
            encoded = new TextEncoder().encode(string);
        } else {
            const bufferEncoding = ENCODE_LABELS.get(String(encoding).toLowerCase());
            if (!bufferEncoding) throw new Error(`Unsupported encoding for fromString(): ${encoding}`);
            const buf = Buffer.from(string, bufferEncoding);
            encoded = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        }
        const data = zeroTerminated(encoded);
        // Copy into a fresh plain Uint8Array (gjs returns a standalone buffer, and
        // Buffer.from may hand out a view into Node's shared slab).
        const out = new Uint8Array(data.length);
        out.set(data);
        return defineLegacyToString(out, toString);
    }

    /**
     * @param {any} bytes a GLib.Bytes boxed handle
     * @returns {Uint8Array} a copy of the bytes as a plain Uint8Array
     */
    function fromGBytes(bytes) {
        // The engine's boxed GBytes proxy carries `toArray()` (gi.js wrapBoxed) —
        // the same convenience gjs adds to GLib.Bytes.prototype. Its absence means
        // the value is not a GBytes, matching gjs's G_TYPE_BYTES typecheck throw.
        if (!bytes || typeof bytes.toArray !== 'function') {
            throw new TypeError('Argument to fromGBytes() must be a GLib.Bytes');
        }
        const data = bytes.toArray();
        // toArray() already returns a copy of the GBytes data; re-view it as a
        // PLAIN Uint8Array (gjs returns Uint8Array, not Node's Buffer subclass).
        const out = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return defineLegacyToString(out, toString);
    }

    /**
     * @param {Uint8Array} array the Uint8Array to convert to GLib.Bytes
     * @returns {any} a GLib.Bytes boxed handle
     */
    function toGBytes(array) {
        if (!(array instanceof Uint8Array)) throw new Error('Argument to ByteArray.toGBytes() must be a Uint8Array');
        const GLib = requireGi('GLib', '2.0');
        return new GLib.Bytes(array);
    }

    // The legacy ByteArray wrapper class, ported verbatim from
    // refs/gjs/modules/script/byteArray.js (backwards compatibility only).
    const ByteArray = class ByteArray {
        constructor(arg = 0) {
            if (arg instanceof Uint8Array) this._array = arg;
            else this._array = new Uint8Array(arg);
            return new Proxy(this, ByteArray);
        }

        static get(target, prop, receiver) {
            if (!Number.isNaN(Number.parseInt(prop))) return Reflect.get(target._array, prop);
            return Reflect.get(target, prop, receiver);
        }

        static set(target, prop, val, receiver) {
            const ix = Number.parseInt(prop);
            if (!Number.isNaN(ix)) {
                if (ix >= target._array.length) {
                    const newArray = new Uint8Array(ix + 1);
                    newArray.set(target._array);
                    target._array = newArray;
                }
                return Reflect.set(target._array, prop, val);
            }
            return Reflect.set(target, prop, val, receiver);
        }

        get length() {
            return this._array.length;
        }

        set length(newLength) {
            if (newLength === this._array.length) return;
            if (newLength < this._array.length) {
                this._array = new Uint8Array(this._array.buffer, 0, newLength);
                return;
            }
            const newArray = new Uint8Array(newLength);
            newArray.set(this._array);
            this._array = newArray;
        }

        toString(encoding = 'UTF-8') {
            return toString(this._array, encoding);
        }

        toGBytes() {
            return toGBytes(this._array);
        }
    };

    /**
     * @param {Iterable<number>} array an iterable to convert into a ByteArray wrapper
     * @returns {InstanceType<ByteArray>}
     */
    function fromArray(array) {
        return new ByteArray(Uint8Array.from(array));
    }

    return { ByteArray, fromArray, fromGBytes, fromString, toGBytes, toString };
}

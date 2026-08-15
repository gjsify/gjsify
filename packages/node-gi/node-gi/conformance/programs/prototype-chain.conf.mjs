// SPDX-License-Identifier: MIT
// The JS prototype chain of an introspected class (#1175). GJS gives every
// instance the real prototype of its class and resolves GI methods ONTO that
// prototype, so a program can read a method there, wrap it, and see every call
// through the instance. node-gi wrapped instances in a Proxy with NO prototype:
// `Cls.prototype.m = spy` was accepted and observable on the prototype, and the
// instance still reached the native method underneath — a spy that reports itself
// installed and then measures nothing (a test asserting `calls === 0` goes GREEN
// having measured nothing). Headless Gio only.
//
// Nothing zlib does is printed: `Gio.Converter.convert()`'s caller-allocated
// out-buffer is not written back to JS (gjs 1.88), and compressed sizes depend on
// the host zlib — so the observable here is dispatch, never converted data. The
// golden is the gjs output; node/bun/deno must match it byte-for-byte.
import Gio from 'gi://Gio?version=2.0';

const proto = Gio.ZlibDecompressor.prototype;

// ---- the prototype carries the class's introspected methods, and only those ----
print('typeof proto.convert:', typeof proto.convert);
print('proto has own convert:', Object.prototype.hasOwnProperty.call(proto, 'convert'));
print('typeof proto.reset:', typeof proto.reset);
print('typeof proto.notAMethod:', typeof proto.notAMethod);
print('proto has own notAMethod:', Object.prototype.hasOwnProperty.call(proto, 'notAMethod'));

// ---- the four rows of #1175 ----
const sameTwice = proto.convert === proto.convert;
const original = proto.convert;
const spy = function () {
    return 'SPY';
};
proto.convert = spy;
const decompressor = new Gio.ZlibDecompressor({ format: Gio.ZlibCompressorFormat.GZIP });
print('proto.convert === proto.convert:', sameTwice);
print('proto.convert === spy:', proto.convert === spy);
print('instance has own convert:', Object.prototype.hasOwnProperty.call(decompressor, 'convert'));
print('d.convert === spy:', decompressor.convert === spy);
print('"convert" in d:', 'convert' in decompressor);
print('d.convert === proto.convert:', decompressor.convert === proto.convert);

// ---- the spy is REACHED, not merely visible ----
print('d.convert(...) returns:', decompressor.convert(new Uint8Array(0), new Uint8Array(0), Gio.ConverterFlags.NONE));
proto.convert = original;
print('restored proto.convert === original:', proto.convert === original);
print('restored d.convert === original:', decompressor.convert === original);

// ---- a counting wrapper counts the REAL calls (reset() is void + stateless) ----
const resetOriginal = proto.reset;
let resets = 0;
proto.reset = function (...args) {
    resets++;
    return resetOriginal.apply(this, args);
};
decompressor.reset();
decompressor.reset();
print('wrapper observed reset calls:', resets);
proto.reset = resetOriginal;
print('after restore, typeof d.reset():', typeof decompressor.reset());
print('after restore, count unchanged:', resets);

// ---- a SECOND instance of the same class shares that one prototype ----
// (Deliberately not asserted here: whether two DIFFERENT classes implementing the
// same interface share one `convert` function. gjs hands both the interface's own
// method object; node-gi materializes one per class prototype — a live divergence,
// recorded in packages/node-gi/AGENTS.md rather than ledgered, because a ledger
// entry would excuse this whole program on node/bun/deno.)
const other = new Gio.ZlibDecompressor({ format: Gio.ZlibCompressorFormat.GZIP });
print('two instances share the method:', other.convert === decompressor.convert);
print("the prototype is the instances' resolver:", proto.convert === other.convert);

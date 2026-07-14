// SPDX-License-Identifier: MIT
// 64-bit integer marshalling — the GJS-exact BigInt-in / Number-out contract.
//
// GLib-only (no GIMarshallingTests typelib) so it runs UNCHANGED on all four
// runtimes and its STDOUT must be byte-identical to the gjs golden:
//   • GLib.DateTime.new_from_unix_utc(gint64) + .to_unix() — the scalar gint64
//     IN/OUT marshalling path (marshal.cc), driven by both a Number and a BigInt;
//   • GLib.Variant 'x'/'t' pack (BigInt in) + unpack (Number out) — the GVariant
//     64-bit path (variant.cc).
//
// A 64-bit value ALWAYS comes back as a JS Number (never a BigInt), matching GJS.
// A value outside ±2^53 additionally emits a "cannot be safely stored" g_warning
// on STDERR — not compared here (conformance diffs stdout only), but the values
// below are chosen so the rounded double stringifies identically on SpiderMonkey
// (gjs) and V8 (node/bun/deno).
import GLib from 'gi://GLib?version=2.0';

// ---- scalar gint64 round-trip (DateTime.new_from_unix_utc + to_unix) ---------
const t = GLib.DateTime.new_from_unix_utc(1234567890).to_unix();
print('scalar to_unix:', t, typeof t);
// A BigInt argument marshals losslessly into the same gint64 slot as the Number.
const tb = GLib.DateTime.new_from_unix_utc(1234567890n).to_unix();
print('scalar to_unix (BigInt in):', tb, typeof tb);

// ---- GVariant int64 ('x') — BigInt in, Number out ----------------------------
print('x small:', new GLib.Variant('x', 42n).deepUnpack());
print('x min:', new GLib.Variant('x', -9223372036854775808n).deepUnpack());
print('x max:', new GLib.Variant('x', 9223372036854775807n).deepUnpack());
print('x safe:', new GLib.Variant('x', 9007199254740991n).deepUnpack());
print('x typeof:', typeof new GLib.Variant('x', 42n).deepUnpack());

// ---- GVariant uint64 ('t') — BigInt in, Number out ---------------------------
print('t small:', new GLib.Variant('t', 7n).deepUnpack());
print('t max:', new GLib.Variant('t', 18446744073709551615n).deepUnpack());
print('t safe:', new GLib.Variant('t', 9007199254740991n).deepUnpack());
print('t typeof:', typeof new GLib.Variant('t', 7n).deepUnpack());

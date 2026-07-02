// SPDX-License-Identifier: MIT
//
// Cross-runtime scenario: GVariant + enums/flags + deterministic GLib helpers.
//
// BYTE-IDENTICAL input to `gjsify build --app {gjs,node}`, run on gjs/node/bun/deno
// (see harness.mjs). Every printed value is deterministic — no hostname, no paths,
// no dependence on signal-callback args (their shape differs across runtimes). The
// GVariant build/deepUnpack path is the same GJS-shaped API on both the native
// `gi://` (gjs) and the `@gjsify/node-gi` reverse bridge (node/bun/deno).
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';

print('node-gi variants example');

// 1. Deterministic GLib string helpers (pure transforms — no environment input).
print(`escape: ${GLib.markup_escape_text('<a href="x">&', -1)}`);
print(`sha256: ${GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, 'gjsify', -1)}`);

// 2. Enums / flags surfaced GJS-style (UPPER_CASE members, numeric values).
print(`filetype-dir: ${Gio.FileType.DIRECTORY}`);
print(`checksum-sha256: ${GLib.ChecksumType.SHA256}`);

// 3. GVariant: tuple build + deepUnpack (the recursive packer/unpacker).
const tuple = new GLib.Variant('(sib)', ['node-gi', 42, true]);
const [s, i, b] = tuple.deepUnpack();
print(`variant-tuple: type=${tuple.get_type_string()} s=${s} i=${i} b=${b}`);

// 4. GVariant: dict build + deepUnpack (single key → stable order across runtimes).
const dict = new GLib.Variant('a{ss}', { lang: 'typescript' });
const unpacked = dict.deepUnpack();
print(`variant-dict: lang=${unpacked.lang}`);

// 5. GVariant: scalar build + unpack round-trip.
const sv = new GLib.Variant('s', 'hello-variant');
print(`variant-string: ${sv.unpack()}`);

print('done');

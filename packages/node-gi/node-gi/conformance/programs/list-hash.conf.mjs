// SPDX-License-Identifier: MIT
// GList / GSList / GHashTable OUT via headless GLib (no test typelib needed).
// Exercises phase-2.3: a transfer-full GHashTable<utf8,utf8> read into a plain
// object, and GSList/GList string returns read into arrays — surfaced exactly as
// GJS does. The golden is the gjs output; node/bun/deno must match byte-for-byte.
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';

// GHashTable<utf8,utf8> OUT (transfer full: keys + values both owned + decoded).
const params = GLib.Uri.parse_params('a=1&b=two&c=3&d=', -1, '&', 0);
print('hash a:', params.a);
print('hash b:', params.b);
print('hash c:', params.c);
print('hash d:', JSON.stringify(params.d));
print('hash keys:', JSON.stringify(Object.keys(params).sort()));

// GList<utf8> return (registered content types). Empty on a minimal host, non-empty
// otherwise — either way a string[]; assert the SHAPE only (deterministic across
// runtimes on the same machine), never the host-dependent values.
const registered = Gio.content_types_get_registered();
print('registered isArray:', Array.isArray(registered));
print('registered all strings:', registered.every((t) => typeof t === 'string'));

// GHashTable round-trips a fixed input deterministically — a second parse with a
// different separator proves the key/value decoding is content-driven, not cached.
const semi = GLib.Uri.parse_params('x=10;y=20', -1, ';', 0);
print('semi x:', semi.x, 'semi y:', semi.y);

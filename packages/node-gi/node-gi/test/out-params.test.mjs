// SPDX-License-Identifier: MIT
// OUT / INOUT parameter marshalling + the GJS return-tuple convention for
// @gjsify/node-gi. Exercises real headless GLib/Gio callables whose signatures
// carry OUT and INOUT arguments, asserting the GJS surfacing rule:
//   [the function's own return value IF non-void] ++ [each OUT/INOUT, in order]
//   → one element returns bare, many return a JS Array, none returns undefined.
import test from 'node:test';
import assert from 'node:assert/strict';

import { callFunction, callStaticMethod, callBoxedMethod, requireNamespace } from '../index.js';

test('single OUT, void return → bare value: GLib.ref_count_init()', () => {
    requireNamespace('GLib', '2.0');
    // void g_ref_count_init(grefcount *rc) initialises rc; grefcount's internal
    // representation seeds to -1. One OUT + void return → returned bare (not [-1]).
    const rc = callFunction('GLib', 'ref_count_init');
    assert.equal(rc, -1);
});

test('INOUT round-trip, void return → bare value: GLib.ref_count_inc()', () => {
    // void g_ref_count_inc(grefcount *rc): reads rc (IN) and writes it back (OUT).
    // The JS input flows in, the mutated value flows out as the single bare result.
    assert.equal(callFunction('GLib', 'ref_count_inc', [-1]), -2);
    assert.equal(callFunction('GLib', 'ref_count_inc', [-3]), -4);
});

test('INOUT + non-void return → [return, inout] array: GLib.ref_count_dec()', () => {
    // gboolean g_ref_count_dec(grefcount *rc): returns whether the count hit zero
    // AND mutates rc (INOUT) → [boolean, number] in [return, out] order.
    const res = callFunction('GLib', 'ref_count_dec', [-2]);
    assert.ok(Array.isArray(res));
    assert.deepEqual(res, [false, -1]);
});

test('non-void return + OUT string → array: GLib.get_charset()', () => {
    // gboolean g_get_charset(const char **charset) → [is_utf8, charset]. The bool
    // and charset are locale-dependent, so assert shape rather than exact values.
    const res = callFunction('GLib', 'get_charset');
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 2);
    assert.equal(typeof res[0], 'boolean');
    assert.equal(typeof res[1], 'string');
    assert.ok(res[1].length > 0);
});

test('string IN + fundamental OUT + throws → array: GLib.ascii_string_to_unsigned()', () => {
    // gboolean g_ascii_string_to_unsigned(str, base, min, max, guint64 *out, GError**)
    // — the GError is handled by the invoker (not an introspected arg), so the
    // result is [success, parsed] = [true, 42].
    assert.deepEqual(callFunction('GLib', 'ascii_string_to_unsigned', ['42', 10, 0, 100]), [true, 42]);
    assert.deepEqual(callFunction('GLib', 'ascii_string_to_signed', ['-7', 10, -100, 100]), [true, -7]);
});

test('instance method with multiple OUT → array: GLib.DateTime.get_ymd()', () => {
    // void g_date_time_get_ymd(GDateTime*, gint *y, gint *m, gint *d): three OUT
    // ints on a boxed instance (offset=1 path) → [year, month, day]. 1136214245 =
    // 2006-01-02 UTC.
    const dt = callStaticMethod('GLib', 'DateTime', 'new_from_unix_utc', [1136214245]);
    assert.deepEqual(callBoxedMethod(dt, 'get_ymd'), [2006, 1, 2]);
});

test('OUT string array → [bool, string[]]: GLib.get_filename_charsets()', () => {
    // gboolean g_get_filename_charsets(const gchar ***): the OUT is a zero-terminated
    // string array. Once a roadmap PR (arrays/lists/hash) — now implemented, so it
    // surfaces as [is_utf8, charsets] rather than throwing "not yet supported".
    const res = callFunction('GLib', 'get_filename_charsets');
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 2);
    assert.equal(typeof res[0], 'boolean');
    assert.ok(Array.isArray(res[1]));
    assert.ok(res[1].length > 0);
    assert.ok(res[1].every((c) => typeof c === 'string'));
});

test('(skip)-annotated return still LEADS the tuple (GJS ignores skip): GLib.uri_split()', () => {
    // gboolean g_uri_split(uri_ref, flags, scheme, userinfo, host, port, path,
    //   query, fragment, GError**). g_uri_split's gboolean return carries `skip="1"`
    //   in the GIR (and the function throws), yet GJS 1.88 KEEPS it as the leading
    //   tuple element — the `(skip)` annotation is IGNORED for the JS return. GJS's
    //   arg-cache derives `m_has_return` purely from the return type and always counts
    //   it (refs/gjs/gi/arg-cache.cpp); nothing there consults skip_return. Verified
    //   against the gold standard (gjs -m):
    //     GLib.uri_split('http://user@host:80/p?q=1#frag', 0)
    //       → [true, 'http', 'user', 'host', 80, '/p', 'q=1', 'frag']   (8 elements)
    //   node-gi previously honoured the annotation and dropped the boolean (7); this
    //   corrected assertion tracks the gold standard (see the calls.cc return-tuple
    //   comment). node-gtk's ShouldSkipReturn honours skip — we match GJS, not node-gtk.
    const res = callFunction('GLib', 'uri_split', ['http://user@host:80/p?q=1#frag', 0]);
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 8);
    assert.deepEqual(res, [true, 'http', 'user', 'host', 80, '/p', 'q=1', 'frag']);
    assert.equal(res[0], true); // the (skip)-annotated gboolean still leads the tuple
});

test('transfer-full string IN is g_strdup`d, not a freed std::string buffer', () => {
    // g_string_new_take(gchar* init) ADOPTS init (transfer full) and g_free's it on
    // realloc/free. A std::string-buffer pointer would be an invalid free; the fix
    // hands over a g_strdup'd copy. append() reallocs → frees the adopted buffer
    // (the crash trigger pre-fix); equal() then confirms the content is intact.
    const s = callStaticMethod('GLib', 'String', 'new_take', ['héllo']);
    callBoxedMethod(s, 'append', [' world']);
    const other = callStaticMethod('GLib', 'String', 'new', ['héllo world']);
    assert.equal(callBoxedMethod(s, 'equal', [other]), true);
});

test('IN-only callables are unchanged: bare scalar returns', () => {
    // The OUT/INOUT routing must leave the IN-only path byte-for-byte: a non-void
    // return with no OUT args still comes back bare, not wrapped in an array.
    const name = callFunction('GLib', 'get_host_name');
    assert.equal(typeof name, 'string');
    assert.ok(name.length > 0);
    assert.equal(callFunction('GLib', 'str_has_prefix', ['hello', 'he']), true);
});

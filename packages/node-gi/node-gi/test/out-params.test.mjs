// SPDX-License-Identifier: MIT
// OUT / INOUT parameter marshalling + the GJS return-tuple convention for
// @gjsify/node-gi, over real headless GLib callables. The surfacing rule:
//   [the function's own return value IF non-void] ++ [each OUT/INOUT, in order]
//   → one element returns bare, many return a JS Array, none returns undefined.
import test from 'node:test';
import assert from 'node:assert/strict';

import { callFunction, callStaticMethod, callBoxedMethod, requireNamespace } from '../index.js';

test('single OUT, void return → bare value: GLib.ref_count_init()', () => {
    requireNamespace('GLib', '2.0');
    // void g_ref_count_init(grefcount *rc): grefcount's internal representation seeds
    // to -1, and the single OUT comes back bare, not as [-1].
    const rc = callFunction('GLib', 'ref_count_init');
    assert.equal(rc, -1);
});

test('INOUT round-trip, void return → bare value: GLib.ref_count_inc()', () => {
    // void g_ref_count_inc(grefcount *rc) reads rc (IN) and writes it back (OUT).
    assert.equal(callFunction('GLib', 'ref_count_inc', [-1]), -2);
    assert.equal(callFunction('GLib', 'ref_count_inc', [-3]), -4);
});

test('INOUT + non-void return → [return, inout] array: GLib.ref_count_dec()', () => {
    // gboolean g_ref_count_dec(grefcount *rc) returns whether the count hit zero AND
    // mutates rc (INOUT) → [boolean, number] in [return, out] order.
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
    // gboolean g_ascii_string_to_unsigned(str, base, min, max, guint64 *out, GError**):
    // the GError is the invoker's, not an introspected arg, so the result is
    // [success, parsed].
    assert.deepEqual(callFunction('GLib', 'ascii_string_to_unsigned', ['42', 10, 0, 100]), [true, 42]);
    assert.deepEqual(callFunction('GLib', 'ascii_string_to_signed', ['-7', 10, -100, 100]), [true, -7]);
});

test('instance method with multiple OUT → array: GLib.DateTime.get_ymd()', () => {
    // void g_date_time_get_ymd(GDateTime*, gint *y, gint *m, gint *d): three OUT ints on
    // a boxed instance (offset=1 path) → [year, month, day]. 1136214245 = 2006-01-02 UTC.
    const dt = callStaticMethod('GLib', 'DateTime', 'new_from_unix_utc', [1136214245]);
    assert.deepEqual(callBoxedMethod(dt, 'get_ymd'), [2006, 1, 2]);
});

test('OUT string array → [bool, string[]]: GLib.get_filename_charsets()', () => {
    // gboolean g_get_filename_charsets(const gchar ***): the OUT is a zero-terminated
    // string array → [is_utf8, charsets].
    const res = callFunction('GLib', 'get_filename_charsets');
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 2);
    assert.equal(typeof res[0], 'boolean');
    assert.ok(Array.isArray(res[1]));
    assert.ok(res[1].length > 0);
    assert.ok(res[1].every((c) => typeof c === 'string'));
});

test('(skip)-annotated return still LEADS the tuple (GJS ignores skip): GLib.uri_split()', () => {
    // g_uri_split's gboolean return carries `skip="1"` in the GIR (and the function
    // throws), yet GJS 1.88 KEEPS it as the leading tuple element: its arg-cache derives
    // `m_has_return` purely from the return type and never consults skip_return
    // (refs/gjs gi/arg-cache.cpp). The 8-element expectation below is the gold standard
    // measured with `gjs -m`; node-gtk's ShouldSkipReturn honours skip, and we match GJS,
    // not node-gtk. See the return-tuple comment in src/calls.cc.
    const res = callFunction('GLib', 'uri_split', ['http://user@host:80/p?q=1#frag', 0]);
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 8);
    assert.deepEqual(res, [true, 'http', 'user', 'host', 80, '/p', 'q=1', 'frag']);
    assert.equal(res[0], true);
});

test('transfer-full string IN is g_strdup`d, not a freed std::string buffer', () => {
    // g_string_new_take(gchar* init) ADOPTS init (transfer full) and g_free's it on
    // realloc, so a std::string-buffer pointer would be an invalid free; we hand over a
    // g_strdup'd copy. append() reallocs — the pre-fix crash trigger.
    const s = callStaticMethod('GLib', 'String', 'new_take', ['héllo']);
    callBoxedMethod(s, 'append', [' world']);
    const other = callStaticMethod('GLib', 'String', 'new', ['héllo world']);
    assert.equal(callBoxedMethod(s, 'equal', [other]), true);
});

test('IN-only callables are unchanged: bare scalar returns', () => {
    // A non-void return with no OUT args still comes back bare, not wrapped in an array.
    const name = callFunction('GLib', 'get_host_name');
    assert.equal(typeof name, 'string');
    assert.ok(name.length > 0);
    assert.equal(callFunction('GLib', 'str_has_prefix', ['hello', 'he']), true);
});

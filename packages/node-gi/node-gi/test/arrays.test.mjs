// SPDX-License-Identifier: MIT
// Array / GList / GSList / GHashTable / GStrv marshalling for @gjsify/node-gi —
// IN, return, and OUT directions against real headless GLib/Gio callables.
//
// Exercises the load-bearing pieces of the container marshalling drop:
//  * GStrv return → string[]                       (g_get_environ)
//  * GStrv IN (transfer none) + string return      (g_environ_getenv)
//  * GStrv IN (transfer full) + GStrv return        (g_environ_setenv)
//  * C byte array IN with an autofilled length arg  (g_base64_encode)
//  * C byte array return with an OUT length arg → Buffer (g_base64_decode)
//  * plain C utf8 array return (transfer full)      (g_uri_list_extract_uris)
//  * GHashTable<utf8,utf8> return → object          (GLib.Uri.parse_params)
//  * GList<utf8> return → string[]                  (g_content_types_get_registered)
//  * INOUT byte-array container is handled           (g_base64_decode_inplace)
import test from 'node:test';
import assert from 'node:assert/strict';

import { callFunction, callStaticMethod, requireNamespace } from '../index.js';

test('GStrv return → string[]: GLib.get_environ()', () => {
  requireNamespace('GLib', '2.0');
  // char** (NULL-terminated, transfer full) of "NAME=VALUE" entries.
  const environ = callFunction('GLib', 'get_environ');
  assert.ok(Array.isArray(environ));
  assert.ok(environ.length > 0);
  assert.ok(environ.every((e) => typeof e === 'string'));
  assert.ok(environ.some((e) => e.startsWith('PATH=')));
});

test('GStrv IN (transfer none) + string return: GLib.environ_getenv()', () => {
  // const char* g_environ_getenv(char** envp, const char* variable): the JS
  // string[] is rebuilt as a NULL-terminated char** IN, and the returned value
  // points INTO that array (transfer none) — the marshaller must read it out
  // before freeing the IN container.
  const environ = callFunction('GLib', 'get_environ');
  assert.equal(callFunction('GLib', 'environ_getenv', [environ, 'PATH']), process.env.PATH);
  assert.equal(callFunction('GLib', 'environ_getenv', [environ, 'NODE_GI_NOPE_XYZ']), null);
});

test('GStrv IN (transfer full) + GStrv return: GLib.environ_setenv()', () => {
  // char** g_environ_setenv(char** envp /*(transfer full)*/, name, value, overwrite)
  // — the callee adopts the IN array (we must NOT free it) and returns a fresh one.
  const environ = callFunction('GLib', 'get_environ');
  const updated = callFunction('GLib', 'environ_setenv', [environ, 'NODE_GI_TEST', 'present', true]);
  assert.ok(Array.isArray(updated));
  assert.ok(updated.includes('NODE_GI_TEST=present'));
});

test('byte array IN with autofilled length + byte return with OUT length round-trip', () => {
  // g_base64_encode(const guchar* data /*(array length=1)*/, gsize len): the
  // length arg is SKIPPED from the JS args and AUTO-FILLED from the input's
  // element count. g_base64_decode(text, gsize* out_len) returns a byte array
  // sized by the OUT length arg → a Node Buffer.
  const bytes = Uint8Array.from([0, 1, 2, 250, 255, 42, 7]);
  const encoded = callFunction('GLib', 'base64_encode', [bytes, bytes.length]);
  assert.equal(typeof encoded, 'string');
  assert.equal(encoded, Buffer.from(bytes).toString('base64'));

  const decoded = callFunction('GLib', 'base64_decode', [encoded]);
  assert.ok(Buffer.isBuffer(decoded));
  assert.ok(Buffer.from(bytes).equals(decoded));
});

test('byte array IN also accepts a plain number[]: GLib.base64_encode()', () => {
  const decoded = callFunction('GLib', 'base64_decode', [
    callFunction('GLib', 'base64_encode', [[1, 2, 3], 3]),
  ]);
  assert.deepEqual([...decoded], [1, 2, 3]);
});

test('plain C utf8 array return (transfer full): GLib.uri_list_extract_uris()', () => {
  // gchar** g_uri_list_extract_uris(const char*): a zero-terminated, transfer-full
  // string array — elements + container are all caller-owned and freed after read.
  const uris = callFunction('GLib', 'uri_list_extract_uris', [
    'http://a.example\r\nhttp://b.example\r\n',
  ]);
  assert.deepEqual(uris, ['http://a.example', 'http://b.example']);
});

test('GHashTable<utf8,utf8> return → object: GLib.Uri.parse_params()', () => {
  // GHashTable* g_uri_parse_params(params, gssize length, separators, flags):
  // transfer-full hash with both names + values fully decoded → a plain object.
  const params = callStaticMethod('GLib', 'Uri', 'parse_params', ['a=1&b=two&c=3', -1, '&', 0]);
  assert.equal(typeof params, 'object');
  assert.equal(params.a, '1');
  assert.equal(params.b, 'two');
  assert.equal(params.c, '3');
});

test('GList<utf8> return → string[]: Gio.content_types_get_registered()', () => {
  requireNamespace('Gio', '2.0');
  // GList* g_content_types_get_registered(void) (transfer full): a list of MIME
  // type strings → a JS array; the node chain is freed after the read. The list
  // is empty on a minimal host with no shared-mime-info database (e.g. the CI
  // container), which exercises the NULL/empty-GList → empty-array path; on a
  // populated host it exercises element marshalling. Either way it must be a
  // string array, never throw or mis-handle the GList pointer.
  const types = callFunction('Gio', 'content_types_get_registered');
  assert.ok(Array.isArray(types));
  assert.ok(types.every((t) => typeof t === 'string'));
});

test('INOUT byte-array container is handled, not deferred: GLib.base64_decode_inplace()', () => {
  // The `text` arg is an INOUT byte array (decoded in place). INOUT containers now
  // marshal (round-tripped byte-for-byte vs gjs in the gimarshalling port +
  // marshalling-close.test.mjs), so this no longer throws the old "not yet supported"
  // deferral. base64_decode_inplace ITSELF is a known-quirky in-place case: its
  // return-array aliases the freed in-place `text` buffer, so the decoded bytes are
  // implementation-defined AND NON-DETERMINISTIC on GJS too (verified: gjs returns a
  // different garbage byte each run) — hence only the absence of the deferral throw is
  // asserted here, never specific bytes. Well-defined INOUT arrays/lists/hashes are
  // covered exhaustively (with exact values) by the tier-B gimarshalling port.
  requireNamespace('GLib', '2.0');
  assert.doesNotThrow(
    () => callFunction('GLib', 'base64_decode_inplace', [Uint8Array.from([97, 71, 107, 61])]),
  );
});

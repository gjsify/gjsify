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
//
// INOUT containers are NOT covered here. They are covered exhaustively, with
// exact values, by the tier-B gimarshalling port (`GIMarshallingTests
// .array_inout`, `.array_inout_etc`, `.method_array_inout`). This file used to
// call `g_base64_decode_inplace` for that and could not: see the deleted case's
// replacement note below.
//
// WHERE that port runs, stated exactly because the first version of this note
// said "every leg" and node-gi.yml says otherwise: `build-test` (Fedora 44 x64)
// and `arm64`. Not macOS, not Windows — those legs need the
// `GIMarshallingTests` typelib, which only the Fedora image carries. Adequate
// for what is claimed here, because the generic INOUT container path is
// architecture- and OS-independent marshalling code and the two legs differ in
// pointer-size-relevant ways; NOT adequate as a general statement about node-gi
// coverage.
import test from 'node:test';
import assert from 'node:assert/strict';

import { callFunction, callStaticMethod, requireNamespace } from '../index.js';
import { requireGi } from '../gi.js';

test('GStrv return → string[]: GLib.get_environ()', () => {
    requireNamespace('GLib', '2.0');
    // char** (NULL-terminated, transfer full) of "NAME=VALUE" entries.
    const environ = callFunction('GLib', 'get_environ');
    assert.ok(Array.isArray(environ));
    assert.ok(environ.length > 0);
    assert.ok(environ.every((e) => typeof e === 'string'));
    // Windows names the search path `Path=`, POSIX `PATH=` — match case-insensitively
    // (node-gi returns the real OS environ verbatim; only the var name's case differs).
    assert.ok(environ.some((e) => /^path=/i.test(e)));
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
    const decoded = callFunction('GLib', 'base64_decode', [callFunction('GLib', 'base64_encode', [[1, 2, 3], 3])]);
    assert.deepEqual([...decoded], [1, 2, 3]);
});

test('plain C utf8 array return (transfer full): GLib.uri_list_extract_uris()', () => {
    // gchar** g_uri_list_extract_uris(const char*): a zero-terminated, transfer-full
    // string array — elements + container are all caller-owned and freed after read.
    const uris = callFunction('GLib', 'uri_list_extract_uris', ['http://a.example\r\nhttp://b.example\r\n']);
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

// DELETED: `INOUT byte-array container is handled: GLib.base64_decode_inplace()`.
//
// DO NOT ADD IT BACK. The call corrupts the marshaller's own stack frame, and it
// is not a node-gi defect — `g_base64_decode_inplace`'s introspection annotation
// contradicts its C ABI, so no binding that honours the annotation can call it:
//
//   glib/gbase64.h:57   guchar *g_base64_decode_inplace (gchar *text, gsize *out_len);
//   GLib-2.0.gir        <parameter name="text" direction="inout"
//                        transfer-ownership="full">
//                         <array length="1" zero-terminated="0" c:type="gchar*"/>
//
// One star. A real INOUT array is `gchar**` (the callee reads the in-container
// and reassigns the out-container), and `calls.cc` implements exactly that: it
// hands the callee `&slots[i]`. So `g_base64_decode_inplace` decodes base64
// straight over the GIArgument union, and the read-back then marshals — and
// frees — a pointer whose low bytes are decoded payload.
//
// Measured here (Fedora 44, Node 24.15, five consecutive runs): the call returns
// 96, 208, 112, 240, 80 — a different value every run, because what comes back is
// the clobbered pointer, not data. The old case asserted only `doesNotThrow`, so
// it passed while doing that, and reported an abort (`free(): invalid pointer`)
// or a silent process death only when the allocator happened to notice — which
// is why #925 looked like a platform flake.
//
// The typelib CANNOT tell the two shapes apart: `c:type` lives in the GIR XML
// and is not compiled into the typelib. Compared field by field against a
// genuine `gchar***` INOUT (`GLib.OptionContext.parse`'s `argv`), the two are
// identical — direction INOUT, transfer EVERYTHING, tag ARRAY, is_pointer true,
// caller-allocates false. So there is nothing for node-gi to detect, and a
// per-function denylist would be a workaround that ossifies. It is an upstream
// GLib annotation bug; `status/upstream-patch-candidates.md` carries it.
//
// INOUT container coverage lives where it can assert exact values: the tier-B
// gimarshalling port, run on every node-gi CI leg.

test('null marshals as a NULL array argument (GJS parity)', () => {
    // gjs 1.88: GLib.environ_getenv(null, 'PATH') === null — a null JS value
    // where a (nullable) array argument is expected marshals as a NULL array
    // (refs/gjs/gi/arg.cpp gjs_array_to_explicit_array). The exposing call was
    // `Gst.init(null)`, the nullable inout argv every GStreamer consumer passes
    // null for (`@gjsify/webaudio`'s ensureGstInit on the jelly-jumper-on-node
    // path) — node-gi used to throw "expected an array for the array argument".
    requireNamespace('GLib', '2.0');
    assert.equal(callFunction('GLib', 'environ_getenv', [null, 'PATH']), null);
});

// An ARRAY OF GOBJECTS as an IN argument — the direction every case above covers
// for strings and bytes and none of them covered for objects.
//
// It did not work, and the gap was invisible because the single-object path is a
// different line of code: `unwrapArg` unwrapped a top-level node-gi instance to its
// handle and returned an Array untouched, so the elements arrived at
// `NodeGiToGIArgument`'s GI_TYPE_TAG_INTERFACE branch as JS wrappers and it threw
// `expected a GObject handle as a container element`. Every GI method taking an
// array of objects was affected; it surfaced through
// `@gjsify/gtk-host/list`'s `Gio.ListStore.splice`, whose whole design rests on
// replacing the model in ONE call.
//
// `Gio.ListStore` is the right subject headlessly: it is a real GI method with a
// `GObject**` IN parameter and it needs no display.
test('array of GObjects IN: Gio.ListStore.splice replaces the model in one call', () => {
    const Gio = requireGi('Gio', '2.0');
    const store = Gio.ListStore.new(Gio.SimpleAction.$gtype);

    // The CONTROL, and it is the reason the bug survived: one GObject as a
    // top-level argument was always unwrapped, so `append` worked throughout.
    store.append(new Gio.SimpleAction({ name: 'first' }));
    assert.equal(store.get_n_items(), 1);

    const replacements = [new Gio.SimpleAction({ name: 'a' }), new Gio.SimpleAction({ name: 'b' })];
    store.splice(0, store.get_n_items(), replacements);
    assert.equal(store.get_n_items(), 2);

    // The objects that came back are the ones handed in — an array that marshalled
    // to the wrong pointers would still give a count of 2.
    assert.equal(store.get_item(0).name, 'a');
    assert.equal(store.get_item(1).name, 'b');

    // An EMPTY array is the boundary the splice path also takes (clearing a model),
    // and it must not be read as "no argument".
    store.splice(0, store.get_n_items(), []);
    assert.equal(store.get_n_items(), 0);
});

test('an IN array of POINTER struct elements marshals', () => {
    // `IsSupportedElementType` deferred every non-object INTERFACE element under one
    // label, so an array of struct POINTERS was refused with the same message as an
    // array of by-value records — though the two are nothing alike in cost. Measured
    // against the installed typelib: `GLib.Variant.new_tuple`'s `children` element is
    // `tag=interface ptr=1 kind=STRUCT`, one pointer slot, the shape an object element
    // already had.
    //
    // The BY-VALUE kind is a different write path with a different width and its own
    // ownership rule, and it lives in `byvalue-elements.test.mjs`. What stays here is
    // the pointer half, because the two must not be admitted by the same widening: one
    // predicate answering yes to both would lay 24-byte GValues out at an 8-byte
    // stride, which is why `is_pointer` is tested rather than the kind.
    const GLib = requireGi('GLib', '2.0');

    const tuple = GLib.Variant.new_tuple([GLib.Variant.new_int32(42), GLib.Variant.new_string('x')]);
    assert.equal(tuple.get_type_string(), '(is)');
    assert.equal(tuple.n_children(), 2);

    // The VALUES, not just the count: an array that marshalled to the wrong pointers
    // would still report two children.
    assert.equal(tuple.get_child_value(0).get_int32(), 42);
    assert.equal(tuple.get_child_value(1).get_string()[0], 'x');

    // The empty array is the boundary the refusal path also took, and it must not be
    // read as "no argument".
    assert.equal(GLib.Variant.new_tuple([]).get_type_string(), '()');

    // CONTROL — an element that is no handle at all is still named, so admitting the
    // pointer kind did not turn the refusal into a silent nullptr. It also separates
    // the two paths: this message comes from the GIArgument route, and a by-value
    // record refused for the same reason answers with a different one
    // (`byvalue-elements.test.mjs` pins that), so a future change that routed pointer
    // elements through the record writer would show up here rather than pass quietly.
    assert.throws(
        () => GLib.Variant.new_tuple([{ not: 'a variant' }]),
        /expected a GObject or boxed handle as a container element/,
    );
});

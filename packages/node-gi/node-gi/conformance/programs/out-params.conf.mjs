// SPDX-License-Identifier: MIT
// OUT/INOUT parameters — the GJS return-tuple convention:
//   [return value if non-void] ++ [each OUT/INOUT, in order]
// surfaced as a bare value (one), an Array (several), with array-length OUT
// params consumed (shell_parse_argv's argc never appears in the tuple).
//
// Includes GLib.uri_split — GJS 1.88 KEEPS the `(skip)`-annotated gboolean return
// as the LEADING tuple element (8 elements, `[true, …]`): the `(skip)` annotation
// is IGNORED for the JS return. node-gi now matches (calls.cc return-tuple
// assembly); earlier it honoured the annotation and omitted the boolean (7).
import GLib from 'gi://GLib?version=2.0';

// gboolean return + OUT strv (argc length param consumed) → [ok, argv].
const parsed = GLib.shell_parse_argv('prog --flag arg1');
print('shell_parse_argv isArray:', Array.isArray(parsed));
print('shell_parse_argv length:', parsed.length);
print('ok:', parsed[0]);
print('argv:', JSON.stringify(parsed[1]));

// gboolean return + guint64 OUT (GError handled by the invoker) → [ok, value].
print('to_unsigned:', JSON.stringify(GLib.ascii_string_to_unsigned('42', 10, 0, 100)));
print('to_signed:', JSON.stringify(GLib.ascii_string_to_signed('-7', 10, -100, 100)));

// void return + three int OUTs on a boxed instance → [y, m, d].
// 1136214245 = 2006-01-02 UTC — timezone-independent via new_from_unix_utc.
const dt = GLib.DateTime.new_from_unix_utc(1136214245);
print('get_ymd:', JSON.stringify(dt.get_ymd()));

// gboolean return + OUT zero-terminated string array → [is_utf8, charsets].
// Content is locale-flavored even under LC_ALL=C across distros — assert the
// SHAPE only, which is what the tuple convention defines.
const charsets = GLib.get_filename_charsets();
print('filename_charsets shape:', Array.isArray(charsets), charsets.length);
print('filename_charsets types:', typeof charsets[0], Array.isArray(charsets[1]));

// (skip)-annotated gboolean return + 7 OUT scheme/userinfo/host/port/path/query/
// fragment. The boolean still LEADS the tuple (8 elements) — GJS ignores the skip
// annotation for the JS return. The input is fixed, so the full tuple is printed.
print('uri_split:', JSON.stringify(GLib.uri_split('http://user@host:80/p?q=1#frag', 0)));

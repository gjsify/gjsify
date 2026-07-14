// SPDX-License-Identifier: MIT
// Container IN + compound array OUT via headless GLib (no test typelib needed).
// Exercises the phase-2.2 marshalling: a JS array rebuilt as a C array / GStrv IN,
// a byte array IN with an autofilled length, a byte array OUT sized by an OUT
// length arg, and a C string array OUT alongside a gboolean return — each surfaced
// exactly as GJS does. The golden is the gjs output; node/bun/deno must match it
// byte-for-byte.
import GLib from 'gi://GLib?version=2.0';

// GStrv IN (transfer none) + string return: the JS string[] becomes a
// NULL-terminated char** the callee borrows; the returned value points into it.
const envp = ['A=1', 'B=two', 'C=3'];
print('getenv B:', GLib.environ_getenv(envp, 'B'));
print('getenv missing:', GLib.environ_getenv(envp, 'NOPE'));

// GStrv IN (transfer full) + GStrv return: the callee adopts the array we built
// and hands back a fresh one — surfaced as a string[].
const updated = GLib.environ_setenv(envp, 'D', '4', true);
print('setenv has D:', updated.includes('D=4'));
print('setenv len:', updated.length);

// GStrv IN + string return (strjoinv joins a NULL-terminated char**).
print('joined:', GLib.strjoinv('/', ['usr', 'local', 'bin']));

// C byte array IN with an AUTOFILLED length arg: base64_encode(data, len) has len
// annotated as data's length, so it is consumed from the array — the idiomatic
// single-arg call (GJS auto-fills it too). The input is a plain JS number[].
print('b64 array:', GLib.base64_encode([104, 105, 33]));
// …and from a typed array (Uint8Array → raw bytes).
print('b64 typed:', GLib.base64_encode(Uint8Array.from([1, 2, 3, 4])));

// C byte array OUT sized by an OUT length arg → a Node Buffer / GJS Uint8Array;
// spread to a plain number[] so the printed form is identical across runtimes.
const decoded = GLib.base64_decode('aGkh');
print('b64 decoded:', JSON.stringify([...decoded]));

// gboolean return + C string array (GStrv) OUT + the argc length arg consumed:
// [ok, argv]. shell_parse_argv is deterministic for a fixed command line.
const [ok, argv] = GLib.shell_parse_argv('prog --flag value');
print('parse ok:', ok);
print('parse argv:', JSON.stringify(argv));

// zero-terminated, transfer-full C string array return.
const uris = GLib.uri_list_extract_uris('http://a.example\r\nhttp://b.example\r\n');
print('uris:', JSON.stringify(uris));

// SPDX-License-Identifier: MIT
// `Function.length` of materialized prototype methods — gjs computes it as
// m_js_in_argc (refs/gjs/gi/function.cpp Function::init): IN/INOUT args minus
// the slots no JS argument fills (array lengths, callback user_data + destroy-
// notify). node-gi's thunks were `function (...args)` and reported 0 for every
// method, which @gjsify/gtk-host's descriptor conformance read as "add_titled()
// takes 0 argument(s)" against the installed GTK. The engine now derives the
// length from the SAME skip pre-scan its invoke loop consumes JS args with
// (calls.cc JsInArgCount), so this program pins report and consumption together.
//
// One shape per skip rule, headless Gio only:
//   cancel            — zero in-args (0 is a real answer, absence is not 0)
//   read_bytes        — plain in-args + an OUT return tuple (out args not counted)
//   read_bytes_async  — a callback arg counts, its user_data slot does not
//   write_all         — an array arg counts, its length arg does not, OUT neither
//
// Deliberately NOT pinned: `read` (a variable-length caller-allocates OUT array)
// and `add_data` (a GDestroyNotify with no closure index) — their CALLING
// CONVENTION diverges from gjs today, so their reported length diverges with it;
// see status/open-todos.md.
import Gio from 'gi://Gio?version=2.0';

print('cancel: ' + Gio.Cancellable.prototype.cancel.length);
print('read_bytes: ' + Gio.InputStream.prototype.read_bytes.length);
print('read_bytes_async: ' + Gio.InputStream.prototype.read_bytes_async.length);
print('write_all: ' + Gio.OutputStream.prototype.write_all.length);

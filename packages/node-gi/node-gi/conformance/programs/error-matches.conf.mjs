// SPDX-License-Identifier: MIT
// GError semantics — a failed sync GI call throws a GLib.Error whose
// instanceof / .matches() / .code surface follows GJS. Booleans only: the
// error MESSAGE is locale/libc-flavored (the runner sets LC_ALL=C anyway)
// and enum VALUES are ABI facts, so those two are the only printed scalars.
import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';

let caught = null;
try {
    Gio.File.new_for_path('/nonexistent-node-gi-conf').load_contents(null);
} catch (e) {
    caught = e;
}

print('threw:', caught !== null);
print('instanceof GLib.Error:', caught instanceof GLib.Error);
print('matches(IOErrorEnum, NOT_FOUND):', caught.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND));
print('matches(IOErrorEnum, EXISTS):', caught.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS));
print('matches(FileError, NOENT):', caught.matches(GLib.FileError, GLib.FileError.NOENT));
print('code === NOT_FOUND:', caught.code === Gio.IOErrorEnum.NOT_FOUND);
print('NOT_FOUND value:', Gio.IOErrorEnum.NOT_FOUND);

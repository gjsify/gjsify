// `Gtk.FileDialog`, `Gtk.FileFilter` and `Gio.File` as one import on every target (ADR 0100).
//
// THE PACKAGE FORKS ON ONE RELATIVE IMPORT, not on an `exports` condition. A `--app gjs` build
// resolves `exports` with `['browser']` and a `--app browser` build with `['import', 'browser']`, so
// no condition tells those two apart. gjsify's platform chains do: `./platform.js` becomes
// `platform.gtk.js` on GJS, `platform.web.js` on the browser and `platform.native.js` on
// NativeScript. The types are the base's, the subset every target honours.

export {
    FileDialog,
    FileFilter,
    File,
    ListStore,
    OutputStream,
    FileOutputStream,
    FileCreateFlags,
    IOErrorEnum,
    DialogError,
    Bytes,
    GLibError,
    promisify,
    registerFileChooserDriver,
} from './platform.js';
export type { FileChooserDriver, FileChooserHandle, FileChooserRequest, FileChooserWriter } from '@gjsify/adwaita-core';

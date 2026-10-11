// The GIO half of `@gjsify/adwaita-web`'s vocabulary — `Gio.Menu`, `Gio.MenuItem`.
// `export * as Gio from './namespace/gio.js'` in `src/index.ts` makes it the namespace,
// the same module shape `./adw.ts` and `./gtk.ts` take and for the same reason (one list
// carrying the value AND the type meaning — see the header of `./adw.ts`).
//
// RE-EXPORTED, NOT DEFINED. This package used to carry its own copy of the classes and
// said so; they hold no DOM, so they now live in `@gjsify/adwaita-core` beside the
// portable model they build. This barrel is the port's DOOR onto them, and
// `gio-menu.spec.ts` drives the whole suite through it.
//
// WHY THIS BARREL IS SHORT, AND WILL STAY SHORT. The other two hold ELEMENTS, and
// `check-vocabulary-alignment.mjs` derives their members from the elements this package
// defines. GIO defines none: what lands here is the handful of GObject types an Adwaita
// author CONSTRUCTS while building a tree — today the menu a `menuModel` property takes.
// `Gio.Settings` and the rest of the library are NOT this package's business; a namespace
// that grows past what the elements consume is a second, unheld vocabulary.
//
// THE ONE EXCEPTION IS ADR 0100: the `Gio.File` a `Gtk.FileDialog` hands back, with the
// `ListStore` its `filters` take, the streams `replace_async` opens, `FileCreateFlags`,
// `IOErrorEnum` and `_promisify`. The subset lives in `@gjsify/adwaita-core`
// (`file-chooser.ts`), which refuses everything past it by name; `../file-chooser-host.ts`
// is the browser's driver behind it.

import '../file-chooser-host.js';

export { GioMenu as Menu, GioMenuItem as MenuItem } from '@gjsify/adwaita-core';
export {
    GioFile as File,
    GioListStore as ListStore,
    GioOutputStream as OutputStream,
    GioFileOutputStream as FileOutputStream,
    FileCreateFlags,
    IOErrorEnum,
    promisify as _promisify,
} from '@gjsify/adwaita-core';
export { SimpleAction, SimpleActionGroup, ApplicationFlags } from '@gjsify/adwaita-core';
export { GioApplication as Application } from '../application.js';

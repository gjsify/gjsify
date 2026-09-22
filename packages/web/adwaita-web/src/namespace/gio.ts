// The GIO half of `@gjsify/adwaita-web`'s vocabulary — `Gio.Menu`, `Gio.MenuItem`.
// `export * as Gio from './namespace/gio.js'` in `src/index.ts` makes it the namespace,
// the same module shape `./adw.ts` and `./gtk.ts` take and for the same reason (one list
// carrying the value AND the type meaning — see the header of `./adw.ts`).
//
// WHY THIS BARREL IS SHORT, AND WILL STAY SHORT. The other two hold ELEMENTS, and
// `check-vocabulary-alignment.mjs` derives their members from the elements this package
// defines. GIO defines none: what lands here is the handful of GObject types an Adwaita
// author CONSTRUCTS while building a tree — today the menu a `menuModel` property takes.
// `Gio.File`, `Gio.Settings`, `Gio.SimpleAction` and the rest of the library are NOT this
// package's business; a namespace that grows past what the elements consume is a second,
// unheld vocabulary.

export { Menu, MenuItem } from '../gio/menu.js';

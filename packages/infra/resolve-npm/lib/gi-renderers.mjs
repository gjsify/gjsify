// WHICH PACKAGE ANSWERS `gi://Ns` ON A TARGET WITH NO GOBJECT INTROSPECTION — ADR 0034 stage 9.
//
// `gi://Gtk?version=4.0` is not a GJS-only specifier in this repository; it is the runtime
// axis, and every target already resolves it: `--app gjs` takes the native protocol,
// `--app node` a lazy `requireGi` proxy (`plugins/gjs-gi-node.ts`), and `--app browser` /
// `--app nativescript` an EMPTY module. The empty one is the row this table changes: a
// namespace substituted by `{}` makes `Adw.ActionRow` `undefined`, and
// `class X extends undefined` is `Class extends value undefined`, thrown far from the
// import that caused it.
//
// WHAT A RENDERER SUPPLIES. ADR 0034 clause 2 makes every widget surface export its widgets
// through `Adw` / `Gtk` namespace OBJECTS, which is exactly the shape `gi://` evaluates to
// on GJS — so the substitution is a re-export and not a translation layer.
//
// THE VERSIONS ARE A GIR FACT, NOT A RENDERER CHOICE. `Adw-1` and `Gtk-4.0` are the
// namespace versions `@gjsify/gtk-host`'s generated widget table was built against; that
// file stamps them in `GENERATED_PROVENANCE`, and `tests/e2e/gi-renderer-arms` holds this
// table against that stamp. Two derivations, one written by a generator that never reads
// this file.
//
// WHY A CURATED TABLE AND NOT A SCAN of `gjsify.widgetVocabulary`. The manifest declaration
// says which SIDE of the vocabulary comparison a package is on (`reference` / `renderer`),
// and there is more than one renderer per repo: `@gjsify/adwaita-react-native` declares
// itself one too, and it is not this table's answer for any `--app` because Metro owns a
// React Native build (root AGENTS.md § Runtime & platform model). Deriving the row from the
// declaration would have to invent that exclusion anyway.

/**
 * `--app <target>` → the package whose `Adw` / `Gtk` namespace exports answer `gi://`, and
 * the GIR namespace versions that arm accepts. `specifiers` names a module whose exports ARE a
 * namespace, for one that is not a member of the renderer's root barrel: `@gjsify/adwaita-nativescript`
 * keeps `GObject` in its `/gobject` subpath (ADR 0096), the web renderer exports it from the
 * root, and `@gjsify/gtksource-nativescript` is a package of its own that depends on the renderer
 * (ADR 0094), so its `GtkSource` namespace can only be named by specifier. A namespace with no entry
 * is read from `renderer`. The browser row has no `GtkSource`: nothing there implements it.
 *
 * @type {Readonly<Record<string, { renderer: string, namespaces: Readonly<Record<string, string>>, specifiers?: Readonly<Record<string, string>> }>>}
 */
export const GI_RENDERERS = {
    browser: {
        renderer: '@gjsify/adwaita-web',
        namespaces: { Adw: '1', Gtk: '4.0', GObject: '2.0', Gio: '2.0', GLib: '2.0' },
    },
    nativescript: {
        renderer: '@gjsify/adwaita-nativescript',
        namespaces: { Adw: '1', Gtk: '4.0', GObject: '2.0', Gio: '2.0', GLib: '2.0', GtkSource: '5' },
        specifiers: {
            GObject: '@gjsify/adwaita-nativescript/gobject',
            GtkSource: '@gjsify/gtksource-nativescript/gtksource',
        },
    },
};

/** The `--app` values that have an arm, for a flag that must name them when refused. */
export const GI_RENDERER_APPS = Object.freeze(Object.keys(GI_RENDERERS));

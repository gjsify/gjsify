// The ledger of namespace members that are VALUES, and the reader both halves of the
// oracle over it share.
//
// WHY THIS EXISTS. ADR 0034 § Amendment 19 let a clause-2 namespace carry a non-widget
// GObject an author CONSTRUCTS — `new Gio.Menu()` — beside the widgets it carries. That
// needs a second list: which members are values, and which GIR type each one is. The
// first version of the list sat in `check-vocabulary-alignment.mjs` and held itself
// against `node_modules/@girs/<pkg>/<pkg>.d.ts`.
//
// IT COULD NOT WORK THERE, AND THE JOB SAID SO IN ITS OWN COMMENT. That gate is a step of
// `.github/workflows/audit-runtimes.yml`, a job that deliberately performs NO install —
// its scripts are pure Node with zero deps, which is what makes it cheap and what nothing
// was going to give up for one lookup. So `@girs` was absent, the lookup answered "not
// installed", and the gate exited 1 on every push of the PR that added it. Measured,
// 2026-09-22.
//
// The repository already stated the answer, in the header of `generated/methods.mts`:
// `check-vocabulary-alignment.mjs` reads that file "with no install to hold a port's
// method names against the GIR, which is the job a committed artifact exists to do".
// This is the same arrangement a third time, after the enum values and the methods:
// `scripts/generate-value-types.mjs` runs under GJS, where the typelib is, and writes
// `generated/value-types.mts`; the gate reads the committed file under plain Node;
// gtk-host's `generated.spec.ts` holds every row against whatever GJS is running.
//
// WHY THE LEDGER LIVES HERE AND NOT IN `adwaita-elements.mjs`, which is the vocabulary
// module and where a reader looks for it first: that module imports `node:fs`, and the
// generator that consumes the ledger runs under `gjs -m`, which answers a bare
// `import 'node:fs'` with `ImportError: Unsupported URI scheme for importing: node` —
// measured. So this module imports nothing but its sibling reader, the GJS half brings
// GLib file reads and the Node half brings `node:fs`, and `adwaita-elements.mjs`
// re-exports the ledger so both Node consumers still read the vocabulary from the
// vocabulary module.

import { readBlock, readStringRecord, residue } from './enum-values.mjs';

/** Where the GIR's answer about each ledger entry is committed — this oracle. */
export const VALUE_TYPES_FILE = 'packages/framework/gtk-host/src/generated/value-types.mts';

/**
 * Namespace members that are NOT widgets, with the GIR type each one is.
 *
 * THE THIRD CASE the vocabulary gate could not express. Its rule — a member with no
 * widget is a member that "outlives the widget it named" — was written when a namespace
 * carried widgets and nothing else, and it is still right for that. `Gio.Menu` is neither
 * a widget nor a stale entry: it is a value an author CONSTRUCTS, and the reason it
 * exists on a port at all is that the reference surface is GJS, where
 * `new Gio.Menu(); menu.append(…)` is simply how a menu is written. ADR 0034 § Amendment
 * 19 is that decision; this table is what keeps it from becoming a hole.
 *
 * Each entry is held against the INSTALLED typelib by `scripts/generate-value-types.mjs`,
 * so a member cannot be excused by naming a type that does not exist, and a member GTK
 * really does ship as a WIDGET cannot hide here — that is the stale-entry direction, and
 * it is the one the whole rule was written for.
 *
 * `member` is the port's spelling, `gir` the type name the namespace declares. They are
 * the same word today and are two fields because only the first is the ports' to choose.
 */
export const CONSTRUCTIBLE_VALUES = [
    {
        member: 'Gio.Menu',
        gir: 'Menu',
        why: "GJS writes `new Gio.Menu(); menu.append('Save as…', 'app.save-as')`, and ADR 0042 already made the VALUE behind it portable. The ports carry the constructor so the two dialects are one text rather than two — the gallery's `Adw.SplitButton` pair went 9 lines to 2 on it.",
    },
    {
        member: 'Gio.MenuItem',
        gir: 'MenuItem',
        why: "`Gio.Menu`'s item half — `set_label` / `set_detailed_action` — for the same reason, and unreachable without it the moment a pane writes anything past a bare `append`.",
    },
    {
        member: 'Gio.SimpleAction',
        gir: 'SimpleAction',
        why: "GJS writes `new Gio.SimpleAction({ name: 'copy' })` and connects `activate`; a Blueprint button's `action-name` resolves to it. The NativeScript port carries a minimal registry (`widgets/actions.ts`) so a shared widget class registers its actions the same way on both sides.",
    },
    {
        member: 'Gio.Application',
        gir: 'Application',
        why: 'GJS writes `class extends Gio.Application` and `runAsync`; ADR 0098 carries the strict subset (startup, activate, actions, id) so the entry point of an application is a class both ports run.',
    },
    {
        member: 'Gtk.Application',
        gir: 'Application',
        why: '`Gio.Application` plus the windows (`add_window`, `active_window`) — the class every GNOME `Application` extends, ADR 0098 stage 1. A GObject, not a widget.',
    },
    {
        member: 'Adw.Application',
        gir: 'Application',
        why: '`Gtk.Application` under the libadwaita name an Adwaita app extends, ADR 0098 stage 1. A GObject, not a widget.',
    },
    {
        member: 'Adw.StyleManager',
        gir: 'StyleManager',
        why: "A widget that follows the system appearance writes `Adw.StyleManager.get_default()` and `connect('notify::dark', …)`. The ports carry the read-only subset (`get_default`, `dark`, `get_dark`, `notify::dark`) over the page's / the app's own scheme; forcing a scheme (`color_scheme`) is outside it. A GObject, not a widget.",
    },
    {
        member: 'Adw.Toast',
        gir: 'Toast',
        why: "GJS writes `overlay.add_toast(new Adw.Toast({ title, timeout, button_label }))` and `connect('button-clicked')`. The ports carry `title`, `timeout`, `priority`, `button-label`, `action-name`, `use-markup`, `dismiss()` and the `button-clicked` / `dismissed` signals; `custom-title` and `action-target` are outside it. A GObject, not a widget.",
    },
    {
        member: 'Adw.ToastPriority',
        gir: 'ToastPriority',
        enum: true,
        why: 'GJS writes `priority: Adw.ToastPriority.HIGH` to put a toast ahead of the shown one. An enum, not a widget.',
    },
    {
        member: 'Gio.ApplicationFlags',
        gir: 'ApplicationFlags',
        flags: true,
        why: 'GJS writes `super({ applicationId, flags: Gio.ApplicationFlags.DEFAULT_FLAGS })`; ADR 0098 accepts only the default and refuses any other flag by name. A flags type, not a widget.',
    },
    {
        member: 'Gtk.ApplicationInhibitFlags',
        gir: 'ApplicationInhibitFlags',
        flags: true,
        why: 'GJS writes `app.inhibit(window, Gtk.ApplicationInhibitFlags.LOGOUT, reason)` to guard leaving with unsaved changes; on the browser `LOGOUT` guards `beforeunload`, the other flags are accepted and do nothing. A flags type, not a widget.',
    },
    {
        member: 'Gio.SimpleActionGroup',
        gir: 'SimpleActionGroup',
        why: "`Gio.SimpleAction`'s container — what `insertActionGroup` (`gtk_widget_insert_action_group`) puts under a prefix such as `source-view`, unreachable without it.",
    },
    {
        member: 'Gio.Settings',
        gir: 'Settings',
        why: "GJS writes `new Gio.Settings({ schema_id, path })` and `get_boolean` / `set_int` / `connect('changed::key')`; ADR 0099 carries that subset on the browser (localStorage) and NativeScript (ApplicationSettings) and refuses the rest by name. A GObject, not a widget.",
    },
    {
        member: 'Gtk.Adjustment',
        gir: 'Adjustment',
        why: 'GJS writes `adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, value: 16, stepIncrement: 1 })`, and ADR 0047 already made the VALUE behind it portable — the class IS `AdwAdjustment` wearing the GIR spelling. It closed the `Adw.SpinRow` pane divergence down to the one property the port has no counterpart for.',
    },
    {
        member: 'Adw.ViewStackPage',
        gir: 'ViewStackPage',
        why: 'Blueprint writes a titled stack as `Adw.ViewStack { Adw.ViewStackPage { name: …; title: …; child: … } }`, and GtkBuilder constructs each record as the GObject it is — not a widget. The NativeScript builder needs a class to construct for the same node, so the record is a value the port carries (`view-stack-page.ts`), read by the stack when it adopts it. The web spells the same record as the `<adw-view-stack-page>` element.',
    },
    {
        member: 'Gtk.StackPage',
        gir: 'StackPage',
        why: 'Blueprint writes a stack as `Gtk.Stack { Gtk.StackPage { name: …; child: … } }`, and GtkBuilder constructs each record as the GObject it is — not a widget. The NativeScript builder needs a class to construct for the same node, so the record is a value the port carries (`stack-page.ts`), read by the stack when it adopts it, exactly as `Adw.ViewStackPage` is for `Adw.ViewStack`.',
    },
    {
        member: 'Gtk.StringList',
        gir: 'StringList',
        why: 'GJS writes `model: new Gtk.StringList({ strings: [...] })`, and ADR 0046 already made the VALUE behind it portable. An `Array` subclass like `Gio.Menu`, so the array spelling and this one are the same write — it closed the `Adw.ComboRow` pane divergence outright.',
    },
    {
        member: 'Adw.SidebarSection',
        gir: 'SidebarSection',
        why: 'A `.blp` writes `Adw.SidebarSection { … }` inside an `Adw.Sidebar`, and the NativeScript shared-tree builder has to build it: the sidebar model is sections of items, and `AdwSidebarSectionSpec` already made that VALUE portable. The class IS the spec wearing the GIR spelling, so `sections` takes it unchanged.',
    },
    {
        member: 'Adw.SidebarItem',
        gir: 'SidebarItem',
        why: "`Adw.SidebarSection`'s item half, for the same reason: a section is empty without it, and `AdwSidebarItemSpec` is the portable value it IS.",
    },
    {
        member: 'Adw.TabPage',
        gir: 'TabPage',
        why: 'A `.blp` writes `Adw.TabPage { title: "…"; child: … }` inside an `Adw.TabView`, and the NativeScript shared-tree builder has to build it: the page is a GObject around its child, which the view reads into its model as a titled page.',
    },
    {
        member: 'Gtk.CssProvider',
        gir: 'CssProvider',
        why: 'GJS writes `new Gtk.CssProvider(); provider.load_from_string(css)` and hands it to `Gtk.StyleContext.add_provider_for_display`; the ports carry that loader and refuse the file loaders by name. A GObject, not a widget.',
    },
    {
        member: 'Gtk.StyleContext',
        gir: 'StyleContext',
        why: '`Gtk.StyleContext.add_provider_for_display` / `remove_provider_for_display` is how an application puts its own CSS on the display; the ports carry those two statics. A GObject, not a widget.',
    },
    {
        member: 'Gtk.Settings',
        gir: 'Settings',
        why: '`Gtk.Settings.get_default()?.gtk_font_name` is how an application reads the system UI font; the ports carry that one property. A GObject, not a widget.',
    },
    {
        member: 'Gtk.IconTheme',
        gir: 'IconTheme',
        why: "`Gtk.IconTheme.get_for_display(display).add_resource_path(path)` registers an application's icons; on the web the path is scanned as gtkicontheme.c does (ADR 0116 § 4); NativeScript still only remembers it. A GObject, not a widget.",
    },
    {
        member: 'Gtk.EventControllerKey',
        gir: 'EventControllerKey',
        why: "GJS writes `new Gtk.EventControllerKey()`, `widget.add_controller(c)` and `c.connect('key-pressed', …)`; the ports carry `key-pressed` / `key-released` with GTK's return-value rule. A GObject, not a widget.",
    },
    {
        member: 'Gtk.show_uri',
        gir: 'show_uri',
        kind: 'function',
        why: "`Gtk.show_uri(parent, uri, Gdk.CURRENT_TIME)` opens a link in the user's handler; the ports hand it to the platform (window.open, an Android intent). A function, not a widget.",
    },
    {
        member: 'Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION',
        gir: 'STYLE_PROVIDER_PRIORITY_APPLICATION',
        kind: 'constant',
        why: "The priority `Gtk.StyleContext.add_provider_for_display` orders providers by; GTK's number, so the order matches. A constant, not a widget.",
    },
    {
        member: 'Gtk.STYLE_PROVIDER_PRIORITY_FALLBACK',
        gir: 'STYLE_PROVIDER_PRIORITY_FALLBACK',
        kind: 'constant',
        why: "The priority `Gtk.StyleContext.add_provider_for_display` orders providers by; GTK's number, so the order matches. A constant, not a widget.",
    },
    {
        member: 'Gtk.STYLE_PROVIDER_PRIORITY_SETTINGS',
        gir: 'STYLE_PROVIDER_PRIORITY_SETTINGS',
        kind: 'constant',
        why: "The priority `Gtk.StyleContext.add_provider_for_display` orders providers by; GTK's number, so the order matches. A constant, not a widget.",
    },
    {
        member: 'Gtk.STYLE_PROVIDER_PRIORITY_THEME',
        gir: 'STYLE_PROVIDER_PRIORITY_THEME',
        kind: 'constant',
        why: "The priority `Gtk.StyleContext.add_provider_for_display` orders providers by; GTK's number, so the order matches. A constant, not a widget.",
    },
    {
        member: 'Gtk.STYLE_PROVIDER_PRIORITY_USER',
        gir: 'STYLE_PROVIDER_PRIORITY_USER',
        kind: 'constant',
        why: "The priority `Gtk.StyleContext.add_provider_for_display` orders providers by; GTK's number, so the order matches. A constant, not a widget.",
    },
    {
        member: 'Gtk.FileDialog',
        gir: 'FileDialog',
        why: 'GJS writes `new Gtk.FileDialog({ title, filters }).open(window, null, cb)`; ADR 0100 carries the modal open/save subset over a per-renderer driver and refuses the rest by name. A GObject, not a widget — the portal draws the dialog.',
    },
    {
        member: 'Gtk.FileFilter',
        gir: 'FileFilter',
        why: "`Gtk.FileDialog`'s `filters` hold these: `new Gtk.FileFilter({ name })` with `add_suffix` / `add_mime_type` (ADR 0100). A GObject the dialog reads, not a widget.",
    },
    {
        member: 'Gtk.DialogError',
        gir: 'DialogError',
        enum: true,
        why: 'An app tells a dismissed dialog from a failed one with `error.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)` (ADR 0100). An error-domain enum, not a widget.',
    },
    {
        member: 'Gio.File',
        gir: 'File',
        interface: true,
        why: 'What `Gtk.FileDialog` hands back: `get_basename`, `load_contents_async`, `replace_async` (ADR 0100 subset over the driver handle). A GInterface, not a widget.',
    },
    {
        member: 'Gio.ListStore',
        gir: 'ListStore',
        why: 'GJS writes `filters: new Gio.ListStore({ itemType: Gtk.FileFilter })` for `Gtk.FileDialog` (ADR 0100). A GObject list model, not a widget.',
    },
    {
        member: 'Gio.OutputStream',
        gir: 'OutputStream',
        why: '`replace_async` resolves to a stream an app writes with `write_bytes_async` and closes with `close_async` (ADR 0100). A GObject, not a widget.',
    },
    {
        member: 'Gio.FileOutputStream',
        gir: 'FileOutputStream',
        why: 'The concrete type `Gio.File.replace_async` returns, the `Gio.OutputStream` subclass an app passes to `_promisify` (ADR 0100). A GObject, not a widget.',
    },
    {
        member: 'Gio.FileCreateFlags',
        gir: 'FileCreateFlags',
        flags: true,
        why: 'GJS writes `file.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, …)`; ADR 0100 accepts NONE and REPLACE_DESTINATION and refuses the rest by name. A flags type, not a widget.',
    },
    {
        member: 'Gio.IOErrorEnum',
        gir: 'IOErrorEnum',
        enum: true,
        why: 'The domain a refused or failed `Gio.File` call rejects with — `NOT_SUPPORTED`, `CANCELLED`, `CLOSED` (ADR 0100). An error-domain enum, not a widget.',
    },
    {
        member: 'Gio.Resource',
        gir: 'Resource',
        struct: true,
        why: 'An app embeds its compiled `.gresource` and writes `Gio.Resource.new_from_data(bytes)._register()`, as a GJS app does with `Gio.Resource.load(path)._register()`; the ports read the real GVDB bytes (ADR 0116 § 3). A boxed struct, not a widget.',
    },
    {
        member: 'Gio.ResourceLookupFlags',
        gir: 'ResourceLookupFlags',
        flags: true,
        why: 'Every `Gio.resources_*` call takes `Gio.ResourceLookupFlags.NONE`, the only flag GIO defines (ADR 0116 § 3). A flags type, not a widget.',
    },
    {
        member: 'Gio.ResourceError',
        gir: 'ResourceError',
        enum: true,
        why: 'The domain a missing resource path fails with — `NOT_FOUND`, `INTERNAL` (ADR 0116 § 3). An error-domain enum, not a widget.',
    },
    {
        member: 'Gio.resources_register',
        gir: 'resources_register',
        kind: 'function',
        why: 'Registers a `Gio.Resource` process-wide, the most recent answering first, as GIO prepends (ADR 0116 § 3). A function, not a widget.',
    },
    {
        member: 'Gio.resources_unregister',
        gir: 'resources_unregister',
        kind: 'function',
        why: 'Removes a registered `Gio.Resource` from the process-wide list (ADR 0116 § 3). A function, not a widget.',
    },
    {
        member: 'Gio.resources_lookup_data',
        gir: 'resources_lookup_data',
        kind: 'function',
        why: 'Reads a file out of the registered resources as `GLib.Bytes` — what the web `Gtk.IconTheme` draws an application icon from (ADR 0116 §§ 3–4). A function, not a widget.',
    },
    {
        member: 'Gio.resources_get_info',
        gir: 'resources_get_info',
        kind: 'function',
        why: 'Answers the size and flags of a resource path without reading it (ADR 0116 § 3). A function, not a widget.',
    },
    {
        member: 'Gio.resources_enumerate_children',
        gir: 'resources_enumerate_children',
        kind: 'function',
        why: 'Lists a resource directory — how `Gtk.IconTheme` scans `<resource-base-path>/icons/` (ADR 0116 §§ 3–4). A function, not a widget.',
    },
    {
        member: 'Gio._promisify',
        gir: '_promisify',
        override: true,
        why: "GJS apps write `Gio._promisify(Gio.File.prototype, 'load_contents_async')` before awaiting (ADR 0100). A function GJS's own Gio override adds; the typelib has no entry, so the generator reads it off the namespace.",
    },
];

/** `Gio.Menu` -> `{ namespace: 'Gio', member: 'Menu' }`. A GIR namespace carries no dot. */
export function splitMember(member) {
    const at = member.indexOf('.');
    if (at === -1) throw new Error(`${member} is not a \`<Namespace>.<Member>\` name`);
    return { namespace: member.slice(0, at), member: member.slice(at + 1) };
}

/**
 * The `'Ns.Member': { gtype: '…', widget: <bool> }` rows of `VALUE_TYPES`.
 *
 * Residue-checked like every other reader of a generated literal here: anything in the
 * body this matcher did not consume is an error naming it, never a shorter answer. A row
 * shape that moves has to be noticed by the reader, because the only other way to notice
 * it is a gate that reports a ledger entry as unheld while the artifact holds it.
 */
function readValueRows(text) {
    const body = readBlock(text, 'VALUE_TYPES');
    const out = new Map();
    const spans = [];
    for (const match of body.matchAll(/'([^']+)':\s*\{\s*gtype:\s*'([^']*)',\s*widget:\s*(true|false),?\s*\}/g)) {
        if (out.has(match[1])) throw new Error(`VALUE_TYPES declares ${match[1]} twice`);
        out.set(match[1], { gtype: match[2], widget: match[3] === 'true' });
        spans.push([match.index, match.index + match[0].length]);
    }
    const left = residue(body, spans);
    if (left !== '') throw new Error(`VALUE_TYPES has entries this reader did not match: ${left.slice(0, 120)}`);
    return out;
}

/**
 * The whole artifact, as data.
 *
 * @param {string} text the generated file
 * @returns {{
 *   provenance: string,
 *   declared: Map<string, { gtype: string, widget: boolean }>,
 *   undeclared: Map<string, string>,
 * }}
 */
export function readValueTypes(text) {
    const provenance = /^export const VALUE_TYPES_PROVENANCE = '([^']*)';$/m.exec(text)?.[1];
    if (provenance === undefined) throw new Error('VALUE_TYPES_PROVENANCE is not declared as a plain string');
    const declared = readValueRows(text);
    const undeclared = readStringRecord(text, 'VALUE_TYPES_UNDECLARED');
    for (const member of undeclared.keys()) {
        if (declared.has(member)) throw new Error(`${member} is both declared and undeclared in the artifact`);
    }
    return { provenance, declared, undeclared };
}

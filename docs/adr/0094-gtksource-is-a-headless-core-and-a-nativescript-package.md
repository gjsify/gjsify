# 94. GtkSourceView is a headless core plus a NativeScript package, with named gaps

- Status: **Accepted** (2026-10-08)
- Date: 2026-10-05
- Deciders: Pascal Garber
- Related: [ADR 0034 (widget vocabulary convergence)](0034-widget-vocabulary-convergence.md),
  [ADR 0015 (headless package contract)](0015-headless-package-contract.md),
  [ADR 0093 (template constructs)](0093-template-constructs-are-carried-and-each-renderer-declares-what-it-builds.md)

## Context

Learn6502 edits assembly in a `GtkSource.View`. Its GNOME app has the real widget; its web app has
`adw-source-view`, a CodeMirror twin; its Android app had nothing. A `.blp` with
`using GtkSource 5;` and `GtkSource.View` should render on all three.

GtkSourceView has no JavaScript port. What can be reused is its DATA: `.lang` and style-scheme XML,
which the GNOME editors and the web twin already agree on.

## Decision

1. **Two packages, cut at the toolkit.** `@gjsify/gtksource-core` (`packages/web/`) is headless
   (`gjsify.headless: true`, all four slots `polyfill`): an XML reader, `.lang` and scheme parsing,
   GRegex to RegExp translation and a line tokenizer that carries state across lines. It reaches no
   typelib, no DOM and no `@nativescript/core`, so Node, GJS and NativeScript run the same specs.
   `@gjsify/gtksource-nativescript` (`packages/nativescript-bridge/`) holds everything that touches
   a platform: the `EditText` driver, the `View` shell, and the `Buffer` / `LanguageManager` /
   `StyleSchemeManager` objects, whose logic is plain TypeScript. The platform half is one file,
   `native-editor.android.ts`, behind a driver seam.
2. **The vocabulary is a namespace.** The package root exports `GtkSource` (`export * as`), and the
   `./gtksource` subpath is the module an app's `xmlns:gtksource="~/gtksource"` barrel re-exports.
   One barrel per library, for the reason ADR 0034 § Amendment 9 gives: the prefix is the only
   thing saying which library a widget belongs to.
3. **The gates stay as they are, on purpose.** `check-core-namespace-claims` already reads
   `GtkSource` as an oracle namespace. `check-vocabulary-alignment` holds the Adw and Gtk tables,
   so `adw-source-view` stays web-only against them; only its stated reason changes.
   `check-construct-capabilities` and `check-adwaita-conformance-drivers` hold renderers of the
   template constructs, and `GtkSource.View` is a leaf view, not a renderer. A gate widened to
   cover it would model a claim nobody makes.

4. **A `.blp` reaches it through a registered barrel, and the adwaita package is a peer.**
   The shared-tree builder of `@gjsify/adwaita-nativescript` knows the `adw` and `gtk` barrels it
   owns; `registerBarrel(prefix, library, namespace)` lets a package that depends on it add one
   more without the dependency running the other way. `@gjsify/gtksource-nativescript/builder`
   makes that call for `GtkSource`, and an app imports it once beside the adwaita builder, so
   `using GtkSource 5; GtkSource.View { … }` builds unchanged, including a `buffer: GtkSource.Buffer
   { text: "…"; };` object child. A real `.blp` compiled with `?shared-tree` takes this path in the
   specs; a device has not run it. The class is named `GtkSourceView`,
   because the builder holds a member to the GIR name the `.blp` wrote. `@gjsify/adwaita-nativescript`
   is a `dependency`, declared with the same `workspace:^` range the app uses, so one installed
   copy serves both: the view shares the adwaita package's colour-scheme state, and a second copy
   would own a state the app's own copy never writes, leaving the editor in the wrong scheme. It was
   first a `peerDependency`, but `gjsify foreach --topological` orders production dependencies
   only, so CI built this package before the adwaita one it imports and failed on a missing
   `registerBarrel`.

## Deliberate gaps

Each is declared in `status/status.json` rather than left to be found.

- **Engine, from the core:** `extend-parent` and `once-only` are not modelled, back-references in
  `end` are not supported, and case-insensitive contexts are not supported. They are reported as
  `unsupported`, or throw under `strict`. A regex feature the translator cannot render faithfully is
  refused, never mistranslated.
- **No word wrap.** Every logical line is one layout line and the view scrolls horizontally. The
  gutter is drawn from the text `Layout`, which stays exact only under that rule.
- **`indent-width` is held and read back, not applied.** An `EditText` has no indent step; its only
  Tab is a hardware key that inserts `\t`, and `tab-width` would need a `TabStopSpan` per line that
  GtkSourceView does not tie to `indent-width`. `auto-indent` copies the previous line's blanks.
- **LGPL data is not bundled.** `def.lang` and the `Adwaita` scheme are GtkSourceView's and LGPL.
  The package ships a small stand-in under `Adwaita` / `Adwaita-dark` and takes the real files
  through `addSchemeFromXml()`.
- **Fallback schemes are our own.** `fallback-schemes.ts` holds colours this package chose; they
  exist because schemes name `Adwaita` as `parent-scheme`, not because they match it.
- **Android only, and unverified on a device.** `native-editor.android.ts` is held by type-checking
  alone; the specs drive `EditorSession` through a fake driver, which is not a device.
  There is no iOS driver.

## Shared widget classes: actions, tooltips, icons

A GtkSource-based widget class shared with a GNOME app writes `action-name: "source-view.copy"`
in its `.blp` and registers `Gio.SimpleAction({ name: "copy" })` in a group under that prefix.
`@gjsify/adwaita-nativescript` carries the minimum of that: `Gio.SimpleAction`,
`Gio.SimpleActionGroup`, `insertActionGroup` and a tap that resolves `prefix.name` up the
parent chain (`widgets/actions.ts`). Not modelled: parameter types, state, `app.`/`win.`
resolution through an application, accelerators. `tooltip-text` also reaches Android's
`View.setTooltipText` (API 26, long press; duck-typed, so no `TooltipCompat` and a no-op on older
devices) beside the accessibility hint, and `registerIcons(map)`
registers a generated icon module by GNOME name. An icon-only `Gtk.Button` wears
`image-button` and `.osd` has a theme rule, so the shared `.blp` renders flat and unlabelled. An app's `native-api-usage.json` must list
`android.view.View` for `setTooltipText`, besides the `EditText` classes of the editor itself.

## Consequences

- A consumer gets `GtkSource.View` from one `.blp` on GTK, and on NativeScript Android once it has
  a device-verified driver. Until then the package is `partial`.
- The core can back a web or GJS renderer later without a rewrite; this ADR does not promise one.
- Closing a gap above means editing the core, not working around it per consumer.

## Amendment (2026-10-09): `gi://GtkSource` is routed on NativeScript

`GI_RENDERERS` (ADR 0034 stage 9) answers `gi://GtkSource?version=5` on `--app nativescript` out of
`@gjsify/gtksource-nativescript/gtksource`, through the table's `specifiers` field, since the
package depends on the renderer and cannot be a member of its root barrel. `tests/e2e/gi-renderer-arms`
builds and evaluates a `GtkSource.View` subclass through it. `GtkSource.init()` is a no-op on
this port, as on GJS where it returns `undefined` and may be called twice; a conformance vector table
runs against real `gi://GtkSource` and the namespace door. The browser row had no `GtkSource` at that point. Status unchanged.

## Amendment (2026-10-09): a web `GtkSource` over the core

`@gjsify/adwaita-web` exports a `GtkSource` namespace (`View`, `Buffer`, `LanguageManager`,
`StyleSchemeManager`, `init`), and the browser row of `GI_RENDERERS` answers `gi://GtkSource?version=5`
from it, so `using GtkSource 5; GtkSource.View` no longer reports a missing member on the browser. It is
built on `@gjsify/gtksource-core`, not on the CodeMirror `<adw-source-view>`: both ports read the same
`.lang` and style-scheme files. The platform-free model (`Buffer`, the managers, `EditorSession`, the
highlight controller, gutter arithmetic, `init`) moved from the NativeScript package into the core, so
Android and the web share one copy. `<gtk-source-view>` is a `<textarea>` that keeps caret, selection,
input, IME and undo, with the highlight on a backdrop and the line numbers in a gutter; its structure
mirrors the Android driver. Like Android it has no word wrap and holds `indent-width` without applying
it. The GJS snake_case manager verbs (`get_default`, `get_language`, `get_scheme`) exist, with vectors run
against real `gi://GtkSource`. Everything else (`TextIter`, `TextMark`, gutters, the `buffer:` object
child of a `.blp`) is absent and refused by name. Status unchanged.

## Amendment (2026-10-09): the Buffer surface

`GtkSource.Buffer` on the web and NativeScript doors now answers the GJS verbs Learn6502 calls:
`get_insert`, `get_selection_bound`, `get_start_iter`, `get_end_iter`, `get_selection_bounds`,
`get_text(start, end, include_hidden)`, `move_mark`, `insert_at_cursor(text, -1)`, `delete(start, end)`,
`set_language`, `set_style_scheme`, `cursor_position`, `begin_user_action`, `end_user_action`,
`undo`, `redo`, `can_undo`, `can_redo`, and `connect_after`. `TextIter` offers `get_offset` and
`set_offset` (counted in characters, as GTK does; the buffer's own offsets stay UTF-16), and `TextMark`
offers `name`, for the two marks `insert` and `selection_bound`. The signals `mark-set` (iterator, mark),
`cursor-moved`, `begin-user-action`, `end-user-action`, `undo` and `redo` are emitted in GTK's order;
`connect` of any other signal name throws by name. `text =` is not undoable and clears the history; a
native edit counts as a user action. Undo coalescing across separate edits is not implemented: each
edit outside a user action is its own step. Vectors (`GTKSOURCE_BUFFER_VECTORS`) run against real
`gi://GtkSource`, the core, and both doors. Not here: arbitrary marks, tags, `signal_stop_emission_by_name`
(so a handler cannot veto `mark-set`), and the view-side verbs. Status unchanged.

## Amendment (2026-10-09): the View surface

`GtkSource.View` on the web and NativeScript doors now answers the verbs Learn6502 calls on the view:
`cursor_visible` (default TRUE), `get_/set_editable`, `highlight_current_line`, `show_line_numbers`,
`vadjustment` and `hadjustment` (one stable `Gtk.Adjustment` each; on the web it follows the textarea's
scroll), `set_direction`/`get_direction`, `get_first_child`, `get_next_sibling` and `get_parent`. A view
has no widget children of its own on these doors, so `get_first_child` answers null where real GTK
answers an internal child. `Gtk.ScrolledWindow` gains `get_policy`, `set_policy` and
`set_/get_vadjustment`/`hadjustment`, and `Gtk` gains the enums `PolicyType`, `TextDirection` and
`TextWindowType`, with GTK's numeric values. Vectors (`GTKSOURCE_VIEW_SURFACE_VECTORS`) run against real
`gi://GtkSource` and `gi://Gtk` (instance vectors only where a display exists), the web door and the
NativeScript door. Not here: `get_gutter` (slice 6) and the later-slice members, which throw by name.
Status unchanged.

# 94. GtkSourceView is a headless core plus a NativeScript package, with named gaps

- Status: **Proposed** (2026-10-05)
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
   is a `peerDependency` (and a `devDependency` for the workspace), not a dependency: the view
   shares the adwaita package's colour-scheme state, and a second installed copy would own a state
   the app's own copy never writes, so the editor would stay in the wrong scheme.

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

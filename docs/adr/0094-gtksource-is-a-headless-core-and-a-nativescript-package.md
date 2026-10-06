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

## Deliberate gaps

Each is declared in `status/status.json` rather than left to be found.

- **Engine, from the core:** `extend-parent` and `once-only` are not modelled, back-references in
  `end` are not supported, and case-insensitive contexts are not supported. They are reported as
  `unsupported`, or throw under `strict`. A regex feature the translator cannot render faithfully is
  refused, never mistranslated.
- **No word wrap.** Every logical line is one layout line and the view scrolls horizontally. The
  gutter is drawn from the text `Layout`, which stays exact only under that rule.
- **`indent-width` is held and read back, not applied.** Android has no Tab key to apply it to.
- **LGPL data is not bundled.** `def.lang` and the `Adwaita` scheme are GtkSourceView's and LGPL.
  The package ships a small stand-in under `Adwaita` / `Adwaita-dark` and takes the real files
  through `addSchemeFromXml()`.
- **Fallback schemes are our own.** `fallback-schemes.ts` holds colours this package chose; they
  exist because schemes name `Adwaita` as `parent-scheme`, not because they match it.
- **Android only, and unverified on a device.** `native-editor.android.ts` is held by type-checking
  alone; the specs drive `EditorSession` through a fake driver, which is not a device.
  There is no iOS driver.

## Consequences

- A consumer gets `GtkSource.View` from one `.blp` on GTK, and on NativeScript Android once it has
  a device-verified driver. Until then the package is `partial`.
- The core can back a web or GJS renderer later without a rewrite; this ADR does not promise one.
- Closing a gap above means editing the core, not working around it per consumer.

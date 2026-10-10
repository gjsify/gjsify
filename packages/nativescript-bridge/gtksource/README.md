# @gjsify/gtksource-nativescript

`GtkSource.View` for NativeScript on Android: an `EditText` whose `Editable` carries the syntax
highlight as spans (set in place, re-tokenized per changed line range), a line-number gutter drawn
from the text `Layout` in `onDraw`, and `GtkSource.Buffer` / `LanguageManager` /
`StyleSchemeManager` over `@gjsify/gtksource-core`.

- No word wrap: every logical line is one layout line, the view scrolls horizontally.
- GtkSourceView's `Adwaita` scheme and `def.lang` are LGPL and not bundled. A small own stand-in is
  registered under `Adwaita` / `Adwaita-dark`; add the real files with `addSchemeFromXml()`.
- `indent-width` is held and read back, not applied: an `EditText` has no indent step. Its only
  Tab is a hardware key that inserts `\t`, and `tab-width` would need a `TabStopSpan` per line that
  GtkSourceView does not tie to `indent-width`. `auto-indent` copies the previous line's blanks.
- The caret line's number is emphasised only under `highlight-current-line` (default false).
- Android API used (R8): the consuming app must keep `android.widget.EditText`, `android.text.*`
  spans, `android.graphics.Paint`/`Typeface` in its `native-api-usage.json` whitelist. Shared
  widget classes that come with `@gjsify/adwaita-nativescript` add `android.view.View`
  (`setTooltipText`, API 26; duck-typed, no `TooltipCompat`) to that list.
- The platform half (`native-editor.android.ts`) ran on a device (API 24 and 36) for `extend-selection` and
  `copy-clipboard`. A triple tap selects nothing natively below API 28; see ADR 0094, last amendment.

## Using it from XML

The package publishes the `GtkSource` namespace as a subpath, and an app re-exports it as its own
barrel, one barrel per library (see [docs/nativescript-xml.md](../../../docs/nativescript-xml.md)):

```ts
// app/gtksource.ts
export * from '@gjsify/gtksource-nativescript/gtksource';
```

```xml
<gtksource:View xmlns="http://schemas.nativescript.org/tns.xsd" xmlns:gtksource="~/gtksource" />
```

## Using it from a `.blp`

A Blueprint file that says `GtkSource.View` builds on Android through the shared-tree builder of
`@gjsify/adwaita-nativescript`, the same file GNOME loads. Import the builder subpath once, for its
effect, beside the adwaita builder:

```ts
import { build } from '@gjsify/adwaita-nativescript/builder';
import '@gjsify/gtksource-nativescript/builder'; // registers the `GtkSource` library
import tree from './source-view.blp?shared-tree';

const view = build(tree);
```

`@gjsify/adwaita-nativescript` is a dependency, not a peer: the build order follows production
dependencies only. Keep your app on the same version range, so the view and your app share one
colour-scheme state.

What a `.blp` can write: `GtkSource.View`, and `buffer: GtkSource.Buffer { text: "…";
highlight-syntax: false; };` as the view's `buffer` object child. `LanguageManager` and
`StyleSchemeManager` are singletons you ask for a `Language` / `StyleScheme`, and `.blp` cannot
call a method, so set `buffer.language` and `buffer.styleScheme` from code after building.

`Gtk.Button`'s `action-name` runs through a minimal `GAction` registry of
`@gjsify/adwaita-nativescript`: register a `Gio.SimpleAction` in a `Gio.SimpleActionGroup`, put the
group on an ancestor with `insertActionGroup('source-view', group)`, and a tap on a button whose
`action-name` is `source-view.copy` calls the action's `activate`. Parameter types, state,
`app.` / `win.` resolution and accelerators are not modelled.

`tooltip-text` also reaches Android's `View.setTooltipText` (long press, API 26) beside the
accessibility hint. `registerIcons({ 'edit-copy-symbolic': '…' })` registers a generated icon module
by GNOME name, so an icon-only `Gtk.Button` in a shared `.blp` finds its glyph; such a button wears
the `image-button` class and renders flat and unlabelled.

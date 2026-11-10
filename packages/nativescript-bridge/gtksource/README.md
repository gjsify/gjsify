# @gjsify/gtksource-nativescript

`GtkSource.View` for NativeScript, with a driver per platform over the same editor logic, and
`GtkSource.Buffer` / `LanguageManager` / `StyleSchemeManager` over `@gjsify/gtksource-core`:

- **Android** — an `EditText` whose `Editable` carries the syntax highlight as spans (set in
  place, re-tokenized per changed line range), with the line-number gutter drawn from the text
  `Layout` in `onDraw`.
- **iOS** — a `UITextView` whose `NSTextStorage` carries it as attributes on ranges, with the
  gutter drawn in `drawRect:` from the `NSLayoutManager`'s line fragments. `NSTextStorage` has no
  span object a repaint can remove, so a repaint NAMES the range it resets; that arithmetic is
  UIKit-free in `text-ranges.ts` and is the half the specs measure.

Shared behaviour and the gaps both halves carry:

- No word wrap: every logical line is one layout line, the view scrolls horizontally.
- GtkSourceView's `Adwaita` scheme and `def.lang` are LGPL and not bundled. A small own stand-in is
  registered under `Adwaita` / `Adwaita-dark`; add the real files with `addSchemeFromXml()`.
- `indent-width` is held and read back, not applied: neither an `EditText` nor a `UITextView` has
  an indent step. Their only Tab is a hardware key that inserts `\t`, and `tab-width` would need a
  per-line tab stop that GtkSourceView does not tie to `indent-width`. `auto-indent` copies the
  previous line's blanks.
- The caret line's number is emphasised only under `highlight-current-line` (default false).
- Text size: the view is a plain `View`, which keeps the CSS `font-size` and applies it to nothing, so
  the driver does (`setTextSize(COMPLEX_UNIT_SP, …)` on Android, points on iOS). Without a
  `font-size` it is 14.67 (GNOME's 11 pt at 96 dpi), the size the Adwaita theme derives its prose
  from; the `EditText` theme default of 18 sp made code 1.23x the prose. The line numbers follow.
- Android API used (R8): the consuming app must keep `android.widget.EditText`, `android.text.*`
  spans, `android.graphics.Paint`/`Typeface` and `android.util.TypedValue` in its `native-api-usage.json` whitelist. Shared
  widget classes that come with `@gjsify/adwaita-nativescript` add `android.view.View`
  (`setTooltipText`, API 26; duck-typed, no `TooltipCompat`) to that list.
- `native-editor.android.ts` ran on a device (API 24 and 36) for `extend-selection` and
  `copy-clipboard`. A triple tap selects nothing natively below API 28; see ADR 0094.
- `native-editor.ios.ts` has run on NO device and no simulator. It emits neither
  `extend-selection` (the text view's own gesture recognisers offer no documented veto before they
  select) nor `copy-clipboard` (UIKit's `-copy:` editing action collides with `NSObject.copy`), and
  `selectionBackground` has no counterpart there: UIKit derives the selection fill from the
  `tintColor` that also paints the caret. See ADR 0094, last amendment.

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
accessibility hint. A glyph outside the compiled subset comes from the app's GResource under
`<resource-base-path>/icons/` (ADR 0116 § 4), so an icon-only `Gtk.Button` in a shared `.blp` finds it; such a button wears
the `image-button` class and renders flat and unlabelled.

# @gjsify/gtksource-nativescript

`GtkSource.View` for NativeScript on Android: an `EditText` whose `Editable` carries the syntax
highlight as spans (set in place, re-tokenized per changed line range), a line-number gutter drawn
from the text `Layout` in `onDraw`, and `GtkSource.Buffer` / `LanguageManager` /
`StyleSchemeManager` over `@gjsify/gtksource-core`.

- No word wrap: every logical line is one layout line, the view scrolls horizontally.
- GtkSourceView's `Adwaita` scheme and `def.lang` are LGPL and not bundled. A small own stand-in is
  registered under `Adwaita` / `Adwaita-dark`; add the real files with `addSchemeFromXml()`.
- `indent-width` is held and read back; Android has no Tab key to apply it to.
- Android API used (R8): the consuming app must keep `android.widget.EditText`, `android.text.*`
  spans, `android.graphics.Paint`/`Typeface` in its `native-api-usage.json` whitelist.
- The platform half (`native-editor.android.ts`) is not verified on a device yet.

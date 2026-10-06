// The `GtkSource` vocabulary: `GtkSource.View`, `GtkSource.Buffer`, `GtkSource.LanguageManager`,
// `GtkSource.StyleSchemeManager`. `export * as GtkSource from './namespace/gtksource.js'` in
// `src/index.ts` makes it the namespace; the `./gtksource` subpath is the module an app's
// `xmlns:gtksource="~/gtksource"` barrel re-exports, so `<gtksource:View>` resolves exactly as
// `<adw:Clamp>` does. One barrel per library: the prefix is the only thing that says which
// library a widget belongs to (ADR 0034 § Amendment 9).
export { Buffer } from '../buffer.js';
export { LanguageManager, Language } from '../language-manager.js';
export { StyleSchemeManager, StyleScheme } from '../style-scheme.js';
export { GtkSourceView as View } from '../view.js';

// The GtkSource vocabulary of `@gjsify/adwaita-web` (ADR 0094 amendment): `GtkSource.View`,
// `Buffer`, `LanguageManager`, `StyleSchemeManager`, over `@gjsify/gtksource-core`, the same names
// the NativeScript port publishes. `export * as GtkSource from './namespace/gtksource.js'` in
// `src/index.ts` makes it the namespace the `gi://GtkSource` arm answers from.
//
// A TRUE SUBSET: GtkSource's completion, search and the rest are absent, and the arm refuses each
// by name.
export {
    Buffer,
    Gutter,
    GutterLines,
    GutterRenderer,
    GutterRendererText,
    Language,
    LanguageManager,
    StyleScheme,
    StyleSchemeManager,
    init,
} from '@gjsify/gtksource-core';
export { GtkSourceView as View } from '../gtksource/gtk-source-view.js';

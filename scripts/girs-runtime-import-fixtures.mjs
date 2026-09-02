// SPDX-License-Identifier: MIT
// Vectors for `check-girs-runtime-imports.mjs`: a source fragment and the specifiers the
// reader must report as RUNTIME imports of the `@girs/*` type vocabulary.
//
// SEPARATE FILE, and the scan skips it, for the reason its sibling
// `gi-import-version-fixtures.mjs` states: a reader that looks for a shape anywhere in a
// file cannot also carry that shape as data — it would report its own vectors, and the
// fix would be to delete them.

/** @type {[source: string, offenders: string[]][]} */
export const GIRS_RUNTIME_IMPORT_VECTORS = [
    // The shape being retired: a DEFAULT import bound to a name the code then calls.
    ["import Gtk from '@girs/gtk-4.0';", ['@girs/gtk-4.0']],
    ['import Adw from "@girs/adw-1";', ['@girs/adw-1']],
    ["    import GLib from '@girs/glib-2.0';", ['@girs/glib-2.0']],
    // A named runtime import is the same thing wearing braces.
    ["import { Button } from '@girs/gtk-4.0';", ['@girs/gtk-4.0']],
    // TYPE imports are the vocabulary and stay. `@girs/*` is where the types live; there
    // is no `gi://` counterpart for a type-only position, and rewriting one would add a
    // runtime dependency to a module that has none.
    ["import type Gtk from '@girs/gtk-4.0';", []],
    ["import type { Widget } from '@girs/gtk-4.0';", []],
    ["import { type Widget } from '@girs/gtk-4.0';", []],
    // Already converted.
    ["import Gtk from 'gi://Gtk?version=4.0';", []],
    // Prose is not an import, and a gate that fires on its own rationale gets the
    // rationale deleted — which is the half that survives a rewrite.
    ["// prefer gi:// over import Gtk from '@girs/gtk-4.0'", []],
    ["/** See `import Gtk from '@girs/gtk-4.0';` for the old spelling. */", []],
    // An `export … from` re-export is not a runtime binding this rule is about: it
    // re-exports types through the package that owns them.
    ["export type { Widget } from '@girs/gtk-4.0';", []],
];

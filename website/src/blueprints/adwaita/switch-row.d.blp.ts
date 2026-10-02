// GENERATED from switch-row.blp — do not edit. ADR 0088 says what these exports mean.
// Regenerate with `gjsify blueprint types`; `scripts/check-blueprint-sidecars.mjs` holds it.

import type Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';

/** The GtkBuilder XML this `.blp` compiles to. */
declare const xml: string;
export default xml;

/** What `build()` hands back: the builder, and every id the file declared. */
export interface Built {
    builder: Gtk.Builder;
    row: Adw.SwitchRow;
}

/** Builds the tree with a fresh `Gtk.Builder`. */
export declare function build(): Built;

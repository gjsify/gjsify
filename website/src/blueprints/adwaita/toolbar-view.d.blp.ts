// GENERATED from toolbar-view.blp — do not edit. ADR 0088 says what these exports mean.
// Regenerate with `gjsify blueprint types`; `scripts/check-blueprint-sidecars.mjs` holds it.

import type Gtk from 'gi://Gtk?version=4.0';

/** The GtkBuilder XML this `.blp` compiles to. */
declare const xml: string;
export default xml;

/** What `build()` hands back: the builder, and every id the file declared. */
export interface Built {
    builder: Gtk.Builder;
    add_button: Gtk.Button;
    selection: Gtk.Label;
}

/** Builds the tree with a fresh `Gtk.Builder`. */
export declare function build(): Built;

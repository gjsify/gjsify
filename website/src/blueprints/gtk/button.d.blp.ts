// GENERATED from button.blp — do not edit. ADR 0088 says what these exports mean.
// Regenerate with `gjsify blueprint types`; `scripts/check-blueprint-sidecars.mjs` holds it.

import type Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';

/** The GtkBuilder XML this `.blp` compiles to. */
declare const xml: string;
export default xml;

/** What `build()` hands back: the builder, and every id the file declared. */
export interface Built {
    builder: Gtk.Builder;
    button_box: Adw.WrapBox;
    pill_button: Gtk.Button;
    add_button: Gtk.Button;
    suggested_button: Gtk.Button;
    delete_button: Gtk.Button;
    flat_button: Gtk.Button;
}

/** Builds the tree with a fresh `Gtk.Builder`. */
export declare function build(): Built;

// The second namespace. `gi://Gtk` is the one ADR 0034 § 6 calls SPARSE on these targets:
// a renderer ships a handful of the GIR's `gtk-*` widgets, and every absent member has to
// be a named refusal rather than `undefined`.
import Gtk from 'gi://Gtk?version=4.0';

export const button = Gtk.Button;
export const kind = typeof Gtk.Button;

export class ProbeButton extends Gtk.Button {}

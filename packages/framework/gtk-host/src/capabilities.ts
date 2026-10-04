// Which template constructs `gtk-host`'s tree builder builds (ADR 0093 § 2). Pure data, so a
// build plugin can read it without importing the renderer.
//
// A GTK application loads a `.blp` through `Gtk.Builder`, which builds every construct; the
// tree path over the host element model keeps its ADR 0072/0092 stance until a consumer needs
// more.

import type { ConstructCapabilities } from '@gjsify/adwaita-core/conformance';

export const capabilities: ConstructCapabilities = {
    layout: {
        refused:
            "gtk-host's host has no door for a layout-manager child object (ADR 0092); load the .blp through Gtk.Builder instead",
    },
    strings: {
        refused:
            "gtk-host's host builds widgets and a Gtk.StringList is not one (ADR 0072); load the .blp through Gtk.Builder instead",
    },
    responses: {
        refused:
            "gtk-host's host builds widgets and a dialog's responses have no door in it (ADR 0072); load the .blp through Gtk.Builder instead",
    },
    page: 'implemented',
    extern: {
        refused:
            "gtk-host's host resolves a tag against its built-in widget descriptors and has no registry for an application class; load the .blp through Gtk.Builder instead",
    },
    signal: {
        refused:
            "gtk-host's tree builder resolves no handler names; a GTK app connects signals in code, or loads the .blp through Gtk.Builder with a scope",
    },
    bind: {
        refused:
            "gtk-host's tree builder resolves no bindings between objects; a GTK app binds properties in code, or loads the .blp through Gtk.Builder",
    },
};

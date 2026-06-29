// Editor-only ambient types for the shared `gi://` source. These references
// surface the `gi://GObject`/`gi://GLib`/`gi://Gio`/`gi://Gdk`/`gi://Gtk`/`gi://Adw`
// module declarations and the GJS ambient globals (`print`, …) from the `@girs/*`
// packages WITHOUT importing any of them at runtime — the bundle is built from
// `src/app.ts` alone, so no `@girs/*` code ever reaches the GJS or Node output.
// They are pure typings.
/// <reference types="@girs/gjs/ambient" />
/// <reference types="@girs/glib-2.0/ambient" />
/// <reference types="@girs/gobject-2.0/ambient" />
/// <reference types="@girs/gio-2.0/ambient" />
/// <reference types="@girs/gdk-4.0/ambient" />
/// <reference types="@girs/gtk-4.0/ambient" />
/// <reference types="@girs/adw-1/ambient" />

// Editor/type-check-only ambient types for the shared `gi://` source. They surface
// the `gi://Adw` module declaration + the GJS ambient globals (`print`, …) from the
// `@girs/*` packages WITHOUT importing any of them at runtime — the bundle is built
// from `src/app.ts` alone, so no `@girs/*` code reaches the GJS or Node output.
// The Gtk/Gdk/Gio/GLib/Graphene ambients back `@gjsify/devtools`' transitive types.
/// <reference types="@girs/gjs/ambient" />
/// <reference types="@girs/glib-2.0/ambient" />
/// <reference types="@girs/gobject-2.0/ambient" />
/// <reference types="@girs/gio-2.0/ambient" />
/// <reference types="@girs/gdk-4.0/ambient" />
/// <reference types="@girs/gtk-4.0/ambient" />
/// <reference types="@girs/graphene-1.0/ambient" />
/// <reference types="@girs/adw-1/ambient" />

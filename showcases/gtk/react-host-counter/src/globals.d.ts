// Editor/type-check-only ambient types for the `gi://` source. They surface the
// `gi://…` module declarations and the GJS ambient globals (`print`, `imports`)
// from the `@girs/*` packages WITHOUT importing any of them at runtime — the
// bundle is built from `src/app.tsx` alone.
/// <reference types="@girs/gjs/ambient" />
/// <reference types="@girs/glib-2.0/ambient" />
/// <reference types="@girs/gobject-2.0/ambient" />
/// <reference types="@girs/gtk-4.0/ambient" />
/// <reference types="@girs/adw-1/ambient" />

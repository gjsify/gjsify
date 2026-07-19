# @gjsify/gtk-runtime-darwin-arm64

Batteries-included, **relocated** GTK / GObject-Introspection runtime bundle for
**macOS arm64**. It lets [`@gjsify/node-gi`](../node-gi) load `gi://` namespaces
(GLib · GObject · Gio · cairo · Pango · Graphene · Gdk) with **no Homebrew GTK**
installed on the host — Phase 2 of cross-platform node-gi.

Platform-gated (`os: ["darwin"]`, `cpu: ["arm64"]`), tier 3 (experimental). On any
other platform npm skips it and `@gjsify/node-gi` falls back to a system/Homebrew
GTK. The heavy `gtk/` payload is **not committed** — it is built on a macOS CI
runner (`scripts/build-gtk-runtime.mjs`) and shipped via the package tarball /
staged into node-gi's `prebuilds/darwin-arm64/gtk/`.

## Layout

```
gtk/
  lib/                 relocated dylibs (@loader_path-linked, ad-hoc re-signed)
  girepository-1.0/    typelibs (GLib/GObject/Gio/cairo/Pango/Graphene/Gdk/…)
  manifest.json        counts + sizes + dylib list
```

## How it is built (the relocation, the crux)

`node scripts/build-gtk-runtime.mjs` runs on a macOS runner **with** a build-time
Homebrew GTK stack (the closure *source*, not shipped):

1. **Collect** — walk the dylib graph with `otool -L`, recursively, from the
   typelib-backing libraries the display-free conformance loads
   (glib/gobject/gio + girepository + cairo + pango + graphene + gdk-pixbuf +
   gtk4). Everything under `$(brew --prefix)/lib` is copied flat into `gtk/lib`;
   `/usr/lib` + `/System` libraries are left as OS-provided.
2. **Relocate** — for each bundled dylib, rewrite its own id **and** every
   sibling reference to `@loader_path/<leaf>` with `install_name_tool`, then
   **ad-hoc re-sign** it (`codesign --force --sign -`). Re-signing is mandatory
   on Apple silicon: `install_name_tool` invalidates the code signature and dyld
   refuses to load a mis-signed dylib. After this, **no bundled library
   references `/opt/homebrew`** — the bundle is portable.
3. **Typelibs** — copy the typelib set into `gtk/girepository-1.0`.
4. **Addon (optional, `--addon`)** — relocate a *copy* of the node-gi addon
   (`node_gi.node`): rewrite its `/opt/homebrew/...` refs to `@rpath/<leaf>` and
   add `@loader_path/gtk/lib` as an rpath, so the addon loads the **bundled**
   `libgirepository` with no Homebrew. This is the env-free path.

## How node-gi finds it

`@gjsify/node-gi`'s loader (`gtk-runtime.js`) resolves the bundle from, in order:

1. `GJSIFY_GTK_RUNTIME` (explicit bundle dir),
2. node-gi's own `prebuilds/<platform>-<arch>/gtk/` (the CI/dev staging path),
3. the sibling monorepo dir `../gtk-runtime-<platform>-<arch>/gtk`,
4. `require.resolve('@gjsify/gtk-runtime-<platform>-<arch>')` (the published dep).

On a match (darwin only) it prepends `gtk/girepository-1.0` to the GIRepository
search path via `prependSearchPath` (env-free) and prepends `gtk/lib` to
`process.env.DYLD_FALLBACK_LIBRARY_PATH`.

## Scope & what a full windowing bundle still needs

This bundle targets the **display-free conformance closure only**. The full
GTK windowing/display stack additionally needs: the Quartz GDK backend, the
`gdk-pixbuf` `loaders.cache` + loader modules, compiled GSettings schemas
(`glib-compile-schemas`), the Adwaita icon theme + `icon-theme.cache`, and
Fontconfig cache/config — none of which are collected here.

**Env-free caveat (macOS):** dyld captures `DYLD_FALLBACK_LIBRARY_PATH` at
launch, so it cannot be set from JS at runtime. Namespaces whose backing dylib is
already in-process via the addon's own link closure (GLib/GObject/Gio/cairo)
resolve **env-free** through the relocated addon's `@rpath`. Namespaces whose
dylib is *not* addon-linked (Pango/Graphene/Gdk) rely on
`DYLD_FALLBACK_LIBRARY_PATH` being set at launch (a launcher/re-exec, or a native
`dlopen`-preload of those libraries at addon load, is the remaining step for a
fully env-free consumer install).

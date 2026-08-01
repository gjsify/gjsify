# @gjsify/gtk-runtime-win32-x64

Batteries-included GTK / GObject-Introspection runtime bundle for **Windows x64**.
It lets [`@gjsify/node-gi`](../node-gi) load `gi://` namespaces (GLib · GObject ·
Gio · cairo · Pango · Graphene · Gdk) with **no gvsbuild / system GTK** installed on
the host — the Windows sibling of `@gjsify/gtk-runtime-darwin-arm64`.

Platform-gated (`os: ["win32"]`, `cpu: ["x64"]`), tier 3 (experimental). On any
other platform npm skips it and `@gjsify/node-gi` falls back to a system/gvsbuild
GTK. The heavy `gtk/` payload is **not committed** — it is built on a Windows CI
runner (`scripts/build-gtk-runtime.mjs`) and shipped via the package tarball /
staged into node-gi's `prebuilds/win32-x64/gtk/`.

## Layout

```
gtk/
  bin/                 GTK/GLib/cairo/pango/graphene/gdk-pixbuf DLLs (+ deps)
  girepository-1.0/    typelibs (GLib/GObject/Gio/cairo/Pango/Graphene/Gdk/…)
  manifest.json        counts + sizes + DLL list
```

Note the native code lives in **`gtk/bin`** (DLLs), not `gtk/lib` — on Windows the
loadable images and the import libraries (`.lib`, not shipped) live in different
dirs, and only the DLLs are needed at runtime.

## How it is built (no relocation — the crux)

`node scripts/build-gtk-runtime.mjs` runs on a Windows runner **with** a build-time
gvsbuild GTK4 stack extracted at `--prefix` (env `GTK_PREFIX`, the closure *source*,
not shipped):

1. **Collect** — enumerate `<prefix>/bin/*.dll` and, from the display-free seed DLLs
   the conformance loads (glib/gobject/gio/gmodule + girepository + cairo + pango +
   graphene + gdk-pixbuf + gtk4 + harfbuzz), walk the DLL import closure with
   `dumpbin /dependents` (recursively), keeping every dependency that is itself a
   gvsbuild DLL. System DLLs (`KERNEL32`, `msvcrt`, `api-ms-win-*`, …) never resolve
   to a file under `<prefix>/bin`, so the "keep only gvsbuild-resident deps" filter
   leaves them OS-provided. If dumpbin can't be located the script copies the whole
   `bin/*.dll` set (a complete superset).
2. **Copy** — the closure DLLs are copied **flat** into `gtk/bin`. **That is the whole
   job.** There is **no** `install_name_tool`/`@rpath`/`codesign` step: Windows
   resolves a DLL's imports by **search path** at `LoadLibrary` time, so a directory
   of DLLs is portable the moment it exists — no per-file rewriting, no re-signing.
3. **Typelibs** — copy the typelib set into `gtk/girepository-1.0`.

Contrast with macOS, where dyld bakes each dylib's dependency install-names, so the
darwin bundle must rewrite every reference to `@loader_path/<leaf>` and ad-hoc
re-sign. Windows needs none of that.

## How node-gi finds + activates it

`@gjsify/node-gi`'s loader (`gtk-runtime.js`) resolves the bundle from, in order:

1. `GJSIFY_GTK_RUNTIME` (explicit bundle dir),
2. node-gi's own `prebuilds/win32-x64/gtk/` (the CI/dev staging path),
3. the sibling monorepo dir `../gtk-runtime-win32-x64/gtk`,
4. `require.resolve('@gjsify/gtk-runtime-win32-x64')` (the published dep).

On a match (win32 only) node-gi makes the bundle genuinely **env-free**:

- **DLLs** — before the native addon is loaded, node-gi **prepends `gtk/bin` to
  `process.env.PATH`** (`maybePrependGtkRuntimeDllPath`, from `index.js`, run BEFORE
  the addon's `require`). Windows re-reads the DLL search path at **every**
  `LoadLibrary` call — unlike dyld, which captures `DYLD_FALLBACK_LIBRARY_PATH` only
  at process launch — so a plain in-process `process.env.PATH` mutation is enough:
  when node-gi's own `require(node_gi.node)` triggers the addon's DLL imports
  (`glib-2.0-0.dll`, `girepository-2.0-0.dll`, `cairo-2.dll`, …), the loader consults
  the just-updated `PATH` and finds them in the bundle. The **same** `PATH` entry also
  satisfies the runtime `g_module_open(<soname>)` lookups a typelib does for its
  non-addon-linked backers (Pango / Gdk / Graphene) — one mechanism covers both, so
  there is no DYLD-style dual path.
- **typelibs** — node-gi prepends `gtk/girepository-1.0` to the GIRepository search
  path via the native `prependSearchPath` (a runtime API, no env needed).

### Why no re-exec (unlike macOS)

The macOS bundle re-execs the process once with `DYLD_FALLBACK_LIBRARY_PATH` set,
because dyld reads that variable **only at launch** — a JS-time `process.env`
mutation cannot reach the running dyld. Windows has no such capture: the DLL search
consults the live `PATH` at each `LoadLibrary`, and the node-gi addon is loaded
**exclusively** by node-gi's own `require()` (in `loadNative()`), which runs *after*
the `PATH` prepend. So the addon's static DLL imports resolve against the bundle with
no re-exec and no native `AddDllDirectory` call (which would be chicken-and-egg —
the addon must already be loaded to call it). PATH-prepend before the `require` is
both sufficient and the simplest mechanism.

## Two closures: display-free (default) + full windowing (`--windowing`)

`build-gtk-runtime.mjs` builds one of two supersets into the same `gtk/` dir:

- **Default (display-free)** — the DLL closure + typelibs the display-free
  conformance needs. `manifest.windowing === false`. Unchanged.
- **`--windowing` (superset)** — everything above **plus** the runtime DATA a real
  GTK window needs on Windows, so a `Adw.ApplicationWindow` realizes + renders with
  no gvsbuild/system GTK:

  ```
  gtk/
    bin/                                  DLLs (+ the SVG/PNG image-loader backers)
    girepository-1.0/                     typelibs
    lib/gdk-pixbuf-2.0/2.10.0/loaders/    image decoder DLLs
    lib/gdk-pixbuf-2.0/2.10.0/loaders.cache   (rewritten bundle-relative)
    share/glib-2.0/schemas/gschemas.compiled  (glib-compile-schemas)
    share/icons/{Adwaita,hicolor}/        icon themes + icon-theme.cache
    etc/fonts/fonts.conf                  Fontconfig config (+ cache), when present
    manifest.json                         windowing:true + windowingData counts
  ```

  Built on the Windows runner:
  ```
  node scripts/build-gtk-runtime.mjs --windowing --prefix C:\gtk-build\gtk\x64\release --out gtk
  ```
  The GdkWin32 backend is compiled **into** `libgtk-4-*.dll` (GTK4 builds every
  backend in), so there is no separate backend DLL — the caches (`loaders.cache`,
  `gschemas.compiled`, `icon-theme.cache`) + the ANGLE/librsvg backers are the
  additions. gvsbuild ships the tools this step runs (`gdk-pixbuf-query-loaders`,
  `glib-compile-schemas`, `gtk4-update-icon-cache`, `fc-cache`) in `<prefix>/bin`.
  Each data step is defensive — a missing tree/tool WARNs and continues (the DLL +
  typelib bundle is always produced).

### How node-gi wires the windowing data

`@gjsify/node-gi`'s loader (`gtk-runtime.js` `maybeWireGtkWindowingEnv`, run at
module load beside the PATH-prepend) detects the windowing data via the
`gschemas.compiled` marker and sets — only when currently unset — the env vars that
locate it: `GSETTINGS_SCHEMA_DIR`, `GDK_PIXBUF_MODULEDIR` + `GDK_PIXBUF_MODULE_FILE`,
`XDG_DATA_DIRS` (prepends `<bundle>/share`) and, when bundled, `FONTCONFIG_PATH` +
`FONTCONFIG_FILE`. Windows re-reads these at first use (schema / loader / icon-theme
init runs after the addon loads), so the in-process mutation is sufficient — no
re-exec, the DLL-search analog. A **display-free** bundle carries no windowing data,
so the marker is absent and the wiring is a strict no-op: the display-free load is
byte-unchanged.

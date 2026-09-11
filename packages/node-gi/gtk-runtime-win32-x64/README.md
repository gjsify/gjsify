# @gjsify/gtk-runtime-win32-x64

Batteries-included GTK / GObject-Introspection runtime bundle for **Windows x64**.
It lets [`@gjsify/node-gi`](../node-gi) load `gi://` namespaces (GLib · GObject ·
Gio · cairo · Pango · Graphene · Gdk) with **no gvsbuild / system GTK** installed on
the host — the Windows sibling of `@gjsify/gtk-runtime-darwin-arm64`.

Platform-gated (`os: ["win32"]`, `cpu: ["x64"]`), tier 3 (experimental). On any
other platform npm skips it and `@gjsify/node-gi` falls back to a system/gvsbuild
GTK. The heavy `gtk/` payload is **not committed** — it is built on a Windows CI
runner (`scripts/build-gtk-runtime.mjs` in the gjsify repo) and shipped via the
package tarball / staged into node-gi's `prebuilds/win32-x64/gtk/`.

The tarball does **not** carry the builder (it imports shared rules from
`packages/node-gi/scripts/`, which only exist in the repo); `gtk/manifest.json`
records the script's repo path under `builder` so a consumer holding only the tarball
can find the recipe that produced its bytes — the same convention the darwin
siblings use.

## Layout

```
gtk/
  bin/                     GTK/GLib/cairo/pango/graphene/gdk-pixbuf DLLs (+ deps)
  girepository-1.0/        typelibs — ONLY those this bundle can back (see below)
  lib/ share/ etc/         --windowing only: pixbuf loaders, schemas, icons, fontconfig,
                           and share/fonts — the GNOME UI typeface (see below)
  licenses/                license texts from the gvsbuild prefix, plus vendored ones
  THIRD-PARTY-NOTICES.md   what is bundled, under which terms, and that it is unmodified
  manifest.json            counts + sizes + DLL list + symmetry/API-floor/license proof
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
3. **Typelibs** — copy into `gtk/girepository-1.0` **only the typelibs this bundle
   can back**. GI resolves a namespace's symbols with `g_module_open(<shared_library>)`
   out of the typelib's own header, so a typelib whose DLL is absent yields a namespace
   that resolves, advertises its classes and then dies in the constructor with
   `Failed to load shared library '…'`. Measured on the published 0.27.1 tarball: 3 of
   37 typelibs were in that state (`Adw-1`, `GtkSource-5`, `Rsvg-2.0`). The rule reads
   the mapping out of each typelib (never a name table — gvsbuild records
   `adwaita-1-0.dll` where brew records `libadwaita-1.0.dylib`), refuses to drop a
   typelib that a kept one DEPENDS on (that is a build failure naming the missing DLL,
   because `gi_repository_require` loads dependencies first), and re-verifies the
   finished bundle off disk against a floor of namespaces that must be present. Shared
   with the darwin builder: [`../scripts/typelib-backers.mjs`](../scripts/typelib-backers.mjs).

   **A backed typelib is not a callable one**, which is the hole that check cannot see.
   Measured on the published 0.50.0 tarballs, one symbol at a time out of each bundle's own
   `Adw-1.typelib`:

   | symbol | win32-x64 | darwin-arm64 | darwin-x64 |
   |---|---|---|---|
   | `adw_about_dialog_new` | present | present | present |
   | `adw_about_dialog_new_from_appdata` | **absent** | present | present |
   | `adw_about_dialog_get_appdata_resource_path` | **absent** | present | present |

   So on Windows an application whose About dialog is built from its own AppStream metainfo
   does not open at all — `no static method 'new_from_appdata'` — while symmetry, the data
   sets, the decode probe and the licence coverage were every one of them green. The cause is
   upstream and deliberate: gvsbuild applies
   `patches/libadwaita/0001-remove-appstream-dependency.patch`, which wraps every
   `*_from_appdata` entry point in `#ifndef G_OS_WIN32` and makes `appstream_dep` conditional
   on `target_system != 'windows'`. libadwaita 1.9.3 (what gvsbuild *and* Homebrew build)
   still parses AppStream through the heavy `appstream` library, for which gvsbuild defines no
   project; the small `ministream` replacement landed in libadwaita 1.10.alpha and gvsbuild
   already carries a `ministream` project for it. Homebrew's formula `depends_on "appstream"`,
   which is why darwin has the functions.

   Nothing here can compile that symbol, so what the builder enforces instead is that the hole
   cannot ship UNANNOUNCED: [`../scripts/typelib-symbols.mjs`](../scripts/typelib-symbols.mjs)
   holds an API floor per namespace, a missing entry point is a build failure unless a
   DECLARED gap names its upstream cause, the gap is recorded in `manifest.typelibApi.gaps`,
   and the gap EXPIRES — it is held against the committed gvsbuild patch snapshot, so the day
   upstream drops that patch the build reds and names the symbols to re-measure. A gap whose
   symbol turns out to be present fails too.
4. **Licenses** — copy the license corpus the gvsbuild prefix documents
   (`share/doc/<project>/COPYING|LICENSE`, `share/licenses/<project>/*`) into
   `gtk/licenses/` and write `gtk/THIRD-PARTY-NOTICES.md`, which lists every bundled
   DLL and states that the DLLs are byte-identical copies (no relocation on Windows).
   Per-DLL *terms* are deliberately NOT invented: the prefix is one flat build tree, so
   the notice says the DLL→project mapping is not recoverable from it.

   "The whole corpus ships" used to stand here and was measured false. Counted on a real
   artifact: 90 shipped binaries against 45 projects the prefix documents, leaving **14
   binaries whose project had no license text at all** — `glib` among them, five DLLs
   under LGPL-2.1-or-later, missing from every win32 tarball published before this. The
   coverage check only ran its per-binary rules under `attribution: "per-binary"`, and
   this bundle passes `prefix`, so it effectively asserted that *some* license text
   existed. A corpus of one file would have satisfied it.
   So every shipped binary is now named against a project (`WIN32_LICENSE_FAMILIES`, a
   NAME map — it carries no terms), coverage is enforced in both attribution modes, and
   texts the prefix does not install are vendored under `licenses-not-in-prefix/` with
   their provenance pinned to the gvsbuild version.

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
  conformance needs. `manifest.windowing === false`. This is the CONFORMANCE variant
  `node-gi.yml` builds.
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
    share/fonts/adwaita/*.ttf             Adwaita Sans + Adwaita Mono (OFL-1.1)
    manifest.json                         windowing:true + windowingData counts
                                          + decodeProbe (measured pixel sizes)
  ```

  **`etc/fonts` is the config; `share/fonts` is the typeface**, and until 0.50.0 only the
  first shipped. Measured on Windows 11 / GTK 4.22.4 with the published bundle: 82 font
  families on the map, `Cantarell` / `Adwaita Sans` / `Adwaita Mono` among none of them, and
  every request for one answered by Tahoma with `couldn't load font …, falling back to
  "Sans 11"` and exit 0. The only `.ttf` in any of the three published tarballs was
  GtkSourceView's own `BuilderBlocks.ttf`. So every Adwaita stylesheet rule naming the GNOME
  font, and every application that asks for one by name, silently drew in a foreign face.

  The faces come from the pinned `refs/adwaita-fonts` submodule rather than from the prefix —
  gvsbuild has no project for them, and a build-time download would put an unpinned artifact
  in a published tarball. The bundle jobs realize that ONE submodule (`--depth 1`); missing it
  is not silent, because `fonts` is a declared windowing-data set and an empty `share/fonts`
  fails the build.

  **Registration is a second step on this platform, not a path.** GTK4-on-Windows is
  pangowin32, whose font map is filled exclusively from the DirectWrite system collection: a
  `FONTCONFIG_FILE` naming a directory of faces moves it by ZERO families even when it is the
  only configuration present (measured both ways — ADR 0038 § W1-W5). So node-gi's loader
  publishes the directory as `GJSIFY_GTK_RUNTIME_FONT_DIR` and `@gjsify/gtk-host`'s
  `initFonts()` hands each face to `add_font_file`, which moves it by one. On darwin the same
  variable is a second route to files `XDG_DATA_DIRS` already reaches.

  **And the SIZE, which shipping faces does not fix.** GTK takes the system UI font from the
  shell, and Windows' is 9 pt where GNOME designs for 11. Measured as `ascent + descent` rather
  than in points — points are not comparable across platforms — that is **16.0 px against
  GNOME's 19.0**, i.e. 16 % small, which is the whole of "the font is a bit small". macOS
  measures 18.8 px and has no size problem at all, so the gap is Windows-alone.

  That is a POLICY, not a defect with one right answer, so `@gjsify/gtk-host` offers three
  states and the application picks (`UI_FONT_POLICIES`):

  | policy | `gtk-font-name` on Windows | for |
  |---|---|---|
  | `system` | `Segoe UI 9`, untouched | honouring the host exactly, size included |
  | `size` | `Segoe UI 11` | the host's face at the size Adwaita is drawn for |
  | `adwaita` | `Adwaita Sans 11` | a GNOME app that looks identical on every platform |

  **Nothing is applied unless asked for.** A runtime that rewrites a font setting nobody asked
  it to change is a surprise, and applying anything by default would also make `system`
  unreachable — the host's own value would be gone before a consumer could choose to keep it.
  `size` is the recommended value for an app shipping a bundled GTK; it is a recommendation in
  the documentation, not a default in the code.

  `initFonts()` captures `gtk-font-name` as the process first found it, which is what makes
  `system` reachable again after `adwaita`: once a value has been overwritten the host's own is
  not recoverable from GTK, from the display or from any schema.

  **The family name differs on this platform**, which `adwaita` resolves rather than assumes:
  `Adwaita Sans` is a variable font with an `opsz` axis whose value at 14 is named `Text`, so
  fontconfig reports `Adwaita Sans` and gvsbuild's DirectWrite reader reports `Adwaita Sans
  Text` — byte-identical file, two names. Writing the declared name here would ask for a family
  Windows does not have and Pango would substitute Tahoma silently. Found by CI, on the one
  platform it happens on.

  Built on the Windows runner:
  ```
  node scripts/build-gtk-runtime.mjs --windowing --prefix C:\gtk-build\gtk\x64\release --out gtk ^
    --addon <node_gi.node>
  ```
  `--addon` is required under `--windowing`: the builder DECODES a `.svg` and a `.png`
  through node-gi and the bundle's OWN loader (the bundled PNG when one ships, otherwise
  the decoded SVG saved to a temp PNG and read back) and records the measured sizes as
  `windowingData.decodeProbe`, which the release gate then requires. A file count is not
  a capability — the darwin sibling shipped 860 icon files of which zero decoded while
  every count was correct. The probe child runs with the host GTK env scrubbed and
  `<PREFIX>\bin` filtered off PATH, and the record states which GTK answered
  (`gtkSource` must be `bundle`), so a DLL missing from the bundle cannot be answered by
  the gvsbuild prefix this job puts on PATH. Nothing relocates the addon here; Windows
  resolves DLLs by search path.
  The GdkWin32 backend is compiled **into** `libgtk-4-*.dll` (GTK4 builds every
  backend in), so there is no separate backend DLL — the caches (`loaders.cache`,
  `gschemas.compiled`, `icon-theme.cache`) + the librsvg backer are the
  additions. The bundle carries `epoxy-0.dll` — GL *dispatch* — and **no GL
  *implementation***; the builder probes for one and records the answer as
  `manifest.glImplementation` (`--require-gl` makes an empty result fatal, for the
  promotion that ships one). On a host with a vendor OpenGL ICD that is invisible;
  on a GPU-less one (VM, RDP, CI) every `Gtk.GLArea` fails with `No GL
  implementation is available`. Measured on the win11-gjsify VM; tracked as #1097,
  with the reasoning in the webgl-on-win32 entry of `status/open-todos.md`.

  **Neither obvious way of closing it works as-is**, which is why the bundle still
  ships none — both measured on 0.34.0:
  - *ANGLE* (`libEGL`/`libGLESv2`) is what #1097 proposed, and gvsbuild ships none.
    But adding it would not have helped: this `epoxy-0.dll` is built with **no EGL
    support at all** (no `epoxy_has_egl` export, no `egl*` entry point), so
    `gdk_win32_display_get_egl_display()` can never engage. That needs libepoxy
    rebuilt with `-Degl=enabled` first.
  - *A desktop ICD in `bin/`* (Mesa's `opengl32.dll` + `libgallium_wgl.dll`) is
    inert by PLACEMENT: epoxy loads desktop GL with a bare
    `LoadLibraryA("OPENGL32")`, which Windows answers from the **application
    directory** and then **System32** — never from `PATH`, the only search the
    loader's bundle wiring controls. System32's inbox GL 1.1 wins and GTK4 rejects
    it. Reaching a bundled ICD needs the addon to opt the process into
    `SetDefaultDllDirectories` + `AddDllDirectory(<bundle>/bin)`.

  **The host-side answer works today** and needs no bundle change: register Mesa as
  a system OpenGL ICD (`mesa-dist-win`'s `systemwidedeploy.cmd 1` writes
  `HKLM\…\OpenGLDrivers\MSOGL` → `mesadrv.dll` and leaves the inbox `opengl32.dll`
  in place as the loader). Measured on the win11-gjsify VM: GDK then reports
  **OpenGL 4.6, non-legacy**, and `three-geometry-teapot` renders.

  gvsbuild ships the tools this step runs (`gdk-pixbuf-query-loaders`,
  `glib-compile-schemas`, `gtk4-update-icon-cache`, `fc-cache`) in `<prefix>/bin`.
  Each data step is defensive — a missing tree/tool WARNs and continues (the DLL +
  typelib bundle is always produced).

  **This is the variant that gets PUBLISHED** (since 0.27.2). Up to and including
  0.27.1 `release.yml` built the display-free variant, so the tarball on npm had
  `"windowing": false`, `"dataBytes": 0`, no pixbuf loaders, no compiled schemas, no
  icon themes — and `GtkSource-5.typelib` with no gtksourceview DLL behind it.

### How node-gi wires the windowing data

`@gjsify/node-gi`'s loader (`gtk-runtime.js` `maybeWireGtkWindowingEnv`, run at
module load beside the PATH-prepend) detects the windowing data via the
`gschemas.compiled` marker and sets — only when currently unset — the env vars that
locate it: `GSETTINGS_SCHEMA_DIR`, `GDK_PIXBUF_MODULEDIR` + `GDK_PIXBUF_MODULE_FILE`,
`XDG_DATA_DIRS` (prepends `<bundle>/share`), when bundled `FONTCONFIG_PATH` +
`FONTCONFIG_FILE`, and `GJSIFY_GTK_RUNTIME_FONT_DIR` at `<bundle>/share/fonts` — which is
a NAME rather than a mechanism: the loader runs before the addon and has no Pango to hand
a face to, so `@gjsify/gtk-host`'s `initFonts()` reads it and registers them.
Windows re-reads these at first use (schema / loader / icon-theme
init runs after the addon loads), so the in-process mutation is sufficient — no
re-exec, the DLL-search analog. A **display-free** bundle carries no windowing data,
so the marker is absent and the wiring is a strict no-op: the display-free load is
byte-unchanged.

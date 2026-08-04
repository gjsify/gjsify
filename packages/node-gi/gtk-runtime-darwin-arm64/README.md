# @gjsify/gtk-runtime-darwin-arm64

Batteries-included, **relocated** GTK / GObject-Introspection runtime bundle for
**macOS arm64**. It lets [`@gjsify/node-gi`](../node-gi) load `gi://` namespaces
(GLib · GObject · Gio · cairo · Pango · Graphene · Gdk) with **no Homebrew GTK**
installed on the host — Phase 2 of cross-platform node-gi.

Platform-gated (`os: ["darwin"]`, `cpu: ["arm64"]`), tier 3 (experimental). On any
other platform npm skips it and `@gjsify/node-gi` falls back to a system/Homebrew
GTK. The heavy `gtk/` payload is **not committed** — it is built on a macOS CI
runner ([`../scripts/build-gtk-runtime-darwin.mjs`](../scripts/build-gtk-runtime-darwin.mjs))
and shipped via the package tarball / staged into node-gi's
`prebuilds/darwin-arm64/gtk/`.

The Intel sibling [`@gjsify/gtk-runtime-darwin-x64`](../gtk-runtime-darwin-x64)
shares that ONE builder: nothing in the relocation pass is arch-dependent, so the
target is derived from the running Node (`darwin-${process.arch}`) and `--out` is
cross-checked against the destination package's own `os`/`cpu`. Neither package
ships a copy of the script; `gtk/manifest.json` records its repo path under
`builder` so a consumer holding only the tarball can find the recipe.

## Layout

```
gtk/
  lib/                     relocated dylibs (@loader_path-linked, ad-hoc re-signed)
  girepository-1.0/        typelibs — ONLY those this bundle can back (see below)
  share/                   --windowing only: GSettings schemas, icon themes, GtkSource data
  licenses/                license texts of the bundled libraries, per component
  THIRD-PARTY-NOTICES.md   what is bundled, under which terms, and how it was modified
  manifest.json            counts + sizes + dylib list + symmetry/license proof
```

## How it is built (the relocation, the crux)

`node ../scripts/build-gtk-runtime-darwin.mjs` runs on a macOS runner **with** a
build-time Homebrew GTK stack (the closure *source*, not shipped):

1. **Collect** — walk the dylib graph with `otool -L`, recursively, from the
   typelib-backing libraries the display-free conformance loads
   (glib/gobject/gio + girepository + cairo + pango + graphene + gdk-pixbuf +
   gtk4). Everything under `$(brew --prefix)/lib` is copied flat into `gtk/lib`;
   `/usr/lib` + `/System` libraries are left as OS-provided.
2. **Relocate** — for each bundled dylib, rewrite its own id **and** every
   sibling reference to `@loader_path/<leaf>` with `install_name_tool`, then
   **ad-hoc re-sign** it (`codesign --force --sign -`). Re-signing is mandatory
   on Apple silicon: `install_name_tool` invalidates the code signature and dyld
   refuses to load a mis-signed dylib. On Intel the signature is not enforced, but
   re-signing keeps ONE code path.
3. **Verify** — re-read every relocated image and fail on any absolute reference to
   a library the bundle *does* carry. The predicate is `$(brew --prefix)`-**derived**,
   not the literal `/opt/homebrew`: that literal is vacuously absent on an Intel
   runner (prefix `/usr/local`), so a hardcoded grep would have passed while proving
   nothing. OS-provided libraries the bundle deliberately leaves alone are reported,
   never failed.
4. **Typelibs** — copy into `gtk/girepository-1.0` **only the typelibs this bundle
   can back**, and then prove it. Details in
   [Typelib symmetry](#typelib-symmetry--a-typelib-without-its-library-is-worse-than-none)
   below; the rule lives in
   [`../scripts/typelib-backers.mjs`](../scripts/typelib-backers.mjs) and is shared
   with the win32 builder.
5. **Licenses** — attribute every bundled dylib to the Homebrew keg it came from
   (`…/Cellar/<formula>/<version>/`), read that keg's own license terms, and write
   `gtk/licenses/` + `gtk/THIRD-PARTY-NOTICES.md` including the statement that the
   binaries were relocated and re-signed. An unattributable dylib fails the build.
6. **Addon (optional, `--addon`)** — relocate a *copy* of the node-gi addon
   (`node_gi.node`): rewrite its Homebrew-prefix refs to `@rpath/<leaf>` and add
   `@loader_path/gtk/lib` as an rpath, so the addon loads the **bundled**
   `libgirepository` with no Homebrew. This is the env-free path, and it gets the
   same verification as the dylibs.

## How node-gi finds it

`@gjsify/node-gi`'s loader (`gtk-runtime.js`) resolves the bundle from, in order:

1. `GJSIFY_GTK_RUNTIME` (explicit bundle dir),
2. node-gi's own `prebuilds/<platform>-<arch>/gtk/` (the CI/dev staging path),
3. the sibling monorepo dir `../gtk-runtime-<platform>-<arch>/gtk`,
4. `require.resolve('@gjsify/gtk-runtime-<platform>-<arch>')` (the published dep).

On a match (darwin only) node-gi makes the bundle genuinely **env-free**:

- **typelibs** — it prepends `gtk/girepository-1.0` to the GIRepository search
  path via `prependSearchPath` (a runtime API, no env needed).
- **dylibs** — on **Node** it **re-execs the process once**
  (`maybeReexecForGtkRuntime`, from `index.js`, before the addon loads) with
  `DYLD_FALLBACK_LIBRARY_PATH=gtk/lib`. (Bun/Deno skip the re-exec — their
  `argv`/`execArgv` differ; they still get the env-free typelibs above, and their
  DYLD path for the non-addon-linked backers is a follow-up.)
  dyld only reads that variable at **launch**, so a JS-time `process.env` mutation
  cannot help the running process — but a one-shot re-exec (guarded by a
  `GJSIFY_GTK_REEXEC` sentinel so it fires at most once) lands the fallback for the
  fresh dyld. GObject-Introspection then resolves every type's `get_type()` and the
  Pango/Gdk/Graphene backers by leaf soname from the bundle. This is exactly what
  the Homebrew-based CI leg relies on, so it is a known-good path.

The re-exec is a no-op off darwin, without a bundle, or once the fallback already
covers the bundle — so it costs one extra `exec` only on the first macOS load of a
batteries-included install, and nothing elsewhere.

## Release flow — how the `gtk/` bundle reaches npm

The `gtk/` payload is gitignored and built ONLY on macOS, so it cannot be produced
by the main (ubuntu) release publish. A dedicated macOS job in
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml) —
`publish-gtk-runtime-darwin`, a two-leg matrix over `arm64` (`macos-latest`) and
`x64` (`macos-15-intel`) — owns both darwin packages' publish end to end:

1. On `release: published` it checks out the tag (the version `@release-it/bumper`
   already bumped in this package's `package.json`, in lockstep with the train).
2. `brew install`s the GTK/GI stack as the build-time closure **source**.
3. Runs `../scripts/build-gtk-runtime-darwin.mjs --windowing --out gtk` to populate
   `gtk/` (relocated dylibs + backed typelibs + runtime data + licenses +
   `manifest.json`). The script itself fails on a surviving Homebrew-prefix reference,
   on an unbacked typelib and on an unattributable dylib; the job then asserts what the
   ARTIFACT must contain: `gtk/lib` + `gtk/girepository-1.0` (the two dirs
   [`index.js`](./index.js)'s `isPresent` gate checks), `Adw-1.typelib` beside a
   libadwaita dylib, `gschemas.compiled`, `share/icons`, `THIRD-PARTY-NOTICES.md`, and
   a manifest that says `windowing: true` with non-zero `dataBytes`.
4. OIDC-publishes **only this package** (Trusted Publisher configured for
   `release.yml`), so `files: ["gtk"]` ships the whole bundle recursively (the
   gjsify packer expands a plain-directory `files` entry). Consumers then see
   `isPresent === true` and get the "no Homebrew needed" path.

The main ubuntu publish job never touches this package — `packages/node-gi/*` is
not a root workspace, so `gjsify foreach` (its enumerator) never sees it. That is
also why the first bare `0.19.0` was an empty ~18 KB shell: nothing built `gtk/`
before publish. This job is the fix; the addon-relocation `--addon`/`--stage`
flags of the build script are a *separate* node-gi concern (see
[`node-gi.yml`](../../../.github/workflows/node-gi.yml) → `macos-gtk-runtime`) and
are **not** part of this tarball.

This was the PATTERN the two siblings now follow:
[`@gjsify/gtk-runtime-win32-x64`](../gtk-runtime-win32-x64) has its own
`windows-latest` publish job (gvsbuild closure source, no relocation step — Windows
resolves DLLs by search path), and
[`@gjsify/gtk-runtime-darwin-x64`](../gtk-runtime-darwin-x64) is a second leg of
*this* job, since it shares this package's builder outright.

## Typelib symmetry — a typelib without its library is worse than none

GObject-Introspection resolves a namespace's symbols with
`g_module_open(<shared_library>)`, where `shared_library` is a field in the typelib's
own header. So a bundle that ships a typelib whose library it does not carry produces
a namespace that **resolves**, advertises its classes, and then dies in the
constructor with `Failed to load shared library '…'`. Measured on the published
0.27.1 darwin tarballs: 6 of 38 typelibs were in that state, `Adw-1` among them.

The builder therefore ships **exactly the typelibs it can back**:

- the typelib→library mapping is read from each typelib's header, never from a table
  (brew records `libadwaita-1.0.dylib`, gvsbuild records `adwaita-1-0.dll` — a table
  would have to track both);
- an unbacked typelib is dropped — **unless a typelib we keep depends on it**, which
  is a hard build failure naming the missing library. `Pango-1.0` depends on
  `HarfBuzz-0.0`, so dropping HarfBuzz would break Pango, Gdk, Gsk and Gtk; the
  repair is to bundle `libharfbuzz-gobject`, which the base seeds now do;
- the finished bundle is re-read off disk and must satisfy the rule again, must
  contain at least one library-backed typelib, and must contain every namespace the
  package promises (plus `Adw` + `GtkSource` for `--windowing`) — so a filter that
  quietly removed everything cannot pass.

`manifest.json` records the outcome under `typelibSymmetry` (backed / header-only
counts, and every dropped namespace with the library it wanted).

## Scope — what the published bundle contains, and what is still missing

Since 0.27.2 the **published** tarball is the `--windowing` superset: the relocated
dylib closure *plus* compiled GSettings schemas (`gschemas.compiled` — a hard startup
blocker for `Gio.Settings` without it), the Adwaita + hicolor icon themes, and
GtkSource's language-specs/styles. The display-free default remains the
**conformance** variant `node-gi.yml` builds, whose closure is exactly what the
display-free conformance loads.

The data is copied with `dereference: true` and the build FAILS on any symlink under
`share/`: Homebrew links a keg's tree into its prefix, so the default copy reproduced
the link farm — `share/icons/Adwaita` was a link into `…/Cellar/adwaita-icon-theme/…`,
0.2 MiB of links where the theme is 22 MB of files, and `npm pack` would have shipped
the dangling link.

Still not collected: the `gdk-pixbuf` loader modules + `loaders.cache` (they are
dylibs needing `@loader_path` relocation from a nested dir, unlike win32's flat DLL
copy), so SVG symbolic icons can render blank; and Fontconfig config/cache, which
macOS text rendering does not need (Pango uses the CoreText backend). Both are
tracked in `status/open-todos.md`.

**Env-free mechanism (macOS):** because dyld captures
`DYLD_FALLBACK_LIBRARY_PATH` only at launch, node-gi re-execs once with it set (see
above) rather than relying on the caller to export it. This covers **all** the
display-free namespaces uniformly — both the addon-linked core
(GLib/GObject/Gio/cairo) and the non-addon-linked backers (Pango/Graphene/Gdk),
including the `get_type()` leaf lookups that `registerClass` subclassing needs. A
native `dlopen`-preload at addon load would avoid even the single re-exec, but it
would require changing the node-gi addon; the re-exec keeps the consumed addon
prebuild untouched.

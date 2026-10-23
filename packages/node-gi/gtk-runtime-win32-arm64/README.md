# @gjsify/gtk-runtime-win32-arm64

Batteries-included GTK / GObject-Introspection runtime bundle for **Windows arm64**.
It lets [`@gjsify/node-gi`](../node-gi) load `gi://` namespaces (GLib · GObject ·
Gio · cairo · Pango · Graphene · Gdk) with **no gvsbuild / system GTK** installed on
the host — the arm64 sibling of [`@gjsify/gtk-runtime-win32-x64`](../gtk-runtime-win32-x64).

Platform-gated (`os: ["win32"]`, `cpu: ["arm64"]`), tier 3 (experimental). On any
other platform npm skips it and `@gjsify/node-gi` falls back to a system/gvsbuild
GTK. The heavy `gtk/` payload is **not committed** — it is built on a
`windows-11-arm` CI runner and shipped via the package tarball / staged into
node-gi's `prebuilds/win32-arm64/gtk/`.

## Where the arm64 prefix comes from — there is no upstream ZIP

`wingtk/gvsbuild` hardcodes `self.platform = "x64"` and publishes only an x64
release ZIP, so unlike the x64 sibling there is nothing to download here. The
prefix is **built from source** in CI by our MSVC fork, `gjsify/gvsbuild`
(`.github/actions/gvsbuild-arm64-prefix`, pinned by commit SHA and cached), the
whole route recorded in
[ADR 0089](../../../docs/adr/0089-win32-arm64-gtk-is-built-from-source-by-our-msvc-gvsbuild-fork.md).
MSVC end to end, never MSYS2/`CLANGARM64`, so the x64 addon recipe
(`binding.gyp`, `win-gi-gyp-flags.mjs`) and this package's builder transfer
unchanged — only the `--prefix` path and the toolset (`vcvarsarm64`) differ.
Exit: when upstream gvsbuild ships an arm64 target, this switches to the
version pin and the fork is retired.

**Still out of scope on arm64 today** (ADR 0089, `status/open-todos/windows.md`
§ win32-arm64): the two-pass gst-plugins-good build for `gstsoup.dll` /
`souphttpsrc` (an arm64 bundle therefore has no http(s) media source yet), plus
webgl (`gwebgl.dll`), gamepad and WebView2 — none of those are built against
the arm64 prefix yet.

## The builder is shared with the x64 sibling

`packages/node-gi/scripts/build-gtk-runtime-win32.mjs` serves both win32
targets — the DLL closure walk (`dumpbin`), the typelib set, the `--windowing`
superset and the license corpus are arch-agnostic; the only arch-dependent
inputs are `--prefix` (the gvsbuild zip extraction on x64, the fork-built
prefix at `C:\gtk-build\gtk\ARM64\release` on arm64) and the MSVC toolset
(`vcvarsarm64.bat`). See that script and
[`@gjsify/gtk-runtime-win32-x64`'s README](../gtk-runtime-win32-x64/README.md)
for the full build/layout/loader documentation — it applies here unchanged,
down to the DLL layout (`gtk/bin`, not `gtk/lib`), the `--windowing` superset,
the typelib-API floor and the license-coverage gate. Built on the Windows-on-ARM
runner:

```
node ..\scripts\build-gtk-runtime-win32.mjs --windowing --prefix C:\gtk-build\gtk\ARM64\release --out gtk ^
  --addon <node_gi.node built for arm64>
```

## How node-gi finds + activates it

Identical to the x64 sibling: node-gi's loader (`gtk-runtime.js`) resolves
`@gjsify/gtk-runtime-win32-arm64` by name (and the usual override/dev-sibling
candidates), prepends `gtk/bin` to `PATH` before the addon loads, and prepends
`gtk/girepository-1.0` to the GIRepository search path — no relocation, no
re-exec, the same mechanism the x64 README documents in full.

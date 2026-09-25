<!-- Authored Open-TODO sections — area: Windows / win32.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### The win32 bundle cannot build `Adw.AboutDialog.new_from_appdata`, and the repair is upstream

Measured on the published 0.50.0 tarballs, symbol by symbol out of each bundle's own
`Adw-1.typelib`: `adw_about_dialog_new_from_appdata` and
`adw_about_dialog_get_appdata_resource_path` are PRESENT in both darwin bundles and ABSENT in
win32-x64. On Windows 11 that is `no static method 'new_from_appdata'`, and the About dialog of
an application built from its own AppStream metainfo does not open.

The cause is gvsbuild's `patches/libadwaita/0001-remove-appstream-dependency.patch`, which wraps
every `*_from_appdata` entry point in `#ifndef G_OS_WIN32` and makes `appstream_dep` conditional
on `target_system != 'windows'`. It is still applied on gvsbuild `main` at libadwaita 1.9.3.
Homebrew's formula `depends_on "appstream"`, which is the whole of the asymmetry.

Nothing in this repository can compile that symbol, so what landed is the ratchet:
`typelib-symbols.mjs` fails the build on a missing floor entry point unless a DECLARED gap names
its upstream cause, and the gap is held against the committed gvsbuild patch snapshot.

**When that expiry fires, precisely.** The snapshot is committed and nothing refreshes it on its
own; `gvsbuild-catalogue.mjs --update` is run by a person. The forcing function is indirect and
real: the `gvsbuild-catalogue` conformance rule fails whenever a workflow's `GVSBUILD_VERSION`
disagrees with the snapshot's, so **raising the pin compels the re-read, and the re-read is what
makes a dropped patch visible** — and raising the pin is the only way a newer gvsbuild ever builds
these bundles. Between two bumps, a patch upstream has already deleted is a gap nothing here can
yet see. That is correct for the bytes being built — the pinned gvsbuild still applies it — but it
is not "the gap expires by itself", and the loose sentence is the kind that gets quoted back as
evidence. If this gap survives several pin bumps, the direct expiry is a scheduled
`gvsbuild-catalogue.mjs --update` that opens a PR on a diff; it is deliberately NOT here today,
because a cron nobody reads is the same blind spot one level up.

What is still OPEN is the fix itself, and there are exactly two routes:

- **libadwaita >= 1.10 + `ministream` in the Windows prefix.** `ministream` replaced the
  `appstream` dependency in libadwaita at 1.10.alpha (commit `7352d8c8`) and gvsbuild already
  carries a `ministream` project — it is there for exactly this. gvsbuild's own `libadwaita`
  recipe is still pinned to 1.9.3 and still patched, so taking this route today means building
  libadwaita outside that recipe on the Windows runner. 1.10 is beta, and it would reach every
  consumer of the bundle at once.
- **gvsbuild drops the patch**, which is the same event from the other side and needs no change
  here beyond bumping `GVSBUILD_VERSION`, re-reading the snapshot and deleting the gap entry.

Until one of them happens, a Windows application that wants an About dialog fills
`Adw.AboutDialog` itself. The dialog is fully constructible; only the metainfo-parsing
constructor is gone — and since #1670 no application has to write that filling twice:
`createAboutDialog()` in `@gjsify/adwaita-app` tries the constructor and falls back to a
GI-free metainfo parse (a port of the `ministream` selection rules the first route above
names), so ONE call is correct on all three operating systems. The gap declaration stays:
the symbol is still absent from the win32 typelib, and that is what the ratchet holds.

### `win32-arm64` is blocked UPSTREAM, not on effort — measured

Asked directly after the `win32-x64` promotion landed, on the reasonable
assumption that a second Windows arch is the same change with one token
swapped. It is not, and the blocker is one project we do not own.

**gvsbuild has no arm64 target.** Measured 2026-08-11 against
`wingtk/gvsbuild`: the last five releases (`2026.3.0` … `2026.8.0`, the newest)
publish exactly two assets each — `GTK3_Gvsbuild_<v>_x64.zip` and
`GTK4_Gvsbuild_<v>_x64.zip` — and `gvsbuild/utils/base_project.py` hardcodes
`self.platform = "x64"`. There is no arm64 ZIP to download and no `--platform`
to ask for one. The 14 issues matching `arm64` in that repository are all
dependabot noise; nobody is asking for it there either.

Everything Windows in this repository stands on that ZIP, so the consequence is
not "webgl needs a leg":

- there is no GTK4/GLib/gdk-pixbuf/**epoxy** to compile `gwebgl.dll` against, and
  no `.pc` files for meson to resolve;
- there is no `g-ir-compiler.exe` to turn valac's GIR into a typelib;
- there is nothing to build `@gjsify/gtk-runtime-win32-arm64` OUT OF — and on
  Windows that bundle is the only GTK there is, so even a hypothetical artifact
  would have nothing to load next to;
- `@gjsify/node-gi` declares `win32-x64` only, so `gi://` does not resolve on
  Windows/ARM at all, with or without webgl.

**Do NOT add the token to unblock work.** `win32-arm64` is a valid
`PLATFORM_RE` token, so it would go in cleanly and then fail
`audit-runtimes --check` in the direction that reads "declares `win32-arm64`
but no CI job produces that target" — correctly, and that failure is the guard
working. An exploratory dispatch-only leg is the sanctioned way to prove a new
target first, but one CANNOT be written here: its first step downloads a ZIP
that does not exist, so it would be red by construction, which is worse than
absent (the `--require-gl` note above is the same shape).

**The one known route, and why it is a DECISION rather than a leg.** MSYS2 ships
a `CLANGARM64` environment with mingw-w64 GTK4, which is the only Windows/ARM
GTK anyone builds today. Taking it means the whole stack goes MinGW — GTK,
`gwebgl.dll` AND the node-gyp addon — because a MinGW DLL against MSVC-ABI GLib
mixes CRTs while GLib routinely allocates what the consumer frees. That is the
ABI hazard `prebuilds.yml`'s win32 header and `napi.yml`'s `windows` job both
record, and it is the reason the x64 leg is MSVC end to end. So a Windows/ARM
port is not this pair plus a runner label; it is a second, parallel toolchain
for one architecture, and it starts at `@gjsify/node-gi`, not at webgl.

Revisit when gvsbuild publishes an arm64 ZIP — at that point the split-build
shape transfers unchanged, since nothing in it is arch-specific: the Linux half
emits arch-independent C + GIR, and the Windows half needs only a
`windows-11-arm` runner and an arm64 prefix. Tracked as #1117.


### win32 `Adw.init()` — measured NOT to fault; two narrower gaps remain

#997's second finding (an `0xC0000005` access violation in `Adw.init()` on
win32) did not reproduce. Measured on the win11-gjsify VM with the published
`@gjsify/node-gi` 0.30.0 prebuild plus `@gjsify/gtk-runtime-win32-x64`, on a
host where `checkMsvcRuntime()` reports the Visual C++ runtime PRESENT: GLib
2.88.1 resolves, `Gtk.init()` returns, `Adw.init()` returns, exit 0. Per the
issue's own decisive test that makes it a DUPLICATE of the first finding — the
undeclared MSVC prerequisite, surfacing at first real use rather than at load.
Full write-up, including the session characterisation, is in ADR 0018.

What is NOT closed by that run, stated so neither reads as covered:

- **Session 0.** The probe was non-interactive (`isTTY` false on both ends,
  stdin on the null device — the condition the original report named) but ran in
  the interactive user session (`SESSIONNAME=Console`). A service / session-0
  context is the one place the original symptom could still live, and it is also
  what some CI agents look like.
- **The GTK bundle did not arrive with `npm install @gjsify/node-gi`.** The
  install script reported *"using the shipped prebuild for win32-x64"* and
  nothing else; `@gjsify/gtk-runtime-win32-x64` (78 MB) had to be installed
  EXPLICITLY before any namespace would resolve. That may be npm 11 declining to
  run install scripts by default (`npm warn allow-scripts`, which did fire here
  and forced the script to be run by hand) rather than a gap in the package —
  the two are not separable from this one observation. Worth one deliberate
  measurement on a clean host with scripts approved, because "install node-gi and
  it works" is what the win32 story currently promises.


### win32 MP3 through the OS decoder: the upstream library route is still open

MP3 now decodes on win32 through `mfmp3dec`, gst-plugins-bad's wrapper of the decoder
Windows ships (ADR 0056 § 7), and a live Icecast stream decodes on every bundle now that
`icydemux` and `id3demux` ship. Three things stay open.

**Media Foundation is an OS component.** Windows N without the Media Feature Pack has no
`mfplat.dll`; there the plugin does not load and MP3 is a gap again, and nothing in the
bundle can detect that ahead of time. Not measured on such a host. On the Server 2025
runner the DLLs were present before the optional feature was installed.

**The library route, as an upstream change, is now filed.** A `libmpg123` project in
`wingtk/gvsbuild` would let win32 use `mpg123audiodec`, like darwin, and drop the OS
dependency. Read at the pinned `2026.6.0` and at `2026.8.0`: no `mpg123` or `flac` module;
gvsbuild's ffmpeg has no mp3 decoder; gst-plugins-rs 0.15.2 has none; gst-plugins-ugly 1.28.4
dropped `mad`. **Filed**: [wingtk/gvsbuild#1849](https://github.com/wingtk/gvsbuild/pull/1849),
out of the `add-mpg123` branch of our `gjsify/gvsbuild` fork, adds `libmpg123` in exactly that
shape and makes `gst-plugins-good` depend on it — the standing task that PR creates is tracked
in `status/upstream-patch-candidates.md`. Until it merges and a pin bump picks it up, the
`mpg123` gap keeps its `upstream` bound, so the catalogue rule reds the day the project exists.

**FLAC is a price, not a wall, and the price is not paid.** `claxon` in gst-plugins-rs is a
pure-Rust FLAC decoder and gvsbuild already defines that tree (`gst-plugin-gtk4`). Taking it
means cargo-c plus gtk4 rebuilt from source (gst-plugins-bad is already built there now, for
mediafoundation) on the leg whose GStreamer
build already runs under a 150-minute timeout. ADR 0056 § Alternatives rejected carries the
reasoning; revisit when a consumer measures FLAC, or when a Rust toolchain lands in that
prefix for another reason.

**The blind spot the new rule does NOT close.** `gvsbuild-catalogue` re-asks "does upstream
have this library" whenever `GVSBUILD_VERSION` moves, because the snapshot and the pin must
agree. While the pin sits still, an upstream addition is invisible — deliberately: a project
we are not pinned to cannot be built anyway, so the finding would be noise until the bump.
The cost is latency, and the bump is where it is paid. A scheduled job polling the catalogue
would remove that latency and add a network dependency plus a job that can go red for
something no PR caused; not obviously worth it, and worth revisiting only if a pin ever sits
still long enough for the latency to matter.



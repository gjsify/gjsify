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

### `win32-arm64` is no longer blocked upstream — the route is our MSVC gvsbuild fork

The 2026-08-11 measurement still holds: `wingtk/gvsbuild` hardcodes `self.platform = "x64"` and
publishes no arm64 ZIP (#1117). What changed is that we stopped waiting. Route and reasons:
[ADR 0088](../../docs/adr/0088-win32-arm64-gtk-is-built-from-source-by-our-msvc-gvsbuild-fork.md)
— GTK is built from source by `gjsify/gvsbuild` (PR #1, `feat/arm64-platform`), MSVC end to end,
not MinGW/`CLANGARM64`, so the x64 addon recipe transfers unchanged.

Measured 2026-10-02: the fork's `Build GTK4 Binaries (ARM64)` is green on `windows-11-arm`
(MSVC 14.51, 1 h 32 min cold), and `@gjsify/node-gi` builds natively against that prefix and
passes node-gi's Windows CI set.

**Do NOT add the token early.** `win32-arm64` enters `gjsify.platforms` only in the PR that adds
the CI leg producing it; otherwise `audit-runtimes --check` fails, correctly. Remaining work, in
order:

1. Merge gjsify/gvsbuild#1 and pin its commit SHA on the fork's default branch, never a feature
   branch head.
2. A `windows-11-arm` leg in `node-gi.yml` and `napi.yml` that builds the prefix from the fork
   (`pipx install git+https://github.com/gjsify/gvsbuild@<sha>`, `actions/cache` with an arm64
   key, path `C:\gtk-build\gtk\ARM64\release`) — and `win32-arm64` in node-gi's
   `gjsify.platforms` in that same PR.
3. `@gjsify/gtk-runtime-win32-arm64`, a new package. Touch points:
   `packages/node-gi/gtk-runtime-win32-x64/scripts/build-gtk-runtime.mjs` (hard-fails unless
   win32/x64, `:127`), the `publish-gtk-runtime-win32-x64` job in `release.yml` (`:532`),
   `GTK_RUNTIME_TARGETS` (`packages/infra/cli/src/utils/ship/app-runtime.ts:100`),
   `NODE_RUNTIME_TARGETS` (`ship/node-runtime.ts:49`), `Layout.arches` in `ship/layout.ts`
   (`:658-670`, the "blocked upstream" refusal), `commands/showcase.ts:311`,
   `RUNNER_DEFAULT_ARCH` (`scripts/manifest-conformance/rules/platforms-ci.mjs:47`),
   `scripts/check-shipped-runtime-packages.mjs`, the `GVSBUILD_VERSION` pin-agreement test
   (`packages/node-gi/node-gi/test/gtk-runtime-bundle-gates.test.mjs:1036` — arm64 pins a SHA,
   not a version), and the gvsbuild catalogue the gap checks read
   (`packages/node-gi/scripts/gvsbuild-catalogue.mjs`). The "blocked upstream" wording in
   `docs/ship-formats.md:192`, ADR 0024 `:540` and the layout refusal text goes with it.
4. The two-pass gst-plugins-good build for `gstsoup.dll` / `souphttpsrc` on arm64 (ADR 0037).
5. Later: webgl (`gwebgl.dll` against the arm64 prefix), gamepad, webview2.

Exit: when upstream gvsbuild ships arm64, switch arm64 to the version pin and retire the fork.

### `Graphene.Box` is opaque on every Windows target

`Vec3`/`Vec4` carry `opaque="1"` in the gvsbuild GIR, so `Graphene.Box` cannot be constructed
from GJS or node-gi on Windows. The typelib is byte-identical on x64 and arm64: a shared gap
of the gvsbuild build, not an arm64 one, and not a reason to hold arm64.


### win32 `Adw.init()` DOES fault on a non-interactive window station — and the bug is GDK's

#997's second finding (an `0xC0000005` access violation in `Adw.init()` on win32) is
REAL. It is not libadwaita's, not the MSVC prerequisite, and not node-gi's: it is one
unguarded pointer chase in GDK/Win32, reachable from any GTK4 application on a
window station where the Text Services Framework cannot be instantiated. Measured
2026-09-30 on the win11-gjsify VM (Windows 11 Pro 25H2, Node 24.18.1, published
`@gjsify/node-gi` 0.52.0 + `@gjsify/gtk-runtime-win32-x64` 0.52.0, GTK 4.22.4,
libadwaita 1.9.1, VC++ redistributable PRESENT):

| context | session | window station | outcome |
|---|---|---|---|
| `ssh` shell as the normal user | 0 | `Service-0x0-<luid>$` | **0xC0000005 in `Adw.init()`**, 4/4 |
| `schtasks` S4U, same user | 0 | `Service-0x0-<luid>$` | **0xC0000005** |
| `schtasks` as `SYSTEM` | 0 | `Service-0x0-3e7$` | exit 0 |
| `schtasks` `-LogonType Interactive` | 1 | `WinSta0` | exit 0 |

**The faulting frame**, from `cdb` (`Microsoft.WinDbg`, winget). The bundle ships no
PDBs, so every frame names the nearest preceding EXPORT, not the real function:

```
gtk_4_1!gdk_win32_surface_set_urgency_hint+0x3472   test byte ptr [rax+0Ch],1   rax=0
gtk_4_1!gtk_settings_reset_property+0xebc
gtk_4_1!gtk_settings_get_for_display+0x2cf
ffi_8!ffi_call → girepository_2_0_0!gi_function_info_invoke → node_gi
```

`adw_init()` is only the messenger — it reaches that frame through
`adw_style_manager_ensure()` → `register_display()` → `adw_style_manager_constructed()`
→ `gtk_settings_get_for_display()`. A probe calling `Gtk.Settings.get_for_display()`
directly, with libadwaita never loaded, faults identically. `Gtk.init()` itself returns:
it opens the display but creates no `GtkSettings`.

**Root cause.** `gdk_win32_display_get_setting()` answers `gtk-im-module` with

```c
GDK_WIN32_DISPLAY (display)->input_locale_items->notification_sink->input_locale_is_ime ? "ime" : ""
```

— `gdk/win32/gdkwin32misc.c:393` at 4.22.4, byte-identical on `main` at 4.23.2, and no
NULL guard anywhere on the chase. `notification_sink` stays NULL whenever
`gdk_win32_display_lang_notification_init()` takes one of its three early returns, and
the first is `CoCreateInstance(CLSID_TF_ThreadMgr)` failing. Measured directly on the
same machine, same minute, from the same two contexts: that call returns **`E_FAIL`
(0x80004005)** on the SSH user's `Service-0x0-2d6a70$` and **`S_OK`** on SYSTEM's
`Service-0x0-3e7$`. TSF's thread manager cannot be created on a per-logon *service*
window station. `input_locale_is_ime` is the bitfield at offset 0x0C — the `rax+0Ch`
read above, with `rax` zero.

A REGRESSION with a date: GTK **4.17.0**, commit `28aacf3db4` ("GDK/Win32: Drop input
locale global variables", 2024-08-20), replaced the static `_gdk_input_locale_is_ime` —
a global that cannot be NULL — with that two-level chase and added no guard. Every
release since carries it.

**`GDK_DEBUG=default-settings` is a measured workaround.** The first two lines of
`gdk_win32_display_get_setting()` return FALSE under that flag, so the `gtk-im-module`
branch is never reached. With it, the same probe in the same SSH session runs
`Adw.init()` to completion, constructs a `Gtk.Window` and exits 0. The price is GTK's
own default settings instead of Windows' font, double-click and theme values — which
costs nothing in a context where no window can be shown to anybody anyway.

**Nothing lands in this repository, on purpose.** The fix belongs in GDK (filed as a
row in `status/upstream-patch-candidates.md`). Setting the flag from node-gi's
windowing loader would have to KNOW it is in such a context before `gdk_display_open()`
reads the debug flags, and the only precise discriminator is the TSF probe itself — a
win32-only COM call added to the addon for a bug we do not own. The window-station NAME
is reachable by the same native route and is NOT precise: SYSTEM's `Service-0x0-3e7$`
is every bit as non-interactive and works. If this ever reaches a gjsify CI leg, that
native probe plus an auto-set `GDK_DEBUG=default-settings` is the shape to build; until
then the flag is documented and upstream carries the fix.

### `npm install @gjsify/node-gi` never brings the GTK bundle — and npm 11 is not the reason

Measured 2026-09-30 on a clean directory with node-gi 0.52.0, which separates what one
earlier observation could not. After `npm install @gjsify/node-gi` **and** after running
`node_modules/@gjsify/node-gi/scripts/install.mjs` by hand — i.e. with npm 11's
`allow-scripts` gate taken out of the picture — `node_modules/@gjsify` holds exactly one
entry: `node-gi`. The install script does not fetch a runtime bundle and is not supposed
to: node-gi declares no `optionalDependencies`, which ADR 0023 makes deliberate, because
whoever ships the application picks the runtime.

So the promise "install node-gi and it works" is kept by a DIAGNOSTIC, not by a
dependency, and that diagnostic fires at the first `requireGi`: the addon itself loads,
its GI dependency closure does not, and `describeAddonLoadFailure()` names
`npm install @gjsify/gtk-runtime-win32-x64`, the `GJSIFY_GTK_RUNTIME` override and the
VC++ redistributable. Working as designed; nothing open here beyond keeping that message
accurate.


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



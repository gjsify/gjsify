# GTK's Android backend on an emulator — 2026-10-09

A first look at what REAL GTK/Libadwaita on Android delivers today, before deciding whether
gjsify grows a track beside the NativeScript port (`packages/nativescript-bridge/adwaita`).
Nothing here is built by us: the APKs are GeopJr's GTK4Android demo builds, produced by pixiewood
(`refs/gtk-android-builder`) from each app's `pixiewood.xml` — Tuba's is
`refs/tuba/build-aux/android/pixiewood.xml`, built by its `.github/workflows/android.yml`.

## Setup

- AVD `Tablet_API_36`: Android 16 (SDK 36), x86_64 image, 2560x1600, started through
  `scripts/android_emulator.sh` in the werkstatt workspace.
- `dev.geopjr.Tuba` 0.10.3 and `org.gnome.Adwaita1.Demo` 1.10 from GTK4Android, both
  `native-code: 'arm64-v8a'` ONLY, so they ran under the image's ARM translation. Every timing
  below is therefore pessimistic, and the renderer result may be an emulator artefact.

## What was measured

| | Adwaita Demo | Tuba |
|---|---|---|
| APK size | 35 MB | 53 MB (61 MB unpacked, 206 files) |
| `am start -W` TotalTime, cold | 181 ms to first frame | 1751 ms |
| PSS after start | 163 MB | 155 MB |
| Renders correctly | yes, sidebar split view at tablet width | yes, login page |
| Touch navigation | works | works |
| Text entry | — | key events and soft-keyboard commits both reach `GtkEntry` |
| Accessibility tree | ONE `SurfaceView`, no nodes | same |

## Findings

1. **It is GTK, not an approximation.** Adwaita's widgets, metrics, icons and the split-view
   breakpoint arrive unchanged — what `@gjsify/adwaita-nativescript` rebuilds widget by widget
   with its gates comes for free.
2. **TalkBack sees nothing.** `uiautomator dump` lists one `SurfaceView`; GTK's accessibility
   tree is not bridged to Android. For an app that must be accessible this alone rules the
   backend out as a REPLACEMENT for the NativeScript port today.
3. **The soft keyboard opens on non-text focus.** Selecting a sidebar row in the Adwaita Demo
   raised the IME and resized the surface (`2560x1504` → `2560x862` in the `Gdk` trace).
4. **No EGL in the emulator.** `GdkAndroidDisplay.init_egl failed`, plus
   `AChoreographer_getInstance() failed` on GTK's thread, so the run fell back to software
   rendering. Re-check on an arm64 device before reading anything into frame times.
5. **The GI stack is already in the APK.** Tuba ships `libgirepository-2.0.so`, `libffi.so`,
   GLib, GObject and Gio for its own use; typelibs are not built (`-Dgtk:introspection` is
   commented out in its manifest). Turning that on is a manifest change, not a port.

## What this means for the three options

- **Real GI inside the NativeScript process** (headless GLib/Gio/Soup through a GI binding):
  finding 5 says the native side builds today. The open question is the binding: `node-gi` is
  N-API, and `refs/nativescript-napi` targets Objective-C only so far.
- **Native GTK rendering as an alternative to the port:** viable as an opt-in renderer for
  apps that want pixel-exact Adwaita; findings 2–4 keep it from replacing the port.
- **GJS on Android via pixiewood** (gjs as the app binary): needs SpiderMonkey cross-built for
  Android, which nothing here measured. Out of scope for this repository; it would be its own
  project.

## Not measured

Scroll and animation smoothness (frames go to the `SurfaceView`, not to HWUI, so `gfxinfo`
does not count them), real-device GPU rendering, x86_64 builds, startup without ARM translation.

# GTK4 on a NativeScript Worker, on a real arm64 device (2026-10-10)

[ADR 0104](../adr/0104-real-gtk-and-gi-on-android-are-opt-in-tracks-beside-the-nativescript-port.md)
stage 5, track C′, repeated on hardware. The
[emulator report](2026-10-10-gtk-on-a-nativescript-worker.md) left three questions open: GPU
rendering, the soft keyboard and accessibility. This run answers them.

**GPU passes, input mostly works, accessibility fails.** Track C stays tier 3.

![An Adwaita window on a Samsung Galaxy S9 with the soft keyboard open](
2026-10-10-gtk-on-a-nativescript-worker-arm64.png)

`adb exec-out screencap` after `entry.grab_focus()`: the `Gtk.Entry` holds focus and the soft
keyboard is up.

## Setup

- A Samsung Galaxy S9 test device (SM-G960F, Exynos 9810, Mali-G72 MP18), /e/OS 4.3 (Android 15,
  SDK 35), `arm64-v8a`.
- node-gi built from `main` at `de2d956aa8` with NDK 27.1.12297006. `libnode_gi.so` is 1 178 504 B,
  unstripped.
- The probe APK is arm64-only, 99.7 MB, debug. The app is the one from the emulator report.
- Another session shared the device from 18:13; every number below was taken before that.

## The gates

### GPU: pass

GSK picked the `GLRenderer` and the surface realized. Over 65 samples the median is 60.0 fps and 62
samples sit between 55 and 62 fps. There is no cairo fallback; the x86_64 emulator had failed EGL.
The window renders in Adwaita dark at 1440×2960.

### Accessibility: fail

`uiautomator dump` shows the GTK window as one opaque `android.view.View` with no text and no
content description. The label, the button and the entry are absent. Two causes:

- The pixiewood-built `libgtk-4.so` has no accessibility backend: zero AT-SPI symbols, zero
  AccessKit symbols.
- GTK's Android backend has no `AccessibilityNodeProvider` bridge to feed Android's tree.

This is the blocker ADR 0104 named, now measured on hardware. gjsify ships no bridge of its own; the
gap belongs in GTK.

### Soft keyboard: partial

- After `entry.grab_focus()` from JS, `mInputShown=true`, and `adb shell input text abc` arrived as
  the entry text `a`, `ab`, `abc`.
- A **tap** on the entry does not focus it, while a tap on the button works. Focus by touch is
  unsolved; this run did not find out why.
- `input text` injects key events. The IME's `commitText` and composition path (predictions,
  composed characters) is untested. `ImContext.java` and 27 `gdk_android_im` symbols are present.

## Other results

- **Tap relay.** A tap reaches the worker's handler; the button counted "Tapped 2x".
- **Android API from the worker.** `Build.MODEL` was read inside a GTK signal callback on the worker
  thread, through NativeScript's Java bridge.
- **UI thread.** 103 ticks: mean absolute drift 1.9 ms, maximum 11 ms, no gap above 2 s.
- **Stability.** No ANR, `FATAL` or `SIGSEGV` in the measured run.

## Findings

### `GDK_DEBUG=opengl` aborts the process

The first run died with `SIGABRT`. `find_egl_device()` in `gdk/gdkdisplay.c` calls
`eglQueryDisplayAttribEXT()` without checking `EGL_EXT_device_query`. Android does not export it,
libepoxy prints the missing symbol to stderr (`/dev/null` on Android) and calls `abort()`. It
happens after EGL is up and hits any GTK app on Android with the flag. Reported in our repo as
[#2147](https://github.com/gjsify/gjsify/issues/2147); file it upstream by hand. Without the flag
the abort does not occur.

### The window never idles

About 3 900 frames in roughly 100 s with no interaction. A window that redraws continuously costs
battery, and `uiautomator dump` times out while the keyboard is open. The suspect is
`GdkAndroidChoreographerSource`; this is under separate investigation and not diagnosed here.

## Limits

- One device, one Adwaita window, one run measured in full.
- Frame times are fps samples, not per-frame GPU timings.
- Cold start, memory and lifecycle handling are unmeasured.
- TalkBack itself was not run; the verdict rests on the accessibility tree.

## Verdict for ADR 0104

Two of the three gates now have an arm64 measurement. GPU passes. Accessibility fails and has no
fix on gjsify's side. The keyboard gate is open: programmatic focus works, touch focus does not.
Track C stays tier 3 and its docs keep saying it is not accessible.

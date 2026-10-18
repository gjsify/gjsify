# Touch focus and IME text on real GTK on Android (2026-10-17)

[ADR 0104](../adr/0104-real-gtk-and-gi-on-android-are-opt-in-tracks-beside-the-nativescript-port.md)
track C′ listed "touch focus on an entry" as not done, and the
[arm64 report](2026-10-10-gtk-on-a-nativescript-worker-arm64.md) found that a tap on the entry did
not focus it and that the IME's `commitText` path was untested. This run measures both on the
x86_64 emulator.

**Both already work, with no code change in node-gi.** A tap on a `Gtk.Entry` focuses it, the soft
keyboard comes up, text committed by the IME arrives as the entry's text, and a tap on a button
moves focus away and hides the keyboard again.

## Setup

- `emulator-5554`, `NsGi_API_36` (x86_64, Android 16, 2560×1600), Gboard as the IME.
- The probe app of the [emulator report](2026-10-10-gtk-on-a-nativescript-worker.md): GTK 4.21 and
  Adwaita from the pixiewood runtime, GLib's loop on a NativeScript Worker, `ToplevelActivity`
  started from JS. Its `libnode_gi.so` was built on 2026-10-15; no later commit changed the
  addon's touch, IME or pump path (`loop.cc`, `android-*.cc`), only integer marshalling (#2247,
  #2260) and gettext on win32 (#2237).
- The window holds a label, a `Gtk.Button` and a `Gtk.Entry`. The previous probe called
  `entry.grab_focus()` from the button handler; that call is gone, so only touch moves focus.
  The window logs `notify::focus-widget` and the entry's `changed`.

## Results

Every step is `adb -s emulator-5554 shell input tap` or `input text`, and the log lines are the
worker's own.

- **Tap on the entry.** `notify::focus-widget` fires with the focus widget `GtkText` (the entry's
  inner editable) and `mInputShown=true` in `dumpsys input_method`. No programmatic focus call.
- **IME commit.** Three taps on Gboard's `q`, `w`, `e` keys give `text="q"`, `"qw"`, `"qwe"`.
  Gboard types letters through `InputConnection.commitText`, so these are the IME path, not key
  events.
- **Key events.** `input text xyz` goes through `onKeyDown` and gives `"qwexy"`, `"qwexyz"`.
- **Deletion.** Two taps on Gboard's backspace give `"qwexy"`, then `"qwex"`.
- **Tap elsewhere.** A tap on the button moves focus to the `GtkButton` (`focus_child=false`),
  `mInputShown` goes to `false`, and the button's `clicked` fires.

## Why the arm64 report saw a failure

Not established. The arm64 run is not reproducible without that device, and this run is not a
claim about it. One candidate explains the wording, and it is cheap to check:

On GTK's desktop backends, focusing a `GtkEntry` focuses its inner `GtkText`. Measured under GJS on
Linux, after `entry.grab_focus()` the window's focus widget is `Gtk_Text` and `entry.has_focus` is
`false`. The earlier worker logged `entry.has_focus()`; a probe that asks the entry itself reports
"not focused" on every platform, whether or not a tap focused it. The accurate question is
`window.get_focus()`, or the editable the entry delegates to.

## Not covered

- arm64 hardware, other IMEs, and IME composition (`setComposingText`, predictions, composed
  characters). Gboard on the emulator showed no suggestion strip.
- `has_focus` is a callable method in node-gi on Android (`entry.get_delegate().has_focus()`
  worked) and a boolean property in GJS. It is a separate GJS-parity question and was not
  followed up.
- Lifecycle and explicit pump ownership. Neither was needed for focus or IME text.

## Reproducing

The app and its scaffold live outside the repo, as in the emulator report. Add a
`notify::focus-widget` logger, drop the `grab_focus()` call, rebuild, install, then:

```sh
adb -s emulator-5554 shell input tap <entry x> <entry y>
adb -s emulator-5554 shell dumpsys input_method | grep mInputShown
adb -s emulator-5554 logcat -d | grep GTKWORKER
```

Tap Gboard's keys the same way to drive `commitText`.

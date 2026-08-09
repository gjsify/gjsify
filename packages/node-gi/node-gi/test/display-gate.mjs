// SPDX-License-Identifier: MIT
// "Can this host open a window?" — one answer, shared by every GTK test.
//
// The gate was copy-pasted into 18 test files, in TWO spellings that disagree:
//
//     const haveDisplay = !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;   // 14 files
//     const displayless = process.platform === 'win32' || process.platform === 'darwin';
//     const haveDisplay = displayless || !!DISPLAY || !!WAYLAND_DISPLAY;            // 4 files
//
// Only the second is true. `DISPLAY`/`WAYLAND_DISPLAY` are X11/Wayland variables;
// GdkWin32 and GdkQuartz supply the display themselves and set neither. So the
// first spelling does not read "no display available" off Linux — it reads
// "skipped", permanently and silently, on every non-Linux host.
//
// That is not hypothetical. Every `gtk-template-*` test carried the Linux-only
// gate, so all four skipped on Windows for as long as they existed, and node-gi's
// `GetGtkTemplateApi()` shipped an `#ifdef _WIN32` stub that made composite
// templates throw there. A user found it, not CI: `gjsify showcase
// three-geometry-teapot --runtime node` on Windows 11 died with "the libgtk-4
// template API is unavailable". The suite that was supposed to catch it was green
// because it had not run.
//
// A skip is invisible by design, which is exactly why the CONDITION for one may
// not be guessed per file.
//
// EVERY GTK TEST ASKS THIS ONE NOW, with exactly two deliberate exceptions:
// `webgl-glarea` and `excalibur-webgl` need a realizable GL CONTEXT, not merely a
// display. That is a different question, so they ask it themselves and say so.
// The point was never "one gate everywhere" — it is that a gate must state the
// thing it actually requires. Both of those reached the right OUTCOME through the
// wrong CLAIM, and a wrong claim keeps being right only by accident.

/**
 * True where the platform backend supplies a display with no environment
 * variable to advertise it: GdkWin32 on Windows, GdkQuartz on macOS.
 */
export const displayless = process.platform === 'win32' || process.platform === 'darwin';

/** True when this host can realize a GTK surface. */
export const haveDisplay = displayless || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

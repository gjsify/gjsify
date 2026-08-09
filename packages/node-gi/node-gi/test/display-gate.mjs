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
// NOT YET ADOPTED EVERYWHERE. The 14 files on the Linux-only spelling keep it for
// now: switching a test's gate makes it START RUNNING on two more platforms, and
// whether each is actually expected to pass there is a per-test question with a
// real answer — not a sweep. Convert them as they are looked at, and put the
// answer in the CI job that runs them.

/**
 * True where the platform backend supplies a display with no environment
 * variable to advertise it: GdkWin32 on Windows, GdkQuartz on macOS.
 */
export const displayless = process.platform === 'win32' || process.platform === 'darwin';

/** True when this host can realize a GTK surface. */
export const haveDisplay = displayless || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

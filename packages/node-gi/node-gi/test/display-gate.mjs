// SPDX-License-Identifier: MIT
// "Can this host open a window?" — one answer, shared by every GTK test.
//
// `DISPLAY`/`WAYLAND_DISPLAY` are X11/Wayland variables; GdkWin32 and GdkQuartz
// supply the display themselves and set neither, so a gate reading only those two
// does not mean "no display" off Linux — it means "skipped", permanently and
// silently, on every non-Linux host. That is how all four `gtk-template-*` tests
// skipped on Windows for as long as they existed while node-gi's
// `GetGtkTemplateApi()` shipped an `#ifdef _WIN32` stub that made composite
// templates throw there; a user hit it (`gjsify showcase three-geometry-teapot
// --runtime node` on Windows 11), not CI.
//
// Deliberate non-users: `webgl-glarea`/`excalibur-webgl` need a realizable GL
// context and `gtk-typelib-backers` needs no display at all — a gate must state
// the thing it actually requires, so those state their own.

/** True where the platform backend supplies the display itself: GdkWin32, GdkQuartz. */
export const displayless = process.platform === 'win32' || process.platform === 'darwin';

/** True when this host can realize a GTK surface. */
export const haveDisplay = displayless || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

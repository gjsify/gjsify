// What the HOST can do, as pure functions of (os, env) — so `on('Display', …)`
// and `on('Gl', …)` can be checked instead of trusted.
//
// Same split, and for the same reason, as `@gjsify/runtime`'s `detect.ts`: a
// capability read off the ambient host can only ever be confirmed for the host
// running the spec, and these two rules are wrong precisely on the hosts CI is
// least often on. `index.ts` owns the single read of the real host.

import type { TargetOs } from '@gjsify/utils/core';

/** The env vars the rules read. `undefined` means "unset", never "empty". */
export interface DisplayEnv {
    DISPLAY?: string;
    WAYLAND_DISPLAY?: string;
}

/**
 * True where the platform backend supplies the display itself: GdkWin32, GdkQuartz.
 *
 * Neither sets `DISPLAY` nor `WAYLAND_DISPLAY` — those are X11/Wayland variables.
 */
export function isDisplaylessBackend(os: TargetOs | undefined): boolean {
    return os === 'win32' || os === 'darwin';
}

/**
 * Can this host realize a window?
 *
 * Reading only `DISPLAY`/`WAYLAND_DISPLAY` does not mean "no display" off Linux —
 * it means SKIPPED, permanently and silently, on every macOS and Windows host.
 * That is not hypothetical: it is how the darwin GTK path stayed uncovered long
 * enough for two independent darwin defects to ship in one release, with nothing
 * on that job able to fail. `@gjsify/node-gi`'s `test/display-gate.mjs` states the
 * same rule for the suites outside this workspace; the two are deliberate mirrors
 * because ADR 0005 forbids the dependency edge that would let them share a module.
 */
export function canRealizeSurface(os: TargetOs | undefined, env: DisplayEnv): boolean {
    return isDisplaylessBackend(os) || !!(env.DISPLAY || env.WAYLAND_DISPLAY);
}

/**
 * Can this host realize a GL context our WebGL implementation can serve?
 *
 * STRICTLY narrower than {@link canRealizeSurface}, and the reason the two carry
 * different names. macOS has a window server without `DISPLAY`, so it passes the
 * surface gate — but no CI leg has ever realized a GL context there: every darwin
 * GL measurement in `status/open-todos.md` was taken by hand on the test VM, with
 * `DYLD_LIBRARY_PATH` exported by the operator, because the `Gtk-4.0` typelib's
 * bare `libgtk-4.1.dylib` leaf does not otherwise resolve on that host (#973). So
 * the darwin answer is unknown, not no. Answering the GL question with the surface
 * answer turns macOS red for a reason the WebGL suite does not own; answering the
 * surface question with the GL answer is what kept darwin silent. win32 is excluded
 * for the measured reason in #1097: the bundled GTK resolves epoxy with no GL
 * implementation behind it.
 *
 * The GL 4.1 ceiling is NOT a reason to exclude darwin any more — `shaderSource()`
 * rewrites `#version 300 es` for a desktop context without ARB_ES3_compatibility,
 * and WebGL2 content draws there (measured, macOS 15.7.9 / GL 4.1 core).
 *
 * Widen this the day a leg proves the context — not the day it seems plausible.
 */
export function canRealizeGl(os: TargetOs | undefined, env: DisplayEnv): boolean {
    return os === 'linux' && !!(env.DISPLAY || env.WAYLAND_DISPLAY);
}

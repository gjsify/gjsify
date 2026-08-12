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
 * surface gate — but CGL caps out at GL 4.1 while WebGL2 content needs
 * `#version 300 es` (ARB_ES3_compatibility, core in GL 4.3), which the driver
 * refuses outright. Answering the GL question with the surface answer turns macOS
 * red for a reason the WebGL suite does not own; answering the surface question
 * with the GL answer is what kept darwin silent. win32 is excluded for the
 * measured reason in #1097: the bundled GTK resolves epoxy with no GL
 * implementation behind it.
 *
 * Widen this the day a leg proves the context — not the day it seems plausible.
 */
export function canRealizeGl(os: TargetOs | undefined, env: DisplayEnv): boolean {
    return os === 'linux' && !!(env.DISPLAY || env.WAYLAND_DISPLAY);
}

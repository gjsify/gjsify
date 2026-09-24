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
 * ASKED, not inferred: `probe` realizes a context and reports whether that
 * worked, and this rule only decides whether asking is sensible at all.
 *
 * It used to be answered from the OS alone — Linux with a display, nothing
 * else — because darwin was UNKNOWN rather than no (every darwin GL measurement
 * had been taken by hand, with a loader variable the operator exported, #973),
 * and win32's bundled GTK resolves epoxy with no GL implementation behind it on
 * a VM without an ICD (#1097). Both reasons describe a HOST, not an OS: the
 * first Apple Silicon Mac realized a GL 4.1 core context through GTK 4.24 and
 * the WebGL suites ran green there, while the OS rule had kept every one of
 * them silently skipped. An OS rule is wrong in both directions at once — it
 * skips a Mac that has GL and would run a Linux runner whose driver has none —
 * and the probe is the question itself, so it is right on hosts no rule named.
 *
 * Still STRICTLY narrower than {@link canRealizeSurface}: no surface, no GL, and
 * the probe is never run where there is no display to open (a headless Linux
 * container, where GTK's own init would fail first).
 */
export function canRealizeGl(os: TargetOs | undefined, env: DisplayEnv, probe: () => boolean): boolean {
    return canRealizeSurface(os, env) && probe();
}

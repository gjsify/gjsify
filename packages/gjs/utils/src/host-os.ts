// Which operating system is this process on — asked in ONE place.
//
// WHY THIS MODULE EXISTS
//
// ADR 0018 makes Linux, macOS and Windows a project goal and turns the OS into
// a DECLARED, machine-checked claim (`package.json#gjsify.os`). A rule can only
// demand that declaration from the packages that actually make an OS decision,
// which means something has to RECOGNISE an OS decision in the source. Before
// this module the tree spelled one in at least nine ways — `process.platform
// === 'win32'`, a destructured `platform === 'win32'`, `ctx.platform !==
// 'win32'`, `target.os === 'linux'`, a local `isWin32()`, a `DIR_LINK_KIND`
// constant, and `const IS_WIN32 = platform === 'win32'` copied verbatim into six
// `@gjsify/fs` spec files, comment and all. A detector taught all nine is a
// second source of truth, and it is the copy that drifts which an agent reads.
//
// So the OS decision goes through here, and `os-axis` keys on this module.
//
// WHY FUNCTIONS AND NOT `const IS_WIN32 = …`
//
// A module-eval-time constant is not safe on GJS. `@gjsify/process` installs
// the process singleton at register time and `platform` is a LAZY own property
// on it; until that swap happens `globalThis.process` is the byte-1 banner stub.
// `detectPlatform()` in `packages/node/process/src/internal/detect.ts` carries
// the measurement and the reasoning: reading through `globalThis.process`
// during init resolves against whichever object is installed AT THAT MOMENT,
// and a bundle whose first read lands on the wrong side of the swap caches a
// wrong answer for the life of the process. That is read ORDER, not a
// guarantee. A function re-reads, so it cannot freeze the stub's answer.
//
// WHY A GUARDED `globalThis` READ AND NOT `import { platform } from 'node:process'`
//
// This module belongs to the `/core` half (see `core.ts`), which must be
// well-defined on every runtime including the browser, where `node:process`
// does not resolve. The guarded read is the sanctioned GJS-GUARDED shape: it
// probes the host and has a documented answer when there is none.

import type { ProcessPlatform } from './platform-names.js';

/**
 * The three operating systems ADR 0018 declares as the project's target set.
 *
 * Deliberately NARROWER than {@link ProcessPlatform}, which is Node's full
 * vocabulary. `gjsify.os` keys are exactly these three: a package may not
 * declare support for an OS the project does not claim, and `os-axis` fails on
 * a key outside this set. The emulated `linux-{ppc64,s390x,riscv64}` targets
 * are build-verified only and are an ARCH question, not an OS one — they live
 * on the `gjsify.platforms` axis, which stays separate by design.
 */
export type TargetOs = 'linux' | 'darwin' | 'win32';

/** The target set as data, so a check iterates it instead of restating it. */
export const TARGET_OSES: readonly TargetOs[] = ['linux', 'darwin', 'win32'];

/** Is `value` one of the three declared target operating systems? */
export function isTargetOs(value: unknown): value is TargetOs {
    return typeof value === 'string' && (TARGET_OSES as readonly string[]).includes(value);
}

/**
 * The host's `process.platform`, or `undefined` where nothing answers.
 *
 * `undefined` is the honest result on a runtime with no process object (the
 * browser), and callers must treat it as "unknown", never as "not Windows" —
 * which is why this returns an optional rather than defaulting to `'linux'`.
 * The defaulting belongs to `@gjsify/process`'s `detectPlatform()`, which has a
 * uname probe to fall back ON; this module has none and must not pretend.
 */
export function hostPlatform(): ProcessPlatform | undefined {
    const platform = (globalThis as { process?: { platform?: unknown } }).process?.platform;
    return typeof platform === 'string' ? (platform as ProcessPlatform) : undefined;
}

/**
 * The host OS as one of the three target names, or `undefined` when the host is
 * not one of them (or could not be determined).
 */
export function hostOs(): TargetOs | undefined {
    const platform = hostPlatform();
    return isTargetOs(platform) ? platform : undefined;
}

/**
 * Running on Windows?
 *
 * The predicate `it.failing(name, fn, reason, { when: isWin32() })` takes — the
 * sanctioned way to carry a POSIX-only assertion through a win32 run without
 * weakening it, and without an `if (platform)` guard that would hide it forever.
 */
export function isWin32(): boolean {
    return hostPlatform() === 'win32';
}

/** Running on macOS? */
export function isDarwin(): boolean {
    return hostPlatform() === 'darwin';
}

/** Running on Linux? */
export function isLinux(): boolean {
    return hostPlatform() === 'linux';
}

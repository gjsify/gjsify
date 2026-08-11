// Which operating system is this process on — asked in ONE place, so that the
// `os-axis` rule (`packages/infra/manifest-conformance/lib/rules/os-axis.mjs`)
// can recognise an OS decision in the source and demand the matching
// `package.json#gjsify.os` declaration for it. See
// docs/adr/0018-os-axis-declaration.md.
//
// Functions, not `const IS_WIN32 = …`: `platform` is a LAZY own property of the
// process singleton that `@gjsify/process` installs at register time, so a
// module-eval-time read can land on the byte-1 banner stub and freeze that wrong
// answer for the life of the process. Measurement and reasoning:
// `detectPlatform()` in `packages/node/process/src/internal/detect.ts`.
//
// A guarded `globalThis` read, not `import { platform } from 'node:process'`:
// this module is in the `/core` half (see `core.ts`), which must be well-defined
// on runtimes where `node:process` does not resolve, e.g. the browser.

import type { ProcessPlatform } from './platform-names.js';

/**
 * The three operating systems ADR 0018 declares as the project's target set.
 *
 * Deliberately narrower than {@link ProcessPlatform} (Node's full vocabulary):
 * `gjsify.os` keys are exactly these three and `os-axis` fails on any other key.
 * The emulated `linux-{ppc64,s390x,riscv64}` targets are an ARCH question and
 * live on the separate `gjsify.platforms` axis.
 */
export type TargetOs = 'linux' | 'darwin' | 'win32';

/** The target set as data, for checks that iterate it. */
export const TARGET_OSES: readonly TargetOs[] = ['linux', 'darwin', 'win32'];

/** Is `value` one of the three declared target operating systems? */
export function isTargetOs(value: unknown): value is TargetOs {
    return typeof value === 'string' && (TARGET_OSES as readonly string[]).includes(value);
}

/**
 * The host's `process.platform`, or `undefined` where nothing answers.
 *
 * Callers must treat `undefined` as "unknown", never as "not Windows". Nothing is
 * defaulted here because this module has no uname probe to fall back on; that
 * defaulting belongs to `@gjsify/process`'s `detectPlatform()`.
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
 * The predicate for `it.failing(name, fn, reason, { when: isWin32() })` — the
 * sanctioned way to park a POSIX-only assertion on a win32 run, instead of an
 * `if (platform)` guard that would hide it forever.
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

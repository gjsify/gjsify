// Platform (os / cpu / libc) matching for the native install backend.
//
// SPDX-License-Identifier: ISC
// Adapted from npm-install-checks (refs/npm-cli/node_modules/npm-install-checks/
// lib/index.js `checkPlatform`/`checkList` + lib/current-env.js). Copyright (c)
// npm, Inc. ISC license.
// Modifications: boolean predicate instead of a thrown EBADPLATFORM (the
// caller decides — the install backend only SKIPS optional nodes, it never
// fails a required one), GJS-safe libc detection, and an "unknown libc never
// excludes" deviation documented at `platformMatches`.
//
// npm prunes optional dependencies whose declared `os`/`cpu`/`libc` cannot
// match the host before reify (`refs/npm-cli/workspaces/arborist/lib/arborist/
// build-ideal-tree.js` `#checkEngineAndPlatform`); pnpm/yarn/bun do the
// equivalent. This module is the predicate half of gjsify's version of that
// pruning — see `install-backend-native.ts` for where it is applied.

import * as fs from 'node:fs';

/** npm manifest shape: a single value or a list, entries may be `!negated`. */
export type PlatformList = string | string[];

/** The `os`/`cpu`/`libc` constraint fields of a packument version. */
export interface PlatformConstraints {
    os?: PlatformList;
    cpu?: PlatformList;
    libc?: PlatformList;
}

/** The host platform the constraints are checked against. */
export interface PlatformEnv {
    os: string;
    cpu: string;
    /** `'glibc'` | `'musl'`, or null when undetectable (non-linux, or no probe hit). */
    libc: string | null;
}

/**
 * npm's `checkList`: `value` passes when it matches at least one non-negated
 * entry (or the list holds only negations, none of which match). A single
 * `'any'` entry always passes. Malformed (non-string/array) lists are treated
 * as "no constraint".
 */
export function checkList(value: string, list: PlatformList): boolean {
    if (typeof list === 'string') list = [list];
    if (!Array.isArray(list)) return true;
    if (list.length === 1 && list[0] === 'any') return true;
    let negated = 0;
    let match = false;
    for (const entry of list) {
        if (typeof entry !== 'string') continue;
        const negate = entry.charAt(0) === '!';
        const test = negate ? entry.slice(1) : entry;
        if (negate) {
            negated++;
            if (value === test) return false;
        } else {
            match = match || value === test;
        }
    }
    return match || negated === list.length;
}

/**
 * Does `target` (a packument version's `os`/`cpu`/`libc` declarations) match
 * the host `env`?
 *
 * DEVIATION from npm on unknown libc: npm treats a set `libc` constraint as a
 * MISMATCH when the host family cannot be determined. Here an unknown family
 * never excludes — a wrong skip breaks a working install (the matching glibc
 * binding would silently not be materialised), while a wrong keep only costs
 * the bytes the filter would have saved, which is the pre-filter status quo.
 */
export function platformMatches(target: PlatformConstraints, env: PlatformEnv): boolean {
    const osOk = target.os ? checkList(env.os, target.os) : true;
    const cpuOk = target.cpu ? checkList(env.cpu, target.cpu) : true;
    const libcOk = target.libc && env.libc ? checkList(env.libc, target.libc) : true;
    return osOk && cpuOk && libcOk;
}

/**
 * Detect the host libc family on linux. Probe order mirrors npm's
 * `current-env.js` with a GJS-safe tail:
 *   1. `/usr/bin/ldd` content ("musl" / "GNU C Library") — works on both Node
 *      and GJS (plain file read).
 *   2. `process.report.getReport()` (Node-only; GJS's process polyfill has no
 *      report).
 *   3. `/lib/ld-musl-*` loader marker (musl hosts without an ldd script).
 * Returns null when nothing matches — see `platformMatches` for why null
 * never excludes.
 */
export function detectLibcFamily(osName: string): string | null {
    if (osName !== 'linux') return null;
    try {
        const content = fs.readFileSync('/usr/bin/ldd', 'utf-8');
        if (content.includes('musl')) return 'musl';
        if (content.includes('GNU C Library')) return 'glibc';
    } catch {
        /* no ldd — fall through */
    }
    try {
        const report = (
            process as unknown as { report?: { getReport?: () => unknown } }
        ).report?.getReport?.() as {
            header?: { glibcVersionRuntime?: unknown };
            sharedObjects?: unknown[];
        } | null;
        if (report?.header?.glibcVersionRuntime) return 'glibc';
        if (
            Array.isArray(report?.sharedObjects) &&
            report.sharedObjects.some(
                (o) => typeof o === 'string' && (o.includes('libc.musl-') || o.includes('ld-musl-')),
            )
        ) {
            return 'musl';
        }
    } catch {
        /* no process.report — fall through */
    }
    try {
        if (fs.readdirSync('/lib').some((f) => f.startsWith('ld-musl-'))) return 'musl';
    } catch {
        /* no /lib */
    }
    return null;
}

let cachedEnv: PlatformEnv | undefined;

/** The host platform env, npm-shaped (`process.platform`/`process.arch` + libc family), cached. */
export function currentPlatformEnv(): PlatformEnv {
    if (!cachedEnv) {
        const os = process.platform;
        cachedEnv = { os, cpu: process.arch, libc: detectLibcFamily(os) };
    }
    return cachedEnv;
}

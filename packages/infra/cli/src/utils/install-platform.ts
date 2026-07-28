// SPDX-License-Identifier: MIT
// The npm `os` / `cpu` / `libc` platform gate for `gjsify install`.
//
// Adapted from npm-install-checks (refs/npm-cli/node_modules/npm-install-checks
// /lib/{index,current-env}.js). Copyright (c) npm, Inc. and contributors, ISC.
// Modifications: TypeScript + a pure `(fields, host) -> boolean` shape (npm
// throws), plus a third libc probe for hosts with no `process.report` (GJS).
//
// WHY this exists: a package may declare which platforms it can run on. The
// binding packages every modern toolchain ships (`@img/sharp-*`,
// `@rolldown/binding-*`, `@anthropic-ai/claude-agent-sdk-*`, `@pagefind/*`, …)
// publish one sibling PER platform and list them all as `optionalDependencies`,
// relying on the installer to place only the sibling that matches the host.
// Without this gate every sibling is materialised — 70 % of the bytes of a cold
// gjsify install were binaries that can never execute here.
//
// SEMANTICS ARE COPIED, NOT INVENTED. The edge cases below are load-bearing and
// were read off npm's own `checkList`, cross-checked against pnpm's
// `@pnpm/config.package-is-installable` and yarn Berry's condition compiler:
//
//   - a bare string is coerced to a one-element list (`"os": "linux"`)
//   - the literal `"any"` passes, but ONLY as the sole element of the list
//   - the EMPTY list passes (`match || negated === list.length` → `0 === 0`)
//   - `!` negates; a negation that matches returns false IMMEDIATELY, so
//     negation always dominates a positive entry in the same list
//   - with at least one positive entry present, one of them MUST match; a list
//     that is entirely negations passes when none of them matched
//   - a package that declares `libc` while the host libc is UNDETERMINABLE
//     fails (npm's `if (target.libc && !libc) libcOk = false`). pnpm skips the
//     libc axis instead; we follow npm, because npm is what the ecosystem's
//     `optionalDependencies` fan-outs are authored against.
//   - …and that libc clause keys on the field being TRUTHY, not on it
//     constraining anything, so an EMPTY `libc: []` fails on such a host while
//     an empty `os: []` passes. `[]` and "absent" are therefore NOT the same
//     value and are kept distinct end to end, lockfile included.
//
// These were not read off the docs and hoped for: `isPlatformSupported` was run
// against npm's own `checkPlatform` over 2688 (target, host) pairs and agrees on
// all of them. The empty-list asymmetry above is precisely what that run caught
// when `[]` was being collapsed to `undefined` — 52 disagreements.
//
// The one deliberate divergence from npm is host DETECTION, not matching: npm
// falls back to `process.report`, which GJS does not implement, so a third
// probe looks for the dynamic loader itself. That can only make the answer MORE
// often correct — it never changes what a given (fields, host) pair decides.

import { readFileSync, readdirSync } from 'node:fs';

/** `os` / `cpu` / `libc` as declared by a package, already normalised. */
export interface PlatformFields {
    os?: string[];
    cpu?: string[];
    libc?: string[];
}

/** The host a package is being installed FOR. */
export interface HostPlatform {
    /** `process.platform` — `linux`, `darwin`, `win32`, … */
    os: string;
    /** `process.arch` — `x64`, `arm64`, … */
    cpu: string;
    /**
     * `glibc` / `musl` on Linux when determinable; `undefined` on every other
     * OS (npm returns undefined there) and on a Linux host whose C library
     * could not be identified.
     */
    libc?: string;
}

/**
 * Normalise a raw `os` / `cpu` / `libc` value off a packument or lockfile into
 * a list of strings, or `undefined` when the package declares nothing.
 *
 * **An EMPTY list is PRESERVED as `[]`, not collapsed to `undefined`** — the two
 * are NOT interchangeable, and assuming they were is the bug a differential run
 * against npm's own `checkPlatform` caught (52 of 2688 (target, host) pairs).
 * `checkList([])` does return true, so for `os`/`cpu` the two spellings agree;
 * but npm's extra libc clause keys on the field being TRUTHY rather than on it
 * constraining anything, and `[]` is truthy in JS. So `{"libc": []}` on a host
 * whose C library is undeterminable FAILS in npm while an absent `libc` passes.
 * The distinction is preserved end to end, including through the lockfile.
 *
 * The mapping mirrors npm's own truthiness test: `""`, `null`, `0` → absent;
 * `"linux"` → `["linux"]`; an array → itself with non-strings dropped (pnpm
 * does the same filtering; npm would throw on `entry.charAt` for a `null`
 * inside the list). A non-string, non-array value (`{}`) is treated as absent
 * rather than reproducing npm's crash on a non-iterable.
 */
export function normalizePlatformList(raw: unknown): string[] | undefined {
    if (typeof raw === 'string') return raw.length > 0 ? [raw] : undefined;
    if (!Array.isArray(raw)) return undefined;
    return raw.filter((v): v is string => typeof v === 'string');
}

/** Pull the three platform fields off a packument version record / manifest. */
export function platformFieldsFrom(source: Record<string, unknown> | undefined): PlatformFields {
    if (!source) return {};
    const fields: PlatformFields = {};
    const os = normalizePlatformList(source.os);
    const cpu = normalizePlatformList(source.cpu);
    const libc = normalizePlatformList(source.libc);
    // `!== undefined`, never truthiness — an empty list is a DECLARATION, and
    // for `libc` it is a meaningful one (see normalizePlatformList).
    if (os !== undefined) fields.os = os;
    if (cpu !== undefined) fields.cpu = cpu;
    if (libc !== undefined) fields.libc = libc;
    return fields;
}

/** True when the package declares nothing about the platforms it supports. */
export function declaresPlatform(fields: PlatformFields): boolean {
    return fields.os !== undefined || fields.cpu !== undefined || fields.libc !== undefined;
}

/**
 * npm's `checkList` — verbatim semantics, see the header. `value` is the host's
 * value for this axis; `undefined` never matches a positive entry (so a list
 * with any positive entry fails), which is what makes an undetectable libc
 * exclude a libc-declaring package.
 */
export function checkList(value: string | undefined, list: readonly string[]): boolean {
    if (list.length === 1 && list[0] === 'any') return true;
    // Match none of the negated values, and at least one of the non-negated
    // values, if any are present.
    let negated = 0;
    let match = false;
    for (const entry of list) {
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
 * Can `fields` run on `host`? The pure form of npm's `checkPlatform` (npm
 * throws `EBADPLATFORM`; the caller here decides between skipping an optional
 * dependency and failing a required one, which is the same split npm makes in
 * arborist's `#checkEngineAndPlatform`).
 */
export function isPlatformSupported(fields: PlatformFields, host: HostPlatform): boolean {
    const osOk = fields.os !== undefined ? checkList(host.os, fields.os) : true;
    const cpuOk = fields.cpu !== undefined ? checkList(host.cpu, fields.cpu) : true;
    // npm: a DECLARED libc against an undeterminable host libc is a failure —
    // and "declared" means the field is present, not that it constrains
    // anything, so `libc: []` fails here where `os: []` passes above. That
    // asymmetry is npm's (`if (target.libc && !libc) libcOk = false`), verified
    // by differential run against npm-install-checks; do not "simplify" it.
    let libcOk = fields.libc !== undefined ? checkList(host.libc, fields.libc) : true;
    if (fields.libc !== undefined && !host.libc) libcOk = false;
    return osOk && cpuOk && libcOk;
}

/** `linux-x64` / `linux-x64 (glibc)` — for one-line diagnostics. */
export function describeHost(host: HostPlatform): string {
    return host.libc ? `${host.os}-${host.cpu} (${host.libc})` : `${host.os}-${host.cpu}`;
}

/**
 * npm's `EBADPLATFORM` message, adapted. Printed for a REQUIRED dependency the
 * host cannot run — the case npm makes a hard error and we must not paper over
 * by silently dropping the package.
 */
export function formatPlatformMismatch(pkgid: string, fields: PlatformFields, host: HostPlatform): string {
    const wanted: Record<string, string> = {};
    if (fields.os) wanted.os = fields.os.join(',');
    if (fields.cpu) wanted.cpu = fields.cpu.join(',');
    if (fields.libc) wanted.libc = fields.libc.join(',');
    const current: Record<string, string> = { os: host.os, cpu: host.cpu };
    if (fields.libc) current.libc = host.libc ?? '<undetermined>';
    return (
        `EBADPLATFORM: unsupported platform for ${pkgid}: ` +
        `wanted ${JSON.stringify(wanted)} (current: ${JSON.stringify(current)})`
    );
}

// --- host detection -------------------------------------------------------

function isMuslPath(file: string): boolean {
    return file.includes('libc.musl-') || file.includes('ld-musl-');
}

/** npm's primary probe: `/usr/bin/ldd` is a script that names its own libc. */
function libcFromLddScript(): string | null | undefined {
    try {
        const content = readFileSync('/usr/bin/ldd', 'utf-8');
        if (content.includes('musl')) return 'musl';
        if (content.includes('GNU C Library')) return 'glibc';
        return null;
    } catch {
        return undefined;
    }
}

/**
 * npm's secondary probe. Node-only — GJS implements no `process.report`, which
 * is exactly why the loader probe below exists as a third step.
 */
function libcFromProcessReport(): string | null | undefined {
    const report = (process as { report?: { getReport?: () => unknown; excludeNetwork?: boolean } }).report;
    if (!report || typeof report.getReport !== 'function') return undefined;
    try {
        const originalExclude = report.excludeNetwork;
        report.excludeNetwork = true;
        const data = report.getReport() as {
            header?: { glibcVersionRuntime?: string };
            sharedObjects?: unknown;
        };
        report.excludeNetwork = originalExclude;
        if (data.header?.glibcVersionRuntime) return 'glibc';
        if (Array.isArray(data.sharedObjects) && data.sharedObjects.some((s) => typeof s === 'string' && isMuslPath(s)))
            return 'musl';
        return null;
    } catch {
        return undefined;
    }
}

/**
 * Third probe (gjsify-specific): the dynamic loader on disk. musl installs an
 * `ld-musl-<arch>.so.1`; glibc installs an `ld-linux…so` under one of the
 * standard library directories. This is the same signal `detect-libc` uses and
 * it needs neither a shell script nor a Node diagnostic report, so it answers
 * on a stock GJS host where npm's two probes are both unavailable.
 */
function libcFromLoader(): string | null {
    for (const dir of ['/lib', '/lib64', '/usr/lib', '/usr/lib64']) {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            continue;
        }
        // musl first, mirroring npm's ldd probe: a glibc host with musl-gcc
        // installed carries both loaders, and the musl one is the specific
        // signal.
        if (entries.some((e) => e.startsWith('ld-musl-'))) return 'musl';
        if (entries.some((e) => e.startsWith('ld-linux'))) return 'glibc';
        // Debian/Ubuntu multiarch keeps the loader one level down
        // (`/usr/lib/<arch>-linux-gnu/`); the directory name itself is the
        // marker, and it is arch-generic unlike a hard-coded `x86_64-`.
        if (entries.some((e) => e.endsWith('-linux-gnu') || e.endsWith('-linux-gnueabihf'))) return 'glibc';
        if (entries.some((e) => e.endsWith('-linux-musl'))) return 'musl';
    }
    return null;
}

let cachedLibc: string | null | undefined;

/**
 * The host's C library family, or `undefined` when it is not a Linux host (the
 * field only applies there — npm's docs: "This field only applies if `os` is
 * `linux`") or could not be determined at all. Memoised: three filesystem
 * probes per install is plenty.
 */
export function detectLibcFamily(osName: string): string | undefined {
    if (osName !== 'linux') return undefined;
    if (cachedLibc === undefined) {
        cachedLibc = libcFromLddScript();
        if (cachedLibc === undefined) cachedLibc = libcFromProcessReport();
        if (cachedLibc === undefined || cachedLibc === null) cachedLibc = libcFromLoader();
    }
    return cachedLibc ?? undefined;
}

let cachedHost: HostPlatform | undefined;

/** The host this process is installing for. Memoised. */
export function currentHostPlatform(): HostPlatform {
    if (!cachedHost) {
        const os = process.platform;
        cachedHost = { os, cpu: process.arch, libc: detectLibcFamily(os) };
    }
    return cachedHost;
}

/** Test seam — drop the memoised host/libc so a spec can vary the environment. */
export function resetHostPlatformCache(): void {
    cachedHost = undefined;
    cachedLibc = undefined;
}

/**
 * `GJSIFY_INSTALL_PLATFORM_CHECK=0` disables the gate entirely — the analogue
 * of npm's `--force`, for a host whose libc probe is wrong or a deliberate
 * cross-platform materialisation. Everything is installed, exactly as before
 * this check existed.
 */
export function platformCheckEnabled(): boolean {
    const flag = process.env.GJSIFY_INSTALL_PLATFORM_CHECK;
    if (flag === undefined) return true;
    const trimmed = flag.trim();
    return !(trimmed === '0' || trimmed === 'false');
}

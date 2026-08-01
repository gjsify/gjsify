// SPDX-License-Identifier: MIT
// Adapted from npm-install-checks 9.0.0
// (refs/npm-cli/node_modules/npm-install-checks/lib/{index,current-env}.js).
// Copyright (c) Isaac Z. Schlueter and npm contributors. ISC.
// Modifications: TypeScript; host values are PARAMETERS instead of ambient
// reads; the libc probe gains a GJS path (no `process.report` there).
//
// `os` / `cpu` / `libc` compatibility for `gjsify install`.
//
// WHY THIS EXISTS: the resolver used to place every optionalDependency a
// packument listed, without ever reading the version's `os`/`cpu`/`libc`
// fields. Measured on a cold tree of this workspace: 183 foreign-platform
// packages / 3361 MB (darwin/win32/arm64 binary siblings of rolldown, oxlint,
// lightningcss, esbuild, …) plus 9 musl-only packages / 308 MB — 3.67 GB of a
// 5.6 GB node_modules that npm would never have written. That is not a size
// nit: those trees also make `detectNativePackages` walk foreign prebuilds,
// and an extract of several GB is what pushed installs into the 30-minute
// wall-clock budget (see the comment in commands/install.ts).
//
// PARITY IS THE POINT, so this is a PORT, not an interpretation: the rules
// below are npm's, quirks included (see `checkList`). A gjsify install that
// placed a different SET than npm for the same manifest would be a worse
// failure than placing too much — a consumer's build then works under one
// installer and not the other, with nothing in either tree to point at.
//
// PURITY: every decision function takes the host triple as an argument. Only
// `resolveHostPlatform()` (and the default probe it builds) reads
// `process.platform`/`process.arch`/the filesystem, so a Linux host can
// unit-test the darwin/win32/musl branches by injection — the philosophy
// `detect-native-packages.ts` documents at its top, applied here.

import { readFileSync, readdirSync } from 'node:fs';

/**
 * A manifest's platform declaration. npm allows BOTH a bare string and an
 * array for each field (`"os": "darwin"` and `"os": ["darwin"]` are the same
 * declaration), which is why every consumer goes through {@link checkList}.
 */
export type PlatformFieldValue = string | string[];

/** The `os`/`cpu`/`libc` slice of a package manifest (or packument version). */
export interface PlatformDeclaration {
    os?: PlatformFieldValue;
    cpu?: PlatformFieldValue;
    libc?: PlatformFieldValue;
}

/**
 * The host a package is being checked AGAINST. `os`/`cpu` use Node's
 * `process.platform`/`process.arch` vocabulary (`linux`, `darwin`, `win32`;
 * `x64`, `arm64`, …) — the same spelling `gjsify.platforms` uses, per the OS
 * axis in AGENTS.md.
 *
 * `libc` is `'glibc'` | `'musl'` | undefined. Undefined means UNKNOWN, not
 * "no libc": npm treats a package that DECLARES a libc while the host's is
 * unknown as incompatible (better to skip an optional binary than to hand a
 * musl binary to a glibc process), and so does {@link checkPlatform}.
 */
export interface PlatformTarget {
    os: string;
    cpu: string;
    libc?: string;
}

/**
 * Result of one compatibility check. `current`/`required` carry npm's
 * EBADPLATFORM payload shape verbatim so a log line and a thrown error read
 * the same and can be diffed against npm's own output.
 */
export interface PlatformVerdict {
    ok: boolean;
    current: PlatformTarget;
    required: PlatformDeclaration;
}

/** Error thrown for an INCOMPATIBLE REQUIRED dependency. Mirrors npm's shape. */
export interface BadPlatformError extends Error {
    code: 'EBADPLATFORM';
    pkgid: string;
    current: PlatformTarget;
    required: PlatformDeclaration;
}

/**
 * Does `value` satisfy an npm platform field list?
 *
 * Verbatim port of `checkList` in npm-install-checks
 * (refs/npm-cli/node_modules/npm-install-checks/lib/index.js). Four rules,
 * and the ORDER of the last two is what makes negation work:
 *
 *   1. a bare string coerces to a one-element list;
 *   2. a list that is EXACTLY `['any']` always passes — note the length check:
 *      `['any', 'x']` does NOT short-circuit, `'any'` is then just a token
 *      that matches nothing. Reproduced deliberately;
 *   3. an exact match on a NEGATED entry (`!win32`) fails immediately, even if
 *      a positive entry later in the list would have matched;
 *   4. otherwise pass when at least one positive entry matched, OR when every
 *      entry was a negation (a pure blocklist means "everything else is fine").
 *
 * Consequence worth knowing before you "fix" it: an EMPTY list passes (rule 4,
 * `negated === list.length === 0`). npm behaves that way and manifests in the
 * wild do ship `"cpu": []`.
 *
 * `value` may be undefined (an unknown host libc). Undefined never equals a
 * list entry, so it only ever matches through the all-negations branch — which
 * is why {@link checkPlatform} needs its extra unknown-libc rule.
 */
export function checkList(value: string | undefined, list: PlatformFieldValue): boolean {
    const entries = typeof list === 'string' ? [list] : list;
    if (entries.length === 1 && entries[0] === 'any') return true;
    let negated = 0;
    let match = false;
    for (const entry of entries) {
        const negate = entry.charAt(0) === '!';
        const test = negate ? entry.slice(1) : entry;
        if (negate) {
            negated++;
            if (value === test) return false;
        } else {
            match = match || value === test;
        }
    }
    return match || negated === entries.length;
}

/**
 * Check a manifest's `os`/`cpu`/`libc` against a host triple.
 *
 * Port of `checkPlatform` (same source file). Two subtleties kept as-is:
 *
 *   - a field is consulted only when TRUTHY, so `""` reads as "not declared"
 *     (while `[]` is truthy and goes through {@link checkList}, which passes it);
 *   - a package that DECLARES `libc` while the host libc is unknown is
 *     incompatible, unconditionally. This is not derivable from `checkList`
 *     (`['!musl']` would otherwise pass on an unknown host) and it is the
 *     conservative direction: a musl binary loaded into a glibc process fails
 *     at `dlopen`, long after the install said it succeeded.
 *
 * Returns a verdict instead of throwing, because the CALLER decides what an
 * incompatibility means — fatal for a required dependency, silently inert for
 * an optional one (npm makes the same split, in arborist rather than here).
 */
export function checkPlatform(target: PlatformDeclaration, host: PlatformTarget): PlatformVerdict {
    const osOk = target.os ? checkList(host.os, target.os) : true;
    const cpuOk = target.cpu ? checkList(host.cpu, target.cpu) : true;
    let libcOk = target.libc ? checkList(host.libc, target.libc) : true;
    if (target.libc && !host.libc) libcOk = false;
    return {
        ok: osOk && cpuOk && libcOk,
        current: { os: host.os, cpu: host.cpu, libc: host.libc },
        required: { os: target.os, cpu: target.cpu, libc: target.libc },
    };
}

/** Does this manifest slice restrict its platform at all? */
export function declaresPlatform(target: PlatformDeclaration): boolean {
    return Boolean(target.os || target.cpu || target.libc);
}

/**
 * The EBADPLATFORM error npm throws for a required dependency the host cannot
 * run. Same `code`/`pkgid`/`current`/`required` properties, so a consumer's
 * error handling (and a human reading the message) sees what npm reports.
 */
export function badPlatformError(pkgid: string, verdict: PlatformVerdict): BadPlatformError {
    const err = new Error(
        `Unsupported platform for ${pkgid}: wanted ${JSON.stringify(verdict.required)} ` +
            `(current: ${JSON.stringify(verdict.current)})`,
    ) as BadPlatformError;
    err.code = 'EBADPLATFORM';
    err.pkgid = pkgid;
    err.current = verdict.current;
    err.required = verdict.required;
    return err;
}

/**
 * Everything the libc probe touches outside itself. Injected so the musl and
 * report-less branches are unit-testable from a glibc host.
 */
export interface LibcProbeHost {
    /** Read a file as UTF-8. `null` when it cannot be read at all. */
    readTextFile(path: string): string | null;
    /** List a directory. `null` when it cannot be read. */
    listDir(path: string): string[] | null;
    /**
     * The two libc-relevant facts out of Node's diagnostic report, or `null` on
     * a runtime that has none. GJS has no `process.report`, which is exactly
     * why this is a separate seam rather than an inline `process.report` read.
     *
     * FLATTENED on purpose: the raw report nests the first field under
     * `header`. A probe that had to mirror Node's report schema would be
     * tedious to fake in a spec for no gain — the only question asked of it is
     * these two values.
     */
    diagnosticReport(): { glibcVersionRuntime?: unknown; sharedObjects?: unknown } | null;
}

/** npm's `ldd` location — a data file to us, never executed. */
const LDD_PATH = '/usr/bin/ldd';

/**
 * Directories probed for a dynamic loader when there is no `process.report`.
 * `/lib` and `/lib64` are the classic locations; `/usr/lib` covers the
 * merged-/usr layouts (Fedora, Arch, Debian ≥ bookworm) where `/lib` is a
 * symlink and, on some containers, absent from the image entirely.
 */
const LOADER_DIRS = ['/lib', '/lib64', '/usr/lib'] as const;

function isMuslSharedObject(file: string): boolean {
    // npm's own predicate, verbatim: both spellings appear across distros.
    return file.includes('libc.musl-') || file.includes('ld-musl-');
}

/**
 * Read the libc family out of `/usr/bin/ldd`, which on every mainstream distro
 * is a TEXT script naming its own implementation. This is npm's primary probe
 * and it is pure file I/O, so it works unchanged under GJS.
 *
 * Three-valued on purpose, and the distinction drives the fallback chain:
 *   - `'musl'` / `'glibc'` — decided;
 *   - `null` — the file was READ but names neither implementation. npm treats
 *     that as final (do not consult the report), so we do too;
 *   - `undefined` — unreadable (no ldd at all: a scratch/distroless image),
 *     the only case that falls through.
 */
function libcFromLddFile(host: LibcProbeHost): string | null | undefined {
    const content = host.readTextFile(LDD_PATH);
    if (content === null) return undefined;
    if (content.includes('musl')) return 'musl';
    if (content.includes('GNU C Library')) return 'glibc';
    return null;
}

/**
 * npm's `process.report`-based probe (Node only). Takes the already-collected
 * report rather than the probe host: `getReport()` walks the whole process
 * state, so `detectLibc` collects it once and asks both questions of the same
 * snapshot.
 */
function libcFromReportData(report: { glibcVersionRuntime?: unknown; sharedObjects?: unknown }): string | null {
    if (report.glibcVersionRuntime) return 'glibc';
    if (Array.isArray(report.sharedObjects) && report.sharedObjects.some((so) => isMuslSharedObject(String(so)))) {
        return 'musl';
    }
    return null;
}

/**
 * Last-resort probe for a runtime with no `process.report`: look for the
 * dynamic loader itself. `ld-musl-<arch>.so.1` means musl,
 * `ld-linux-<arch>.so.2` (or `ld-linux.so.2`) means glibc.
 *
 * This logic used to live inline in `oxc-resolve.ts`, where it decided which
 * `@oxlint/binding-*` package to name in an install hint — and where a lazy
 * `require('node:fs')` inside its try/catch threw a ReferenceError that the
 * catch swallowed, silently pinning every host to `gnu`. It is here now so
 * there is ONE definition with ONE set of tests behind it; `oxc-resolve.ts`
 * calls this.
 *
 * glibc WINS a tie: a glibc workstation with a musl cross-toolchain installed
 * carries both loaders and is the realistic mixed case, whereas an Alpine box
 * carrying an `ld-linux-*` stub is not. (npm's report probe orders the two the
 * same way.)
 */
export function libcFromLoaderScan(host: LibcProbeHost, dirs: readonly string[] = LOADER_DIRS): string | null {
    let sawMusl = false;
    for (const dir of dirs) {
        const entries = host.listDir(dir);
        if (!entries) continue;
        for (const entry of entries) {
            if (entry.startsWith('ld-linux')) return 'glibc';
            if (entry.startsWith('ld-musl-')) sawMusl = true;
        }
    }
    return sawMusl ? 'musl' : null;
}

/**
 * Detect the host libc family. `undefined` = unknown (and, per
 * {@link checkPlatform}, that makes every libc-DECLARING package incompatible).
 *
 * Only meaningful on Linux; npm returns undefined for every other OS and so do
 * we — a declaration like `"libc": ["glibc"]` on a darwin package would
 * otherwise be judged against a value the platform has no concept of.
 *
 * Chain: ldd text → `process.report` when the runtime HAS one → loader scan.
 * The middle step keeps NODE PARITY exactly, including its `null` answer: we
 * deliberately do NOT fall through from a null report into the loader scan,
 * because the same lockfile must resolve to the same tree under Node and under
 * GJS. Diverging there would make "install once, run the bundle anywhere"
 * depend on which runtime ran the installer.
 */
export function detectLibc(os: string, host: LibcProbeHost): string | undefined {
    if (os !== 'linux') return undefined;
    const fromFile = libcFromLddFile(host);
    if (fromFile !== undefined) return fromFile ?? undefined;
    const report = host.diagnosticReport();
    if (report !== null) return libcFromReportData(report) ?? undefined;
    return libcFromLoaderScan(host) ?? undefined;
}

/** The real host probe: node:fs reads (which `@gjsify/fs` serves under GJS). */
export function defaultLibcProbeHost(): LibcProbeHost {
    return {
        readTextFile(path) {
            try {
                return readFileSync(path, 'utf-8');
            } catch {
                // Genuinely expected: distroless/scratch images ship no ldd,
                // and `/lib64` is absent on plenty of layouts. The caller
                // treats null as "probe the next source", so swallowing here
                // is the control flow, not a hidden failure.
                return null;
            }
        },
        listDir(path) {
            try {
                return readdirSync(path);
            } catch {
                return null;
            }
        },
        diagnosticReport() {
            // `process.report` is a Node diagnostic API that GJS's `process`
            // polyfill does not implement, so the existence check below is a
            // genuine per-runtime variance probe, not paranoia. The cast is
            // needed for a second reason: `excludeNetwork` is real (npm sets it)
            // but missing from @types/node's `ProcessReport`, so the typed
            // `process.report` cannot express the assignment.
            const report = (process as { report?: { excludeNetwork?: boolean; getReport?: () => unknown } }).report;
            if (!report || typeof report.getReport !== 'function') return null;
            // npm flips `excludeNetwork` first: gathering the network section
            // does DNS work that can take seconds on a host with an
            // unreachable resolver. Restore it so we don't mutate global
            // diagnostic state for the rest of the process.
            const previous = report.excludeNetwork;
            report.excludeNetwork = true;
            try {
                const raw = report.getReport() as {
                    header?: { glibcVersionRuntime?: unknown };
                    sharedObjects?: unknown;
                };
                return { glibcVersionRuntime: raw.header?.glibcVersionRuntime, sharedObjects: raw.sharedObjects };
            } finally {
                report.excludeNetwork = previous;
            }
        },
    };
}

/**
 * Memoized libc answer. npm caches the same way (a module-level `family`):
 * the probe reads files, and a resolve asks for the host triple once per
 * package. `libcProbed` is a separate flag because `undefined` is a legitimate
 * ANSWER (unknown libc), not a "not computed yet" marker.
 */
let cachedLibc: string | undefined;
let libcProbed = false;

/** Test-only: forget the memoized libc so a spec can re-probe with a new host. */
export function resetLibcCache(): void {
    cachedLibc = undefined;
    libcProbed = false;
}

/** Memoizing wrapper over {@link detectLibc}. */
export function hostLibc(os: string, host: LibcProbeHost = defaultLibcProbeHost()): string | undefined {
    if (!libcProbed) {
        cachedLibc = detectLibc(os, host);
        libcProbed = true;
    }
    return cachedLibc;
}

/**
 * Explicit target overrides. npm exposes these as the config keys `os`, `cpu`
 * and `libc`, which means an env `npm_config_<key>` sets them just as a
 * `--<key>` flag does; `gjsify install` mirrors both spellings (its
 * `--os/--cpu/--libc` flags write these keys, and `loadNpmrc` already honours
 * `npm_config_registry` the same way).
 *
 * Pure: the env block is a parameter. Empty/whitespace values are ignored
 * rather than treated as "the empty platform", so `npm_config_libc=` behaves
 * like an absent key.
 */
export function readPlatformOverrides(env: Record<string, string | undefined>): Partial<PlatformTarget> {
    const pick = (key: string): string | undefined => {
        const raw = env[key];
        if (typeof raw !== 'string') return undefined;
        const trimmed = raw.trim();
        return trimmed === '' ? undefined : trimmed;
    };
    const out: Partial<PlatformTarget> = {};
    const os = pick('npm_config_os');
    const cpu = pick('npm_config_cpu');
    const libc = pick('npm_config_libc');
    if (os !== undefined) out.os = os;
    if (cpu !== undefined) out.cpu = cpu;
    if (libc !== undefined) out.libc = libc;
    return out;
}

/**
 * Is the platform check bypassed? npm's `--force` (config key `force`)
 * suppresses the EBADPLATFORM THROW for a required dependency — it does NOT
 * un-skip an incompatible OPTIONAL one, which npm marks inert regardless
 * ("We ignore the --force and --engine-strict flags" — arborist
 * build-ideal-tree.js, the `node.optional && !node.inert` branch). Callers
 * must keep that asymmetry: forcing a required install is a user overriding a
 * declaration about their own machine; forcing an optional one would only
 * download a binary nothing can load.
 */
export function readPlatformForce(env: Record<string, string | undefined>): boolean {
    const raw = env.npm_config_force;
    if (typeof raw !== 'string') return false;
    const v = raw.trim().toLowerCase();
    return v === 'true' || v === '1';
}

/** Sources {@link resolveHostPlatform} may read. All optional, all injectable. */
export interface HostPlatformSources {
    /** Defaults to `process.platform`. */
    platform?: string;
    /** Defaults to `process.arch`. */
    arch?: string;
    /** Defaults to `process.env`; read for the npm config-key overrides. */
    env?: Record<string, string | undefined>;
    /** Defaults to {@link defaultLibcProbeHost}. */
    probe?: LibcProbeHost;
}

/**
 * The triple an install resolves against: the running host, with the npm
 * config keys applied on top.
 *
 * The libc probe runs only when the target OS is linux AND libc was not
 * overridden — so `--os=darwin` on a Linux host does no libc I/O and yields
 * `libc: undefined`, exactly as npm's `currentEnv.libc(os)` does. That is what
 * makes a single host able to test every branch (requirement behind the
 * `--os/--cpu/--libc` flags), and what keeps the check honest when a user
 * resolves a tree for a machine they are not on.
 *
 * Under GJS `process.platform`/`process.arch` come from `@gjsify/process`,
 * which derives them from `uname` through
 * `packages/gjs/utils/src/platform-names.ts`. That table is written against
 * NODE's vocabulary (`linux`/`darwin`/`win32`, `x64`/`arm64`), which is the
 * same vocabulary npm's `os`/`cpu` fields use — so the values are directly
 * comparable and need no translation layer here.
 */
export function resolveHostPlatform(sources: HostPlatformSources = {}): PlatformTarget {
    const env = sources.env ?? process.env;
    const overrides = readPlatformOverrides(env);
    const os = overrides.os ?? sources.platform ?? process.platform;
    const cpu = overrides.cpu ?? sources.arch ?? process.arch;
    const libc = overrides.libc ?? (os === 'linux' ? hostLibc(os, sources.probe ?? defaultLibcProbeHost()) : undefined);
    return { os, cpu, libc };
}

/** Human-readable target, for a one-line install log. */
export function describePlatformTarget(target: PlatformTarget): string {
    return `${target.os}-${target.cpu}${target.libc ? `-${target.libc}` : ''}`;
}

// SPDX-License-Identifier: MIT
//
// The darwin, win32 and musl branches are exercised HERE, on a glibc Linux CI
// host, by injecting foreign `platform`/`arch`/`libc` into pure functions. There
// is no musl runner in this repo's CI at all, so an injected `libc: 'musl'` is
// the ONLY way that branch ever executes.
//
// NOT covered, and not coverable off-host: whether `dyld` honours the
// `DYLD_LIBRARY_PATH` / `DYLD_FALLBACK_LIBRARY_PATH` we emit, whether Windows'
// `LoadLibrary` picks the DLL up off `PATH`, and whether a musl loader accepts a
// `-musl` prebuild. The darwin fallback half was measured by hand on the macOS
// 15.7.8 x86_64 test VM.

import { describe, it, expect } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    buildNativeEnv,
    canonicalPlatformToken,
    detectNativePackages,
    hostPlatformTokens,
    libraryPathVar,
    parsePlatformToken,
    platformPackageName,
    prebuildDirCandidates,
    resolveHostLibc,
    resolvePrebuildDirName,
} from './detect-native-packages.js';

/** Lay down `<root>/node_modules/<name>/` with a gjsify manifest + prebuild dirs. */
function seedPackage(
    root: string,
    name: string,
    opts: { prebuildDirs: string[]; platforms?: string[]; nodeModulesOf?: string },
): void {
    // `nodeModulesOf` seeds the ISOLATED layout — the package inside ANOTHER
    // package's `node_modules`, where pnpm's virtual store puts a per-platform
    // companion and where the CWD up-walk can never see it.
    const base = opts.nodeModulesOf ? join(root, 'node_modules', ...opts.nodeModulesOf.split('/')) : root;
    const pkgDir = join(base, 'node_modules', ...name.split('/'));
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify({
            name,
            version: '1.0.0',
            gjsify: { prebuilds: 'prebuilds', ...(opts.platforms ? { platforms: opts.platforms } : {}) },
        }),
    );
    for (const dir of opts.prebuildDirs) {
        mkdirSync(join(pkgDir, 'prebuilds', dir), { recursive: true });
        writeFileSync(join(pkgDir, 'prebuilds', dir, 'placeholder.txt'), '');
    }
}

export default async () => {
    await describe('canonicalPlatformToken', async () => {
        await it('folds the legacy uname arch onto the node spelling', async () => {
            // Lockstep with `ARCH_ALIASES` in `@gjsify/manifest-conformance`
            // (lib/platforms.mjs), which the platform audit canonicalises
            // `gjsify.platforms` through: a divergence lets a package pass the
            // audit while the CLI misses its directory.
            expect(canonicalPlatformToken('linux-x86_64')).toBe('linux-x64');
            expect(canonicalPlatformToken('linux-x64')).toBe('linux-x64');
            expect(canonicalPlatformToken('linux-aarch64')).toBe('linux-arm64');
            expect(canonicalPlatformToken('darwin-arm64')).toBe('darwin-arm64');
            expect(canonicalPlatformToken('win32-x64')).toBe('win32-x64');
            expect(canonicalPlatformToken('linux-riscv64')).toBe('linux-riscv64');
        });

        await it('carries the -musl suffix through, arch alias and all', async () => {
            // Grammar is `<os>-<arch>[-musl]`: normalise the arch WITHOUT losing
            // the libc half, or a musl declaration compares equal to the glibc
            // one and silently resolves a glibc directory on a musl host.
            expect(canonicalPlatformToken('linux-x64-musl')).toBe('linux-x64-musl');
            expect(canonicalPlatformToken('linux-x86_64-musl')).toBe('linux-x64-musl');
            expect(canonicalPlatformToken('linux-aarch64-musl')).toBe('linux-arm64-musl');
        });

        await it('does NOT drop a -musl suffix off a non-Linux token', async () => {
            // `darwin-arm64-musl` is malformed; canonicalising it to a VALID
            // token would hide it from the audit that rejects it.
            expect(canonicalPlatformToken('darwin-arm64-musl')).toBe('darwin-arm64-musl');
            expect(canonicalPlatformToken('win32-x64-musl')).toBe('win32-x64-musl');
        });
    });

    await describe('parsePlatformToken', async () => {
        await it('splits the three axes and only honours -musl on linux', async () => {
            expect(parsePlatformToken('linux-x64')).toStrictEqual({ os: 'linux', arch: 'x64', libc: null });
            expect(parsePlatformToken('linux-x64-musl')).toStrictEqual({ os: 'linux', arch: 'x64', libc: 'musl' });
            // npm's `libc` field is documented Linux-only, so `libc` stays null
            // and the caller reports the token instead of half-honouring it.
            expect(parsePlatformToken('darwin-arm64-musl')).toStrictEqual({
                os: 'darwin',
                arch: 'arm64',
                libc: null,
            });
        });
    });

    await describe('hostPlatformTokens', async () => {
        await it('prefers the -musl token on a musl host and keeps the plain one behind it', async () => {
            // The unsuffixed directory is the DEFAULT build, and for bridges that
            // record no `libc.so.6` at all (tls-native, webrtc-native on most
            // arches) it genuinely loads on musl — hence a fallback, not an
            // exclusion.
            expect(hostPlatformTokens('linux', 'x64', 'musl')).toStrictEqual(['linux-x64-musl', 'linux-x64']);
        });

        await it('never offers a -musl token on glibc', async () => {
            // A musl artifact cannot load against glibc, so probing for one can
            // only produce a false positive.
            expect(hostPlatformTokens('linux', 'x64', 'glibc')).toStrictEqual(['linux-x64']);
            expect(hostPlatformTokens('linux', 'x64')).toStrictEqual(['linux-x64']);
            expect(hostPlatformTokens('linux', 'x64', null)).toStrictEqual(['linux-x64']);
        });

        await it('ignores a musl claim on an OS that has no musl', async () => {
            expect(hostPlatformTokens('darwin', 'arm64', 'musl')).toStrictEqual(['darwin-arm64']);
            expect(hostPlatformTokens('win32', 'x64', 'musl')).toStrictEqual(['win32-x64']);
        });
    });

    await describe('resolveHostLibc', async () => {
        await it('trusts the glibc runtime version when the process exposes one', async () => {
            expect(resolveHostLibc({ platform: 'linux', glibcVersionRuntime: '2.42' })).toBe('glibc');
        });

        await it('falls back to the musl loader probe — the only one GJS can answer', async () => {
            // `@gjsify/process` has no `report`, so on GJS the glibc probe never
            // answers and this branch is the whole detection.
            expect(resolveHostLibc({ platform: 'linux', muslLoaderPresent: true })).toBe('musl');
            expect(resolveHostLibc({ platform: 'linux', muslLoaderPresent: false })).toBe('glibc');
            expect(resolveHostLibc({ platform: 'linux' })).toBe('glibc');
        });

        await it('reports no libc axis off Linux', async () => {
            // npm's `libc` field is Linux-only; every other OS has one C library.
            expect(resolveHostLibc({ platform: 'darwin', muslLoaderPresent: true })).toBe(null);
            expect(resolveHostLibc({ platform: 'win32' })).toBe(null);
        });
    });

    await describe('platformPackageName', async () => {
        await it('derives the companion package name for a target', async () => {
            // The `@gjsify/gtk-runtime-darwin-arm64` / napi-rs `<pkg>-<triple>`
            // pattern — ONE definition, shared by sibling resolution and the audit.
            expect(platformPackageName('@gjsify/rolldown-native', 'linux-x64')).toBe(
                '@gjsify/rolldown-native-linux-x64',
            );
            expect(platformPackageName('@gjsify/rolldown-native', 'linux-x64-musl')).toBe(
                '@gjsify/rolldown-native-linux-x64-musl',
            );
            expect(platformPackageName('some-native', 'darwin-arm64')).toBe('some-native-darwin-arm64');
        });
    });

    await describe('prebuildDirCandidates', async () => {
        await it('probes the canonical node spelling first on Linux', async () => {
            // The uname spelling stays as a trailing compat probe, for tarballs
            // published before the rename.
            expect(prebuildDirCandidates('linux', 'x64')).toStrictEqual(['linux-x64', 'linux-x86_64']);
            expect(prebuildDirCandidates('linux', 'arm64')).toStrictEqual(['linux-arm64', 'linux-aarch64']);
        });

        await it('collapses to one candidate when the spellings agree', async () => {
            // ppc64/s390x/riscv64 are spelled identically by node and uname.
            expect(prebuildDirCandidates('linux', 'ppc64')).toStrictEqual(['linux-ppc64']);
            expect(prebuildDirCandidates('linux', 's390x')).toStrictEqual(['linux-s390x']);
            expect(prebuildDirCandidates('linux', 'riscv64')).toStrictEqual(['linux-riscv64']);
        });

        await it('probes node-style first on darwin (what CI actually stages)', async () => {
            // prebuilds.yml stages `PREBUILD: darwin-arm64`, and on Apple silicon
            // `uname -m` also reports `arm64` — node-style IS the native spelling.
            expect(prebuildDirCandidates('darwin', 'arm64')).toStrictEqual(['darwin-arm64', 'darwin-aarch64']);
        });

        await it('probes node-style first on win32', async () => {
            expect(prebuildDirCandidates('win32', 'x64')).toStrictEqual(['win32-x64', 'win32-x86_64']);
        });

        await it('puts a pre-rename package’s OWN declared spelling ahead of the canonical name', async () => {
            // A pre-rename tarball declares AND ships `linux-x86_64`; probing its
            // declaration first loads it without the CLI having to guess.
            expect(prebuildDirCandidates('linux', 'x64', ['linux-x86_64', 'darwin-arm64'])).toStrictEqual([
                'linux-x86_64',
                'linux-x64',
            ]);
            expect(prebuildDirCandidates('linux', 'arm64', ['linux-x64', 'linux-arm64'])).toStrictEqual([
                'linux-arm64',
                'linux-aarch64',
            ]);
        });

        await it('ignores declared entries for other hosts', async () => {
            expect(prebuildDirCandidates('darwin', 'arm64', ['linux-x64', 'win32-x64'])).toStrictEqual([
                'darwin-arm64',
                'darwin-aarch64',
            ]);
        });

        await it('puts the -musl directory ahead of the default build on a musl host', async () => {
            expect(prebuildDirCandidates('linux', 'x64', undefined, 'musl')).toStrictEqual([
                'linux-x64-musl',
                'linux-x64',
                'linux-x86_64',
            ]);
        });

        await it('never offers a -musl directory on glibc, however it is declared', async () => {
            // Not merely "prefers the glibc one": the suffixed name must not
            // appear at all — even when the package declares it, which every
            // dual-libc package does.
            expect(prebuildDirCandidates('linux', 'x64', ['linux-x64', 'linux-x64-musl'], 'glibc')).toStrictEqual([
                'linux-x64',
                'linux-x86_64',
            ]);
            expect(prebuildDirCandidates('linux', 'x64', ['linux-x64-musl'])).toStrictEqual([
                'linux-x64',
                'linux-x86_64',
            ]);
        });

        await it('keeps the libc preference ahead of the declaration probe', async () => {
            // The declared-spelling probe wins within ONE host token but must NOT
            // reorder the libc axis: a musl host takes the musl directory before
            // any spelling of the default build.
            expect(prebuildDirCandidates('linux', 'x64', ['linux-x86_64', 'linux-x64-musl'], 'musl')).toStrictEqual([
                'linux-x64-musl',
                'linux-x86_64',
                'linux-x64',
            ]);
        });
    });

    await describe('resolvePrebuildDirName', async () => {
        await it('finds the canonical node-style dir every bridge now stages (linux)', async () => {
            expect(
                resolvePrebuildDirName({
                    platform: 'linux',
                    arch: 'x64',
                    declaredPlatforms: ['linux-x64', 'linux-arm64', 'darwin-arm64'],
                    existingDirs: ['linux-x64', 'linux-arm64', 'darwin-arm64'],
                }),
            ).toBe('linux-x64');
            expect(
                resolvePrebuildDirName({
                    platform: 'linux',
                    arch: 'arm64',
                    existingDirs: ['linux-arm64', 'darwin-arm64', 'win32-x64'],
                }),
            ).toBe('linux-arm64');
        });

        await it('still finds a pre-rename uname-style dir (undeclared tarball)', async () => {
            // A tarball published before `gjsify.platforms` existed ships
            // `linux-x86_64` and declares nothing.
            expect(
                resolvePrebuildDirName({
                    platform: 'linux',
                    arch: 'x64',
                    existingDirs: ['linux-x86_64', 'linux-aarch64', 'darwin-arm64'],
                }),
            ).toBe('linux-x86_64');
        });

        await it('finds darwin-arm64 — the case the hardcoded `linux-` prefix made impossible', async () => {
            expect(
                resolvePrebuildDirName({
                    platform: 'darwin',
                    arch: 'arm64',
                    declaredPlatforms: ['linux-x64', 'linux-arm64', 'darwin-arm64'],
                    existingDirs: ['linux-x64', 'linux-arm64', 'darwin-arm64'],
                }),
            ).toBe('darwin-arm64');
        });

        await it('finds win32-x64', async () => {
            expect(
                resolvePrebuildDirName({
                    platform: 'win32',
                    arch: 'x64',
                    declaredPlatforms: ['linux-x64', 'linux-arm64', 'darwin-arm64', 'win32-x64'],
                    existingDirs: ['linux-x64', 'darwin-arm64', 'win32-x64'],
                }),
            ).toBe('win32-x64');
        });

        await it('returns null when the host has no artifact', async () => {
            // `@gjsify/sab-native` is Linux-only by design (ADR 0013) — a macOS
            // host must get a clean "nothing here", not a bogus directory.
            expect(
                resolvePrebuildDirName({
                    platform: 'darwin',
                    arch: 'arm64',
                    declaredPlatforms: ['linux-x64', 'linux-arm64'],
                    existingDirs: ['linux-x64', 'linux-arm64'],
                }),
            ).toBe(null);
        });

        await it('picks the -musl directory on a musl host when one is shipped', async () => {
            expect(
                resolvePrebuildDirName({
                    platform: 'linux',
                    arch: 'x64',
                    declaredPlatforms: ['linux-x64', 'linux-x64-musl', 'linux-arm64'],
                    existingDirs: ['linux-x64', 'linux-x64-musl', 'linux-arm64'],
                    libc: 'musl',
                }),
            ).toBe('linux-x64-musl');
        });

        await it('falls back to the default build on a musl host with no -musl artifact', async () => {
            // Correct for the libc-AGNOSTIC bridges (no `libc.so.6` in DT_NEEDED
            // at all), which is why the fallback exists rather than returning
            // null. Whether a package may be installed on musl is the `libc`
            // manifest field's job; the `prebuild-libc` audit holds that field to
            // what the binaries actually record.
            expect(
                resolvePrebuildDirName({
                    platform: 'linux',
                    arch: 'x64',
                    declaredPlatforms: ['linux-x64'],
                    existingDirs: ['linux-x64'],
                    libc: 'musl',
                }),
            ).toBe('linux-x64');
        });

        await it('refuses a -musl directory on a glibc host', async () => {
            // The one directional guarantee. With only the musl build shipped the
            // answer is a clean miss, then the package's own graceful no-native
            // path — never a library that cannot be dlopen'ed.
            expect(
                resolvePrebuildDirName({
                    platform: 'linux',
                    arch: 'x64',
                    declaredPlatforms: ['linux-x64-musl'],
                    existingDirs: ['linux-x64-musl'],
                    libc: 'glibc',
                }),
            ).toBe(null);
            expect(
                resolvePrebuildDirName({
                    platform: 'linux',
                    arch: 'x64',
                    declaredPlatforms: ['linux-x64', 'linux-x64-musl'],
                    existingDirs: ['linux-x64', 'linux-x64-musl'],
                    libc: 'glibc',
                }),
            ).toBe('linux-x64');
        });
    });

    await describe('libraryPathVar', async () => {
        await it('maps each OS to the variable its loader actually reads', async () => {
            expect(libraryPathVar('linux')).toStrictEqual({ name: 'LD_LIBRARY_PATH', separator: ':' });
            // dyld ignores LD_LIBRARY_PATH entirely — why every macOS gate step in
            // .github/workflows/napi.yml sets DYLD_LIBRARY_PATH.
            expect(libraryPathVar('darwin')).toStrictEqual({ name: 'DYLD_LIBRARY_PATH', separator: ':' });
            // Windows has no dedicated variable; `LoadLibrary` searches PATH.
            expect(libraryPathVar('win32')).toStrictEqual({ name: 'PATH', separator: ';' });
        });
    });

    await describe('buildNativeEnv', async () => {
        const pkgs = [
            { name: '@gjsify/tls-native', prebuildsDir: '/p/tls/prebuilds/X' },
            { name: '@gjsify/http2-native', prebuildsDir: '/p/http2/prebuilds/X' },
        ];

        // The HOST's GI libdirs are a third injected fact: the real derivation
        // probes the running filesystem, so leaving it live would make the darwin
        // rows below answer differently on a Linux CI box, a Mac, and a Mac
        // without GTK. Its own branches live in `system-gi.spec.ts`; these rows
        // pin what `buildNativeEnv` DOES with the answer.
        const noSystemGi = () => [];
        const brewX64 = () => ['/usr/local/lib'];

        await it('emits LD_LIBRARY_PATH on Linux and preserves the inherited value', async () => {
            const env = buildNativeEnv(pkgs, {
                platform: 'linux',
                env: { LD_LIBRARY_PATH: '/usr/local/lib', GI_TYPELIB_PATH: '/usr/lib/girepository-1.0' },
                systemGiDirs: noSystemGi,
            });
            expect(env.LD_LIBRARY_PATH).toBe('/p/tls/prebuilds/X:/p/http2/prebuilds/X:/usr/local/lib');
            expect(env.GI_TYPELIB_PATH).toBe('/p/tls/prebuilds/X:/p/http2/prebuilds/X:/usr/lib/girepository-1.0');
            expect(env.DYLD_LIBRARY_PATH).toBeUndefined();
        });

        await it('emits DYLD_LIBRARY_PATH — and no LD_LIBRARY_PATH — on darwin', async () => {
            const env = buildNativeEnv(pkgs, { platform: 'darwin', env: {}, systemGiDirs: noSystemGi });
            expect(env.DYLD_LIBRARY_PATH).toBe('/p/tls/prebuilds/X:/p/http2/prebuilds/X');
            // A dead LD_LIBRARY_PATH once shipped here: emitted, ignored by dyld,
            // prebuild never loaded.
            expect(env.LD_LIBRARY_PATH).toBeUndefined();
        });

        await it('prepends to PATH with `;` on win32', async () => {
            const env = buildNativeEnv(pkgs, {
                platform: 'win32',
                env: { PATH: 'C:\\Windows\\System32' },
                systemGiDirs: noSystemGi,
            });
            expect(env.PATH).toBe('/p/tls/prebuilds/X;/p/http2/prebuilds/X;C:\\Windows\\System32');
            // GLib's G_SEARCHPATH_SEPARATOR is `;` on Windows too.
            expect(env.GI_TYPELIB_PATH).toBe('/p/tls/prebuilds/X;/p/http2/prebuilds/X');
        });

        await it('reuses the host’s own PATH casing on win32', async () => {
            // A stock Windows env block spells it `Path`, and a plain JS object is
            // case-sensitive — writing `PATH` alongside it hands a child process
            // two competing entries.
            const env = buildNativeEnv(pkgs, {
                platform: 'win32',
                env: { Path: 'C:\\Windows' },
                systemGiDirs: noSystemGi,
            });
            expect(env.Path).toBe('/p/tls/prebuilds/X;/p/http2/prebuilds/X;C:\\Windows');
            expect(env.PATH).toBeUndefined();
        });

        await it('omits an empty inherited value instead of a trailing separator', async () => {
            const env = buildNativeEnv([pkgs[0]!], {
                platform: 'linux',
                env: {},
                systemGiDirs: noSystemGi,
            });
            expect(env.LD_LIBRARY_PATH).toBe('/p/tls/prebuilds/X');
            expect(env.GI_TYPELIB_PATH).toBe('/p/tls/prebuilds/X');
        });

        // The host's own GI libdirs (darwin only). Measured on the macOS 15.7.8
        // x86_64 VM: bare `gjs -c "imports.gi.Gtk; Gtk.init()"` dies in
        // `g_module_open('libgtk-4.1.dylib')` because Homebrew's `gjs` has an
        // rpath into GLib's keg only and dyld's default fallback path holds
        // neither `/usr/local/lib` nor `/opt/homebrew/lib` — so GTK showcases were
        // broken under `--runtime gjs` and fine under `--runtime node`, which
        // node-gi had already repaired. Full trace in `utils/system-gi.ts`.

        await it('puts the host GI libdirs on DYLD_FALLBACK_LIBRARY_PATH on darwin', async () => {
            const env = buildNativeEnv(pkgs, { platform: 'darwin', env: {}, systemGiDirs: brewX64 });
            // `/usr/lib` is APPENDED because setting the variable REPLACES dyld's
            // own default fallback list — emitting only our dir would silently
            // remove /usr/lib from the search.
            expect(env.DYLD_FALLBACK_LIBRARY_PATH).toBe('/usr/local/lib:/usr/lib');
        });

        await it('keeps DYLD_LIBRARY_PATH carrying ONLY the prebuild dirs', async () => {
            // The override variable wins by LEAF for every dylib in the process,
            // including ones the host resolved correctly, so a system libdir here
            // would shadow the very libraries a prebuild links against.
            const env = buildNativeEnv(pkgs, { platform: 'darwin', env: {}, systemGiDirs: brewX64 });
            expect(env.DYLD_LIBRARY_PATH).toBe('/p/tls/prebuilds/X:/p/http2/prebuilds/X');
            // GI finds the host's typelibs on its own search path already — only
            // the loader was blind, so the typelib variable is untouched.
            expect(env.GI_TYPELIB_PATH).toBe('/p/tls/prebuilds/X:/p/http2/prebuilds/X');
        });

        await it('PREPENDS to an existing DYLD_FALLBACK_LIBRARY_PATH rather than replacing it', async () => {
            // An inherited value must survive, and stay BEHIND ours so a host that
            // pointed at a specific stack does not out-rank our prefix.
            const env = buildNativeEnv(pkgs, {
                platform: 'darwin',
                env: { DYLD_FALLBACK_LIBRARY_PATH: '/opt/ci/lib:/usr/lib' },
                systemGiDirs: brewX64,
            });
            expect(env.DYLD_FALLBACK_LIBRARY_PATH).toBe('/usr/local/lib:/opt/ci/lib:/usr/lib');
            // The inherited value already carries /usr/lib, so it is not added twice.
            expect(env.DYLD_FALLBACK_LIBRARY_PATH?.split(':').filter((d) => d === '/usr/lib').length).toBe(1);
        });

        await it('emits it with NO native packages at all — the gap is the host loader', async () => {
            // The defect has nothing to do with gjsify prebuilds — a plain
            // `gjsify run script.gjs.js` touching GTK hits it too. If this row ever
            // needs `packages` non-empty, the fix has been narrowed too far.
            const env = buildNativeEnv([], { platform: 'darwin', env: {}, systemGiDirs: brewX64 });
            expect(env.DYLD_FALLBACK_LIBRARY_PATH).toBe('/usr/local/lib:/usr/lib');
        });

        await it('leaves the variable ALONE off darwin', async () => {
            // `systemGiLibraryDirs()` is itself `[]` on every other platform (ld.so's
            // configured cache on Linux; `LoadLibrary` re-reading PATH on Windows),
            // so nothing here needs a second platform test. Note this row passes the
            // EMPTY stub, so it cannot distinguish the platform gate from the stub
            // agreeing — the row below covers the gate with the live derivation.
            for (const platform of ['linux', 'win32']) {
                const env = buildNativeEnv(pkgs, { platform, env: {}, systemGiDirs: noSystemGi });
                expect(env.DYLD_FALLBACK_LIBRARY_PATH).toBeUndefined();
            }
        });

        await it('leaves a Mac with no GI stack byte-unchanged', async () => {
            // Nothing to point at, and writing an empty variable would REPLACE
            // dyld's default fallback list with nothing — worse than not writing it.
            const env = buildNativeEnv(pkgs, { platform: 'darwin', env: {}, systemGiDirs: noSystemGi });
            expect(env.DYLD_FALLBACK_LIBRARY_PATH).toBeUndefined();
        });

        await it('uses the real derivation by default — no injection, no darwin, no variable', async () => {
            // The default parameter is what production takes; every row above would
            // still pass if it were wired to a stub and nothing else. This one runs
            // the live `systemGiLibraryDirs` and holds on any host, because its own
            // platform gate returns `[]` for `linux`/`win32`.
            for (const platform of ['linux', 'win32']) {
                const env = buildNativeEnv(pkgs, { platform, env: {} });
                expect(env.DYLD_FALLBACK_LIBRARY_PATH).toBeUndefined();
            }
        });
    });

    await describe('detectNativePackages (foreign platform injected)', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-detect-native-'));
        try {
            // Mirrors the real tree: every bridge stages the node spelling,
            // sab-native is Linux-only (ADR 0013), and `@gjsify/legacy-native`
            // stands in for a pre-rename tarball — uname-style dirs, no
            // `gjsify.platforms` at all.
            seedPackage(root, '@gjsify/tls-native', {
                prebuildDirs: ['linux-x64', 'linux-arm64', 'darwin-arm64'],
                platforms: ['linux-x64', 'linux-arm64', 'darwin-arm64'],
            });
            seedPackage(root, '@gjsify/node-gi', {
                prebuildDirs: ['linux-x64', 'linux-arm64', 'darwin-arm64', 'win32-x64'],
                platforms: ['linux-x64', 'linux-arm64', 'darwin-arm64', 'win32-x64'],
            });
            seedPackage(root, '@gjsify/sab-native', {
                prebuildDirs: ['linux-x64'],
                platforms: ['linux-x64'],
            });
            seedPackage(root, '@gjsify/legacy-native', {
                prebuildDirs: ['linux-x86_64', 'linux-aarch64'],
            });

            const byName = (pkgs: Array<{ name: string; prebuildsDir: string }>) =>
                Object.fromEntries(pkgs.map((p) => [p.name, p.prebuildsDir]));

            await it('resolves the canonical spelling — and a legacy one — from one walk (linux/x64)', async () => {
                const found = byName(detectNativePackages(root, { platform: 'linux', arch: 'x64' }));
                expect(found['@gjsify/tls-native']).toBe(
                    join(root, 'node_modules/@gjsify/tls-native/prebuilds/linux-x64'),
                );
                expect(found['@gjsify/node-gi']).toBe(join(root, 'node_modules/@gjsify/node-gi/prebuilds/linux-x64'));
                expect(found['@gjsify/sab-native']).toBe(
                    join(root, 'node_modules/@gjsify/sab-native/prebuilds/linux-x64'),
                );
                // Backward compatibility with tarballs already on npm.
                expect(found['@gjsify/legacy-native']).toBe(
                    join(root, 'node_modules/@gjsify/legacy-native/prebuilds/linux-x86_64'),
                );
            });

            await it('resolves darwin-arm64 and skips the Linux-only packages', async () => {
                const found = byName(detectNativePackages(root, { platform: 'darwin', arch: 'arm64' }));
                expect(found['@gjsify/tls-native']).toBe(
                    join(root, 'node_modules/@gjsify/tls-native/prebuilds/darwin-arm64'),
                );
                expect(found['@gjsify/node-gi']).toBe(
                    join(root, 'node_modules/@gjsify/node-gi/prebuilds/darwin-arm64'),
                );
                // Linux-only by design — must be absent, not mis-resolved.
                expect(found['@gjsify/sab-native']).toBeUndefined();
                expect(found['@gjsify/legacy-native']).toBeUndefined();
            });

            await it('resolves win32-x64 and skips packages without a Windows artifact', async () => {
                const found = byName(detectNativePackages(root, { platform: 'win32', arch: 'x64' }));
                expect(found['@gjsify/node-gi']).toBe(join(root, 'node_modules/@gjsify/node-gi/prebuilds/win32-x64'));
                expect(found['@gjsify/tls-native']).toBeUndefined();
                expect(found['@gjsify/sab-native']).toBeUndefined();
            });

            await it('resolves the legacy uname spelling on linux/arm64 too', async () => {
                const found = byName(detectNativePackages(root, { platform: 'linux', arch: 'arm64' }));
                expect(found['@gjsify/legacy-native']).toBe(
                    join(root, 'node_modules/@gjsify/legacy-native/prebuilds/linux-aarch64'),
                );
            });

            await it('finds nothing for a host no package ships for', async () => {
                expect(detectNativePackages(root, { platform: 'linux', arch: 's390x' })).toStrictEqual([]);
            });

            await it('takes the -musl artifact on a musl host and the default build on glibc', async () => {
                seedPackage(root, '@gjsify/duallibc-native', {
                    prebuildDirs: ['linux-x64', 'linux-x64-musl'],
                    platforms: ['linux-x64', 'linux-x64-musl'],
                });
                const onMusl = byName(detectNativePackages(root, { platform: 'linux', arch: 'x64', libc: 'musl' }));
                expect(onMusl['@gjsify/duallibc-native']).toBe(
                    join(root, 'node_modules/@gjsify/duallibc-native/prebuilds/linux-x64-musl'),
                );
                const onGlibc = byName(detectNativePackages(root, { platform: 'linux', arch: 'x64', libc: 'glibc' }));
                expect(onGlibc['@gjsify/duallibc-native']).toBe(
                    join(root, 'node_modules/@gjsify/duallibc-native/prebuilds/linux-x64'),
                );
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    await describe('detectNativePackages (per-platform companion packages)', async () => {
        // The layout a bridge SPLIT into per-platform npm packages produces: the
        // depending package keeps the declaration and ships no binary,
        // `<name>-<token>` carries it. Seeded in the ISOLATED position — inside the
        // depending package's OWN `node_modules` — because that is the case the CWD
        // up-walk structurally cannot reach, and the reason the second pass exists.
        // A hoisted layout needs no help; the up-walk lists the companion normally.
        const root = mkdtempSync(join(tmpdir(), 'gjsify-detect-sibling-'));
        try {
            seedPackage(root, '@gjsify/split-native', { prebuildDirs: [], platforms: ['linux-x64', 'darwin-arm64'] });
            seedPackage(root, '@gjsify/split-native-linux-x64', {
                prebuildDirs: ['linux-x64'],
                platforms: ['linux-x64'],
                nodeModulesOf: '@gjsify/split-native',
            });
            seedPackage(root, '@gjsify/split-native-linux-x64-musl', {
                prebuildDirs: ['linux-x64-musl'],
                platforms: ['linux-x64-musl'],
                nodeModulesOf: '@gjsify/split-native',
            });

            const byName = (pkgs: Array<{ name: string; prebuildsDir: string }>) =>
                Object.fromEntries(pkgs.map((p) => [p.name, p.prebuildsDir]));
            const nested = (name: string, dir: string) =>
                join(root, 'node_modules/@gjsify/split-native/node_modules', name, 'prebuilds', dir);

            await it('resolves a companion package from the depending package’s own node_modules', async () => {
                const found = byName(detectNativePackages(root, { platform: 'linux', arch: 'x64', libc: 'glibc' }));
                expect(found['@gjsify/split-native-linux-x64']).toBe(
                    nested('@gjsify/split-native-linux-x64', 'linux-x64'),
                );
                // The depending package contributes no directory — it has none, and
                // inventing one would put a non-existent path on GI_TYPELIB_PATH.
                expect(found['@gjsify/split-native']).toBeUndefined();
            });

            await it('applies the libc preference to the companion NAME, not just the directory', async () => {
                // The split moves the target into the package name, so the musl
                // decision happens one level earlier. Getting it wrong is silent:
                // the glibc companion resolves fine, then fails at `dlopen` on the
                // user's Alpine box.
                const found = byName(detectNativePackages(root, { platform: 'linux', arch: 'x64', libc: 'musl' }));
                expect(found['@gjsify/split-native-linux-x64-musl']).toBe(
                    nested('@gjsify/split-native-linux-x64-musl', 'linux-x64-musl'),
                );
                expect(found['@gjsify/split-native-linux-x64']).toBeUndefined();
            });

            await it('adds nothing for a host with no companion package', async () => {
                // Declared `darwin-arm64`, no companion installed — a macOS host
                // must get a clean miss, not the linux artifact.
                expect(detectNativePackages(root, { platform: 'darwin', arch: 'arm64' })).toStrictEqual([]);
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
};

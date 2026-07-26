// SPDX-License-Identifier: MIT
// Unit tests for native-prebuild resolution across operating systems.
//
// The whole point of this file: the darwin and win32 branches are exercised
// HERE, on a Linux CI host, by injecting foreign `platform`/`arch` values into
// pure functions. Before the OS-axis fix these branches did not exist —
// `checkPackage` interpolated a literal `linux-` prefix and `buildNativeEnv`
// only ever emitted `LD_LIBRARY_PATH`, so the `darwin-arm64` prebuilds
// `.github/workflows/prebuilds.yml` produces were unreachable.
//
// What is NOT covered here (and cannot be, off-host): whether `dyld` actually
// honours the `DYLD_LIBRARY_PATH` we emit, and whether Windows' `LoadLibrary`
// picks the DLL up off `PATH`. Those are CI-only, on the real OS.

import { describe, it, expect } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    buildNativeEnv,
    canonicalPlatformToken,
    detectNativePackages,
    libraryPathVar,
    prebuildDirCandidates,
    resolvePrebuildDirName,
} from './detect-native-packages.js';

/** Lay down `<root>/node_modules/<name>/` with a gjsify manifest + prebuild dirs. */
function seedPackage(root: string, name: string, opts: { prebuildDirs: string[]; platforms?: string[] }): void {
    const pkgDir = join(root, 'node_modules', ...name.split('/'));
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
        await it('normalises node-style arch onto the uname spelling', async () => {
            // Must stay in lockstep with `ARCH_ALIASES` in
            // scripts/audit-runtimes.mjs — the platform-support audit
            // canonicalises `gjsify.platforms` the same way, and a divergence
            // would let a package pass the audit while the CLI misses its dir.
            expect(canonicalPlatformToken('linux-x64')).toBe('linux-x86_64');
            expect(canonicalPlatformToken('linux-x86_64')).toBe('linux-x86_64');
            expect(canonicalPlatformToken('darwin-arm64')).toBe('darwin-aarch64');
            expect(canonicalPlatformToken('win32-x64')).toBe('win32-x86_64');
            expect(canonicalPlatformToken('linux-riscv64')).toBe('linux-riscv64');
        });
    });

    await describe('prebuildDirCandidates', async () => {
        await it('probes uname-style first on Linux, then the node spelling', async () => {
            expect(prebuildDirCandidates('linux', 'x64')).toStrictEqual(['linux-x86_64', 'linux-x64']);
            expect(prebuildDirCandidates('linux', 'arm64')).toStrictEqual(['linux-aarch64', 'linux-arm64']);
        });

        await it('collapses to one candidate when the spellings agree', async () => {
            // ppc64/s390x/riscv64 are spelled identically by node and uname.
            expect(prebuildDirCandidates('linux', 'ppc64')).toStrictEqual(['linux-ppc64']);
            expect(prebuildDirCandidates('linux', 's390x')).toStrictEqual(['linux-s390x']);
        });

        await it('probes node-style first on darwin (what CI actually stages)', async () => {
            // prebuilds.yml stages `PREBUILD: darwin-arm64`; on Apple silicon
            // `uname -m` also reports `arm64`, so node-style IS the native one.
            expect(prebuildDirCandidates('darwin', 'arm64')).toStrictEqual(['darwin-arm64', 'darwin-aarch64']);
        });

        await it('probes node-style first on win32', async () => {
            expect(prebuildDirCandidates('win32', 'x64')).toStrictEqual(['win32-x64', 'win32-x86_64']);
        });

        await it('puts the package’s OWN declared spelling ahead of the guesses', async () => {
            // `gjsify.platforms` tells us the exact directory name the package
            // stages, whatever convention it picked — strictly better than
            // guessing, and it is why both conventions can coexist.
            expect(prebuildDirCandidates('linux', 'x64', ['linux-x64', 'darwin-arm64'])).toStrictEqual([
                'linux-x64',
                'linux-x86_64',
            ]);
            expect(prebuildDirCandidates('darwin', 'arm64', ['darwin-aarch64'])).toStrictEqual([
                'darwin-aarch64',
                'darwin-arm64',
            ]);
        });

        await it('ignores declared entries for other hosts', async () => {
            expect(prebuildDirCandidates('darwin', 'arm64', ['linux-x86_64', 'win32-x64'])).toStrictEqual([
                'darwin-arm64',
                'darwin-aarch64',
            ]);
        });
    });

    await describe('resolvePrebuildDirName', async () => {
        await it('finds the uname-style dir the Vala bridges stage (linux)', async () => {
            expect(
                resolvePrebuildDirName({
                    platform: 'linux',
                    arch: 'x64',
                    existingDirs: ['linux-x86_64', 'linux-aarch64', 'darwin-arm64'],
                }),
            ).toBe('linux-x86_64');
        });

        await it('finds the node-style dir @gjsify/node-gi stages (linux)', async () => {
            expect(
                resolvePrebuildDirName({
                    platform: 'linux',
                    arch: 'arm64',
                    existingDirs: ['linux-arm64', 'darwin-arm64', 'win32-x64'],
                }),
            ).toBe('linux-arm64');
        });

        await it('finds darwin-arm64 — the case the hardcoded `linux-` prefix made impossible', async () => {
            expect(
                resolvePrebuildDirName({
                    platform: 'darwin',
                    arch: 'arm64',
                    declaredPlatforms: ['linux-x86_64', 'linux-aarch64', 'darwin-arm64'],
                    existingDirs: ['linux-x86_64', 'linux-aarch64', 'darwin-arm64'],
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
            // @gjsify/sab-native is Linux-only by design (ADR 0013) — a macOS
            // host must get a clean "nothing here", not a bogus directory.
            expect(
                resolvePrebuildDirName({
                    platform: 'darwin',
                    arch: 'arm64',
                    declaredPlatforms: ['linux-x86_64', 'linux-aarch64'],
                    existingDirs: ['linux-x86_64', 'linux-aarch64'],
                }),
            ).toBe(null);
        });
    });

    await describe('libraryPathVar', async () => {
        await it('maps each OS to the variable its loader actually reads', async () => {
            expect(libraryPathVar('linux')).toStrictEqual({ name: 'LD_LIBRARY_PATH', separator: ':' });
            // dyld ignores LD_LIBRARY_PATH entirely — this is why every macOS
            // gate step in .github/workflows/napi.yml sets DYLD_LIBRARY_PATH.
            expect(libraryPathVar('darwin')).toStrictEqual({ name: 'DYLD_LIBRARY_PATH', separator: ':' });
            // Windows has no dedicated variable; LoadLibrary searches PATH.
            expect(libraryPathVar('win32')).toStrictEqual({ name: 'PATH', separator: ';' });
        });
    });

    await describe('buildNativeEnv', async () => {
        const pkgs = [
            { name: '@gjsify/tls-native', prebuildsDir: '/p/tls/prebuilds/X' },
            { name: '@gjsify/http2-native', prebuildsDir: '/p/http2/prebuilds/X' },
        ];

        await it('emits LD_LIBRARY_PATH on Linux and preserves the inherited value', async () => {
            const env = buildNativeEnv(pkgs, {
                platform: 'linux',
                env: { LD_LIBRARY_PATH: '/usr/local/lib', GI_TYPELIB_PATH: '/usr/lib/girepository-1.0' },
            });
            expect(env.LD_LIBRARY_PATH).toBe('/p/tls/prebuilds/X:/p/http2/prebuilds/X:/usr/local/lib');
            expect(env.GI_TYPELIB_PATH).toBe('/p/tls/prebuilds/X:/p/http2/prebuilds/X:/usr/lib/girepository-1.0');
            expect(env.DYLD_LIBRARY_PATH).toBeUndefined();
        });

        await it('emits DYLD_LIBRARY_PATH — and no LD_LIBRARY_PATH — on darwin', async () => {
            const env = buildNativeEnv(pkgs, { platform: 'darwin', env: {} });
            expect(env.DYLD_LIBRARY_PATH).toBe('/p/tls/prebuilds/X:/p/http2/prebuilds/X');
            // A dead LD_LIBRARY_PATH is exactly what shipped before: emitted,
            // ignored by dyld, and the prebuild never loaded.
            expect(env.LD_LIBRARY_PATH).toBeUndefined();
        });

        await it('prepends to PATH with `;` on win32', async () => {
            const env = buildNativeEnv(pkgs, {
                platform: 'win32',
                env: { PATH: 'C:\\Windows\\System32' },
            });
            expect(env.PATH).toBe('/p/tls/prebuilds/X;/p/http2/prebuilds/X;C:\\Windows\\System32');
            // GLib's G_SEARCHPATH_SEPARATOR is `;` on Windows too.
            expect(env.GI_TYPELIB_PATH).toBe('/p/tls/prebuilds/X;/p/http2/prebuilds/X');
        });

        await it('reuses the host’s own PATH casing on win32', async () => {
            // A stock Windows env block spells it `Path`. A plain JS object is
            // case-sensitive, so writing `PATH` alongside it would hand a child
            // process two competing entries.
            const env = buildNativeEnv(pkgs, { platform: 'win32', env: { Path: 'C:\\Windows' } });
            expect(env.Path).toBe('/p/tls/prebuilds/X;/p/http2/prebuilds/X;C:\\Windows');
            expect(env.PATH).toBeUndefined();
        });

        await it('omits an empty inherited value instead of a trailing separator', async () => {
            const env = buildNativeEnv([pkgs[0]!], { platform: 'linux', env: {} });
            expect(env.LD_LIBRARY_PATH).toBe('/p/tls/prebuilds/X');
            expect(env.GI_TYPELIB_PATH).toBe('/p/tls/prebuilds/X');
        });
    });

    await describe('detectNativePackages (foreign platform injected)', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-detect-native-'));
        try {
            // Mirrors the real tree: Vala bridges stage uname-style + darwin,
            // node-gi stages node-style everywhere, sab-native is Linux-only.
            seedPackage(root, '@gjsify/tls-native', {
                prebuildDirs: ['linux-x86_64', 'linux-aarch64', 'darwin-arm64'],
                platforms: ['linux-x86_64', 'linux-aarch64', 'darwin-arm64'],
            });
            seedPackage(root, '@gjsify/node-gi', {
                prebuildDirs: ['linux-x64', 'linux-arm64', 'darwin-arm64', 'win32-x64'],
                platforms: ['linux-x64', 'linux-arm64', 'darwin-arm64', 'win32-x64'],
            });
            seedPackage(root, '@gjsify/sab-native', {
                prebuildDirs: ['linux-x86_64'],
                platforms: ['linux-x86_64'],
            });

            const byName = (pkgs: Array<{ name: string; prebuildsDir: string }>) =>
                Object.fromEntries(pkgs.map((p) => [p.name, p.prebuildsDir]));

            await it('resolves BOTH naming conventions from one walk (linux/x64)', async () => {
                const found = byName(detectNativePackages(root, { platform: 'linux', arch: 'x64' }));
                expect(found['@gjsify/tls-native']).toBe(
                    join(root, 'node_modules/@gjsify/tls-native/prebuilds/linux-x86_64'),
                );
                expect(found['@gjsify/node-gi']).toBe(join(root, 'node_modules/@gjsify/node-gi/prebuilds/linux-x64'));
                expect(found['@gjsify/sab-native']).toBe(
                    join(root, 'node_modules/@gjsify/sab-native/prebuilds/linux-x86_64'),
                );
            });

            await it('resolves darwin-arm64 for both conventions, and skips the Linux-only package', async () => {
                const found = byName(detectNativePackages(root, { platform: 'darwin', arch: 'arm64' }));
                expect(found['@gjsify/tls-native']).toBe(
                    join(root, 'node_modules/@gjsify/tls-native/prebuilds/darwin-arm64'),
                );
                expect(found['@gjsify/node-gi']).toBe(
                    join(root, 'node_modules/@gjsify/node-gi/prebuilds/darwin-arm64'),
                );
                // Linux-only by design — must be absent, not mis-resolved.
                expect(found['@gjsify/sab-native']).toBeUndefined();
            });

            await it('resolves win32-x64 and skips packages without a Windows artifact', async () => {
                const found = byName(detectNativePackages(root, { platform: 'win32', arch: 'x64' }));
                expect(found['@gjsify/node-gi']).toBe(join(root, 'node_modules/@gjsify/node-gi/prebuilds/win32-x64'));
                expect(found['@gjsify/tls-native']).toBeUndefined();
                expect(found['@gjsify/sab-native']).toBeUndefined();
            });

            await it('finds nothing for a host no package ships for', async () => {
                expect(detectNativePackages(root, { platform: 'linux', arch: 's390x' })).toStrictEqual([]);
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
};

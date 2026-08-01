// SPDX-License-Identifier: MIT
// Unit tests for the os/cpu/libc compatibility port (utils/platform-check.ts).
//
// EVERY host value is INJECTED. Nothing here reads process.platform,
// process.arch or process.report, which is the point: the darwin / win32 /
// musl / no-report-runtime branches are the ones that decide what a Linux CI
// box installs for someone else's machine, and a spec that read the running
// host could only ever cover one of them. Same philosophy as
// detect-native-packages.spec.ts.
//
// The checkList cases below are the npm semantics table, quirks included (a
// one-element `['any']` short-circuit that a two-element list does NOT get; a
// negation that loses to an exact match; an empty list passing). Reference:
// refs/npm-cli/node_modules/npm-install-checks/lib/index.js.

import { describe, expect, it } from '@gjsify/unit';

import {
    badPlatformError,
    checkList,
    checkPlatform,
    declaresPlatform,
    detectLibc,
    libcFromLoaderScan,
    readPlatformForce,
    readPlatformOverrides,
    resolveHostPlatform,
    resetLibcCache,
    type LibcProbeHost,
} from './platform-check.js';

/** A probe host built from plain data — no filesystem, no runtime facts. */
function probe(opts: {
    files?: Record<string, string>;
    dirs?: Record<string, string[]>;
    report?: { glibcVersionRuntime?: unknown; sharedObjects?: unknown } | null;
}): LibcProbeHost {
    return {
        readTextFile: (path) => opts.files?.[path] ?? null,
        listDir: (path) => opts.dirs?.[path] ?? null,
        diagnosticReport: () => opts.report ?? null,
    };
}

const GLIBC_LDD = 'GNU libc (GNU C Library) stable release version 2.41\n';
const MUSL_LDD = '#!/bin/sh\n# musl libc (x86_64)\n';

export default async () => {
    await describe('platform-check — checkList (npm semantics)', async () => {
        await it('coerces a bare string to a one-element list', async () => {
            expect(checkList('darwin', 'darwin')).toBe(true);
            expect(checkList('linux', 'darwin')).toBe(false);
        });

        await it('a single "any" entry always passes', async () => {
            expect(checkList('linux', ['any'])).toBe(true);
            expect(checkList('win32', 'any')).toBe(true);
            expect(checkList(undefined, ['any'])).toBe(true);
        });

        await it('"any" is NOT special in a multi-entry list (length check)', async () => {
            // npm's fast path requires list.length === 1. Here 'any' is just a
            // token that matches nothing, so only the explicit entry counts.
            expect(checkList('linux', ['any', 'darwin'])).toBe(false);
            expect(checkList('darwin', ['any', 'darwin'])).toBe(true);
        });

        await it('an exact match on a negated entry fails immediately', async () => {
            expect(checkList('win32', ['!win32'])).toBe(false);
            // …even when a later positive entry would have matched: the negation
            // returns early. This ordering IS the semantics, not an artefact.
            expect(checkList('win32', ['!win32', 'win32'])).toBe(false);
        });

        await it('an all-negations list passes anything it does not name', async () => {
            expect(checkList('linux', ['!win32', '!darwin'])).toBe(true);
            expect(checkList('darwin', ['!win32', '!darwin'])).toBe(false);
        });

        await it('a mixed list needs at least one positive match', async () => {
            // 'linux' is not named positively and negated !== list.length, so a
            // non-matching value fails even though no negation hit.
            expect(checkList('linux', ['darwin', '!win32'])).toBe(false);
            expect(checkList('darwin', ['darwin', '!win32'])).toBe(true);
        });

        await it('no positive match and no negation fails', async () => {
            expect(checkList('linux', ['darwin', 'win32'])).toBe(false);
        });

        await it('an empty list passes (negated === length === 0)', async () => {
            // Manifests in the wild ship `"cpu": []`; npm accepts them.
            expect(checkList('linux', [])).toBe(true);
        });

        await it('an undefined value only ever passes an all-negations list', async () => {
            expect(checkList(undefined, ['glibc'])).toBe(false);
            expect(checkList(undefined, ['!musl'])).toBe(true);
        });
    });

    await describe('platform-check — checkPlatform (os × cpu × libc)', async () => {
        const linuxGlibcX64 = { os: 'linux', cpu: 'x64', libc: 'glibc' };

        await it('a declaration-free package is compatible everywhere', async () => {
            expect(checkPlatform({}, linuxGlibcX64).ok).toBe(true);
            expect(declaresPlatform({})).toBe(false);
        });

        await it('os alone decides when cpu/libc are undeclared', async () => {
            expect(checkPlatform({ os: ['linux'] }, linuxGlibcX64).ok).toBe(true);
            expect(checkPlatform({ os: ['darwin'] }, linuxGlibcX64).ok).toBe(false);
        });

        await it('cpu alone decides when os/libc are undeclared', async () => {
            expect(checkPlatform({ cpu: ['x64'] }, linuxGlibcX64).ok).toBe(true);
            expect(checkPlatform({ cpu: ['arm64'] }, linuxGlibcX64).ok).toBe(false);
        });

        await it('all three must pass — one mismatch is enough to fail', async () => {
            const decl = { os: ['linux'], cpu: ['x64'], libc: ['glibc'] };
            expect(checkPlatform(decl, linuxGlibcX64).ok).toBe(true);
            expect(checkPlatform(decl, { os: 'linux', cpu: 'x64', libc: 'musl' }).ok).toBe(false);
            expect(checkPlatform(decl, { os: 'linux', cpu: 'arm64', libc: 'glibc' }).ok).toBe(false);
            expect(checkPlatform(decl, { os: 'darwin', cpu: 'x64', libc: 'glibc' }).ok).toBe(false);
        });

        await it('the real shape: the four rolldown binary siblings on one host', async () => {
            const host = { os: 'linux', cpu: 'x64', libc: 'glibc' };
            const siblings = [
                { name: 'linux-x64-gnu', decl: { os: ['linux'], cpu: ['x64'], libc: ['glibc'] }, expected: true },
                { name: 'linux-x64-musl', decl: { os: ['linux'], cpu: ['x64'], libc: ['musl'] }, expected: false },
                { name: 'linux-arm64-gnu', decl: { os: ['linux'], cpu: ['arm64'], libc: ['glibc'] }, expected: false },
                { name: 'darwin-arm64', decl: { os: ['darwin'], cpu: ['arm64'] }, expected: false },
                { name: 'win32-x64-msvc', decl: { os: ['win32'], cpu: ['x64'] }, expected: false },
            ];
            for (const sibling of siblings) {
                expect(checkPlatform(sibling.decl, host).ok).toBe(sibling.expected);
            }
        });

        await it('a DECLARED libc against an UNKNOWN host libc is incompatible', async () => {
            // Not derivable from checkList: `['!musl']` would otherwise pass on a
            // host whose libc we could not probe. npm adds this rule explicitly
            // and it is the conservative direction — a musl binary in a glibc
            // process fails at dlopen, long after the install claimed success.
            const unknown = { os: 'linux', cpu: 'x64' };
            expect(checkPlatform({ libc: ['glibc'] }, unknown).ok).toBe(false);
            expect(checkPlatform({ libc: ['musl'] }, unknown).ok).toBe(false);
            expect(checkPlatform({ libc: ['!musl'] }, unknown).ok).toBe(false);
            // …while a package that declares NO libc is unaffected by the gap.
            expect(checkPlatform({ os: ['linux'] }, unknown).ok).toBe(true);
        });

        await it('an empty-string field reads as "not declared"', async () => {
            // `target.os ? … : true` — falsy means undeclared. An empty ARRAY is
            // truthy and goes through checkList, which passes it.
            expect(checkPlatform({ os: '' }, { os: 'linux', cpu: 'x64' }).ok).toBe(true);
            expect(declaresPlatform({ os: '' })).toBe(false);
            expect(checkPlatform({ os: [] }, { os: 'linux', cpu: 'x64' }).ok).toBe(true);
        });

        await it('the verdict carries npm’s current/required payload', async () => {
            const verdict = checkPlatform({ os: ['darwin'], cpu: ['arm64'] }, { os: 'linux', cpu: 'x64' });
            expect(verdict.current.os).toBe('linux');
            expect(verdict.current.cpu).toBe('x64');
            expect(verdict.current.libc).toBe(undefined);
            expect(JSON.stringify(verdict.required.os)).toBe('["darwin"]');
            const err = badPlatformError('pkg@1.0.0', verdict);
            expect(err.code).toBe('EBADPLATFORM');
            expect(err.pkgid).toBe('pkg@1.0.0');
            expect(err.message.includes('pkg@1.0.0')).toBe(true);
            expect(err.message.includes('darwin')).toBe(true);
        });
    });

    await describe('platform-check — libc detection (injected hosts)', async () => {
        await it('reads the family out of /usr/bin/ldd (the primary probe)', async () => {
            expect(detectLibc('linux', probe({ files: { '/usr/bin/ldd': MUSL_LDD } }))).toBe('musl');
            expect(detectLibc('linux', probe({ files: { '/usr/bin/ldd': GLIBC_LDD } }))).toBe('glibc');
        });

        await it('a readable but unrecognised ldd is FINAL (no report fallback)', async () => {
            // npm only falls through when ldd is UNREADABLE; a readable file that
            // names neither implementation yields "unknown". Keeping that means a
            // host npm calls unknown is unknown here too.
            const host = probe({
                files: { '/usr/bin/ldd': 'some other loader\n' },
                report: { glibcVersionRuntime: '2.41' },
            });
            expect(detectLibc('linux', host)).toBe(undefined);
        });

        await it('falls back to process.report when there is no ldd (Node parity)', async () => {
            expect(detectLibc('linux', probe({ report: { glibcVersionRuntime: '2.41' } }))).toBe('glibc');
            expect(detectLibc('linux', probe({ report: { sharedObjects: ['/lib/ld-musl-x86_64.so.1'] } }))).toBe(
                'musl',
            );
            expect(detectLibc('linux', probe({ report: { sharedObjects: ['/lib/libc.musl-x86_64.so.1'] } }))).toBe(
                'musl',
            );
        });

        await it('a report that answers neither stays unknown, NOT loader-scanned', async () => {
            // Deliberate: the same lockfile must resolve to the same tree under
            // Node and GJS. Improving on Node's answer here would make the
            // installed set depend on which runtime ran the installer.
            const host = probe({ report: { sharedObjects: [] }, dirs: { '/lib': ['ld-musl-x86_64.so.1'] } });
            expect(detectLibc('linux', host)).toBe(undefined);
        });

        await it('scans the dynamic loaders when the runtime has no report (GJS)', async () => {
            expect(detectLibc('linux', probe({ dirs: { '/lib': ['ld-musl-x86_64.so.1', 'libc.so'] } }))).toBe('musl');
            expect(detectLibc('linux', probe({ dirs: { '/lib64': ['ld-linux-x86-64.so.2'] } }))).toBe('glibc');
            // Merged-/usr layouts where /lib is absent from the image.
            expect(detectLibc('linux', probe({ dirs: { '/usr/lib': ['ld-linux-aarch64.so.1'] } }))).toBe('glibc');
        });

        await it('no probe answers at all → unknown (never a guess)', async () => {
            expect(detectLibc('linux', probe({}))).toBe(undefined);
            expect(detectLibc('linux', probe({ dirs: { '/lib': ['libfoo.so'] } }))).toBe(undefined);
        });

        await it('glibc wins when both loaders are present', async () => {
            // A glibc workstation with a musl cross-toolchain carries both; the
            // reverse (an Alpine box with ld-linux) is not a real layout.
            const host = probe({ dirs: { '/lib': ['ld-musl-x86_64.so.1', 'ld-linux-x86-64.so.2'] } });
            expect(libcFromLoaderScan(host)).toBe('glibc');
        });

        await it('libc is undefined on every non-linux OS', async () => {
            // npm's currentEnv.libc(os) does the same. A darwin package cannot be
            // judged against a value the platform has no concept of.
            const host = probe({ files: { '/usr/bin/ldd': GLIBC_LDD } });
            expect(detectLibc('darwin', host)).toBe(undefined);
            expect(detectLibc('win32', host)).toBe(undefined);
        });
    });

    await describe('platform-check — npm config keys', async () => {
        await it('reads os / cpu / libc from the npm_config_* env keys', async () => {
            const overrides = readPlatformOverrides({
                npm_config_os: 'darwin',
                npm_config_cpu: 'arm64',
                npm_config_libc: 'musl',
            });
            expect(overrides.os).toBe('darwin');
            expect(overrides.cpu).toBe('arm64');
            expect(overrides.libc).toBe('musl');
        });

        await it('ignores absent and blank values', async () => {
            const overrides = readPlatformOverrides({ npm_config_os: '  ', npm_config_cpu: undefined });
            expect(overrides.os).toBe(undefined);
            expect(overrides.cpu).toBe(undefined);
            expect(Object.keys(overrides).length).toBe(0);
        });

        await it('trims surrounding whitespace', async () => {
            expect(readPlatformOverrides({ npm_config_libc: ' musl ' }).libc).toBe('musl');
        });

        await it('force is only true for an explicit true/1', async () => {
            expect(readPlatformForce({ npm_config_force: 'true' })).toBe(true);
            expect(readPlatformForce({ npm_config_force: '1' })).toBe(true);
            expect(readPlatformForce({ npm_config_force: 'false' })).toBe(false);
            expect(readPlatformForce({ npm_config_force: '' })).toBe(false);
            expect(readPlatformForce({})).toBe(false);
        });
    });

    await describe('platform-check — resolveHostPlatform (injected)', async () => {
        await it('uses the injected host when no override is set', async () => {
            resetLibcCache();
            const target = resolveHostPlatform({
                platform: 'linux',
                arch: 'x64',
                env: {},
                probe: probe({ files: { '/usr/bin/ldd': MUSL_LDD } }),
            });
            expect(target.os).toBe('linux');
            expect(target.cpu).toBe('x64');
            expect(target.libc).toBe('musl');
        });

        await it('an override wins over the host — every field independently', async () => {
            resetLibcCache();
            const target = resolveHostPlatform({
                platform: 'linux',
                arch: 'x64',
                env: { npm_config_cpu: 'arm64', npm_config_libc: 'glibc' },
                probe: probe({ files: { '/usr/bin/ldd': MUSL_LDD } }),
            });
            expect(target.os).toBe('linux');
            expect(target.cpu).toBe('arm64');
            // The override must win over the probe, not merely fill a gap.
            expect(target.libc).toBe('glibc');
        });

        await it('a non-linux target never probes libc', async () => {
            resetLibcCache();
            let probed = false;
            const counting: LibcProbeHost = {
                readTextFile: () => {
                    probed = true;
                    return GLIBC_LDD;
                },
                listDir: () => null,
                diagnosticReport: () => null,
            };
            const target = resolveHostPlatform({
                platform: 'linux',
                arch: 'x64',
                env: { npm_config_os: 'darwin' },
                probe: counting,
            });
            expect(target.os).toBe('darwin');
            expect(target.libc).toBe(undefined);
            expect(probed).toBe(false);
        });

        await it('the probe is memoized (npm caches the same way)', async () => {
            resetLibcCache();
            let reads = 0;
            const counting: LibcProbeHost = {
                readTextFile: () => {
                    reads++;
                    return GLIBC_LDD;
                },
                listDir: () => null,
                diagnosticReport: () => null,
            };
            resolveHostPlatform({ platform: 'linux', arch: 'x64', env: {}, probe: counting });
            resolveHostPlatform({ platform: 'linux', arch: 'x64', env: {}, probe: counting });
            expect(reads).toBe(1);
            // Leave no memoized answer behind for whatever spec runs next.
            resetLibcCache();
        });
    });
};

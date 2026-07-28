// SPDX-License-Identifier: MIT
// Unit tests for the install-time `os`/`cpu`/`libc` gate.
//
// The matching rules are copied from npm-install-checks, so these cases are
// written as a CONTRACT against npm's `checkList` — every row below was read
// off `refs/npm-cli/node_modules/npm-install-checks/lib/index.js` and several
// of them are counter-intuitive enough that re-deriving them from the docs
// would get them wrong (an empty list PASSES; `any` only short-circuits as the
// sole element; a negation beats a positive match in the same list; and an
// empty `libc` list is NOT the same as an absent one).
//
// The whole surface was additionally cross-checked by running
// `isPlatformSupported` against npm's own `checkPlatform` over 3360
// (target, host) pairs — that differential is what produced the empty-list case
// below, which had been "simplified" away. It cannot live in CI as a test (it
// needs the `refs/npm-cli` submodule, which the affected classifier ignores and
// no test job initialises), so its findings are pinned here instead.
//
// The end-to-end behaviour these feed — skip an optional mismatch, fail a
// required one, install anything unclassifiable — is covered by
// `tests/e2e/install-platform-filter/`.

import { describe, it, expect } from '@gjsify/unit';

import {
    checkList,
    currentHostPlatform,
    declaresPlatform,
    describeHost,
    detectLibcFamily,
    formatPlatformMismatch,
    isPlatformSupported,
    normalizePlatformList,
    platformFieldsFrom,
    resetHostPlatformCache,
    type HostPlatform,
} from './install-platform.js';

const LINUX_X64_GLIBC: HostPlatform = { os: 'linux', cpu: 'x64', libc: 'glibc' };
const LINUX_X64_MUSL: HostPlatform = { os: 'linux', cpu: 'x64', libc: 'musl' };
const LINUX_X64_UNKNOWN_LIBC: HostPlatform = { os: 'linux', cpu: 'x64' };
const DARWIN_ARM64: HostPlatform = { os: 'darwin', cpu: 'arm64' };

export default async () => {
    await describe('install-platform / checkList', async () => {
        await it('matches a single positive entry', async () => {
            expect(checkList('linux', ['linux'])).toBe(true);
            expect(checkList('darwin', ['linux'])).toBe(false);
        });

        await it('matches any of several positive entries', async () => {
            expect(checkList('linux', ['darwin', 'linux'])).toBe(true);
            expect(checkList('win32', ['darwin', 'linux'])).toBe(false);
        });

        await it('treats the sole entry "any" as a wildcard', async () => {
            expect(checkList('win32', ['any'])).toBe(true);
            // …but ONLY as the sole element: alongside another entry, "any" is
            // compared literally and never matches a real platform value.
            expect(checkList('win32', ['any', 'x64'])).toBe(false);
        });

        await it('passes an EMPTY list (npm: match || negated === list.length → 0 === 0)', async () => {
            expect(checkList('linux', [])).toBe(true);
        });

        await it('excludes a negated value and admits everything else', async () => {
            expect(checkList('win32', ['!win32'])).toBe(false);
            expect(checkList('linux', ['!win32'])).toBe(true);
            expect(checkList('darwin', ['!win32', '!linux'])).toBe(true);
        });

        await it('requires a positive match once any positive entry is present', async () => {
            // ["linux","!win32"] on darwin: nothing negated matched, but a
            // positive constraint exists and darwin does not satisfy it.
            expect(checkList('darwin', ['linux', '!win32'])).toBe(false);
            expect(checkList('linux', ['linux', '!win32'])).toBe(true);
            expect(checkList('win32', ['linux', '!win32'])).toBe(false);
        });

        await it('lets a negation beat a positive entry for the same value', async () => {
            // A negation returns immediately; a positive match only sets a flag.
            expect(checkList('linux', ['linux', '!linux'])).toBe(false);
            expect(checkList('linux', ['!linux', 'linux'])).toBe(false);
        });

        await it('never matches a positive entry when the host value is unknown', async () => {
            expect(checkList(undefined, ['glibc'])).toBe(false);
            expect(checkList(undefined, ['!musl'])).toBe(true);
        });
    });

    await describe('install-platform / normalizePlatformList', async () => {
        await it('coerces a bare string to a one-element list', async () => {
            expect(normalizePlatformList('linux')).toStrictEqual(['linux']);
        });

        await it('drops non-strings instead of crashing on them', async () => {
            expect(normalizePlatformList(['linux', null, 3, 'darwin'])).toStrictEqual(['linux', 'darwin']);
        });

        await it('PRESERVES an empty list — it is not the same as an absent field', async () => {
            // Collapsing `[]` to undefined looks harmless (`checkList([])` is
            // true either way) and is not: npm's libc clause tests the field
            // for TRUTHINESS, and `[]` is truthy. A differential run against
            // npm's own checkPlatform disagreed on 52 of 2688 pairs while this
            // returned undefined. See the `libc: []` case further down.
            expect(normalizePlatformList([])).toStrictEqual([]);
        });

        await it('maps every falsy / malformed declaration to undefined', async () => {
            // Mirrors npm's own truthiness test on the field.
            expect(normalizePlatformList('')).toBe(undefined);
            expect(normalizePlatformList(undefined)).toBe(undefined);
            expect(normalizePlatformList(null)).toBe(undefined);
            // npm would throw on a non-iterable here; treating it as absent is
            // the one place we deliberately do not reproduce a crash.
            expect(normalizePlatformList({ os: 'linux' })).toBe(undefined);
        });
    });

    await describe('install-platform / platformFieldsFrom', async () => {
        await it('reads the three fields off a packument version record', async () => {
            const fields = platformFieldsFrom({
                name: 'x',
                version: '1.0.0',
                os: ['linux'],
                cpu: 'x64',
                libc: ['musl'],
            });
            expect(fields.os).toStrictEqual(['linux']);
            expect(fields.cpu).toStrictEqual(['x64']);
            expect(fields.libc).toStrictEqual(['musl']);
            expect(declaresPlatform(fields)).toBe(true);
        });

        await it('reports a portable package as declaring nothing', async () => {
            const fields = platformFieldsFrom({ name: 'x', version: '1.0.0' });
            expect(declaresPlatform(fields)).toBe(false);
            expect(isPlatformSupported(fields, DARWIN_ARM64)).toBe(true);
        });
    });

    await describe('install-platform / isPlatformSupported', async () => {
        await it('accepts a package with no constraints anywhere', async () => {
            expect(isPlatformSupported({}, LINUX_X64_GLIBC)).toBe(true);
        });

        await it('rejects a foreign os or cpu', async () => {
            expect(isPlatformSupported({ os: ['darwin'], cpu: ['arm64'] }, LINUX_X64_GLIBC)).toBe(false);
            expect(isPlatformSupported({ os: ['linux'], cpu: ['arm64'] }, LINUX_X64_GLIBC)).toBe(false);
            expect(isPlatformSupported({ os: ['linux'], cpu: ['x64'] }, LINUX_X64_GLIBC)).toBe(true);
        });

        await it('separates musl from glibc on an otherwise-matching linux-x64', async () => {
            // The case os/cpu alone cannot see: @img/sharp-linuxmusl-x64 and
            // @anthropic-ai/claude-agent-sdk-linux-x64-musl both declare
            // {os:[linux],cpu:[x64]} and differ ONLY here.
            const musl = { os: ['linux'], cpu: ['x64'], libc: ['musl'] };
            const glibc = { os: ['linux'], cpu: ['x64'], libc: ['glibc'] };
            expect(isPlatformSupported(musl, LINUX_X64_GLIBC)).toBe(false);
            expect(isPlatformSupported(musl, LINUX_X64_MUSL)).toBe(true);
            expect(isPlatformSupported(glibc, LINUX_X64_GLIBC)).toBe(true);
            expect(isPlatformSupported(glibc, LINUX_X64_MUSL)).toBe(false);
        });

        await it('rejects a libc-declaring package when the host libc is undeterminable', async () => {
            // npm's `if (target.libc && !libc) libcOk = false`. pnpm skips the
            // axis instead; we follow npm deliberately.
            expect(isPlatformSupported({ libc: ['glibc'] }, LINUX_X64_UNKNOWN_LIBC)).toBe(false);
            expect(isPlatformSupported({ libc: ['glibc'] }, DARWIN_ARM64)).toBe(false);
            // A package that declares no libc is unaffected by an unknown host libc.
            expect(isPlatformSupported({ os: ['linux'] }, LINUX_X64_UNKNOWN_LIBC)).toBe(true);
        });

        await it('treats an EMPTY libc list as a declaration, unlike an empty os list', async () => {
            // npm's asymmetry, reproduced exactly: `if (target.libc && !libc)`
            // fires on any truthy field, and `[]` is truthy — so an empty libc
            // list excludes the package on a host with no known libc, while an
            // empty os list constrains nothing and passes. Collapsing `[]` to
            // "absent" during normalisation silently loses this.
            expect(isPlatformSupported({ libc: [] }, LINUX_X64_UNKNOWN_LIBC)).toBe(false);
            expect(isPlatformSupported({ libc: [] }, DARWIN_ARM64)).toBe(false);
            expect(isPlatformSupported({ libc: [] }, LINUX_X64_GLIBC)).toBe(true);
            expect(isPlatformSupported({ os: [] }, DARWIN_ARM64)).toBe(true);
            expect(isPlatformSupported({ cpu: [] }, DARWIN_ARM64)).toBe(true);
        });
    });

    await describe('install-platform / host detection', async () => {
        await it('reports this runtime own platform, and only a real libc family', async () => {
            resetHostPlatformCache();
            const host = currentHostPlatform();
            expect(host.os).toBe(process.platform);
            expect(host.cpu).toBe(process.arch);
            // Whatever the probes conclude, it must be one of npm's three
            // possible answers — never a stray truthy string that would then be
            // compared against a package's `libc` list and never match.
            expect(host.libc === 'glibc' || host.libc === 'musl' || host.libc === undefined).toBe(true);
            // Off Linux the field does not apply at all (npm's rule).
            if (process.platform !== 'linux') expect(host.libc).toBe(undefined);
            // A real Linux host must be classifiable — if this ever fails here,
            // every libc-declaring package would be excluded on that machine.
            if (process.platform === 'linux') expect(host.libc).toBeDefined();
        });

        await it('never reports a libc off Linux, whatever the OS name', async () => {
            resetHostPlatformCache();
            expect(detectLibcFamily('darwin')).toBe(undefined);
            expect(detectLibcFamily('win32')).toBe(undefined);
            resetHostPlatformCache();
        });

        await it('memoises the host between calls', async () => {
            resetHostPlatformCache();
            expect(currentHostPlatform()).toBe(currentHostPlatform());
        });
    });

    await describe('install-platform / diagnostics', async () => {
        await it('describes the host with its libc when known', async () => {
            expect(describeHost(LINUX_X64_GLIBC)).toBe('linux-x64 (glibc)');
            expect(describeHost(DARWIN_ARM64)).toBe('darwin-arm64');
        });

        await it('names both sides of a mismatch, npm EBADPLATFORM style', async () => {
            const msg = formatPlatformMismatch(
                '@img/sharp-linuxmusl-x64@0.34.5',
                { os: ['linux'], cpu: ['x64'], libc: ['musl'] },
                LINUX_X64_GLIBC,
            );
            expect(msg).toContain('EBADPLATFORM');
            expect(msg).toContain('@img/sharp-linuxmusl-x64@0.34.5');
            expect(msg).toContain('"libc":"musl"');
            expect(msg).toContain('"libc":"glibc"');
        });

        await it('omits the libc column when the package does not constrain it', async () => {
            const msg = formatPlatformMismatch('p@1.0.0', { os: ['darwin'] }, LINUX_X64_GLIBC);
            expect(msg).toContain('"os":"darwin"');
            expect(msg.includes('libc')).toBe(false);
        });
    });
};

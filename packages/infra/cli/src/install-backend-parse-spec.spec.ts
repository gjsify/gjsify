// Tests for `parseSpec()` in `utils/install-backend-native.ts`.
//
// Locks in the npm-CLI-compatible behaviour: a bare name (no `@version`)
// resolves to the `latest` dist-tag, NOT semver `*`. The two differ for
// any package whose `latest` is a prerelease — semver `*` skips
// prereleases per spec §9, so `*` would silently downgrade to the
// abandoned non-prerelease maximum (e.g. ts-for-gir 3.3.0 instead of
// 4.0.0-rc.17).

import { describe, it, expect } from '@gjsify/unit';

import type { Packument } from '@gjsify/npm-registry';

import { parseSpec, pickVersion } from './utils/install-backend-native.js';

// Minimal synthetic Packument — only the fields pickVersion reads.
function synthPackument(opts: {
    name: string;
    distTags: Record<string, string>;
    versions: string[];
}): Packument {
    const versions: Record<string, unknown> = {};
    for (const v of opts.versions) {
        versions[v] = { name: opts.name, version: v };
    }
    return {
        name: opts.name,
        'dist-tags': opts.distTags,
        versions,
    } as unknown as Packument;
}

export default async () => {
    await describe('parseSpec', async () => {

        await it('returns name+range=latest for bare scoped name', async () => {
            expect(parseSpec('@ts-for-gir/cli')).toStrictEqual({
                name: '@ts-for-gir/cli',
                range: 'latest',
            });
        });

        await it('returns name+range=latest for bare unscoped name', async () => {
            expect(parseSpec('lodash')).toStrictEqual({
                name: 'lodash',
                range: 'latest',
            });
        });

        await it('preserves explicit version on scoped name', async () => {
            expect(parseSpec('@ts-for-gir/cli@4.0.0-rc.17')).toStrictEqual({
                name: '@ts-for-gir/cli',
                range: '4.0.0-rc.17',
            });
        });

        await it('preserves explicit semver range on scoped name', async () => {
            expect(parseSpec('@gjsify/cli@^0.4.0')).toStrictEqual({
                name: '@gjsify/cli',
                range: '^0.4.0',
            });
        });

        await it('preserves explicit version on unscoped name', async () => {
            expect(parseSpec('lodash@4.17.21')).toStrictEqual({
                name: 'lodash',
                range: '4.17.21',
            });
        });

        await it('preserves dist-tag aliases on scoped name', async () => {
            expect(parseSpec('@ts-for-gir/cli@next')).toStrictEqual({
                name: '@ts-for-gir/cli',
                range: 'next',
            });
        });

        await it('treats empty version (`name@`) as `latest`', async () => {
            // npm CLI behaviour: `npm install foo@` is the same as
            // `npm install foo`. The parser must not produce `range: ''`
            // because pickVersion() would later choke on a non-semver
            // empty string when the dist-tag fast path misses.
            expect(parseSpec('lodash@')).toStrictEqual({
                name: 'lodash',
                range: 'latest',
            });
            expect(parseSpec('@ts-for-gir/cli@')).toStrictEqual({
                name: '@ts-for-gir/cli',
                range: 'latest',
            });
        });

        await it('rejects a scoped name without a slash', async () => {
            expect(() => parseSpec('@gjsify')).toThrow();
        });

    });

    await describe('pickVersion (regression: ts-for-gir-style prerelease-as-latest)', async () => {

        await it('picks dist-tags.latest when range="latest", even if it is a prerelease', async () => {
            // ts-for-gir reproducer: only prereleases on the current major
            // (4.0.0-rc.17 tagged `latest`) plus an abandoned earlier major
            // (3.3.0, no longer tagged). The bare-spec resolution from
            // parseSpec(name) → range='latest' must pick 4.0.0-rc.17 via
            // the dist-tag fast path.
            const p = synthPackument({
                name: '@ts-for-gir/cli',
                distTags: { latest: '4.0.0-rc.17', next: '4.0.0-beta.5' },
                versions: ['3.3.0', '4.0.0-beta.5', '4.0.0-rc.15', '4.0.0-rc.16', '4.0.0-rc.17'],
            });
            expect(pickVersion(p, 'latest')).toBe('4.0.0-rc.17');
        });

        await it('picks dist-tags alias when range matches a non-latest tag', async () => {
            const p = synthPackument({
                name: '@ts-for-gir/cli',
                distTags: { latest: '4.0.0-rc.17', next: '4.0.0-beta.5' },
                versions: ['4.0.0-beta.5', '4.0.0-rc.17'],
            });
            expect(pickVersion(p, 'next')).toBe('4.0.0-beta.5');
        });

        await it('explicit semver range still skips prereleases (preserves npm semantics)', async () => {
            // semver `*` (or `^1.0.0` against a `1.0.0-rc.0`) excludes
            // prereleases per spec §9 unless the user explicitly opted
            // into the prerelease via dist-tag or exact version. This
            // assertion documents that ONLY the dist-tag path (range
            // = 'latest' / 'next' / …) opts in.
            const p = synthPackument({
                name: 'pkg',
                distTags: { latest: '2.0.0-rc.0' },
                versions: ['1.9.0', '2.0.0-rc.0'],
            });
            expect(pickVersion(p, '*')).toBe('1.9.0');
        });

        await it('exact version pin always resolves regardless of release status', async () => {
            const p = synthPackument({
                name: '@ts-for-gir/cli',
                distTags: { latest: '4.0.0-rc.17' },
                versions: ['3.3.0', '4.0.0-rc.15', '4.0.0-rc.16', '4.0.0-rc.17'],
            });
            expect(pickVersion(p, '4.0.0-rc.15')).toBe('4.0.0-rc.15');
        });

    });
};

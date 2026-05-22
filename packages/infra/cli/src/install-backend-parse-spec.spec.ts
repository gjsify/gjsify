// Tests for `parseSpec()` in `utils/install-backend-native.ts`.
//
// Locks in the npm-CLI-compatible behaviour: a bare name (no `@version`)
// resolves to the `latest` dist-tag, NOT semver `*`. The two differ for
// any package whose `latest` is a prerelease — semver `*` skips
// prereleases per spec §9, so `*` would silently downgrade to the
// abandoned non-prerelease maximum (e.g. ts-for-gir 3.3.0 instead of
// 4.0.0-rc.17).

import { describe, it, expect } from '@gjsify/unit';

import { parseSpec } from './utils/install-backend-native.js';

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
};

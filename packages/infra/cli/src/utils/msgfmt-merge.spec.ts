// SPDX-License-Identifier: MIT
// The two answers `mergeCatalogues` gives WITHOUT spawning anything.
//
// Both are here rather than in an e2e suite because both are decided before the
// first `execFileSync`, so neither needs gettext on the host — and the guard is
// the more important of the two: it is the only place that stops a caller from
// reproducing constraint 5, whose whole difficulty is that msgfmt reports it as
// two successes. `tests/e2e/ship` proves the SHIP path never trips it; this
// proves the seam refuses anyone who would.

import { describe, expect, it } from '@gjsify/unit';

import { mergeCatalogues } from './msgfmt-merge.js';

/** The message of the error a call throws, or null when it does not throw. */
function refusal(fn: () => void): string | null {
    try {
        fn();
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

// A directory that does not exist, so a spawn that DID happen would fail loudly
// instead of quietly succeeding somewhere. Nothing below may reach msgfmt.
const NOWHERE = '/nonexistent/gjsify-msgfmt-merge-spec';

export default async () => {
    await describe('mergeCatalogues', async () => {
        await it('returns the template untouched when there is nothing to fold', () => {
            // The path `gjsify ship` takes for a project without a `localeDir`: no
            // catalogues means no msgfmt, so a host without gettext still packs.
            expect(
                mergeCatalogues({
                    mode: '--desktop',
                    template: '/tmp/app.desktop',
                    extension: '.desktop',
                    catalogues: [],
                    workDir: NOWHERE,
                }),
            ).toBe('/tmp/app.desktop');
        });

        await it('refuses two catalogues claiming the same locale', () => {
            // Chained, this is two exit-0 msgfmt calls and a file both validators
            // reject (`multiple keys named "Name[de]"`, `tag-duplicated`). The refusal
            // has to NAME the locale — the caller holds several `.po` and cannot act
            // on "a duplicate" alone.
            const message = refusal(() =>
                mergeCatalogues({
                    mode: '--desktop',
                    template: '/tmp/app.desktop',
                    extension: '.desktop',
                    catalogues: [
                        { locale: 'de', po: '/tmp/app.po' },
                        { locale: 'fr', po: '/tmp/lib-fr.po' },
                        { locale: 'de', po: '/tmp/lib-de.po' },
                    ],
                    workDir: NOWHERE,
                }),
            );
            expect(message).toMatch(/locale "de"/);
            // And it names the way out, because there is one — the caller decides
            // which translation wins and hands over a single catalogue.
            expect(message).toMatch(/msgcat --use-first/);
        });

        await it('refuses BEFORE the first spawn', () => {
            // Not cosmetic. Refusing mid-chain would leave intermediates behind and,
            // worse, would make the guard depend on msgfmt being installed — so a host
            // without gettext would get `ENOENT` for a call that was invalid anyway.
            // `workDir` above is unwritable, so reaching a spawn cannot look like this.
            expect(
                refusal(() =>
                    mergeCatalogues({
                        mode: '--xml',
                        template: '/tmp/app.metainfo.xml',
                        extension: '.metainfo.xml',
                        catalogues: [
                            { locale: 'pt_BR', po: '/tmp/a.po' },
                            { locale: 'pt_BR', po: '/tmp/b.po' },
                        ],
                        workDir: NOWHERE,
                    }),
                ),
            ).toMatch(/^mergeCatalogues: /);
        });

        await it('lets distinct locales through to msgfmt', () => {
            // The control for the guard: same shape, different locales, so whatever
            // this reports is msgfmt's answer and not the guard's. Without it, a guard
            // that refused EVERYTHING would pass all three cases above.
            const message = refusal(() =>
                mergeCatalogues({
                    mode: '--desktop',
                    template: '/tmp/app.desktop',
                    extension: '.desktop',
                    catalogues: [
                        { locale: 'de', po: '/tmp/de.po' },
                        { locale: 'fr', po: '/tmp/fr.po' },
                    ],
                    workDir: NOWHERE,
                }),
            );
            // `?? ''` rather than asserting on a possibly-null value: what this checks
            // is that the guard did not speak, and "no error at all" is one of the two
            // ways for that to be true.
            expect(message ?? '').not.toMatch(/^mergeCatalogues: /);
        });
    });
};

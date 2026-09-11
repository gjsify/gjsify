// The name mapping on its own — no gettext, no filesystem. `gettext.spec.ts`
// proves the plugins WIRE it and that glibc agrees; these cases pin down what it
// answers, including the shapes that occur once and are therefore the ones a
// later "simplification" quietly changes.

import { describe, expect, it } from '@gjsify/unit';
import {
    catalogNames,
    CollidingCatalogNameError,
    planCatalogNames,
    posixLocaleDirectories,
    UnmappableCatalogNameError,
} from './catalog-names.js';

const posix = { pluginName: 'vite-plugin-gettext', namespace: 'posix' as const };
const bcp47 = { pluginName: 'vite-plugin-gettext-po2json', namespace: 'bcp47' as const };

/** What `fn` threw, so a case can assert the TYPE and the message it carries. */
function thrownBy(fn: () => void): unknown {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return undefined;
}

export default async () => {
    await describe('posixLocaleDirectories', async () => {
        await it('maps a Weblate script subtag to the locales glibc probes', async () => {
            // The bug: `zh_Hans` alone is a directory nothing looks up. Measured
            // against glibc — `zh_CN` is NOT reached by a `zh_SG` user, so both
            // territories are written rather than one standing in for the other.
            const dirs = posixLocaleDirectories('zh_Hans');
            expect(dirs?.includes('zh_CN')).toBe(true);
            expect(dirs?.includes('zh_SG')).toBe(true);
        });

        await it('keeps the original name alongside the mapped ones', async () => {
            // Additive: no deployment that already found a catalog stops finding
            // it. It is never the ONLY entry, which is the actual defect.
            const dirs = posixLocaleDirectories('zh_Hans');
            expect(dirs?.includes('zh_Hans')).toBe(true);
            expect((dirs?.length ?? 0) > 1).toBe(true);
        });

        await it('folds a BCP-47 hyphen to the POSIX underscore', async () => {
            // Measured: a `pt-BR` directory is reached by NO selector at all.
            expect(posixLocaleDirectories('pt-BR')?.includes('pt_BR')).toBe(true);
        });

        await it('leaves a name that is already POSIX alone', async () => {
            expect(posixLocaleDirectories('de')).toStrictEqual(['de']);
            expect(posixLocaleDirectories('pt_BR')).toStrictEqual(['pt_BR']);
        });

        await it('writes a modifier script without a territory', async () => {
            // Measured: `sr@latin` is reached by `sr_RS@latin` users, while
            // `sr_RS@latin` is reached only by itself. The broader form is the
            // right one, and it is the counter-intuitive one.
            expect(posixLocaleDirectories('sr_Latn')?.includes('sr@latin')).toBe(true);
        });

        await it('lets an explicit territory settle the name over the script', async () => {
            expect(posixLocaleDirectories('zh_Hans_CN')?.includes('zh_CN')).toBe(true);
        });

        await it('refuses a script subtag it has no mapping for', async () => {
            // Guessing a territory here would reproduce the original bug with a
            // different name, so the answer is "I cannot place this".
            expect(posixLocaleDirectories('az_Arab')).toBe(undefined);
        });

        await it('takes a configured override for an unknown script', async () => {
            const dirs = posixLocaleDirectories('az_Arab', { az_Arab: ['az_IR'] });
            expect(dirs?.includes('az_IR')).toBe(true);
        });
    });

    await describe('catalogNames — the Android namespace', async () => {
        await it('gives simplified Chinese the name the repo already tracks', async () => {
            // `values-zh_Hans` is not a directory Android consults: an
            // underscore is illegal in a resource qualifier.
            expect(catalogNames('zh_Hans')?.bcp47).toBe('zh');
        });

        await it('hyphenates a region so the qualifier comes out legal', async () => {
            // `pt_BR` -> `values-pt_BR` (broken); `pt-BR` -> `values-pt-rBR`.
            expect(catalogNames('pt_BR')?.bcp47).toBe('pt-BR');
        });

        await it('disagrees with the POSIX name for the same catalog', async () => {
            // The whole reason the two namespaces are separate data.
            const names = catalogNames('pt_BR');
            expect(names?.posix.includes('pt_BR')).toBe(true);
            expect(names?.bcp47).toBe('pt-BR');
        });

        await it('refuses a script that has no Android qualifier', async () => {
            // `sr_Latn` has a POSIX home (`sr@latin`) but no legal qualifier —
            // the two namespaces answer differently, which is the point.
            expect(posixLocaleDirectories('sr_Latn')?.includes('sr@latin')).toBe(true);
            expect(catalogNames('sr_Latn')).toBe(undefined);
        });
    });

    await describe('planCatalogNames', async () => {
        await it('names every unmappable catalog, not just the first', async () => {
            // Reporting one at a time turns a single misconfiguration into a
            // build-fix-build loop.
            const thrown = thrownBy(() => planCatalogNames(['de', 'az_Arab', 'ks_Arab'], posix));

            expect(thrown instanceof UnmappableCatalogNameError).toBe(true);
            expect((thrown as UnmappableCatalogNameError).catalogs).toStrictEqual(['az_Arab', 'ks_Arab']);
        });

        await it('says what would happen, not just that it refused', async () => {
            const thrown = thrownBy(() => planCatalogNames(['az_Arab'], posix));
            const message = (thrown as Error).message;

            // The message has to carry the reason the failure is invisible
            // otherwise, or the next reader "fixes" it by disabling the guard.
            expect(message.includes('az_Arab.po')).toBe(true);
            expect(message.includes('exit 0')).toBe(true);
            expect(message.includes('localeNames')).toBe(true);
        });

        await it('refuses two catalogs that would land in one directory', async () => {
            // `zh_Hans.po` beside a hand-made `zh_CN.po`: without this, whichever
            // is written last wins and the other's translations are absent.
            const thrown = thrownBy(() => planCatalogNames(['zh_Hans', 'zh_CN'], posix));

            expect(thrown instanceof CollidingCatalogNameError).toBe(true);
            expect((thrown as CollidingCatalogNameError).claimed).toBe('zh_CN');
        });

        await it('accepts both Chinese scripts side by side', async () => {
            // The territories are disjoint on purpose; a broad `zh` for either
            // would have collided here and served the wrong script.
            const plans = planCatalogNames(['zh_Hans', 'zh_Hant'], posix);
            expect(plans.length).toBe(2);
        });

        await it('passes an ordinary catalogue set through untouched', async () => {
            const plans = planCatalogNames(['de', 'fr', 'pt', 'pt_BR'], posix);
            expect(plans.map((plan) => plan.posix[0])).toStrictEqual(['de', 'fr', 'pt', 'pt_BR']);
        });

        await it('refuses a JSON name collision independently of the POSIX one', async () => {
            // `zh_Hans` -> `zh` and a plain `zh.po` -> `zh`: legal as POSIX
            // directories, a collision as filenames. The namespaces are checked
            // separately because they can disagree about what collides.
            expect(planCatalogNames(['zh_Hans', 'zh'], posix).length).toBe(2);
            expect(thrownBy(() => planCatalogNames(['zh_Hans', 'zh'], bcp47))).toBeInstanceOf(
                CollidingCatalogNameError,
            );
        });
    });
};

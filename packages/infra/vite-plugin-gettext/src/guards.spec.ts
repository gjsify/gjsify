// The guard decisions on their own — no gettext, no filesystem. `xgettext.spec.ts`
// proves the plugin WIRES them; these cases pin down what they answer, including
// the shapes that only show up once and are therefore the ones a later
// "simplification" quietly changes.

import { describe, expect, it } from '@gjsify/unit';
import {
    assertCatalogsSurviveMerge,
    assertEverySourcePatternMatched,
    CatalogShrinkError,
    countActiveEntries,
    EmptySourcePatternError,
} from './guards.js';

const context = { pluginName: 'vite-plugin-xgettext', cwd: '/workspace' };

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
    await describe('assertEverySourcePatternMatched', async () => {
        await it('accepts a run where every pattern found something', async () => {
            assertEverySourcePatternMatched(
                [
                    { pattern: 'src/**/*.blp', fileCount: 24 },
                    { pattern: 'dist/**/*.ui', fileCount: 3 },
                ],
                context,
            );
        });

        await it('names every empty pattern, not just the first', async () => {
            const thrown = thrownBy(() =>
                assertEverySourcePatternMatched(
                    [
                        { pattern: 'src/**/*.blp', fileCount: 24 },
                        { pattern: '../learn/dist/**/*.ui', fileCount: 0 },
                        { pattern: 'data/**/*.desktop.in', fileCount: 0 },
                    ],
                    context,
                ),
            );

            // Reporting one at a time turns a single misconfiguration into a
            // build-fix-build loop, which is how a guard earns a `catch`.
            expect(thrown instanceof EmptySourcePatternError).toBe(true);
            expect((thrown as EmptySourcePatternError).patterns).toStrictEqual([
                '../learn/dist/**/*.ui',
                'data/**/*.desktop.in',
            ]);
            expect((thrown as Error).message).toContain('../learn/dist/**/*.ui');
            expect((thrown as Error).message).toContain('data/**/*.desktop.in');
            expect((thrown as Error).message).toContain('/workspace');
        });

        await it('exempts only the patterns optionalSources names', async () => {
            const matches = [
                { pattern: 'optional/**/*.ui', fileCount: 0 },
                { pattern: 'src/**/*.blp', fileCount: 0 },
            ];

            const thrown = thrownBy(() =>
                assertEverySourcePatternMatched(matches, { ...context, optionalSources: ['optional/**/*.ui'] }),
            );
            expect(thrown instanceof EmptySourcePatternError).toBe(true);
            expect((thrown as EmptySourcePatternError).patterns).toStrictEqual(['src/**/*.blp']);

            assertEverySourcePatternMatched([matches[0]], { ...context, optionalSources: ['optional/**/*.ui'] });
        });
    });

    await describe('assertCatalogsSurviveMerge', async () => {
        const merge = (potEntries: number, catalogs: Array<{ language: string; entries: number }>, max?: number) =>
            assertCatalogsSurviveMerge({
                potEntries,
                catalogs,
                potFile: 'po/messages.pot',
                pluginName: 'vite-plugin-xgettext',
                maxEntryLoss: max,
            });

        await it('lets a first run through when there is nothing to lose', async () => {
            merge(120, []);
            merge(120, [{ language: 'de', entries: 0 }]);
        });

        await it('lets growth and ordinary churn through', async () => {
            merge(140, [{ language: 'de', entries: 120 }]);
            merge(117, [{ language: 'de', entries: 120 }]);
        });

        await it('refuses the loss the Learn6502 incident produced', async () => {
            const thrown = thrownBy(() => merge(41, [{ language: 'de', entries: 340 }]));
            expect(thrown instanceof CatalogShrinkError).toBe(true);
            expect((thrown as Error).message).toContain('88%');
            expect((thrown as Error).message).toContain('33%');
        });

        await it('measures against the LARGEST catalog', async () => {
            // A catalog an earlier bad run already gutted must not become the
            // yardstick that excuses gutting the rest.
            expect(
                thrownBy(() =>
                    merge(60, [
                        { language: 'fr', entries: 0 },
                        { language: 'de', entries: 100 },
                    ]),
                ) instanceof CatalogShrinkError,
            ).toBe(true);
        });

        await it('draws the line at the documented default', async () => {
            merge(2, [{ language: 'de', entries: 3 }]); // exactly one third, allowed
            expect(thrownBy(() => merge(66, [{ language: 'de', entries: 100 }])) instanceof CatalogShrinkError).toBe(
                true,
            );
        });

        await it('lets a project raise the limit deliberately', async () => {
            merge(10, [{ language: 'de', entries: 100 }], 0.95);
            merge(0, [{ language: 'de', entries: 100 }], 1);
        });
    });

    await describe('countActiveEntries', async () => {
        await it('does not count the header', async () => {
            expect(countActiveEntries('msgid ""\nmsgstr ""\n"Language: de\\n"\n')).toBe(0);
            expect(countActiveEntries('')).toBe(0);
        });

        await it('does not count what msgfmt will not read', async () => {
            // The whole reason a LINE count cannot do this job: msgmerge keeps the
            // pruned entries in the file, commented out, and msgfmt ignores them.
            const po = [
                'msgid ""',
                'msgstr ""',
                '',
                'msgid "Kept"',
                'msgstr "Behalten"',
                '',
                '#~ msgid "Pruned"',
                '#~ msgstr "Entfernt"',
                '',
            ].join('\n');
            expect(countActiveEntries(po)).toBe(1);
        });

        await it('counts a multi-line, plural, contextual entry exactly once', async () => {
            const po = [
                'msgid ""',
                'msgstr ""',
                '',
                'msgctxt "toolbar"',
                'msgid ""',
                '"A caption long enough that xgettext wrapped it onto "',
                '"a second line."',
                'msgid_plural "captions"',
                'msgstr[0] ""',
                'msgstr[1] ""',
                '',
            ].join('\n');
            // The wrapped halves of the caption are bare string lines, and
            // `msgid_plural` is a different keyword: neither opens an entry, so
            // the only two that do are the header and this one.
            expect(countActiveEntries(po)).toBe(1);
        });
    });
};

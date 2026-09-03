// The guard decisions on their own — no gettext, no filesystem. `xgettext.spec.ts`
// proves the plugin WIRES them; these cases pin down what they answer, including
// the shapes that only show up once and are therefore the ones a later
// "simplification" quietly changes.

import { describe, expect, it } from '@gjsify/unit';
import {
    activeMsgids,
    assertCatalogsSurviveMerge,
    assertEverySourcePatternMatched,
    CatalogShrinkError,
    countActiveEntries,
    DEFAULT_MAX_CATALOG_ENTRY_LOSS,
    EmptySourcePatternError,
    InvalidEntryLossError,
    resolveMaxEntryLoss,
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
        /** `count` distinct msgids; `prefix` is what makes two sets disjoint. */
        const ids = (count: number, prefix = 'm') => new Set(Array.from({ length: count }, (_, i) => `${prefix}${i}`));

        const merge = (
            potMsgids: Set<string>,
            catalogs: Array<{ language: string; msgids: Set<string> }>,
            max?: number,
        ) =>
            assertCatalogsSurviveMerge({
                potMsgids,
                catalogs,
                potFile: 'po/messages.pot',
                pluginName: 'vite-plugin-xgettext',
                maxEntryLoss: max,
            });

        await it('lets a first run through when there is nothing to lose', async () => {
            merge(ids(120), []);
            merge(ids(120), [{ language: 'de', msgids: ids(0) }]);
        });

        await it('lets growth and ordinary churn through', async () => {
            merge(ids(140), [{ language: 'de', msgids: ids(120) }]);
            merge(ids(117), [{ language: 'de', msgids: ids(120) }]);
        });

        await it('refuses the loss the Learn6502 incident produced', async () => {
            const thrown = thrownBy(() => merge(ids(41), [{ language: 'de', msgids: ids(340) }]));
            expect(thrown instanceof CatalogShrinkError).toBe(true);
            expect((thrown as Error).message).toContain('88%');
            expect((thrown as Error).message).toContain('33%');
        });

        await it('refuses a run that replaced the msgids without shrinking', async () => {
            // The case a COUNT cannot see, and the one Learn6502 is closest to: its
            // msgids are whitespace-normalised renders of markdown, so a change in
            // the inline-markup step re-msgids every paragraph at a constant total.
            // msgmerge fuzzy-matches those and msgfmt then leaves every fuzzy entry
            // out of the .mo, so the translations are just as gone (measured on
            // gettext 0.26: `0 translated, 1 fuzzy`).
            const thrown = thrownBy(() => merge(ids(100, 'rendered-'), [{ language: 'de', msgids: ids(100, 'old-') }]));
            expect(thrown instanceof CatalogShrinkError).toBe(true);
            expect((thrown as CatalogShrinkError).lostEntries).toBe(100);
            expect((thrown as CatalogShrinkError).catalogEntries).toBe(100);
        });

        await it('measures against the LARGEST catalog', async () => {
            // A catalog an earlier bad run already gutted must not become the
            // yardstick that excuses gutting the rest.
            expect(
                thrownBy(() =>
                    merge(ids(60), [
                        { language: 'fr', msgids: ids(0) },
                        { language: 'de', msgids: ids(100) },
                    ]),
                ) instanceof CatalogShrinkError,
            ).toBe(true);
        });

        await it('draws the line at the documented default', async () => {
            merge(ids(2), [{ language: 'de', msgids: ids(3) }]); // exactly one third, allowed
            expect(
                thrownBy(() => merge(ids(66), [{ language: 'de', msgids: ids(100) }])) instanceof CatalogShrinkError,
            ).toBe(true);
        });

        await it('lets a project raise the limit deliberately', async () => {
            merge(ids(10), [{ language: 'de', msgids: ids(100) }], 0.95);
            merge(ids(0), [{ language: 'de', msgids: ids(100) }], 1);
        });

        await it('refuses a limit that is not a fraction, before reading any catalog', async () => {
            // No catalogs at all: the option still has to be judged here, or a typo
            // stays invisible until the run it was supposed to protect.
            expect(thrownBy(() => merge(ids(1), [], 50)) instanceof InvalidEntryLossError).toBe(true);
        });
    });

    await describe('resolveMaxEntryLoss', async () => {
        await it('defaults to a third', async () => {
            expect(resolveMaxEntryLoss(undefined, 'p')).toBe(DEFAULT_MAX_CATALOG_ENTRY_LOSS);
        });

        await it('accepts both ends of the fraction', async () => {
            expect(resolveMaxEntryLoss(0, 'p')).toBe(0);
            expect(resolveMaxEntryLoss(1, 'p')).toBe(1);
        });

        await it('refuses a percentage, which would wave everything through', async () => {
            const thrown = thrownBy(() => resolveMaxEntryLoss(50, 'p'));
            expect(thrown instanceof InvalidEntryLossError).toBe(true);
            expect((thrown as Error).message).toContain('not a percentage');
        });

        await it('refuses the values that would make the guard fire on a clean run', async () => {
            // NaN loses every comparison, so the guard fails a build that lost
            // nothing — and gets raised out of the way for the wrong reason.
            expect(thrownBy(() => resolveMaxEntryLoss(Number.NaN, 'p')) instanceof InvalidEntryLossError).toBe(true);
            expect(thrownBy(() => resolveMaxEntryLoss(-0.1, 'p')) instanceof InvalidEntryLossError).toBe(true);
            expect(thrownBy(() => resolveMaxEntryLoss(Infinity, 'p')) instanceof InvalidEntryLossError).toBe(true);
        });
    });

    await describe('activeMsgids', async () => {
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
            expect([...activeMsgids(po)]).toStrictEqual(['Kept']);
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
            // `msgid_plural` is a different keyword and the wrapped halves are bare
            // string lines: neither opens an entry, so the only two that do are the
            // header and this one.
            expect([...activeMsgids(po)]).toStrictEqual([
                'toolbar\u0004A caption long enough that xgettext wrapped it onto a second line.',
            ]);
        });

        await it('reads a wrapped msgid to the same value as an unwrapped one', async () => {
            // A POT and a catalog wrap at different points — `--no-wrap`, a longer
            // location comment — so only the JOINED value is comparable, and the
            // guard compares a POT with a catalog for a living.
            const wrapped = ['msgid ""', '"Hello, "', '"world."', 'msgstr ""'].join('\n');
            const flat = 'msgid "Hello, world."\nmsgstr ""';
            expect([...activeMsgids(wrapped)]).toStrictEqual([...activeMsgids(flat)]);
        });

        await it('keeps two entries that differ only in context apart', async () => {
            const po = [
                'msgctxt "verb"',
                'msgid "Open"',
                'msgstr ""',
                '',
                'msgctxt "adjective"',
                'msgid "Open"',
                'msgstr ""',
                '',
                'msgid "Open"',
                'msgstr ""',
            ].join('\n');
            expect(activeMsgids(po).size).toBe(3);
            expect(activeMsgids(po).has('Open')).toBe(true);
        });
    });
};

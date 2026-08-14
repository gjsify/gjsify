// The failure recap — the block that NAMES what failed, above the summary that counts it.
//
// WHY THIS SPEC EXISTS. Before #1159 the summary line was the only failure signal and
// it named nothing, while no marker distinguished a failing line from a passing one: a
// grep for `✖`, `✘`, `❌`, `not ok` or `AssertionError` over a 9305-line CI log returned
// the summary and nothing else. The reporter was the one part of this runner that
// nothing tested, which is how it stayed that way.

import { describe, expect, it, formatFailureAnnotations, formatFailureRecap } from '@gjsify/unit';

/** Strip SGR codes so assertions read the text, not the colouring. */
const plain = (lines: string[]): string[] => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));

const entry = (suite: string, test: string, message: string) => ({ suite, test, message });

export default async () => {
    await describe('formatFailureRecap', async () => {
        await it('names each failure with its suite, test and reason', () => {
            const lines = plain(
                formatFailureRecap([entry('boxed lists', 'a row activates', 'Expected: 42\nActual: 41')], 1),
            );
            expect(lines.length).toBe(2);
            expect(lines[1]!.includes('boxed lists › a row activates')).toBe(true);
            expect(lines[1]!.includes('Expected: 42')).toBe(true);
        });

        await it('keeps only the first line of a multi-line reason', () => {
            // The block exists to be SCANNED; the full diff is already printed above,
            // at the failure itself. A recap that reprints diffs is the log again.
            const lines = plain(formatFailureRecap([entry('s', 't', 'first\nsecond\nthird')], 1));
            expect(lines[1]!.includes('first')).toBe(true);
            expect(lines[1]!.includes('second')).toBe(false);
        });

        await it('marks every failure line with ✖, which nothing else in the output uses', () => {
            // `grep '✖'` has to be sufficient on its own — that alone would have saved
            // the fifteen minutes #1159 measured, with no recap being read at all.
            // `✗` is expected failures and `❌` is the per-test line plus the summary,
            // so neither can serve.
            const lines = plain(formatFailureRecap([entry('a', 'one', 'x'), entry('b', 'two', 'y')], 2));
            for (const line of lines) expect(line.includes('✖')).toBe(true);
            expect(lines.some((l) => l.includes('✗') || l.includes('❌'))).toBe(false);
        });

        await it('reports its own blind spot when the tally exceeds the ledger', () => {
            // The incident behind #1159 was a suite TIMEOUT: it raised the tally
            // without recording anything, so a recap over the ledger alone would have
            // printed an empty list under a red summary — a fix that looks like one.
            // Both timeout paths now record; this line is what makes a future one loud.
            const lines = plain(formatFailureRecap([entry('s', 't', 'x')], 3));
            const last = lines[lines.length - 1]!;
            expect(last.includes('3 failures counted but 1 named')).toBe(true);
            expect(last.includes('INCOMPLETE')).toBe(true);
        });

        await it('stays silent about the tally when ledger and count agree', () => {
            const lines = plain(formatFailureRecap([entry('s', 't', 'x'), entry('s', 'u', 'y')], 2));
            expect(lines.length).toBe(3);
            expect(lines.some((l) => l.includes('INCOMPLETE'))).toBe(false);
        });

        await it('carries the runtime tag, so a concatenated CI log stays attributable', () => {
            // Several runtimes print into one step log; a recap that does not say which
            // leg it belongs to sends the reader back to bisecting the log.
            const lines = plain(formatFailureRecap([entry('s', 't', 'x')], 1, '[Node.js 24] '));
            expect(lines[0]!.includes('[Node.js 24]')).toBe(true);
        });

        await it('singularises the heading for one failure and pluralises for more', () => {
            expect(plain(formatFailureRecap([entry('s', 't', 'x')], 1))[0]!.includes('failed test')).toBe(true);
            expect(
                plain(formatFailureRecap([entry('s', 't', 'x'), entry('s', 'u', 'y')], 2))[0]!.includes('failed tests'),
            ).toBe(true);
        });
    });

    await describe('formatFailureAnnotations', async () => {
        await it('emits one ::error:: command per failure, titled with suite and test', () => {
            const lines = formatFailureAnnotations([entry('boxed lists', 'a row activates', 'Expected 42')]);
            expect(lines.length).toBe(1);
            expect(lines[0]!.startsWith('::error title=')).toBe(true);
            expect(lines[0]!.includes('boxed lists › a row activates')).toBe(true);
        });

        await it('carries NO escape codes — they would print literally on the summary page', () => {
            const lines = formatFailureAnnotations([entry('s', 't', 'x')], '[Gjs] ');
            // eslint-disable-next-line no-control-regex
            expect(/\x1b\[/.test(lines[0]!)).toBe(false);
            expect(lines[0]!.includes('[Gjs]')).toBe(true);
        });

        await it('starts at column 0, or Actions does not read it as a command', () => {
            const lines = formatFailureAnnotations([entry('s', 't', 'x')]);
            expect(lines[0]!.startsWith(' ')).toBe(false);
        });

        await it('encodes the characters a workflow command would otherwise eat', () => {
            const lines = formatFailureAnnotations([entry('s', 't', 'got 50% of\nthe rows')]);
            expect(lines[0]!.includes('%25')).toBe(true);
            // Only the first line is carried, so the newline never reaches the encoder
            // — but a `%` in that first line must still survive.
            expect(lines[0]!.includes('the rows')).toBe(false);
        });

        await it('caps at ten and SAYS how many it dropped', () => {
            // Actions renders ten annotations per step, and this runner is launched once
            // per runtime per shard. A silent cap would read as "that was all of them".
            const many = Array.from({ length: 14 }, (_, i) => entry('s', `t${i}`, 'x'));
            const lines = formatFailureAnnotations(many);
            expect(lines.length).toBe(11);
            expect(lines[10]!.includes('4 further failure(s)')).toBe(true);
        });

        await it('says nothing extra when the count is exactly the cap', () => {
            const exactly = Array.from({ length: 10 }, (_, i) => entry('s', `t${i}`, 'x'));
            expect(formatFailureAnnotations(exactly).length).toBe(10);
        });
    });
};

// The support table is the contract, so these are contract tests.
//
// The KEY SET is checked by `scripts/check-rn-surface.mjs` against react-native's
// own exports — that comparison needs Node and a package on disk, so it is a repo
// gate rather than a spec. What belongs here is the behaviour three readers depend
// on: which statuses are importable, and that every entry can produce a sentence.

import { describe, expect, it } from '@gjsify/unit';

import { SUPPORT_TABLE, SUPPORTED_NAMES, explainUnsupported, isImportable } from './support-table.js';

export default async () => {
    await describe('the support table', async () => {
        await it('gives every entry a status and a non-empty reason', async () => {
            const bad = SUPPORTED_NAMES.filter((name) => {
                const entry = SUPPORT_TABLE[name];
                return entry === undefined || typeof entry.reason !== 'string' || entry.reason.trim().length === 0;
            });
            expect(bad).toStrictEqual([]);
        });

        await it('schedules exactly the statuses that can be scheduled', async () => {
            // `refused` and `not-reachable` are not scheduling statements, so a tier
            // on one of them would be a promise the table does not mean to make.
            const wrongly = SUPPORTED_NAMES.filter((name) => {
                const entry = SUPPORT_TABLE[name]!;
                const schedulable = entry.status !== 'refused' && entry.status !== 'not-reachable';
                return !schedulable && entry.tier !== undefined;
            });
            expect(wrongly).toStrictEqual([]);
        });

        await it('lists limits for every partial entry and for no other', async () => {
            const missing = SUPPORTED_NAMES.filter(
                (name) => SUPPORT_TABLE[name]!.status === 'partial' && (SUPPORT_TABLE[name]!.limits ?? []).length === 0,
            );
            const spurious = SUPPORTED_NAMES.filter(
                (name) => SUPPORT_TABLE[name]!.status !== 'partial' && SUPPORT_TABLE[name]!.limits !== undefined,
            );
            expect(missing).toStrictEqual([]);
            expect(spurious).toStrictEqual([]);
        });

        await it('treats supported and partial as importable, and nothing else', async () => {
            const importable = SUPPORTED_NAMES.filter((name) => isImportable(name));
            const expected = SUPPORTED_NAMES.filter((name) => {
                const status = SUPPORT_TABLE[name]!.status;
                return status === 'supported' || status === 'partial';
            });
            expect(importable).toStrictEqual(expected);
            // A name the table has never heard of is not importable either — the
            // gate must not fall open on an unknown import.
            expect(isImportable('NoSuchExport')).toBe(false);
        });

        await it('names the export in every sentence it produces', async () => {
            const silent = SUPPORTED_NAMES.filter((name) => !explainUnsupported(name).includes(`"${name}"`));
            expect(silent).toStrictEqual([]);
        });

        await it('tells a reader what to do about a name it does not know', async () => {
            const message = explainUnsupported('TotallyMadeUp');
            expect(message).toContain('TotallyMadeUp');
            // The actionable half: an unknown name means the TABLE may be stale, and
            // the message must say which script settles that rather than leaving the
            // reader to conclude they typed it wrong.
            expect(message).toContain('check-rn-surface');
        });
    });
};

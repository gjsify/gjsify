// The support table is the contract, so these are contract tests.
//
// The KEY SET is checked by `scripts/check-rn-surface.mjs` against react-native's
// own exports — that comparison needs Node and a package on disk, so it is a repo
// gate rather than a spec. What belongs here is the behaviour three readers depend
// on: which statuses are importable, and that every entry can produce a sentence.

import { describe, expect, it } from '@gjsify/unit';

import { SUPPORT_TABLE, SUPPORTED_NAMES, explainUnsupported, isImportable } from './support-table.js';
// The whole package, because the invariant below is about the EXPORT SURFACE and not
// about the table: a name cannot be both a real export and a generated refusing one.
// It is the one vector here that needs the module graph, and it needs no display —
// nothing in it renders.
import * as reactNative from './index.js';
import { UnsupportedError } from './unsupported.js';

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

        await it('dates every entry it does schedule', async () => {
            // THE CONVERSE of the assertion above, and the half that was missing.
            // One direction alone let the website say tiers are absent only from
            // `refused` and `not-reachable`, while seven entries outside those two
            // carried none — five `no-desktop-meaning` stubs and two `supported`
            // names that were answered rather than scheduled.
            //
            // So the rule is not "not refused, therefore tiered", which is false.
            // It is: the two statuses that PROMISE something about when — `planned`
            // and `partial` — must say when. A tier-less entry in one of those is a
            // promise with no date, and it reads to a porter as "soon".
            const undated = SUPPORTED_NAMES.filter((name) => {
                const entry = SUPPORT_TABLE[name]!;
                const scheduled = entry.status === 'planned' || entry.status === 'partial';
                return scheduled && entry.tier === undefined;
            });
            expect(undated).toStrictEqual([]);
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

        await it('exports every importable name for real, and every other one as a refusal', async () => {
            // THE ONE THING THE TABLE CANNOT SAY ABOUT ITSELF. `export *` from the
            // generated file silently loses to an explicit export of the same name, so a
            // status that moved to `partial` without a real implementation would leave a
            // refusing proxy in place — importable by the gate, refusing at the call —
            // and a name implemented without its status moving would be shadowed by the
            // proxy. Both are invisible to `check-rn-surface.mjs`, which compares the
            // table with the generator's output rather than with the module.
            const surface = reactNative as unknown as Record<string, unknown>;
            const wrong: string[] = [];
            for (const name of SUPPORTED_NAMES) {
                const value = surface[name];
                const refusing = isRefusingProxy(value);
                if (isImportable(name)) {
                    if (value === undefined) wrong.push(`${name}: importable, but not exported`);
                    else if (refusing) wrong.push(`${name}: importable, but exported as a refusal`);
                } else if (value === undefined) {
                    wrong.push(`${name}: not importable, and not exported at all`);
                } else if (!refusing) {
                    wrong.push(`${name}: not importable, but exported as a real value`);
                }
            }
            expect(wrong).toStrictEqual([]);
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

/**
 * Is this export the generated stand-in rather than an implementation?
 *
 * By BEHAVIOUR, because there is nothing else to look at: the stand-in is a `Proxy`
 * over a function, so `typeof` says "function" for both. What separates them is that
 * reading an arbitrary property off the stand-in throws `UnsupportedError` while a real
 * component or API object answers `undefined`.
 */
function isRefusingProxy(value: unknown): boolean {
    if (value === null || (typeof value !== 'function' && typeof value !== 'object')) return false;
    try {
        void (value as Record<string, unknown>)['gjsify-refusal-probe'];
        return false;
    } catch (error) {
        return error instanceof UnsupportedError;
    }
}

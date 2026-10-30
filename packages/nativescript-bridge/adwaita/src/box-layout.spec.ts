// `Gtk.Box`'s two decisions — the tracks along its axis and the child order — driven off-device.
//
// The widget class cannot be imported here: `extends GridLayout` evaluates the bare
// `@nativescript/core` specifier at module eval and the workspace install has none
// (AGENTS.md). So this drives `widgets/box-layout.ts`, the SHIPPING pure half the widget
// calls, and asserts the track list a `GridLayout` would be handed; the widget itself is
// driven against the platform double in `gtk-box.spec.ts`.
//
// THE GAP EXPECTATIONS ARE GTK'S, not the port's: measured under gjs 1.88.1 /
// gtk 4.22.4 on `Gtk.Box`, `spacing` written and the children's allocations read back.
//
//   spacing 0, three children      no gap anywhere — the default is 0 in C
//   spacing 12, vertical           child 0 at the top edge, 1 and 2 offset by 12
//   spacing 12, one child          no gap at all: N children means N-1 gaps
//
// How an authored spacing becomes the property (the negative clamp included) is shared
// with the web box and asserted in `@gjsify/adwaita-core`'s `box.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import {
    boxChildTrack,
    boxPlacementStart,
    boxSpacingChanges,
    boxTrackDiff,
    boxTrackPlan,
    DEFAULT_BOX_SPACING,
    resolveBoxChildOrder,
    type BoxTrack,
} from './widgets/box-layout.js';

/** `count` children, none of them expanding. */
const plain = (count: number): boolean[] => Array.from({ length: count }, () => false);

export default async () => {
    await describe('boxSpacingChanges — the early return the setter takes', async () => {
        await it('is false for the same value in either spelling', () => {
            expect(boxSpacingChanges(12, 12)).toBe(false);
            expect(boxSpacingChanges(12, '12')).toBe(false);
        });

        await it('is false for a negative written over 0, because both clamp there', () => {
            expect(boxSpacingChanges(0, -4)).toBe(false);
        });

        await it('is true for a real change', () => {
            expect(boxSpacingChanges(0, 12)).toBe(true);
            expect(boxSpacingChanges(12, 0)).toBe(true);
        });
    });

    await describe('boxTrackPlan — one track per child, a pixel gap between them', async () => {
        await it('gives N children N-1 gaps: the first and last touch the box edge', () => {
            expect(boxTrackPlan([false, false, false], 12, false)).toStrictEqual([
                { unit: 'auto', value: 1 },
                { unit: 'pixel', value: 12 },
                { unit: 'auto', value: 1 },
                { unit: 'pixel', value: 12 },
                { unit: 'auto', value: 1 },
            ]);
        });

        await it('one child has no gap at all, and no child has no track', () => {
            expect(boxTrackPlan([false], 12, false)).toStrictEqual([{ unit: 'auto', value: 1 }]);
            expect(boxTrackPlan([], 12, false)).toStrictEqual([]);
        });

        await it('hands the spare space to the children that expand — `*` for them, `auto` for the rest', () => {
            expect(boxTrackPlan([false, true, false], 0, false).map((track) => track.unit)).toStrictEqual([
                'auto',
                'pixel',
                'star',
                'pixel',
                'auto',
            ]);
        });

        await it('shares equally between every child that expands', () => {
            const plan = boxTrackPlan([true, true], 0, false);
            expect(plan.filter((track) => track.unit === 'star').length).toBe(2);
            expect(plan.every((track) => track.unit !== 'star' || track.value === 1)).toBe(true);
        });

        await it('makes every child `*` when homogeneous, expanding or not', () => {
            expect(
                boxTrackPlan([false, false], 6, true)
                    .filter((track) => track.unit !== 'pixel')
                    .map((track) => track.unit),
            ).toStrictEqual(['star', 'star']);
        });

        await it('is all-zero gap tracks at the default spacing, so an untouched box shows no gap', () => {
            expect(boxTrackPlan([false, false], DEFAULT_BOX_SPACING, false)[1]).toStrictEqual({
                unit: 'pixel',
                value: 0,
            });
        });

        await it('clamps through the same normaliser, so a negative spacing cannot pull children together', () => {
            expect(boxTrackPlan([false, false], -4, false)[1]).toStrictEqual({ unit: 'pixel', value: 0 });
        });
    });

    await describe('boxChildTrack — the even tracks are the children, the odd ones the gaps', async () => {
        await it('numbers children 0, 2, 4', () => {
            expect([0, 1, 2].map(boxChildTrack)).toStrictEqual([0, 2, 4]);
        });
    });

    await describe('boxTrackDiff — the suffix a track list has to change', async () => {
        await it('keeps the whole list and adds the one pair an append needs', () => {
            expect(boxTrackDiff(boxTrackPlan(plain(1), 12, false), boxTrackPlan(plain(2), 12, false))).toStrictEqual({
                keep: 1,
                add: [
                    { unit: 'pixel', value: 12 },
                    { unit: 'auto', value: 1 },
                ],
            });
        });

        await it('adds nothing for a remove at the end — the kept run IS the shorter plan', () => {
            expect(boxTrackDiff(boxTrackPlan(plain(2), 12, false), boxTrackPlan(plain(1), 12, false))).toStrictEqual({
                keep: 1,
                add: [],
            });
        });

        await it('changes nothing when nothing moved', () => {
            const plan = boxTrackPlan([false, true], 6, false);
            expect(boxTrackDiff(plan, plan)).toStrictEqual({ keep: plan.length, add: [] });
        });

        await it('keeps nothing when the FIRST track changed, as a homogeneous toggle makes it', () => {
            expect(boxTrackDiff(boxTrackPlan(plain(2), 6, false), boxTrackPlan(plain(2), 6, true)).keep).toBe(0);
        });

        await it('keeps the leading child track when only the gap behind it changed', () => {
            const diff = boxTrackDiff(boxTrackPlan(plain(2), 6, false), boxTrackPlan(plain(2), 12, false));
            expect(diff.keep).toBe(1);
            expect(diff.add).toStrictEqual([
                { unit: 'pixel', value: 12 },
                { unit: 'auto', value: 1 },
            ]);
        });

        await it('reaches the whole list from an empty one, and empties it again', () => {
            expect(boxTrackDiff([], boxTrackPlan(plain(1), 0, false))).toStrictEqual({
                keep: 0,
                add: [{ unit: 'auto', value: 1 }],
            });
            expect(boxTrackDiff(boxTrackPlan(plain(1), 0, false), [])).toStrictEqual({ keep: 0, add: [] });
        });

        await it('APPLIED AS TOLD, reproduces every plan the widget would have rebuilt', () => {
            // The invariant the widget leans on: `keep` tracks of the old list plus `add` IS
            // the new list, at every step of a growing and then shrinking box.
            let applied: BoxTrack[] = [];
            const step = (count: number) => {
                const plan = boxTrackPlan(plain(count), 8, false);
                const { keep, add } = boxTrackDiff(applied, plan);
                applied = [...applied.slice(0, keep), ...add];
                expect(applied).toStrictEqual(plan);
            };
            for (let count = 1; count <= 6; count++) step(count);
            for (let count = 5; count >= 0; count--) step(count);
        });
    });

    await describe('boxPlacementStart — which children still need a cell written', async () => {
        await it('is the newcomer alone for an append', () => {
            expect(boxPlacementStart(['a', 'b'], ['a', 'b', 'c'])).toBe(2);
        });

        await it('is past the end for a remove at the end — no child moved', () => {
            expect(boxPlacementStart(['a', 'b', 'c'], ['a', 'b'])).toBe(2);
        });

        await it('is past the end when nothing changed at all, as an expand flag does not', () => {
            expect(boxPlacementStart(['a', 'b'], ['a', 'b'])).toBe(2);
        });

        await it('is 0 for a prepend, because every index shifted', () => {
            expect(boxPlacementStart(['a', 'b'], ['c', 'a', 'b'])).toBe(0);
        });

        await it('starts at the hole for a removal from the middle', () => {
            expect(boxPlacementStart(['a', 'b', 'c'], ['a', 'c'])).toBe(1);
        });

        await it('compares by IDENTITY — two children that look alike are two children', () => {
            const [a, b] = [{}, {}];
            expect(boxPlacementStart([a], [b])).toBe(0);
            expect(boxPlacementStart([a], [a])).toBe(1);
        });
    });

    await describe('resolveBoxChildOrder — `gtk_widget_insert_after`, NULL means FIRST', async () => {
        await it('inserts at the FIRST position for a NULL sibling, not the last', () => {
            expect(
                resolveBoxChildOrder({ children: ['a', 'b'], child: 'c', sibling: null, op: 'insert-after' }),
            ).toStrictEqual(['c', 'a', 'b']);
        });

        await it('inserts directly after the named sibling', () => {
            expect(
                resolveBoxChildOrder({ children: ['a', 'b'], child: 'c', sibling: 'a', op: 'insert-after' }),
            ).toStrictEqual(['a', 'c', 'b']);
        });

        await it('refuses an insert of a child the box already holds', () => {
            expect(resolveBoxChildOrder({ children: ['a', 'b'], child: 'a', sibling: 'b', op: 'insert-after' })).toBe(
                null,
            );
        });

        await it('refuses a reorder of a child the box does not hold', () => {
            expect(resolveBoxChildOrder({ children: ['a', 'b'], child: 'c', sibling: 'a', op: 'reorder-after' })).toBe(
                null,
            );
        });

        await it('moves an existing child rather than duplicating it', () => {
            expect(
                resolveBoxChildOrder({ children: ['a', 'b', 'c'], child: 'a', sibling: 'b', op: 'reorder-after' }),
            ).toStrictEqual(['b', 'a', 'c']);
        });

        await it('refuses a child placed after itself, where C hits a g_return_if_fail', () => {
            expect(resolveBoxChildOrder({ children: ['a'], child: 'a', sibling: 'a', op: 'reorder-after' })).toBe(null);
        });
    });
};

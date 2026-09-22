// `Gtk.Box`'s two decisions — the gap and the child order — driven off-device.
//
// The widget class cannot be imported here: `extends StackLayout` evaluates the bare
// `@nativescript/core` specifier at module eval and the workspace install has none
// (AGENTS.md). So this drives `widgets/box-layout.ts`, the SHIPPING pure half the widget
// calls, and asserts the margin strings a `StackLayout` child would be handed.
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

import { boxChildMargin, boxSpacingChanges, DEFAULT_BOX_SPACING, resolveBoxChildOrder } from './widgets/box-layout.js';

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

    await describe('boxChildMargin — the gap, on the leading edge of the current axis', async () => {
        await it('gives the FIRST child no gap: N children have N-1 gaps', () => {
            expect(boxChildMargin(0, 12, 'vertical')).toBe('0 0 0 0');
            expect(boxChildMargin(0, 12, 'horizontal')).toBe('0 0 0 0');
        });

        await it('puts a vertical box gap on the TOP of every later child', () => {
            expect(boxChildMargin(1, 12, 'vertical')).toBe('12 0 0 0');
            expect(boxChildMargin(2, 12, 'vertical')).toBe('12 0 0 0');
        });

        await it('puts a horizontal box gap on the LEFT of every later child', () => {
            expect(boxChildMargin(1, 12, 'horizontal')).toBe('0 0 0 12');
        });

        await it('touches no cross-axis edge — a `Gtk.Box` gap is one axis, unlike the wrap box', () => {
            // `wrapBoxChildMargin` puts half the spacing on all four edges because a
            // wrapping run has gaps on two axes. A box has one, so three of the four
            // edges are 0 and the box's own bounds are untouched: no outer inset.
            expect(
                boxChildMargin(1, 12, 'vertical')
                    .split(' ')
                    .filter((edge) => edge !== '0'),
            ).toStrictEqual(['12']);
            expect(
                boxChildMargin(1, 12, 'horizontal')
                    .split(' ')
                    .filter((edge) => edge !== '0'),
            ).toStrictEqual(['12']);
        });

        await it('is all zeroes at the default spacing, so an untouched box writes nothing visible', () => {
            expect(boxChildMargin(1, DEFAULT_BOX_SPACING, 'vertical')).toBe('0 0 0 0');
        });

        await it('clamps through the same normaliser, so a negative spacing cannot pull children together', () => {
            expect(boxChildMargin(1, -4, 'vertical')).toBe('0 0 0 0');
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

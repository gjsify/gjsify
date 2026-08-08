// PopoverState + resolvePopoverKey. The vector table is the shared spec both
// renderers assert against; this suite adds the state-machine matrix (notify
// only on change, the interactive flag, unsubscribe mid-fan-out) that a vector
// row cannot express.
import { describe, expect, it } from '@gjsify/unit';

import {
    POPOVER_ITEM_RADIUS,
    POPOVER_MENU_PADDING,
    POPOVER_PADDING,
    POPOVER_RADIUS,
    PopoverState,
    resolvePopoverKey,
} from './popover.js';
import type { PopoverStateChange } from './popover.js';
import { POPOVER_KEY_VECTORS, POPOVER_SURFACE_VECTORS } from './conformance/popover.js';

export default async () => {
    await describe('PopoverState open/closed', async () => {
        await it('starts closed', () => {
            expect(new PopoverState().open).toBe(false);
        });

        await it('popup/popdown are idempotent and notify only on a real transition', () => {
            const state = new PopoverState();
            const seen: PopoverStateChange[] = [];
            state.subscribe((change) => seen.push(change));

            expect(state.popdown()).toBe(false); // already closed
            expect(state.popup()).toBe(true);
            expect(state.popup()).toBe(false); // already open
            expect(state.open).toBe(true);
            expect(state.popdown()).toBe(true);
            expect(state.open).toBe(false);

            expect(seen).toStrictEqual([
                { open: true, interactive: false },
                { open: false, interactive: false },
            ]);
        });

        await it('toggle flips and is tagged interactive — it is the anchor gesture', () => {
            const state = new PopoverState();
            const seen: PopoverStateChange[] = [];
            state.subscribe((change) => seen.push(change));

            expect(state.toggle()).toBe(true);
            expect(state.open).toBe(true);
            expect(state.toggle()).toBe(true);
            expect(state.open).toBe(false);

            expect(seen).toStrictEqual([
                { open: true, interactive: true },
                { open: false, interactive: true },
            ]);
        });

        await it('dismiss differs from popdown ONLY in the interactive flag', () => {
            const dismissed = new PopoverState();
            const dismissedSeen: PopoverStateChange[] = [];
            dismissed.subscribe((change) => dismissedSeen.push(change));
            dismissed.popup();
            expect(dismissed.dismiss()).toBe(true);

            const closed = new PopoverState();
            const closedSeen: PopoverStateChange[] = [];
            closed.subscribe((change) => closedSeen.push(change));
            closed.popup();
            expect(closed.popdown()).toBe(true);

            expect(dismissedSeen[1]).toStrictEqual({ open: false, interactive: true });
            expect(closedSeen[1]).toStrictEqual({ open: false, interactive: false });
            // A dismiss on an already-closed popover is a no-op, like popdown.
            expect(dismissed.dismiss()).toBe(false);
        });

        await it('unsubscribe stops delivery, and unsubscribing mid-fan-out cannot skip a sibling', () => {
            const state = new PopoverState();
            const first: boolean[] = [];
            const second: boolean[] = [];
            const off = state.subscribe((change) => {
                first.push(change.open);
                off(); // drop myself while the fan-out is in flight
            });
            state.subscribe((change) => second.push(change.open));

            state.popup();
            state.popdown();

            expect(first).toStrictEqual([true]);
            // The snapshot copy is what keeps `second` from being skipped on the first emit.
            expect(second).toStrictEqual([true, false]);
        });
    });

    await describe('resolvePopoverKey vectors', async () => {
        for (const vector of POPOVER_KEY_VECTORS) {
            const { key, context, expected, rule } = vector;
            const label = `${key === ' ' ? 'Space' : key} @${context.currentIndex}/${context.itemCount}${
                context.hasSearch === true ? ' +search' : ''
            }`;
            await it(`${label} → ${expected.action}:${expected.index} — ${rule}`, () => {
                expect(resolvePopoverKey(key, context)).toStrictEqual(expected);
            });
        }
    });

    await describe('resolvePopoverKey arithmetic beyond the vectors', async () => {
        await it('ArrowDown/ArrowUp walk the whole list and return to the start', () => {
            const count = 4;
            const down: number[] = [];
            let index = -1;
            for (let step = 0; step < count + 1; step++) {
                index = resolvePopoverKey('ArrowDown', { itemCount: count, currentIndex: index }).index;
                down.push(index);
            }
            expect(down).toStrictEqual([0, 1, 2, 3, 0]);

            const up: number[] = [];
            index = -1;
            for (let step = 0; step < count + 1; step++) {
                index = resolvePopoverKey('ArrowUp', { itemCount: count, currentIndex: index }).index;
                up.push(index);
            }
            // Enters at the END, then walks back and wraps — the mirror of ArrowDown.
            expect(up).toStrictEqual([3, 2, 1, 0, 3]);
        });

        await it('never returns an index outside the list', () => {
            for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab']) {
                for (const itemCount of [0, 1, 2, 5]) {
                    for (const currentIndex of [-5, -1, 0, 1, 4, 99]) {
                        const { action, index } = resolvePopoverKey(key, { itemCount, currentIndex });
                        if (action === 'focus' || action === 'activate') {
                            expect(index >= 0 && index < itemCount).toBe(true);
                        } else {
                            expect(index).toBe(-1);
                        }
                    }
                }
            }
        });

        await it('a non-finite itemCount is treated as an empty list, not as NaN arithmetic', () => {
            expect(resolvePopoverKey('ArrowDown', { itemCount: Number.NaN, currentIndex: 0 })).toStrictEqual({
                action: 'none',
                index: -1,
            });
        });

        await it('hasSearch only suppresses Home/End while the entry actually has focus', () => {
            // The flag alone must not disable navigation — that would break every
            // searchable dropdown the moment focus reached an option.
            expect(resolvePopoverKey('End', { itemCount: 3, currentIndex: 0, hasSearch: true })).toStrictEqual({
                action: 'focus',
                index: 2,
            });
        });
    });

    await describe('popover surface constants', async () => {
        await it('match the vectors derived from the vendored stylesheet', () => {
            const plain = POPOVER_SURFACE_VECTORS.find((v) => v.variant === 'plain');
            const menu = POPOVER_SURFACE_VECTORS.find((v) => v.variant === 'menu');
            const item = POPOVER_SURFACE_VECTORS.find((v) => v.variant === 'menu-item');

            expect(plain?.padding).toBe(POPOVER_PADDING);
            expect(plain?.borderRadius).toBe(POPOVER_RADIUS);
            expect(menu?.padding).toBe(POPOVER_MENU_PADDING);
            // The MENU override changes the padding, never the radius.
            expect(menu?.borderRadius).toBe(POPOVER_RADIUS);
            expect(item?.borderRadius).toBe(POPOVER_ITEM_RADIUS);
        });

        await it('$popover_radius is $menu_radius + 6, not $card_radius or $button_radius', () => {
            // _common.scss:10,13 — the derivation the three copies each replaced
            // with a token that happened to be nearby.
            expect(POPOVER_RADIUS).toBe(POPOVER_ITEM_RADIUS + 6);
            expect(POPOVER_RADIUS).not.toBe(12); // $card_radius — menu button + drop-down
            expect(POPOVER_RADIUS).not.toBe(9); // $button_radius — split button
        });

        await it('the popover elevation is THREE layers', () => {
            // The split button shipped two. The count is the assertion.
            for (const vector of POPOVER_SURFACE_VECTORS) {
                expect(vector.shadow.length).toBe(vector.variant === 'menu-item' ? 0 : 3);
            }
        });

        await it('every surface vector cites a vendored source with line numbers', () => {
            for (const vector of POPOVER_SURFACE_VECTORS) {
                expect(vector.source.startsWith('refs/libadwaita/')).toBe(true);
                expect(/:\d+(-\d+)?$/.test(vector.source)).toBe(true);
                expect(vector.selector.length > 0).toBe(true);
            }
        });
    });
};

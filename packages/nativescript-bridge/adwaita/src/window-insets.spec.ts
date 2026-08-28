// Inset assignment for a toolbar view.
//
// The widget that consumes this extends `GridLayout`, so it cannot be imported
// off-device and no renderer spec can construct one — the same structural gap that
// let the expander row ship a 16-unit tap target (#1155). The decision therefore
// lives in a pure sibling and is checked here, from any host.

import { describe, expect, it } from '@gjsify/unit';

import {
    NO_HOST_PAYMENT,
    NO_INSETS,
    WindowInsetsBroadcast,
    insetsOwedBy,
    normaliseInsets,
    toolbarViewInsetPadding,
} from './widgets/window-insets.js';

/** A phone in portrait: status bar above, gesture area below. */
const PHONE = { top: 24, bottom: 48, left: 0, right: 0 };

export default async () => {
    await describe('toolbarViewInsetPadding', async () => {
        await it('gives each edge to the bar that sits on it', () => {
            const p = toolbarViewInsetPadding(PHONE, { hasTopBar: true, hasBottomBar: true });
            expect(p.topBarTop).toBe(24);
            expect(p.bottomBarBottom).toBe(48);
            expect(p.contentTop).toBe(0);
            expect(p.contentBottom).toBe(0);
        });

        await it('hands the inset to the content when that edge has no bar', () => {
            // The case the reported defect actually shows: with no bar there, content
            // sits under the clock, and a rule that only padded bars would leave it there.
            const p = toolbarViewInsetPadding(PHONE, { hasTopBar: false, hasBottomBar: false });
            expect(p.contentTop).toBe(24);
            expect(p.contentBottom).toBe(48);
            expect(p.topBarTop).toBe(0);
            expect(p.bottomBarBottom).toBe(0);
        });

        await it('mixes the two edges independently', () => {
            const p = toolbarViewInsetPadding(PHONE, { hasTopBar: true, hasBottomBar: false });
            expect(p.topBarTop).toBe(24);
            expect(p.contentTop).toBe(0);
            expect(p.contentBottom).toBe(48);
            expect(p.bottomBarBottom).toBe(0);
        });

        await it('never doubles an edge and never drops it', () => {
            // Doubling leaves a gap the height of the status bar; dropping puts content
            // under it. Both are silent, so the invariant is asserted over every shape.
            for (const hasTopBar of [true, false]) {
                for (const hasBottomBar of [true, false]) {
                    const p = toolbarViewInsetPadding(PHONE, { hasTopBar, hasBottomBar });
                    expect(p.topBarTop + p.contentTop).toBe(PHONE.top);
                    expect(p.bottomBarBottom + p.contentBottom).toBe(PHONE.bottom);
                }
            }
        });

        await it('adds nothing when there is nothing to add', () => {
            const p = toolbarViewInsetPadding(NO_INSETS, { hasTopBar: true, hasBottomBar: true });
            expect(p.topBarTop + p.contentTop + p.bottomBarBottom + p.contentBottom).toBe(0);
        });
    });

    await describe('insetsOwedBy', async () => {
        // The Android host (a `Page`'s `LayoutBase`) pays the bottom edge, keyboard
        // folded in, and — after `host-insets.android.ts` writes `androidOverflowEdge` —
        // nothing at the top. This is the shape that produced the defect: before this
        // function existed the widget paid the bottom a second time, measured as
        // 63 px + 63 px of dead space under the content on emulator-5554.
        const ANDROID_PAGE = { top: false, bottom: true };

        await it('drops only the edges the host paid', () => {
            expect(insetsOwedBy(PHONE, ANDROID_PAGE)).toStrictEqual({ top: 24, bottom: 0, left: 0, right: 0 });
        });

        await it('owes everything when nothing above pays', () => {
            expect(insetsOwedBy(PHONE, NO_HOST_PAYMENT)).toStrictEqual(PHONE);
        });

        await it('owes nothing when the host pays both edges', () => {
            const owed = insetsOwedBy(PHONE, { top: true, bottom: true });
            expect(owed.top).toBe(0);
            expect(owed.bottom).toBe(0);
        });

        await it('never touches left or right', () => {
            // No host in this tree pays them, and an edge dropped by a rule that never
            // paid it is how an inset goes missing silently rather than loudly.
            const cutout = { top: 24, bottom: 48, left: 33, right: 11 };
            for (const top of [true, false]) {
                for (const bottom of [true, false]) {
                    const owed = insetsOwedBy(cutout, { top, bottom });
                    expect(owed.left).toBe(33);
                    expect(owed.right).toBe(11);
                }
            }
        });

        await it('composes with the slot split so each edge is paid exactly once', () => {
            // The whole point, asserted end to end: host share + widget share = the inset.
            for (const paid of [NO_HOST_PAYMENT, ANDROID_PAGE, { top: true, bottom: false }]) {
                const p = toolbarViewInsetPadding(insetsOwedBy(PHONE, paid), {
                    hasTopBar: true,
                    hasBottomBar: true,
                });
                expect(p.topBarTop + p.contentTop + (paid.top ? PHONE.top : 0)).toBe(PHONE.top);
                expect(p.bottomBarBottom + p.contentBottom + (paid.bottom ? PHONE.bottom : 0)).toBe(PHONE.bottom);
            }
        });
    });

    await describe('normaliseInsets', async () => {
        await it('passes finite positive values through', () => {
            expect(normaliseInsets(PHONE)).toStrictEqual(PHONE);
        });

        await it('turns anything unusable into zero rather than NaN', () => {
            // The source is a native object across the NS bridge. A missing field
            // arrives as `undefined`, and `padding: NaN` renders as no padding with no
            // error anywhere — a silent wrong answer rather than a loud one.
            expect(normaliseInsets({ top: 24 })).toStrictEqual({ top: 24, bottom: 0, left: 0, right: 0 });
            expect(normaliseInsets(null)).toStrictEqual(NO_INSETS);
            expect(normaliseInsets(undefined)).toStrictEqual(NO_INSETS);
            expect(normaliseInsets({ top: Number.NaN, bottom: Number.POSITIVE_INFINITY })).toStrictEqual(NO_INSETS);
        });

        await it('clamps a negative inset to zero', () => {
            // No platform should report one, but a negative padding is the one value NS
            // reacts to by shifting the layout the wrong way.
            expect(normaliseInsets({ top: -10, bottom: 48, left: 0, right: 0 }).top).toBe(0);
        });
    });

    await describe('WindowInsetsBroadcast', async () => {
        await it('starts at zero, so a reader before the first dispatch is not undefined', () => {
            expect(new WindowInsetsBroadcast().last).toStrictEqual(NO_INSETS);
        });

        await it('replays the last reading to a late subscriber', () => {
            // The one that matters on a device: insets are dispatched ONCE, early. A
            // pane built after that — the storybook builds its detail pane on
            // navigation — would sit un-inset until the next rotation.
            const broadcast = new WindowInsetsBroadcast();
            broadcast.publish(PHONE);

            let seen: unknown = null;
            broadcast.subscribe((insets) => {
                seen = insets;
            });
            expect(seen).toStrictEqual(PHONE);
        });

        await it('fans one reading out to every subscriber', () => {
            const broadcast = new WindowInsetsBroadcast();
            const tops: number[] = [];
            broadcast.subscribe((i) => tops.push(i.top));
            broadcast.subscribe((i) => tops.push(i.top));
            tops.length = 0; // drop the two immediate replays of NO_INSETS

            broadcast.publish(PHONE);
            expect(tops).toStrictEqual([24, 24]);
        });

        await it('drops an unchanged reading', () => {
            // Android re-dispatches insets on every layout pass, and applying padding
            // schedules another layout pass. Without this the two feed each other.
            const broadcast = new WindowInsetsBroadcast();
            let calls = 0;
            broadcast.subscribe(() => {
                calls += 1;
            });
            expect(calls).toBe(1); // the replay

            expect(broadcast.publish(PHONE)).toBe(true);
            expect(broadcast.publish({ ...PHONE })).toBe(false);
            expect(calls).toBe(2);
        });

        await it('normalises what the platform hands over', () => {
            const broadcast = new WindowInsetsBroadcast();
            broadcast.publish({ top: Number.NaN, bottom: 48 });
            expect(broadcast.last).toStrictEqual({ top: 0, bottom: 48, left: 0, right: 0 });
        });

        await it('calls a listener subscribed DURING a dispatch exactly once', () => {
            // The reason `publish` iterates a copy. `subscribe()` replays the last
            // reading immediately, so a live Set iterator would reach the new listener
            // again in the same dispatch — one reading, two calls, and the second one
            // writes padding and schedules a layout pass. A toolbar view built from
            // another view's inset handler is how that happens on a device.
            const broadcast = new WindowInsetsBroadcast();
            const late: number[] = [];
            // The flag matters: `subscribe` calls its listener AT ONCE, so without it
            // the inner subscribe would happen during that first replay rather than
            // during a dispatch — which is a different situation and passes either way.
            let dispatching = false;
            broadcast.subscribe(() => {
                if (!dispatching) return;
                dispatching = false;
                broadcast.subscribe((insets) => late.push(insets.top));
            });

            dispatching = true;
            broadcast.publish(PHONE);
            expect(late).toStrictEqual([24]);
        });

        await it('stops calling an unsubscribed listener, and still calls its sibling', () => {
            // A pane torn down mid-dispatch used to be able to skip the pane after it:
            // deleting from a Set while iterating it drops the next entry.
            const broadcast = new WindowInsetsBroadcast();
            const seen: string[] = [];
            let detachFirst = () => {};
            detachFirst = broadcast.subscribe(() => {
                seen.push('first');
                detachFirst();
            });
            broadcast.subscribe(() => seen.push('second'));
            seen.length = 0;

            broadcast.publish(PHONE);
            expect(seen).toStrictEqual(['first', 'second']);

            seen.length = 0;
            broadcast.publish({ top: 30, bottom: 48, left: 0, right: 0 });
            expect(seen).toStrictEqual(['second']);
        });
    });
};

/** @jsxImportSource react */
// The React Native half of `AdwToastOverlay`, rendered through React's real reconciler.
//
// THE SHARED CLAIM IS A BEHAVIOUR, NOT A NUMBER, and it is the one thing "one API surface"
// has to mean for a widget with state: two toasts added back to back show ONE.
// `content.gtk.spec.tsx` measures that against libadwaita 1.9.3 — a single
// `AdwToastWidget` in the tree, carrying the FIRST title — and this file asserts it of
// `@gjsify/adwaita-core`'s port. Neither half runs the other's queue.
//
// MOST OF THIS SUITE IS TIMER-FREE ON PURPOSE. `timeout: 0` is libadwaita's "until
// dismissed", so ordering, one-at-a-time and `dismissAll` can all be asked without a
// clock — and the auto-dismiss LIFECYCLE is already held against a deterministic fake
// scheduler in `@gjsify/adwaita-core`'s own suite, which is where it belongs. What that
// leaves unproven is the WIRING: that this component actually hands the queue a working
// timer rather than a scheduler that never fires.
//
// THAT TAKES TWO ROWS, NOT ONE, AND THE SECOND IS WHERE THE DURATION LIVES. A single
// "the toast went away" row is passed by a scheduler that ignores the millisecond count
// entirely and fires on the next tick — measured: replacing `setTimeout(callback, ms)`
// with `setTimeout(callback, 0)` left it green. So a second toast with a MINUTE-long
// timeout is asserted still on screen after the same wait. One row says the timer fires,
// the other says it fires on the toast's own clock; neither says it alone.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.
//
// THE `dismissAll` ROW IS THE OTHER HALF OF A PAIR THE GTK SIDE CANNOT COMPLETE.
// `adw_toast_overlay_dismiss_all` animates the strip out over real time, and pumping the
// main context for ~1.6s leaves the widget in place — measured. So GTK asserts that the
// call lands and costs no diagnostic, and the REMOVAL is asserted here, where the queue is
// ours.

import { describe, expect, it } from '@gjsify/unit';
import { act, type ReactTestRendererJSON } from 'react-test-renderer';

import { AdwToast } from '@gjsify/adwaita-core';

import type { AdwToastOverlayHandle } from '../props.js';
import { RCT_TEXT, RCT_VIEW } from '../testing/react-native.js';
import { mount } from '../testing/render.spec.js';
import { AdwToastOverlay } from './toast-overlay.native.js';

/**
 * The real timeouts in this file, and the margin around them.
 *
 * A short lifetime and a generous wait: what is being proven is that a timer FIRES, not
 * when — a tight margin would turn a scheduler assertion into a scheduler race. The long
 * one is the other side of the same question, and it is a MINUTE rather than a second so
 * that neither the wait below nor a slow machine can reach it.
 */
const SHORT_TIMEOUT_MS = 10;
const LONG_TIMEOUT_MS = 60_000;
const WAIT_MS = 250;

/**
 * How many `setTimeout` handles the host is currently holding.
 *
 * The teardown row reads the DELTA and never the total: `react-test-renderer` and the
 * runner hold timers of their own, and a total would make the assertion about them.
 */
const pendingTimers = (): number =>
    process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;

/** Mount with a ref, and hand back both the renderer and the handle. */
function overlay(children: React.ReactNode = null): {
    handle: AdwToastOverlayHandle;
    tree: () => ReactTestRendererJSON;
    unmount: () => void;
} {
    const ref: { current: AdwToastOverlayHandle | null } = { current: null };
    const renderer = mount(<AdwToastOverlay ref={ref}>{children}</AdwToastOverlay>);
    if (ref.current === null) throw new Error('the overlay exposed no imperative handle');
    return {
        handle: ref.current,
        tree: () => renderer.toJSON() as ReactTestRendererJSON,
        unmount: () => act(() => renderer.unmount()),
    };
}

/** Every string in the rendered tree, in order — the strip's title and button land here. */
function texts(node: ReactTestRendererJSON | string | null): string[] {
    if (node === null) return [];
    if (typeof node === 'string') return [node];
    return (node.children ?? []).flatMap((child) => texts(child as ReactTestRendererJSON | string));
}

/** The strip, or `null` when nothing is on screen. */
function strip(tree: ReactTestRendererJSON): ReactTestRendererJSON | null {
    const children = (tree.children ?? []) as ReactTestRendererJSON[];
    const last = children[children.length - 1];
    if (last === undefined || typeof last === 'string') return null;
    return (last.props.style as Record<string, unknown> | undefined)?.position === 'absolute' ? last : null;
}

export default async () => {
    await describe('AdwToastOverlay on React Native — the wrapper', async () => {
        await it('renders its content and no strip until something is queued', async () => {
            const { tree } = overlay('wrapped');
            expect(tree().type).toBe(RCT_VIEW);
            expect(texts(tree())).toStrictEqual(['wrapped']);
            expect(strip(tree())).toBe(null);
        });
    });

    await describe('AdwToastOverlay on React Native — the queue, which is one at a time', async () => {
        await it('shows the FIRST of two toasts added together, as libadwaita does', async () => {
            const { handle, tree } = overlay('wrapped');
            act(() => {
                handle.addToast(new AdwToast('first', { timeout: 0 }));
                handle.addToast(new AdwToast('second', { timeout: 0 }));
            });
            expect(texts(tree())).toStrictEqual(['wrapped', 'first']);
        });

        await it('advances to the queued toast when the visible one is pressed away', async () => {
            // The action button dismisses the current toast, which is what advances the
            // queue — the same thing both other renderers do with theirs.
            const { handle, tree } = overlay('wrapped');
            act(() => {
                handle.addToast(new AdwToast('first', { timeout: 0, buttonLabel: 'Undo' }));
                handle.addToast(new AdwToast('second', { timeout: 0 }));
            });
            expect(texts(tree())).toStrictEqual(['wrapped', 'first', 'Undo']);
            const row = strip(tree())?.children?.[0] as ReactTestRendererJSON | undefined;
            const button = (row?.children ?? [])[1] as ReactTestRendererJSON | undefined;
            expect(button?.type).toBe(RCT_TEXT);
            const onPress = button?.props.onPress as (() => void) | undefined;
            if (typeof onPress !== 'function') throw new Error('the toast button carries no onPress');
            act(() => onPress());
            expect(texts(tree())).toStrictEqual(['wrapped', 'second']);
        });

        await it('renders no button for a toast with no label', async () => {
            const { handle, tree } = overlay('wrapped');
            act(() => handle.addToast(new AdwToast('first', { timeout: 0 })));
            const row = strip(tree())?.children?.[0] as ReactTestRendererJSON | undefined;
            expect((row?.children ?? []).length).toBe(1);
        });

        await it('dismissAll clears the visible toast AND the backlog', async () => {
            // Not `dismiss`: `adw_toast_overlay_dismiss_all` is the only dismissal the
            // OVERLAY has, and `AdwToastQueue.clear()` is the same operation — it drops
            // the pending toasts instead of advancing to them.
            const { handle, tree } = overlay('wrapped');
            act(() => {
                handle.addToast(new AdwToast('first', { timeout: 0 }));
                handle.addToast(new AdwToast('second', { timeout: 0 }));
            });
            act(() => handle.dismissAll());
            expect(strip(tree())).toBe(null);
            expect(texts(tree())).toStrictEqual(['wrapped']);
        });
    });

    await describe('AdwToastOverlay on React Native — the scheduler is really wired', async () => {
        await it('auto-dismisses through a real timer, which no fake would prove', async () => {
            const { handle, tree } = overlay('wrapped');
            act(() => handle.addToast(new AdwToast('first', { timeout: SHORT_TIMEOUT_MS })));
            expect(texts(tree())).toStrictEqual(['wrapped', 'first']);
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
            });
            expect(strip(tree())).toBe(null);
        });

        await it('waits the toast’s OWN timeout and not a fixed one', async () => {
            // The control for the row above, and the reason there are two: a scheduler
            // that dropped the millisecond count and fired on the next tick passes that
            // row and fails this one.
            const { handle, tree } = overlay('wrapped');
            act(() => handle.addToast(new AdwToast('first', { timeout: LONG_TIMEOUT_MS })));
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
            });
            expect(texts(tree())).toStrictEqual(['wrapped', 'first']);
            // Not tidiness: the minute-long handle would otherwise hold the event loop
            // open for a minute after the last assertion.
            act(() => handle.dismissAll());
        });

        await it('cancels a pending timer on unmount instead of leaving it running', async () => {
            // THE FIRST VERSION OF THIS ROW COULD NOT GO RED, which is the one failure
            // this file is otherwise written against. It unmounted a showing overlay,
            // waited out a short timeout and asserted NOTHING — on the reasoning that a
            // leaked timer is invisible to a test. Measured: replacing the component's
            // `useEffect(() => () => queue.current?.clear(), [])` with a no-op teardown
            // left the suite at exit 0, because React 19 drops a `setState` on an
            // unmounted tree with no warning at all.
            //
            // The claim is about a HANDLE that outlives the tree, so the handle is what
            // is counted. `process.getActiveResourcesInfo()` is the host's own register
            // of them, and the timeout is a minute so that the row cannot be passed by
            // the timer firing on its own.
            const { handle, unmount } = overlay('wrapped');
            const before = pendingTimers();
            act(() => handle.addToast(new AdwToast('first', { timeout: LONG_TIMEOUT_MS })));
            expect(pendingTimers()).toBe(before + 1);
            unmount();
            expect(pendingTimers()).toBe(before);
        });
    });
};

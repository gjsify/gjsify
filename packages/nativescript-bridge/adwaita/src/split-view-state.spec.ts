// The NativeScript split-view adapters against the shared conformance vectors.
//
// This suite exercises the REAL adapters the widgets run on — the whole reason
// `split-view-state.ts` is free of `@nativescript/core` value imports. What stood
// here before was a `MockSplitView` that reimplemented the two setters, so it
// could only ever confirm that the mock agreed with itself: it reported the
// don't-emit-on-no-change guard as covered while the widgets shipped four
// divergences from libadwaita (no collapse coupling, no `pin-sidebar`, a
// keyboard-reachable off-screen pane, and a navigation stack keyed on a boolean).
//
// Reference: refs/libadwaita/src/adw-overlay-split-view.c
// Reference: refs/libadwaita/src/adw-navigation-split-view.c

import { describe, expect, it } from '@gjsify/unit';

import {
    NAVIGATION_ACTION_VECTORS,
    NAVIGATION_SPLIT_VIEW_LAYOUT_VECTORS,
    NAVIGATION_STACK_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import { OVERLAY_COLLAPSE_VECTORS } from '@gjsify/adwaita-core/conformance';
import type { OverlaySplitViewSnapshot } from '@gjsify/adwaita-core/conformance';

import {
    NsNavigationSplitViewState,
    NsOverlaySplitViewState,
    splitViewColumns,
    type NsShowSidebarNotification,
    type NsSplitViewHost,
    type NsSplitViewState,
} from './widgets/split-view-state.js';

/** One host call, flattened so a whole sequence can be compared in one assertion. */
type HostCall = 'applyLayout' | 'transitionSidebar' | `notify:${string}`;

/** A recording {@link NsSplitViewHost} — the widget half, reduced to its calls. */
class RecordingHost implements NsSplitViewHost {
    readonly calls: HostCall[] = [];
    readonly notifications: NsShowSidebarNotification[] = [];

    applyLayout(): void {
        this.calls.push('applyLayout');
    }

    transitionSidebar(): void {
        this.calls.push('transitionSidebar');
    }

    notifyShowSidebar(event: NsShowSidebarNotification): void {
        this.calls.push(`notify:show-sidebar=${event.showSidebar}`);
        this.notifications.push(event);
    }
}

/** Bind a fresh recorder to `state` and hand both back. */
function record<T extends NsSplitViewState>(state: T): { state: T; host: RecordingHost } {
    const host = new RecordingHost();
    state.bind(host);
    return { state, host };
}

/** The observable state of an overlay adapter, in the conformance vector's shape. */
function snapshot(state: NsOverlaySplitViewState): OverlaySplitViewSnapshot {
    return {
        showSidebar: state.showSidebar,
        collapsed: state.collapsed,
        showProgress: state.showProgress,
        shieldVisible: state.shieldVisible,
        sidebarFocusable: state.sidebarFocusable,
        contentFocusable: state.contentFocusable,
    };
}

export default async () => {
    await describe('NsOverlaySplitViewState against OVERLAY_COLLAPSE_VECTORS', async () => {
        for (const vector of OVERLAY_COLLAPSE_VECTORS) {
            const { initial, before, setCollapsed, after, notifications, rule } = vector;

            await it(`${JSON.stringify(initial)} → collapsed=${setCollapsed} — ${rule}`, () => {
                const { state, host } = record(new NsOverlaySplitViewState(initial));
                expect(snapshot(state)).toStrictEqual(before);

                state.setCollapsed(setCollapsed);
                expect(snapshot(state)).toStrictEqual(after);

                // The vector's notification list is the GTK freeze/thaw ORDER:
                // `show-sidebar` is queued by the coupling and thawed before
                // `collapsed`. The adapter turns each into one host call.
                expect(host.calls).toStrictEqual(
                    notifications.map((property) =>
                        property === 'collapsed'
                            ? 'applyLayout'
                            : (`notify:show-sidebar=${after.showSidebar}` as HostCall),
                    ),
                );
            });
        }
    });

    await describe('NsOverlaySplitViewState collapse coupling (set_collapsed :1457-1458)', async () => {
        await it('hides an unpinned sidebar the moment the breakpoint collapses the view', () => {
            // The headline divergence: NativeScript left the sidebar AND its scrim
            // up, so on a phone the overlay covered the content immediately. Both
            // storybooks hand-rolled a hide() call next to their breakpoint to
            // paper over it.
            const state = new NsOverlaySplitViewState();
            expect(state.showSidebar).toBe(true);

            state.setCollapsed(true);
            expect(state.showSidebar).toBe(false);
            expect(state.shieldVisible).toBe(false);
        });

        await it('applies the coupled flip STRUCTURALLY, never as an animated toggle', () => {
            // `set_collapsed` calls `set_show_sidebar (self, …, FALSE, 0)` — the
            // animate argument is FALSE. Sliding the sidebar out while the view is
            // re-laying itself out would animate a pane that is being rebuilt.
            const { state, host } = record(new NsOverlaySplitViewState());
            state.setCollapsed(true);
            expect(host.calls).toStrictEqual(['notify:show-sidebar=false', 'applyLayout']);
        });

        await it('animates a USER toggle, and only that', () => {
            const { state, host } = record(new NsOverlaySplitViewState({ collapsed: true, showSidebar: false }));
            state.setShowSidebar(true);
            expect(host.calls).toStrictEqual(['transitionSidebar', 'notify:show-sidebar=true']);
        });

        await it('re-shows the sidebar on uncollapse', () => {
            const state = new NsOverlaySplitViewState({ collapsed: true, showSidebar: false });
            state.setCollapsed(false);
            expect(state.showSidebar).toBe(true);
        });

        await it('emits nothing when the value is unchanged', () => {
            const { state, host } = record(new NsOverlaySplitViewState());
            expect(state.setCollapsed(false)).toBe(false);
            expect(state.setShowSidebar(true)).toBe(false);
            expect(host.calls).toStrictEqual([]);
        });

        await it('re-arms the animated path after a throwing host', () => {
            const state = new NsOverlaySplitViewState();
            let animated = 0;
            let armed = true;
            state.bind({
                applyLayout: () => {},
                transitionSidebar: () => {
                    animated++;
                },
                notifyShowSidebar: () => {
                    if (!armed) return;
                    armed = false;
                    throw new Error('host blew up');
                },
            });
            // The coupled flip notifies FIRST, so the throw unwinds out of the
            // middle of `setCollapsed`.
            expect(() => state.setCollapsed(true)).toThrow();

            // A later USER toggle must still animate. The flag that marks a change
            // as "coupled" is cleared in a `finally`; left set, every subsequent
            // reveal would silently be instant.
            state.setShowSidebar(true);
            expect(animated).toBe(1);
        });
    });

    await describe('NsOverlaySplitViewState pin-sidebar (:990-992, default FALSE)', async () => {
        await it('defaults to unpinned', () => {
            expect(new NsOverlaySplitViewState().pinSidebar).toBe(false);
        });

        await it('suppresses the coupling entirely once set', () => {
            const { state, host } = record(new NsOverlaySplitViewState());
            expect(state.setPinSidebar(true)).toBe(true);

            state.setCollapsed(true);
            expect(snapshot(state)).toStrictEqual({
                showSidebar: true,
                collapsed: true,
                showProgress: 1,
                shieldVisible: true,
                sidebarFocusable: true,
                contentFocusable: false,
            });
            // Only `collapsed` notified — there was no show-sidebar change to queue.
            expect(host.calls).toStrictEqual(['applyLayout']);
        });

        await it('unpinning restores it, and does not retroactively hide anything', () => {
            const state = new NsOverlaySplitViewState({ pinSidebar: true });
            state.setCollapsed(true);
            expect(state.showSidebar).toBe(true);

            expect(state.setPinSidebar(false)).toBe(true);
            expect(state.showSidebar).toBe(true); // pin-sidebar is not a visibility property

            state.setCollapsed(false);
            state.setCollapsed(true);
            expect(state.showSidebar).toBe(false);
        });

        await it('reports no change when set to the value it already has', () => {
            const state = new NsOverlaySplitViewState();
            expect(state.setPinSidebar(false)).toBe(false);
        });
    });

    await describe('NsOverlaySplitViewState pane focus (can-focus :330-331, :1460-1461)', async () => {
        await it('keeps both panes reachable while docked', () => {
            const state = new NsOverlaySplitViewState();
            expect(state.sidebarFocusable).toBe(true);
            expect(state.contentFocusable).toBe(true);
        });

        await it('drops the content out of the focus order behind an open overlay', () => {
            // `!collapsed || !show_sidebar` — the pane UNDER the overlay must not
            // answer taps or appear to a screen reader. The scrim only shields the
            // area it covers.
            const state = new NsOverlaySplitViewState({ collapsed: true, showSidebar: true });
            expect(state.sidebarFocusable).toBe(true);
            expect(state.contentFocusable).toBe(false);
        });

        await it('drops the off-screen sidebar once it is closed', () => {
            const state = new NsOverlaySplitViewState({ collapsed: true, showSidebar: false });
            expect(state.sidebarFocusable).toBe(false);
            expect(state.contentFocusable).toBe(true);
        });
    });

    await describe('NsNavigationSplitViewState against NAVIGATION_STACK_VECTORS', async () => {
        for (const vector of NAVIGATION_STACK_VECTORS) {
            // The animated rows are `set_show_content`'s own branch: reached by
            // TOGGLING the property, which the block below drives.
            if (vector.changingPage) continue;

            const { hasSidebar, hasContent, sidebarPosition, showContent, plan, rule } = vector;

            await it(`${sidebarPosition} showContent=${showContent} → ${plan.stack.join('>') || '(empty)'} — ${rule}`, () => {
                const state = new NsNavigationSplitViewState({ sidebarPosition, collapsed: true });
                state.setPaneMounted('sidebar', hasSidebar);
                state.setPaneMounted('content', hasContent);
                state.setShowSidebar(!showContent);

                expect(state.stack).toStrictEqual(plan.stack);
                expect(state.visiblePane).toBe(plan.stack[plan.stack.length - 1] ?? null);
            });
        }

        await it('keeps a LONE sidebar visible where the old boolean rendered blank', () => {
            // `self->content && (self->show_content || !self->sidebar)` and its
            // mirror (:389-401). Keying visibility on `showSidebar` alone left a
            // collapsed split view holding only a sidebar showing NOTHING, because
            // the flag said "content" and there was no content.
            const state = new NsNavigationSplitViewState({ collapsed: true });
            state.setPaneMounted('sidebar', true);
            state.setShowSidebar(false);

            expect(state.showSidebar).toBe(false);
            expect(state.visiblePane).toBe('sidebar');
            expect(state.isVisible('sidebar')).toBe(true);
            expect(state.isVisible('content')).toBe(false);
        });

        await it('keeps a LONE content visible too', () => {
            const state = new NsNavigationSplitViewState({ collapsed: true });
            state.setPaneMounted('content', true);
            expect(state.showSidebar).toBe(true);
            expect(state.visiblePane).toBe('content');
        });

        await it('shows nothing when neither pane is mounted', () => {
            const state = new NsNavigationSplitViewState({ collapsed: true });
            expect(state.visiblePane).toBeNull();
        });
    });

    await describe('NsNavigationSplitViewState swap direction (set_show_content :1414-1428)', async () => {
        /** Mount both panes and settle, then report what toggling `showSidebar` does. */
        const swap = (sidebarPosition: 'start' | 'end', showSidebar: boolean) => {
            const { state, host } = record(new NsNavigationSplitViewState({ sidebarPosition, collapsed: true }));
            state.setPaneMounted('sidebar', true);
            state.setPaneMounted('content', true);
            host.calls.length = 0;
            state.setShowSidebar(showSidebar);
            return { state, host };
        };

        await it('start: showing the content is a PUSH', () => {
            const { state, host } = swap('start', false);
            expect(state.transition).toBe('push');
            expect(state.visiblePane).toBe('content');
            expect(host.calls).toStrictEqual(['transitionSidebar', 'notify:show-sidebar=false']);
        });

        await it('start: going back to the sidebar is a POP', () => {
            const { state } = swap('start', false);
            state.setShowSidebar(true);
            expect(state.transition).toBe('pop');
            expect(state.visiblePane).toBe('sidebar');
        });

        await it('end: showing the content is a POP, not a push', () => {
            // The reversal that ran an `end`-positioned swap backwards: with the
            // sidebar packed at the end the CONTENT is the root page, so revealing
            // it pops the sidebar off the top. Taking the direction from
            // `showSidebar` produced a push here.
            const { state } = swap('end', false);
            expect(state.transition).toBe('pop');
            expect(state.visiblePane).toBe('content');
        });

        await it('end: hiding the content PUSHES the sidebar on top', () => {
            const { state } = swap('end', false);
            state.setShowSidebar(true);
            expect(state.transition).toBe('push');
            expect(state.visiblePane).toBe('sidebar');
            expect(state.stack).toStrictEqual(['content', 'sidebar']);
        });

        await it('falls back to an instant replace when only one pane is mounted', () => {
            // The animated branch needs BOTH children (:1403-1409), so there is no
            // direction to slide in — the widget must not animate a swap it cannot
            // make.
            const { state, host } = record(new NsNavigationSplitViewState({ collapsed: true }));
            state.setPaneMounted('sidebar', true);
            host.calls.length = 0;

            state.setShowSidebar(false);
            expect(state.transition).toBe('replace');
            expect(host.calls).toStrictEqual(['applyLayout', 'notify:show-sidebar=false']);
        });

        await it('an UNCOLLAPSED show-content change is structural too', () => {
            const { state, host } = record(new NsNavigationSplitViewState());
            state.setPaneMounted('sidebar', true);
            state.setPaneMounted('content', true);
            host.calls.length = 0;

            state.setShowSidebar(false);
            expect(state.transition).toBe('replace');
            expect(host.calls).toStrictEqual(['applyLayout', 'notify:show-sidebar=false']);
        });

        await it('emits nothing when the value is unchanged', () => {
            const { state, host } = record(new NsNavigationSplitViewState({ collapsed: true }));
            state.setPaneMounted('sidebar', true);
            state.setPaneMounted('content', true);
            host.calls.length = 0;

            expect(state.setShowSidebar(true)).toBe(false);
            expect(host.calls).toStrictEqual([]);
        });
    });

    await describe('splitViewColumns against NAVIGATION_SPLIT_VIEW_LAYOUT_VECTORS', async () => {
        // The RTL rows used to be skipped, with a note saying NativeScript
        // surfaces no text direction. It does: `direction` is an inherited CSS
        // property on `Style`, so the whole table is drivable now.
        for (const vector of NAVIGATION_SPLIT_VIEW_LAYOUT_VECTORS) {
            const label = `${vector.sidebarPosition} ${vector.direction}: the sidebar takes the column at x=${vector.sidebar.x}`;
            await it(`${label} — ${vector.rule}`, () => {
                const columns = splitViewColumns(vector.sidebarPosition, vector.direction);
                // The vector's rects are pixels; the grid's equivalent is the
                // ORDER — the sidebar is in the leading column exactly when it is
                // allocated at x = 0.
                const sidebarLeads = vector.sidebar.x === 0;
                expect(columns).toStrictEqual(sidebarLeads ? { sidebar: 0, content: 1 } : { sidebar: 1, content: 0 });
            });
        }

        await it('MIRRORS under RTL — a start sidebar takes the trailing column', () => {
            expect(splitViewColumns('start', 'ltr')).toStrictEqual({ sidebar: 0, content: 1 });
            expect(splitViewColumns('start', 'rtl')).toStrictEqual({ sidebar: 1, content: 0 });
            expect(splitViewColumns('end', 'ltr')).toStrictEqual({ sidebar: 1, content: 0 });
            expect(splitViewColumns('end', 'rtl')).toStrictEqual({ sidebar: 0, content: 1 });
        });

        await it('defaults to ltr, which is what an unset NS direction means', () => {
            expect(splitViewColumns('start')).toStrictEqual(splitViewColumns('start', 'ltr'));
        });

        await it('never puts both panes in the same column', () => {
            // The inversion this closes: the navigation split view wrote the
            // sidebar into column 0 and the content into column 1 UNCONDITIONALLY,
            // while the base had already made column 0 the expanding one for an
            // `end` sidebar — so both the side AND the sizing mode were swapped.
            for (const position of ['start', 'end'] as const) {
                for (const direction of ['ltr', 'rtl'] as const) {
                    const columns = splitViewColumns(position, direction);
                    expect(columns.sidebar).not.toBe(columns.content);
                }
            }
        });
    });

    await describe('setPaneMounted is a no-op on the overlay', async () => {
        await it('reports no change — Adw.OverlaySplitView has no navigation stack', () => {
            const { state, host } = record(new NsOverlaySplitViewState());
            expect(state.setPaneMounted('sidebar', true)).toBe(false);
            expect(state.setPaneMounted('content', true)).toBe(false);
            expect(host.calls).toStrictEqual([]);
        });
    });

    await describe('NsNavigationSplitViewState tags + navigation.* actions', async () => {
        // The class carried a note saying tags and the actions were "NOT wired on
        // NativeScript", so NAVIGATION_ACTION_VECTORS had no consumer on this
        // side and NAVIGATION_SPLIT_VIEW_CRITICALS none at all. They are wired
        // through an explicit setTag rather than a `tag` read off a pane View —
        // a View is not an Adw.NavigationPage.
        for (const vector of NAVIGATION_ACTION_VECTORS) {
            const label =
                vector.action === 'push'
                    ? `push "${vector.tag}" (sidebar=${vector.sidebarTag ?? 'none'}, content=${vector.contentTag ?? 'none'})`
                    : `pop (sidebar=${vector.hasSidebar}, content=${vector.hasContent})`;
            await it(`${label} → ${vector.result.kind} — ${vector.rule}`, () => {
                const state = new NsNavigationSplitViewState({
                    collapsed: vector.collapsed,
                    showContent: vector.showContent,
                    // `delegate` is the ROUTING's answer; whether it survives
                    // depends on the ancestor. An ancestor that claims the tag is
                    // the case the table describes — the unclaimed one becomes a
                    // critical, which is the state's own step.
                    onDelegate: () => true,
                });
                if (vector.action === 'pop') {
                    state.setPaneMounted('sidebar', vector.hasSidebar ?? false);
                    state.setPaneMounted('content', vector.hasContent ?? false);
                    expect(state.pop().kind).toBe(vector.result.kind);
                    return;
                }
                state.setPaneMounted('sidebar', true);
                state.setPaneMounted('content', true);
                // A colliding pair is refused by setTag, so the second tag is the
                // one that does not stick — which is exactly why the shared-tag
                // rows describe a state a real widget cannot reach.
                const sidebarStuck = state.setTag('sidebar', vector.sidebarTag ?? null);
                const contentStuck = state.setTag('content', vector.contentTag ?? null);
                if (!sidebarStuck || !contentStuck) {
                    expect(vector.sidebarTag).toBe(vector.contentTag);
                    return;
                }
                expect(state.push(vector.tag as string).kind).toBe(vector.result.kind);
            });
        }

        await it('REFUSES a colliding retag and clears it, keeping the pane', () => {
            // `check_tags_cb` (:431-460) — a different failure from mounting a
            // colliding page, which is refused outright (:1195-1201).
            const state = new NsNavigationSplitViewState();
            state.setPaneMounted('sidebar', true);
            state.setPaneMounted('content', true);
            expect(state.setTag('sidebar', 'same')).toBe(true);
            expect(state.setTag('content', 'same')).toBe(false);
            expect(state.sidebarTag).toBe('same');
            expect(state.contentTag).toBe(null);
        });

        await it('a push that lands flips show-content, which the widget renders', () => {
            const { state, host } = record(new NsNavigationSplitViewState({ collapsed: true }));
            state.setPaneMounted('sidebar', true);
            state.setPaneMounted('content', true);
            state.setTag('sidebar', 'list');
            state.setTag('content', 'detail');
            host.calls.length = 0;
            expect(state.push('detail').kind).toBe('set-show-content');
            expect(state.showContent).toBe(true);
            // The layout has to have been asked to re-run, or the pane swap is a
            // property change nobody drew.
            expect(host.calls.length).toBeGreaterThan(0);
        });
    });
};

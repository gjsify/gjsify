// Split-view specs — driven by the shared conformance vectors, so this suite and
// the two renderer suites assert the SAME tables.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_SWIPE_BORDER,
    adwLengthToPx,
    INSTANT_SPLIT_VIEW_ANIMATOR,
    isSidebarAtVisualStart,
    layoutNavigationSplitView,
    layoutOverlaySplitView,
    measureSplitViewHorizontal,
    NAVIGATION_SPLIT_VIEW_CRITICALS,
    NavigationSplitViewState,
    OverlaySplitViewState,
    resolveNaturalSidebarWidth,
    resolveNavigationAction,
    resolveNavigationSidebarWidth,
    resolveNavigationStack,
    resolveOverlaySidebarWidth,
    resolveSidebarBounds,
    resolveSwipeArea,
    resolveSwipeRelease,
    resolveSwipeSnapPoints,
    resolveSwipeStart,
    swipeCancelProgress,
    tagsConflict,
} from './split-view.js';
import { glibClamp } from './glib.js';
import type { SplitViewAnimation, SplitViewAnimationRequest, SplitViewAnimator } from './split-view.js';
import {
    ADW_LENGTH_UNIT_VECTORS,
    GLIB_CLAMP_VECTORS,
    NATURAL_SIDEBAR_WIDTH_VECTORS,
    NAVIGATION_ACTION_VECTORS,
    NAVIGATION_SPLIT_VIEW_LAYOUT_VECTORS,
    NAVIGATION_STACK_VECTORS,
    OVERLAY_COLLAPSE_VECTORS,
    OVERLAY_SPLIT_VIEW_LAYOUT_VECTORS,
    OVERLAY_SWIPE_AREA_VECTORS,
    OVERLAY_SWIPE_CANCEL_VECTORS,
    OVERLAY_SWIPE_RELEASE_VECTORS,
    OVERLAY_SWIPE_SNAP_POINT_VECTORS,
    OVERLAY_SWIPE_START_VECTORS,
    SIDEBAR_BOUNDS_VECTORS,
    SIDEBAR_WIDTH_VECTORS,
    SPLIT_VIEW_MEASURE_VECTORS,
    TAGS_CONFLICT_VECTORS,
} from './conformance/split-view.js';

/** A hand-driven animator, so the reveal ramp is exercised without a real timer. */
class ManualAnimator implements SplitViewAnimator {
    requests: SplitViewAnimationRequest[] = [];
    cancelled = 0;
    private _pending: SplitViewAnimationRequest | null = null;

    animate(request: SplitViewAnimationRequest): SplitViewAnimation {
        this.requests.push(request);
        this._pending = request;
        return {
            cancel: () => {
                this.cancelled++;
                this._pending = null;
            },
        };
    }

    /** Deliver one intermediate frame. */
    tick(progress: number): void {
        this._pending?.onValue(progress);
    }

    /** Settle the pending animation on its target. */
    finish(): void {
        const request = this._pending;
        this._pending = null;
        request?.onValue(request.to);
        request?.onDone();
    }
}

export default async () => {
    await describe('length units + GLib CLAMP', async () => {
        for (const { unit, value, dpi, px, rule } of ADW_LENGTH_UNIT_VECTORS) {
            await it(`${value}${unit} at ${dpi} dpi → ${px}px — ${rule}`, () => {
                expect(adwLengthToPx(unit, value, dpi)).toBe(px);
            });
        }

        await it('defaults to 96 dpi, where sp is a passthrough', () => {
            expect(adwLengthToPx('sp', 180)).toBe(180);
        });

        for (const { x, low, high, clamped, rule } of GLIB_CLAMP_VECTORS) {
            await it(`CLAMP(${x}, ${low}, ${high}) = ${clamped} — ${rule}`, () => {
                expect(glibClamp(x, low, high)).toBe(clamped);
            });
        }

        await it('differs from Math.min/Math.max on inverted bounds', () => {
            // The exact case allocate_uncollapsed reaches when the content pane's
            // minimum leaves less room than min-sidebar-width.
            const [x, low, high] = [75, 180, 100];
            expect(glibClamp(x, low, high)).toBe(180);
            expect(Math.min(high, Math.max(low, x))).toBe(100);
        });
    });

    await describe('isSidebarAtVisualStart (get_start_or_end)', async () => {
        await it('is the physical left edge in LTR and mirrors under RTL', () => {
            expect(isSidebarAtVisualStart('start', 'ltr')).toBe(true);
            expect(isSidebarAtVisualStart('end', 'ltr')).toBe(false);
            expect(isSidebarAtVisualStart('start', 'rtl')).toBe(false);
            expect(isSidebarAtVisualStart('end', 'rtl')).toBe(true);
        });

        await it('defaults to LTR', () => {
            expect(isSidebarAtVisualStart('start')).toBe(true);
        });
    });

    await describe('sidebar bounds (measure vs allocate)', async () => {
        for (const { spec, sidebarChildMin, ceil, min, max, rule } of SIDEBAR_BOUNDS_VECTORS) {
            await it(`${ceil ? 'allocate' : 'measure'} → [${min}, ${max}] — ${rule}`, () => {
                expect(resolveSidebarBounds(spec, sidebarChildMin, { ceil })).toStrictEqual({ min, max });
            });
        }
    });

    await describe('allocated sidebar width', async () => {
        for (const vector of SIDEBAR_WIDTH_VECTORS) {
            const { widget, spec, totalWidth, contentMin, sidebarChildMin, collapsed, width, rule } = vector;
            await it(`${widget} @${totalWidth} → ${width} — ${rule}`, () => {
                const input = { ...spec, totalWidth, contentMin, sidebarChildMin };
                const actual =
                    widget === 'navigation'
                        ? resolveNavigationSidebarWidth(input)
                        : resolveOverlaySidebarWidth({ ...input, collapsed });
                expect(actual).toBe(width);
            });
        }

        await it('the two widgets disagree on the SAME input', () => {
            // The bound-vs-result cap. A renderer that shares one implementation
            // between its two split views is wrong for one of them.
            const input = { totalWidth: 300, contentMin: 200 };
            expect(resolveNavigationSidebarWidth(input)).toBe(180);
            expect(resolveOverlaySidebarWidth(input)).toBe(100);
        });
    });

    await describe('natural sidebar width + container measure', async () => {
        for (const { contentNatural, min, max, fraction, natural, rule } of NATURAL_SIDEBAR_WIDTH_VECTORS) {
            await it(`content ${contentNatural} × ${fraction} → ${natural} — ${rule}`, () => {
                expect(resolveNaturalSidebarWidth(contentNatural, { min, max }, fraction)).toBe(natural);
            });
        }

        for (const vector of SPLIT_VIEW_MEASURE_VECTORS) {
            const { min, max, sidebarNatural, contentMin, contentNatural, showProgress, minimum, natural } = vector;
            await it(`progress ${showProgress} → {${minimum}, ${natural}} — ${vector.rule}`, () => {
                expect(
                    measureSplitViewHorizontal({
                        bounds: { min, max },
                        sidebarNatural,
                        contentMin,
                        contentNatural,
                        showProgress,
                    }),
                ).toStrictEqual({ minimum, natural });
            });
        }

        await it('defaults progress to 1, reducing to the navigation rule', () => {
            expect(
                measureSplitViewHorizontal({
                    bounds: { min: 180, max: 280 },
                    sidebarNatural: 267,
                    contentMin: 400,
                    contentNatural: 800,
                }),
            ).toStrictEqual({ minimum: 580, natural: 1067 });
        });
    });

    await describe('pane geometry', async () => {
        for (const vector of NAVIGATION_SPLIT_VIEW_LAYOUT_VECTORS) {
            const { totalWidth, sidebarWidth, sidebarPosition, direction, sidebar, content, rule } = vector;
            await it(`nav ${sidebarPosition}/${direction} — ${rule}`, () => {
                expect(
                    layoutNavigationSplitView({ totalWidth, sidebarWidth, sidebarPosition, direction }),
                ).toStrictEqual({ sidebar, content });
            });
        }

        for (const vector of OVERLAY_SPLIT_VIEW_LAYOUT_VECTORS) {
            const { totalWidth, sidebarWidth, showProgress, collapsed, sidebarPosition, direction, layout } = vector;
            await it(`overlay ${collapsed ? 'collapsed' : 'docked'} @${showProgress} — ${vector.rule}`, () => {
                const actual = layoutOverlaySplitView({
                    totalWidth,
                    sidebarWidth,
                    showProgress,
                    collapsed,
                    sidebarPosition,
                    direction,
                });
                expect(actual.sidebar).toStrictEqual(layout.sidebar);
                expect(actual.content).toStrictEqual(layout.content);
                expect(actual.shieldVisible).toBe(layout.shieldVisible);
                expect(actual.sidebarPainted).toBe(layout.sidebarPainted);
                expect(actual.shadowProgress).toBe(layout.shadowProgress);
                expect(actual.shadowSide).toBe(layout.shadowSide);
            });
        }
    });

    await describe('tags + navigation stack + actions', async () => {
        for (const { sidebarTag, contentTag, conflict, rule } of TAGS_CONFLICT_VECTORS) {
            await it(`${JSON.stringify(sidebarTag)} vs ${JSON.stringify(contentTag)} → ${conflict} — ${rule}`, () => {
                expect(tagsConflict(sidebarTag, contentTag)).toBe(conflict);
            });
        }

        await it('treats an omitted tag like an absent one', () => {
            expect(tagsConflict(undefined, undefined)).toBe(false);
            expect(tagsConflict('a', undefined)).toBe(false);
        });

        for (const vector of NAVIGATION_STACK_VECTORS) {
            const { hasSidebar, hasContent, sidebarPosition, showContent, changingPage, plan, rule } = vector;
            await it(`stack [${plan.stack.join(', ')}] ${plan.transition} — ${rule}`, () => {
                expect(
                    resolveNavigationStack({ hasSidebar, hasContent, sidebarPosition, showContent, changingPage }),
                ).toStrictEqual(plan);
            });
        }

        await it('the animated branch settles on the SAME stack as the static one', () => {
            for (const sidebarPosition of ['start', 'end'] as const) {
                for (const showContent of [false, true]) {
                    const base = { hasSidebar: true, hasContent: true, sidebarPosition, showContent };
                    expect(resolveNavigationStack({ ...base, changingPage: true }).stack).toStrictEqual(
                        resolveNavigationStack(base).stack,
                    );
                }
            }
        });

        for (const vector of NAVIGATION_ACTION_VECTORS) {
            await it(`${vector.action} → ${vector.result.kind} — ${vector.rule}`, () => {
                const input =
                    vector.action === 'push'
                        ? ({
                              action: 'push',
                              tag: vector.tag!,
                              sidebarTag: vector.sidebarTag,
                              contentTag: vector.contentTag,
                              showContent: vector.showContent,
                              collapsed: vector.collapsed,
                          } as const)
                        : ({
                              action: 'pop',
                              hasSidebar: vector.hasSidebar!,
                              hasContent: vector.hasContent!,
                              showContent: vector.showContent,
                          } as const);
                expect(resolveNavigationAction(input)).toStrictEqual(vector.result);
            });
        }
    });

    await describe('NavigationSplitViewState', async () => {
        await it('REFUSES a page whose tag the other pane already holds', () => {
            const criticals: string[] = [];
            const state = new NavigationSplitViewState({ onCritical: (m) => criticals.push(m) });
            expect(state.setSidebar({ tag: 'a' })).toBe(true);
            expect(state.setContent({ tag: 'a' })).toBe(false);
            expect(state.content).toBe(null);
            expect(criticals).toStrictEqual([NAVIGATION_SPLIT_VIEW_CRITICALS.contentCollision('a')]);
        });

        await it('CLEARS the tag instead when a MOUNTED page is retagged', () => {
            // A different failure mode from the refused assignment above: by then
            // the page is already installed, so check_tags_cb drops the tag.
            const criticals: string[] = [];
            const state = new NavigationSplitViewState({ onCritical: (m) => criticals.push(m) });
            state.setSidebar({ tag: 'a' });
            state.setContent({ tag: 'b' });
            expect(state.setTag('content', 'a')).toBe(false);
            expect(state.content).not.toBe(null);
            expect(state.contentTag).toBe(null);
            expect(criticals).toStrictEqual([NAVIGATION_SPLIT_VIEW_CRITICALS.contentTagCollision('a')]);
        });

        await it('routes navigation.push / navigation.pop', () => {
            const criticals: string[] = [];
            const state = new NavigationSplitViewState({ onCritical: (m) => criticals.push(m) });
            state.setSidebar({ tag: 'list' });
            state.setContent({ tag: 'detail' });
            expect(state.push('detail')).toStrictEqual({ kind: 'set-show-content', showContent: true });
            expect(state.showContent).toBe(true);
            expect(state.pop()).toStrictEqual({ kind: 'set-show-content', showContent: false });
            expect(state.showContent).toBe(false);
            expect(criticals).toHaveLength(0);
        });

        await it('criticals an unclaimed push but lets an unclaimed pop pass silently', () => {
            const criticals: string[] = [];
            const state = new NavigationSplitViewState({ onCritical: (m) => criticals.push(m) });
            expect(state.push('nope')).toStrictEqual({ kind: 'not-found', tag: 'nope' });
            expect(criticals).toStrictEqual([NAVIGATION_SPLIT_VIEW_CRITICALS.notFound('nope')]);
            expect(state.pop()).toStrictEqual({ kind: 'delegate' });
            expect(criticals).toHaveLength(1);
        });

        await it('offers an unmatched action to the parent before failing it', () => {
            const seen: string[] = [];
            const state = new NavigationSplitViewState({
                onCritical: () => {
                    throw new Error('must not reach the critical when the parent handles it');
                },
                onDelegate: (action, tag) => {
                    seen.push(`${action}:${tag ?? ''}`);
                    return true;
                },
            });
            expect(state.push('outer')).toStrictEqual({ kind: 'delegate' });
            expect(seen).toStrictEqual(['push:outer']);
        });

        await it('tags a show-content change and reports its push/pop direction', () => {
            const state = new NavigationSplitViewState({ collapsed: true });
            state.setSidebar({});
            state.setContent({});
            const changes: { transition: string; interactive: boolean }[] = [];
            state.subscribe((c) => changes.push({ transition: c.plan.transition, interactive: c.interactive }));
            expect(state.setShowContent(true, true)).toBe(true);
            expect(changes).toStrictEqual([{ transition: 'push', interactive: true }]);
            expect(state.visiblePane).toBe('content');
            expect(state.setShowContent(true)).toBe(false); // idempotent, no notification
            expect(changes).toHaveLength(1);
        });

        await it('reports `replace` when the change is not animatable', () => {
            // `set_show_content` only drives the navigation view when the split
            // view is collapsed AND both children are present.
            const state = new NavigationSplitViewState();
            state.setSidebar({});
            state.setContent({});
            const transitions: string[] = [];
            state.subscribe((c) => transitions.push(c.plan.transition));
            state.setShowContent(true);
            expect(transitions).toStrictEqual(['replace']);
        });

        await it('keeps a LONE child visible whatever show-content says', () => {
            const state = new NavigationSplitViewState({ collapsed: true, showContent: true });
            state.setSidebar({});
            expect(state.visiblePane).toBe('sidebar');
            expect(state.stack.stack).toStrictEqual(['sidebar']);
        });
    });

    await describe('OverlaySplitViewState', async () => {
        for (const vector of OVERLAY_COLLAPSE_VECTORS) {
            await it(`collapse coupling — ${vector.rule}`, () => {
                const state = new OverlaySplitViewState(vector.initial);
                const snapshot = () => ({
                    showSidebar: state.showSidebar,
                    collapsed: state.collapsed,
                    showProgress: state.showProgress,
                    shieldVisible: state.shieldVisible,
                    sidebarFocusable: state.sidebarFocusable,
                    contentFocusable: state.contentFocusable,
                });
                expect(snapshot()).toStrictEqual(vector.before);
                const notified: string[] = [];
                state.subscribe((c) => notified.push(c.property));
                state.setCollapsed(vector.setCollapsed);
                expect(snapshot()).toStrictEqual(vector.after);
                expect(notified).toStrictEqual([...vector.notifications]);
            });
        }

        await it('notifies exactly once for a repeated hide', () => {
            // The web element fires `sidebar-toggled` twice here today, and fires
            // nothing at all for the equivalent property set.
            const state = new OverlaySplitViewState();
            const notified: string[] = [];
            state.subscribe((c) => notified.push(c.property));
            expect(state.setShowSidebar(false)).toBe(true);
            expect(state.setShowSidebar(false)).toBe(false);
            expect(notified.filter((p) => p === 'show-sidebar')).toHaveLength(1);
        });

        await it('consumes Escape only when collapsed with the sidebar out', () => {
            const collapsedOpen = new OverlaySplitViewState({ collapsed: true, showSidebar: true });
            expect(collapsedOpen.escape()).toBe(true);
            expect(collapsedOpen.showSidebar).toBe(false);
            expect(collapsedOpen.escape()).toBe(false); // progress is 0 now

            const docked = new OverlaySplitViewState({ showSidebar: true });
            expect(docked.escape()).toBe(false);
            expect(docked.showSidebar).toBe(true);
        });

        await it('hides on a shield click and marks it interactive', () => {
            const state = new OverlaySplitViewState({ collapsed: true, showSidebar: true });
            const interactive: boolean[] = [];
            state.subscribe((c) => {
                if (c.property === 'show-sidebar') interactive.push(c.interactive);
            });
            expect(state.dismissShield()).toBe(true);
            expect(state.dismissShield()).toBe(false);
            expect(interactive).toStrictEqual([true]);
        });

        await it('ramps the progress through the injected animator', () => {
            const animator = new ManualAnimator();
            const state = new OverlaySplitViewState({ animator });
            const progress: number[] = [];
            state.subscribe((c) => {
                if (c.property === 'show-progress') progress.push(c.showProgress);
            });
            state.setShowSidebar(false);
            expect(state.showProgress).toBe(1); // nothing has ticked yet
            expect(animator.requests[0]).toMatchObject({ from: 1, to: 0, clamp: true });
            animator.tick(0.4);
            expect(state.showProgress).toBe(0.4);
            expect(state.shieldVisible).toBe(false); // not collapsed
            animator.finish();
            expect(state.showProgress).toBe(0);
            expect(progress).toStrictEqual([0.4, 0]);
        });

        await it('does NOT animate the collapse-driven hide', () => {
            // `set_collapsed` passes animate = FALSE, so the sidebar is simply gone.
            const animator = new ManualAnimator();
            const state = new OverlaySplitViewState({ animator });
            state.setCollapsed(true);
            expect(animator.requests).toHaveLength(0);
            expect(state.showProgress).toBe(0);
        });

        await it('ships an instant animator so a renderer without timing still settles', () => {
            const state = new OverlaySplitViewState({ animator: INSTANT_SPLIT_VIEW_ANIMATOR });
            state.setShowSidebar(false);
            expect(state.showProgress).toBe(0);
        });

        await it('lets a swipe own the progress and settle it', () => {
            const state = new OverlaySplitViewState({ collapsed: true, showSidebar: false });
            state.beginSwipe();
            expect(state.snapPoints).toStrictEqual([0, 1]);
            state.setShowProgress(0.6);
            expect(state.showProgress).toBe(0.6);
            expect(state.shieldVisible).toBe(true);
            expect(state.endSwipe(1)).toStrictEqual({ kind: 'set-show-sidebar', showSidebar: true });
            expect(state.showSidebar).toBe(true);
        });
    });

    await describe('swipe gating + geometry', async () => {
        for (const vector of OVERLAY_SWIPE_SNAP_POINT_VECTORS) {
            await it(`snap points [${vector.snapPoints.join(', ')}] — ${vector.rule}`, () => {
                expect(
                    resolveSwipeSnapPoints({
                        showProgress: vector.showProgress,
                        enableShowGesture: vector.enableShowGesture,
                        enableHideGesture: vector.enableHideGesture,
                        swipeActive: vector.swipeActive,
                    }),
                ).toStrictEqual(vector.snapPoints);
            });
        }

        for (const vector of OVERLAY_SWIPE_START_VECTORS) {
            await it(`swipe start ${vector.detected} — ${vector.rule}`, () => {
                expect(
                    resolveSwipeStart({
                        showProgress: vector.showProgress,
                        collapsed: vector.collapsed,
                        direction: vector.direction,
                        enableShowGesture: vector.enableShowGesture,
                        enableHideGesture: vector.enableHideGesture,
                    }),
                ).toBe(vector.detected);
            });
        }

        for (const vector of OVERLAY_SWIPE_RELEASE_VECTORS) {
            await it(`release at ${vector.to} → ${vector.kind} — ${vector.rule}`, () => {
                const release = resolveSwipeRelease({ to: vector.to, showSidebar: vector.showSidebar });
                expect(release.kind).toBe(vector.kind);
                if (release.kind === 'set-show-sidebar') {
                    expect(release.showSidebar).toBe(vector.showSidebarAfter);
                }
            });
        }

        for (const { showProgress, cancelProgress, rule } of OVERLAY_SWIPE_CANCEL_VECTORS) {
            await it(`cancel(${showProgress}) = ${cancelProgress} — ${rule}`, () => {
                expect(swipeCancelProgress(showProgress)).toBe(cancelProgress);
            });
        }

        await it('rounds negatives away from zero, unlike Math.round', () => {
            expect(swipeCancelProgress(-0.5)).toBe(-1);
            expect(Math.round(-0.5)).toBe(-0);
        });

        for (const vector of OVERLAY_SWIPE_AREA_VECTORS) {
            await it(`swipe area ${JSON.stringify(vector.area)} — ${vector.rule}`, () => {
                expect(
                    resolveSwipeArea({
                        isDrag: vector.isDrag,
                        sidebarWidth: vector.sidebarWidth,
                        showProgress: vector.showProgress,
                        totalWidth: vector.totalWidth,
                        totalHeight: vector.totalHeight,
                        sidebarPosition: vector.sidebarPosition,
                        direction: vector.direction,
                    }),
                ).toStrictEqual(vector.area);
            });
        }

        await it('never grabs less than ADW_SWIPE_BORDER', () => {
            const area = resolveSwipeArea({
                isDrag: true,
                sidebarWidth: 10,
                showProgress: 1,
                totalWidth: 400,
                totalHeight: 800,
            });
            expect(area.width).toBe(ADW_SWIPE_BORDER);
        });
    });
};

// The two split views against the shared conformance vectors.
//
// The element now delegates the property interplay to
// `OverlaySplitViewState`, so this suite asserts the half a DOM renderer owns:
// that the attributes reach the state, and that what the state derives actually
// reaches the DOM.
//
// The rule it pins down first is the one the element got wrong for its whole
// life: `Adw.OverlaySplitView:show-sidebar` defaults to TRUE
// (adw-overlay-split-view.c:974-976), and an HTML boolean attribute is
// presence-only, which can only express a FALSE default. Bare markup showed no
// sidebar where GTK shows one.
import { describe, expect, it } from '@gjsify/unit';

import {
    OVERLAY_COLLAPSE_VECTORS,
    OVERLAY_SWIPE_AREA_VECTORS,
    OVERLAY_SWIPE_CANCEL_VECTORS,
    OVERLAY_SWIPE_RELEASE_VECTORS,
    OVERLAY_SWIPE_SNAP_POINT_VECTORS,
    OVERLAY_SWIPE_START_VECTORS,
    NAVIGATION_ACTION_VECTORS,
    NAVIGATION_STACK_VECTORS,
    SIDEBAR_BOUNDS_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import type { AdwNavigationSplitView } from './elements/adw-navigation-split-view.js';
import type { AdwOverlaySplitView } from './elements/adw-overlay-split-view.js';

/** Wait for a ResizeObserver delivery (it runs after layout, before paint). */
function settle(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/** Mount a split view from markup and return it. */
function mount(attrs = ''): { view: AdwOverlaySplitView; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML =
        `<adw-overlay-split-view ${attrs}>` +
        '<div slot="sidebar">s</div><div slot="content">c</div>' +
        '</adw-overlay-split-view>';
    return { view: host.querySelector('adw-overlay-split-view') as AdwOverlaySplitView, host };
}

/** The parts of `OverlaySplitViewSnapshot` a DOM renderer actually publishes. */
interface DomSnapshot {
    showSidebar: boolean;
    collapsed: boolean;
    shieldVisible: boolean;
    sidebarFocusable: boolean;
    contentFocusable: boolean;
}

/**
 * Read the whole derived state back OUT of the DOM.
 *
 * Asserting only `showSidebar`/`collapsed` is what let `pin-sidebar` fall out of
 * `observedAttributes` unnoticed: both of those still agreed, because the vectors
 * only ever set the attribute in markup, where `connectedCallback` reads it
 * directly. Every field the element publishes is checked here instead.
 *
 * `showProgress` is the one snapshot field with no DOM surface — the element
 * paints the reveal from the `collapsed`/`show-sidebar` classes rather than a
 * numeric progress (a continuous reveal is not implemented). `shieldVisible` is
 * derived from it (`collapsed && showProgress > 0`), so a progress bug still
 * shows up here.
 */
function domSnapshot(view: AdwOverlaySplitView): DomSnapshot {
    const backdrop = view.querySelector('.adw-osv-backdrop') as HTMLElement;
    const sidebar = view.querySelector('.adw-osv-sidebar') as HTMLElement;
    const content = view.querySelector('.adw-osv-content') as HTMLElement;
    return {
        showSidebar: view.classList.contains('show-sidebar'),
        collapsed: view.classList.contains('collapsed'),
        shieldVisible: !backdrop.hidden,
        sidebarFocusable: sidebar.getAttribute('aria-hidden') === 'false',
        contentFocusable: content.getAttribute('aria-hidden') === 'false',
    };
}

/** The same five fields, taken from a conformance snapshot. */
function expectedSnapshot(snapshot: {
    showSidebar: boolean;
    collapsed: boolean;
    shieldVisible: boolean;
    sidebarFocusable: boolean;
    contentFocusable: boolean;
}): DomSnapshot {
    return {
        showSidebar: snapshot.showSidebar,
        collapsed: snapshot.collapsed,
        shieldVisible: snapshot.shieldVisible,
        sidebarFocusable: snapshot.sidebarFocusable,
        contentFocusable: snapshot.contentFocusable,
    };
}

export const AdwSplitViewsTest = async () => {
    await describe('adw-overlay-split-view defaults (Adw.OverlaySplitView properties)', async () => {
        await it('shows the sidebar with no attributes at all, like GTK does', () => {
            const { view, host } = mount();
            expect(view.showSidebar).toBe(true);
            expect(view.classList.contains('show-sidebar')).toBe(true);
            host.remove();
        });

        await it('takes show-sidebar="false" as the explicit off switch', () => {
            const { view, host } = mount('show-sidebar="false"');
            expect(view.showSidebar).toBe(false);
            expect(view.classList.contains('show-sidebar')).toBe(false);
            host.remove();
        });

        await it('still treats a bare show-sidebar as true', () => {
            const { view, host } = mount('show-sidebar');
            expect(view.showSidebar).toBe(true);
            host.remove();
        });

        await it('round-trips the property setter through the attribute', () => {
            const { view, host } = mount();
            view.showSidebar = false;
            expect(view.showSidebar).toBe(false);
            view.showSidebar = true;
            expect(view.showSidebar).toBe(true);
            host.remove();
        });
    });

    await describe('adw-overlay-split-view collapse (shared conformance vectors)', async () => {
        for (const vector of OVERLAY_COLLAPSE_VECTORS) {
            const { initial, before, setCollapsed, after, rule } = vector;
            // Only the rows a DOM element can express: `pinSidebar` and the
            // starting `collapsed`/`showSidebar` all have attributes.
            const attrs = [
                initial.collapsed ? 'collapsed' : '',
                initial.showSidebar === false ? 'show-sidebar="false"' : '',
                initial.pinSidebar ? 'pin-sidebar' : '',
            ]
                .filter(Boolean)
                .join(' ');

            await it(`${JSON.stringify(initial)} → collapsed=${setCollapsed} — ${rule}`, () => {
                const { view, host } = mount(attrs);
                expect(view.showSidebar).toBe(before.showSidebar);
                expect(view.collapsed).toBe(before.collapsed);
                expect(domSnapshot(view)).toStrictEqual(expectedSnapshot(before));

                view.collapsed = setCollapsed;
                expect(view.showSidebar).toBe(after.showSidebar);
                expect(view.collapsed).toBe(after.collapsed);
                expect(domSnapshot(view)).toStrictEqual(expectedSnapshot(after));
                host.remove();
            });
        }

        await it('honours pin-sidebar set AFTER construction, not only in markup', () => {
            // The regression the vector loop above cannot see: it only ever puts
            // `pin-sidebar` in the markup, which `connectedCallback` reads directly.
            // With the attribute missing from `observedAttributes` the
            // `_readAttribute` branch was dead, so pinning a live element silently
            // did nothing and the next collapse still hid the sidebar.
            const { view, host } = mount();
            view.setAttribute('pin-sidebar', '');

            view.collapsed = true;
            expect(domSnapshot(view)).toStrictEqual({
                showSidebar: true,
                collapsed: true,
                shieldVisible: true,
                sidebarFocusable: true,
                contentFocusable: false,
            });
            host.remove();
        });

        await it('unpins again when the attribute is removed', () => {
            const { view, host } = mount('pin-sidebar');
            view.removeAttribute('pin-sidebar');

            view.collapsed = true;
            expect(domSnapshot(view)).toStrictEqual({
                showSidebar: false,
                collapsed: true,
                shieldVisible: false,
                sidebarFocusable: false,
                contentFocusable: true,
            });
            host.remove();
        });
    });

    await describe('adw-overlay-split-view derived state reaches the DOM', async () => {
        await it('hides the shield unless collapsed AND revealed', () => {
            const { view, host } = mount();
            const backdrop = view.querySelector('.adw-osv-backdrop') as HTMLElement;
            // Expanded: no shield, whatever the sidebar is doing.
            expect(backdrop.hidden).toBe(true);
            host.remove();
        });

        await it('marks the off-screen pane aria-hidden once collapsing hides it', () => {
            // Collapsing is a TRANSITION: it auto-hides an unpinned sidebar, so
            // content becomes the reachable pane. Constructing collapsed does
            // NOT — `<adw-overlay-split-view collapsed>` keeps the sidebar shown,
            // the same as building the GTK widget with both properties set.
            const { view, host } = mount();
            expect((view.querySelector('.adw-osv-sidebar') as HTMLElement).getAttribute('aria-hidden')).toBe('false');

            view.collapsed = true;
            expect((view.querySelector('.adw-osv-sidebar') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
            expect((view.querySelector('.adw-osv-content') as HTMLElement).getAttribute('aria-hidden')).toBe('false');
            host.remove();
        });

        await it('constructing collapsed keeps the sidebar shown, unlike collapsing later', () => {
            const { view, host } = mount('collapsed');
            expect(view.showSidebar).toBe(true);
            host.remove();
        });

        await it('leaves both panes reachable while expanded', () => {
            const { view, host } = mount();
            expect((view.querySelector('.adw-osv-sidebar') as HTMLElement).getAttribute('aria-hidden')).toBe('false');
            expect((view.querySelector('.adw-osv-content') as HTMLElement).getAttribute('aria-hidden')).toBe('false');
            host.remove();
        });
    });
    await describe('adw-overlay-split-view sidebar width (Adw.OverlaySplitView properties)', async () => {
        await it('defaults to the WIDGET values, not to an app preference', () => {
            // 180 / 280 / 0.25 — adw-overlay-split-view.c:1036-1075. These read
            // 280 / 400 / 0.30 before, which are the values the three.js and
            // canvas2d showcases set explicitly in their .blp, so the storybook's
            // GTK and browser sides showed different sidebars.
            const { view, host } = mount();
            expect(view.minSidebarWidth).toBe(180);
            expect(view.maxSidebarWidth).toBe(280);
            expect(view.sidebarWidthFraction).toBe(0.25);
            host.remove();
        });

        await it('writes the normalised bounds, not the raw attributes', () => {
            const { view, host } = mount('min-sidebar-width="300" max-sidebar-width="200"');
            const sidebar = view.querySelector('.adw-osv-sidebar') as HTMLElement;
            // libadwaita never lets max fall below min, so both land at 300.
            // CSS on its own resolves the conflict the other way (min-width wins
            // over max-width), which would render a different widget.
            expect(sidebar.style.minWidth).toBe('300px');
            expect(sidebar.style.maxWidth).toBe('300px');
            host.remove();
        });

        for (const vector of SIDEBAR_BOUNDS_VECTORS) {
            // Only the rows expressible in CSS pixels: the element has no dpi or
            // length-unit attribute, so `sp`-at-another-dpi rows stay in core.
            if (vector.spec.sidebarWidthUnit !== undefined || vector.spec.dpi !== undefined) continue;
            if (vector.sidebarChildMin !== 0 || !vector.ceil) continue;

            const attrs = [
                vector.spec.minSidebarWidth !== undefined ? `min-sidebar-width="${vector.spec.minSidebarWidth}"` : '',
                vector.spec.maxSidebarWidth !== undefined ? `max-sidebar-width="${vector.spec.maxSidebarWidth}"` : '',
            ]
                .filter(Boolean)
                .join(' ');

            await it(`bounds ${JSON.stringify(vector.spec)} → ${vector.min}/${vector.max} — ${vector.rule}`, () => {
                const { view, host } = mount(attrs);
                const sidebar = view.querySelector('.adw-osv-sidebar') as HTMLElement;
                expect(sidebar.style.minWidth).toBe(`${vector.min}px`);
                expect(sidebar.style.maxWidth).toBe(`${vector.max}px`);
                host.remove();
            });
        }
    });
    await describe('adw-navigation-split-view sidebar width (Adw.NavigationSplitView)', async () => {
        const mountNav = (attrs = '') => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            host.innerHTML =
                `<adw-navigation-split-view ${attrs}>` +
                '<div slot="sidebar">s</div><div slot="content">c</div>' +
                '</adw-navigation-split-view>';
            return {
                view: host.querySelector('adw-navigation-split-view') as AdwNavigationSplitView,
                host,
            };
        };

        await it('bounds the sidebar even with no attributes', () => {
            // An absent attribute used to mean "no bound at all"; the widget
            // always has 180 / 280.
            const { view, host } = mountNav();
            const sidebar = view.querySelector('.adw-nsv-sidebar') as HTMLElement;
            expect(sidebar.style.minWidth).toBe('180px');
            expect(sidebar.style.maxWidth).toBe('280px');
            host.remove();
        });

        await it('normalises an inverted pair the way GLib CLAMP does', () => {
            const { view, host } = mountNav('min-sidebar-width="320" max-sidebar-width="200"');
            const sidebar = view.querySelector('.adw-nsv-sidebar') as HTMLElement;
            expect(sidebar.style.minWidth).toBe('320px');
            expect(sidebar.style.maxWidth).toBe('320px');
            host.remove();
        });

        await it('drops the caps while collapsed, so the pane fills the view', () => {
            const { view, host } = mountNav('collapsed');
            const sidebar = view.querySelector('.adw-nsv-sidebar') as HTMLElement;
            expect(sidebar.style.minWidth).toBe('');
            expect(sidebar.style.maxWidth).toBe('');
            host.remove();
        });

        await it('falls back to the default when the attribute is not a number', () => {
            const { view, host } = mountNav('min-sidebar-width="wide"');
            const sidebar = view.querySelector('.adw-nsv-sidebar') as HTMLElement;
            expect(sidebar.style.minWidth).toBe('180px');
            host.remove();
        });
    });

    await describe('<adw-overlay-split-view> reveal is a CONTINUUM, not two states', async () => {
        /** Mount a view of a known width so the geometry is predictable. */
        function mountSizedView(width: number, attrs = ''): { view: AdwOverlaySplitView; host: HTMLElement } {
            const { view, host } = mount(attrs);
            host.style.width = `${width}px`;
            host.style.height = '400px';
            (view as unknown as HTMLElement).style.height = '400px';
            return { view, host };
        }

        /** The state the element composes — the same object the vectors describe. */
        const stateOf = (view: AdwOverlaySplitView) =>
            (view as unknown as { _state: import('@gjsify/adwaita-core').OverlaySplitViewState })._state;

        await it('drives show-progress through the whole range, not 0 and 1', async () => {
            const { view, host } = mountSizedView(800);
            const state = stateOf(view);
            const sidebar = view.querySelector('.adw-osv-sidebar') as HTMLElement;
            await settle();

            const offsets = new Set<string>();
            for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
                state.setShowProgress(progress);
                offsets.add(sidebar.style.marginLeft || sidebar.style.left || '');
            }
            // Two end states would give at most two distinct offsets; the five
            // OVERLAY_SWIPE_* tables need every value in between to mean something.
            expect(offsets.size).toBeGreaterThan(2);
            host.remove();
        });

        for (const vector of OVERLAY_SWIPE_SNAP_POINT_VECTORS) {
            await it(`snap points [${vector.snapPoints.join(', ')}] — ${vector.rule}`, async () => {
                const attrs =
                    (vector.enableShowGesture ? '' : 'enable-show-gesture="false" ') +
                    (vector.enableHideGesture ? '' : 'enable-hide-gesture="false"');
                const { view, host } = mountSizedView(800, attrs);
                const state = stateOf(view);
                await settle();
                state.setShowProgress(vector.showProgress);
                if (vector.swipeActive) state.beginSwipe();
                expect(state.snapPoints).toStrictEqual([...vector.snapPoints]);
                host.remove();
            });
        }

        await it('grabs only where the swipe area is — the ADW_SWIPE_BORDER strip when closed', async () => {
            // The AREA itself is `resolveSwipeArea`, driven row by row in the
            // core suite; what a DOM renderer owns is that a pointerdown OUTSIDE
            // it starts nothing, which no unit test of the function can show.
            const { view, host } = mountSizedView(800, 'collapsed show-sidebar="false"');
            const state = stateOf(view);
            await settle();
            const rect = view.getBoundingClientRect();

            const down = (offsetX: number) =>
                view.dispatchEvent(
                    new PointerEvent('pointerdown', {
                        bubbles: true,
                        pointerId: 1,
                        button: 0,
                        clientX: rect.left + offsetX,
                        clientY: rect.top + 100,
                    }),
                );
            const move = (offsetX: number) =>
                view.dispatchEvent(
                    new PointerEvent('pointermove', {
                        bubbles: true,
                        pointerId: 1,
                        clientX: rect.left + offsetX,
                        clientY: rect.top + 100,
                    }),
                );

            // Far from the edge: outside the 32px strip, so nothing begins.
            down(300);
            move(400);
            expect(state.swipeActive).toBe(false);

            // On the edge: the gesture takes over and the progress follows.
            down(8);
            move(120);
            expect(state.swipeActive).toBe(true);
            expect(state.showProgress).toBeGreaterThan(0);
            host.remove();
        });

        for (const vector of OVERLAY_SWIPE_RELEASE_VECTORS) {
            await it(`release at ${vector.to} — ${vector.rule}`, async () => {
                const { view, host } = mountSizedView(800, 'collapsed');
                const state = stateOf(view);
                await settle();
                // Seed `show-sidebar` without animating, then take the gesture.
                state.setShowSidebar(vector.showSidebar, { animate: false });
                state.beginSwipe();
                const plan = state.endSwipe(vector.to);
                expect(plan.kind).toBe(vector.kind);
                // A `set-show-sidebar` release is the one that notifies, so the
                // property has to have MOVED, not just the animation settled.
                if (plan.kind === 'set-show-sidebar') expect(state.showSidebar).toBe(vector.showSidebarAfter);
                host.remove();
            });
        }

        await it('a cancelled pointer snaps back where get_cancel_progress says', async () => {
            const { view, host } = mountSizedView(800, 'collapsed show-sidebar="false"');
            const state = stateOf(view);
            await settle();
            const rect = view.getBoundingClientRect();
            view.dispatchEvent(
                new PointerEvent('pointerdown', {
                    bubbles: true,
                    pointerId: 2,
                    button: 0,
                    clientX: rect.left + 8,
                    clientY: rect.top + 100,
                }),
            );
            view.dispatchEvent(
                new PointerEvent('pointermove', {
                    bubbles: true,
                    pointerId: 2,
                    clientX: rect.left + 60,
                    clientY: rect.top + 100,
                }),
            );
            expect(state.swipeActive).toBe(true);
            view.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 2 }));
            expect(state.swipeActive).toBe(false);
            // A short drag from closed rounds back to closed.
            expect(state.showSidebar).toBe(false);
            host.remove();
        });

        await it('Escape closes a collapsed revealed sidebar', async () => {
            // `escape_shortcut_cb` (adw-overlay-split-view.c:705-716) was absent
            // from both ports, which made `OverlaySplitViewState.escape()` dead
            // code.
            const { view, host } = mountSizedView(800, 'collapsed');
            await settle();
            // Parse-time attributes are CONSTRUCTION options, not sequential
            // setters, so `collapsed` in the markup does not fire the auto-hide
            // — the element documents that and OVERLAY_COLLAPSE_VECTORS covers
            // the setter path. So the sidebar is already revealed here.
            expect(view.showSidebar).toBe(true);

            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
            view.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            expect(view.showSidebar).toBe(false);
            host.remove();
        });

        await it('...and PROPAGATES from an uncollapsed one, so an enclosing dialog still closes', async () => {
            const { view, host } = mountSizedView(800);
            await settle();
            expect(view.collapsed).toBe(false);
            expect(view.showSidebar).toBe(true);

            const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
            view.dispatchEvent(event);
            // A docked sidebar is not something Escape closes, however revealed
            // it is — the gate is `!collapsed`, checked before the progress.
            expect(event.defaultPrevented).toBe(false);
            expect(view.showSidebar).toBe(true);
            host.remove();
        });

        await it('is gated on the PROGRESS, so it still consumes mid-close', async () => {
            // Worth pinning because it looks like a bug: `escape_shortcut_cb`
            // tests `show_progress`, not `show_sidebar`, so a second Escape
            // during the closing animation is consumed too and the set inside is
            // a no-op. Reading the gate as "is the sidebar shown" would make the
            // key propagate for ~250ms after the first press and close a dialog
            // behind the view.
            const { view, host } = mountSizedView(800, 'collapsed');
            await settle();
            expect(view.showSidebar).toBe(true);

            const escape = () => {
                const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
                view.dispatchEvent(event);
                return event.defaultPrevented;
            };
            expect(escape()).toBe(true);
            expect(view.showSidebar).toBe(false);
            // The reveal is still animating out, so the progress is above zero.
            expect(escape()).toBe(true);
            host.remove();
        });

        await it('slides off the edge the sidebar is ON, in both positions', async () => {
            // `marginRight: -offsetWidth` regardless of `sidebarPosition` is what
            // this used to do, so an `end` sidebar slid the wrong way.
            const start = mountSizedView(800, 'show-sidebar="false"');
            await settle();
            const startBar = start.view.querySelector('.adw-osv-sidebar') as HTMLElement;
            expect(startBar.style.marginLeft.startsWith('-')).toBe(true);
            expect(startBar.style.marginRight).toBe('');
            start.host.remove();

            const end = mountSizedView(800, 'sidebar-position="end" show-sidebar="false"');
            await settle();
            const endBar = end.view.querySelector('.adw-osv-sidebar') as HTMLElement;
            expect(endBar.style.marginRight.startsWith('-')).toBe(true);
            expect(endBar.style.marginLeft).toBe('');
            end.host.remove();
        });

        await it('mirrors under RTL — a start sidebar is drawn on the RIGHT', async () => {
            const { view, host } = mountSizedView(800, 'show-sidebar="false"');
            host.style.direction = 'rtl';
            await settle();
            // Re-run the geometry now the direction is readable.
            view.setAttribute('sidebar-position', 'start');
            await settle();
            expect(view.classList.contains('sidebar-at-visual-start')).toBe(false);
            const sidebar = view.querySelector('.adw-osv-sidebar') as HTMLElement;
            expect(sidebar.style.marginRight.startsWith('-')).toBe(true);
            host.remove();
        });

        await it('does not write a CSS PERCENTAGE width — (int) truncates, a percentage is fractional', async () => {
            const { view, host } = mountSizedView(800);
            await settle();
            const sidebar = view.querySelector('.adw-osv-sidebar') as HTMLElement;
            expect(sidebar.style.width.endsWith('%')).toBe(false);
            expect(sidebar.style.width.endsWith('px')).toBe(true);
            // 800 * 0.25 = 200, inside [180, 280], so it is the fraction exactly.
            expect(sidebar.style.width).toBe('200px');
            host.remove();
        });

        await it('keeps the content pane from being squeezed to nothing', async () => {
            // `measure_uncollapsed` (:558-563) as CSS spells it: the pane claims
            // its own min-content, where `min-width: 0` let the sidebar take
            // everything.
            const { view, host } = mountSizedView(800);
            await settle();
            const content = view.querySelector('.adw-osv-content') as HTMLElement;
            expect(getComputedStyle(content).minWidth).not.toBe('0px');
            host.remove();
        });

        await it('names the cancel rows the core owns, so this suite is not read as covering them', () => {
            // `swipeCancelProgress`'s half-away-from-zero rounding is arithmetic
            // with no DOM surface — a pointercancel can only show the rounded
            // OUTCOME, not the rule. The core suite drives every row.
            expect(OVERLAY_SWIPE_CANCEL_VECTORS.length).toBeGreaterThan(0);
            expect(OVERLAY_SWIPE_START_VECTORS.length).toBeGreaterThan(0);
        });
    });

    await describe('<adw-navigation-split-view> stack, tags and navigation.* actions', async () => {
        /** Mount a navigation split view with the given panes and attributes. */
        function mountNav(attrs = '', panes = { sidebar: true, content: true, sidebarTag: '', contentTag: '' }) {
            const host = document.createElement('div');
            host.style.width = '800px';
            host.style.height = '400px';
            document.body.appendChild(host);
            const sidebar = panes.sidebar
                ? `<div slot="sidebar"${panes.sidebarTag ? ` tag="${panes.sidebarTag}"` : ''}>s</div>`
                : '';
            const content = panes.content
                ? `<div slot="content"${panes.contentTag ? ` tag="${panes.contentTag}"` : ''}>c</div>`
                : '';
            host.innerHTML = `<adw-navigation-split-view ${attrs}>${sidebar}${content}</adw-navigation-split-view>`;
            return {
                view: host.querySelector('adw-navigation-split-view') as AdwNavigationSplitView,
                host,
            };
        }

        /** Which pane the element says is on top, read off the DOM. */
        const visiblePane = (view: AdwNavigationSplitView) => {
            const sidebar = view.querySelector('.adw-nsv-sidebar') as HTMLElement;
            const content = view.querySelector('.adw-nsv-content') as HTMLElement;
            return {
                sidebar: sidebar?.dataset.paneVisible === 'true',
                content: content?.dataset.paneVisible === 'true',
            };
        };

        for (const vector of NAVIGATION_STACK_VECTORS) {
            // Only the STATIC rows: the animated branch reaches the same stack by
            // a push or a pop, and a DOM renderer that has no transition cannot
            // tell them apart. The core suite drives the direction.
            if (vector.changingPage) continue;
            const label =
                `${vector.hasSidebar ? 'sidebar' : '-'}/${vector.hasContent ? 'content' : '-'} ` +
                `${vector.sidebarPosition} show-content=${vector.showContent}`;
            await it(`${label} → [${vector.plan.stack.join(', ')}] — ${vector.rule}`, async () => {
                const attrs =
                    'collapsed ' +
                    (vector.showContent ? 'show-content ' : '') +
                    (vector.sidebarPosition === 'end' ? 'sidebar-position="end"' : '');
                const { view, host } = mountNav(attrs, {
                    sidebar: vector.hasSidebar,
                    content: vector.hasContent,
                    sidebarTag: '',
                    contentTag: '',
                });
                await settle();
                const top = vector.plan.stack[vector.plan.stack.length - 1] ?? null;
                const panes = visiblePane(view);
                // A LONE child stays visible whatever `show-content` says — the
                // rule two CSS classes could not express, and the reason a
                // collapsed sidebar-only view used to render blank.
                if (vector.hasSidebar) expect(panes.sidebar).toBe(top === 'sidebar');
                if (vector.hasContent) expect(panes.content).toBe(top === 'content');
                host.remove();
            });
        }

        for (const vector of NAVIGATION_ACTION_VECTORS) {
            const label =
                vector.action === 'push'
                    ? `push "${vector.tag}" (sidebar=${vector.sidebarTag ?? 'none'}, content=${vector.contentTag ?? 'none'})`
                    : `pop (sidebar=${vector.hasSidebar}, content=${vector.hasContent})`;
            // A row whose two panes carry the SAME tag describes a state the
            // duplicate-tag guard makes unreachable through a real widget: the
            // second assignment is refused (:1195-1201), so the element can never
            // hold both. Asserted below instead of driven here.
            const collides =
                vector.action === 'push' && vector.sidebarTag != null && vector.sidebarTag === vector.contentTag;
            if (collides) continue;

            await it(`${label} → ${vector.result.kind} — ${vector.rule}`, async () => {
                const attrs = (vector.collapsed ? 'collapsed ' : '') + (vector.showContent ? 'show-content' : '');
                const { view, host } = mountNav(attrs, {
                    sidebar: vector.action === 'pop' ? (vector.hasSidebar ?? false) : true,
                    content: vector.action === 'pop' ? (vector.hasContent ?? false) : true,
                    sidebarTag: vector.sidebarTag ?? '',
                    contentTag: vector.contentTag ?? '',
                });
                // `delegate` is the ROUTING's answer; whether it survives depends
                // on the ancestor. An ancestor that claims the tag is the case the
                // table describes — the unclaimed one becomes a critical, which
                // is the state's own step and has its own test below.
                host.addEventListener('navigation-push', (event) => {
                    (event as CustomEvent<{ handled: boolean }>).detail.handled = true;
                });
                host.addEventListener('navigation-pop', (event) => {
                    (event as CustomEvent<{ handled: boolean }>).detail.handled = true;
                });
                await settle();
                const result = vector.action === 'push' ? view.push(vector.tag as string) : view.pop();
                expect(result.kind).toBe(vector.result.kind);
                if (result.kind === 'set-show-content' && vector.result.kind === 'set-show-content') {
                    expect(view.showContent).toBe(vector.result.showContent);
                    // The DOM has to agree, or a consumer reading the attribute
                    // back after a push sees the pre-push answer.
                    expect(view.hasAttribute('show-content')).toBe(vector.result.showContent);
                }
                host.remove();
            });
        }

        await it('leaves out only the rows the tag guard makes unreachable', () => {
            const collidingRows = NAVIGATION_ACTION_VECTORS.filter(
                (v) => v.action === 'push' && v.sidebarTag != null && v.sidebarTag === v.contentTag,
            );
            // Exactly the shared-tag pushes. Their `rule` even says so — the C's
            // routing tests the content tag first, which only matters in a
            // collision the setters refuse to create.
            expect(collidingRows.length).toBeGreaterThan(0);
            for (const row of collidingRows) expect(row.contentTag).toBe(row.sidebarTag);
        });

        await it('an UNCLAIMED push becomes a critical, not a silent no-op', async () => {
            // `navigation_push_cb` :683 — the parent gets first refusal, and only
            // then is it an error. A pop walks off the end silently instead.
            const { view, host } = mountNav('collapsed', {
                sidebar: true,
                content: true,
                sidebarTag: 'list',
                contentTag: 'detail',
            });
            await settle();
            const pushed = view.push('nowhere');
            expect(pushed.kind).toBe('not-found');
            expect(view.showContent).toBe(false);
            host.remove();
        });

        await it('delegates an unmatched push to an ancestor, which is how nesting forwards it', async () => {
            const { view, host } = mountNav('collapsed', {
                sidebar: true,
                content: true,
                sidebarTag: 'list',
                contentTag: 'detail',
            });
            await settle();
            const seen: string[] = [];
            host.addEventListener('navigation-push', (event) => {
                const detail = (event as CustomEvent<{ tag?: string; handled: boolean }>).detail;
                seen.push(detail.tag ?? '');
                // An ancestor that OWNS the tag says so, and the critical is
                // never reached — `return TRUE` in the C's routing.
                detail.handled = true;
            });
            const result = view.push('somewhere-else');
            expect(seen).toStrictEqual(['somewhere-else']);
            expect(result.kind).toBe('delegate');
            host.remove();
        });

        await it('REFUSES a pane whose tag the other one already carries', async () => {
            // `adw_navigation_split_view_set_content` :1195-1201 — the pane keeps
            // what it had; the assignment does not happen. Neither port had a
            // duplicate-tag guard at all.
            const { view, host } = mountNav('', {
                sidebar: true,
                content: true,
                sidebarTag: 'same',
                contentTag: 'same',
            });
            await settle();
            expect(view.sidebarTag).toBe('same');
            // The content was refused, so it carries no tag of record.
            expect(view.contentTag).toBe(null);
            host.remove();
        });

        await it('puts the divider on the side the sidebar is DRAWN on', async () => {
            const start = mountNav();
            await settle();
            expect(start.view.classList.contains('sidebar-at-visual-start')).toBe(true);
            start.host.remove();

            const end = mountNav('sidebar-position="end"');
            await settle();
            expect(end.view.classList.contains('sidebar-at-visual-start')).toBe(false);
            end.host.remove();
        });
    });
};

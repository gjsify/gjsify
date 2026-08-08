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

import { SIDEBAR_BOUNDS_VECTORS } from '@gjsify/adwaita-core/conformance';
import { OVERLAY_COLLAPSE_VECTORS } from '@gjsify/adwaita-core/conformance';

import type { AdwNavigationSplitView } from './elements/adw-navigation-split-view.js';
import type { AdwOverlaySplitView } from './elements/adw-overlay-split-view.js';

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
};

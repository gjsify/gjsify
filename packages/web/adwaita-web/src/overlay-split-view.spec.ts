// <adw-overlay-split-view> against the shared collapse vectors.
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

import { OVERLAY_COLLAPSE_VECTORS } from '@gjsify/adwaita-core/conformance';

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

export const AdwOverlaySplitViewTest = async () => {
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

                view.collapsed = setCollapsed;
                expect(view.showSidebar).toBe(after.showSidebar);
                expect(view.collapsed).toBe(after.collapsed);
                host.remove();
            });
        }
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
};

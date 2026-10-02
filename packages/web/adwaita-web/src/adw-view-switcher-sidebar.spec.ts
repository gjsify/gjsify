// DOM-level tests for <adw-view-switcher-sidebar>: the sidebar-shaped switcher that
// drives an <adw-view-stack>. What is C here is the GROUPING (`populate_sidebar`), the
// index for activation (`activated_cb`), the indicator's three states (`update_badge`)
// and the direction of the selection (`selection_changed_cb`) — so those are what the
// rows below pin, on top of the shared section vectors.
import { describe, expect, it } from '@gjsify/unit';

import { VIEW_SWITCHER_SIDEBAR_SECTION_VECTORS } from '@gjsify/adwaita-core/conformance';
import { createViewSwitcherPage, viewSwitcherSidebarSections } from '@gjsify/adwaita-core';

import type { AdwViewSwitcherSidebar } from './elements/adw-view-switcher-sidebar.js';
import type { AdwViewStack } from './elements/adw-view-stack.js';

interface PageSpec {
    name: string;
    title?: string;
    icon?: string;
    startsSection?: string;
    badge?: string;
    attention?: boolean;
    hidden?: boolean;
}

function mount(
    pages: PageSpec[],
    attrs = '',
): {
    sidebar: AdwViewSwitcherSidebar;
    stack: AdwViewStack;
    host: HTMLElement;
} {
    const host = document.createElement('div');
    const inner = pages
        .map(
            (page) =>
                `<adw-view-stack-page name="${page.name}"${page.title ? ` title="${page.title}"` : ''}` +
                `${page.icon ? ` icon-name="${page.icon}"` : ''}${page.startsSection ? ` starts-section` : ''}` +
                `${page.startsSection && page.startsSection !== 'true' ? ` section-title="${page.startsSection}"` : ''}` +
                `${page.badge ? ` badge-number="${page.badge}"` : ''}${page.attention ? ' needs-attention' : ''}` +
                `${page.hidden ? ' hidden' : ''}></adw-view-stack-page>`,
        )
        .join('');
    host.innerHTML =
        `<adw-navigation-split-view>` +
        `<adw-view-switcher-sidebar ${attrs}></adw-view-switcher-sidebar>` +
        `<adw-view-stack>${inner}</adw-view-stack>` +
        `</adw-navigation-split-view>`;
    document.body.appendChild(host);
    return {
        sidebar: host.querySelector('adw-view-switcher-sidebar') as AdwViewSwitcherSidebar,
        stack: host.querySelector('adw-view-stack') as AdwViewStack,
        host,
    };
}

const rows = (sidebar: AdwViewSwitcherSidebar): HTMLElement[] =>
    Array.from(sidebar.querySelectorAll('adw-sidebar > .adw-sidebar-list .adw-sidebar-item'));
const headings = (sidebar: AdwViewSwitcherSidebar): string[] =>
    Array.from(sidebar.querySelectorAll('adw-sidebar .adw-sidebar-section-heading')).map((el) => el.textContent ?? '');
const indicator = (sidebar: AdwViewSwitcherSidebar, row: number): HTMLElement =>
    rows(sidebar)[row].querySelector('.indicator') as HTMLElement;

export const AdwViewSwitcherSidebarTest = async () => {
    await describe('viewSwitcherSidebarSections (populate_sidebar)', async () => {
        await it('drives the same grouping the conformance table pins', async () => {
            for (const vector of VIEW_SWITCHER_SIDEBAR_SECTION_VECTORS) {
                const names = vector.pages === '' ? [] : vector.pages.split(',');
                const starts = vector.starts === '' ? [] : vector.starts.split(',');
                const pages = names.map((name) =>
                    createViewSwitcherPage({
                        name,
                        startsSection: starts.includes(name),
                        sectionTitle: vector.sections.split(',')[starts.indexOf(name)] ?? null,
                    }),
                );
                const sections = viewSwitcherSidebarSections(pages);
                expect(sections.map((section) => section.pages.map((page) => page.name).join(','))).toStrictEqual(
                    vector.groups === '' ? [] : vector.groups.split('/'),
                );
            }
        });
    });

    await describe('<adw-view-switcher-sidebar> sections', async () => {
        await it('gives every stack page a row, in stack order', async () => {
            const { sidebar, host } = mount([
                { name: 'inbox', title: 'Inbox', icon: 'mail-unread' },
                { name: 'drafts', title: 'Drafts' },
            ]);
            expect(rows(sidebar)).toHaveLength(2);
            expect(rows(sidebar)[0].querySelector('.adw-sidebar-item-title')?.textContent).toBe('Inbox');
            expect(rows(sidebar)[1].querySelector('.adw-sidebar-item-title')?.textContent).toBe('Drafts');
            expect((rows(sidebar)[0].querySelector('.adw-sidebar-item-icon') as HTMLElement).hidden).toBe(false);
            host.remove();
        });

        await it('splits the pages at starts-section, headed by section-title', async () => {
            const { sidebar, host } = mount([
                { name: 'inbox', title: 'Inbox' },
                { name: 'drafts', title: 'Drafts' },
                { name: 'archive', title: 'Archive', startsSection: 'Archive' },
            ]);
            expect(rows(sidebar)).toHaveLength(3);
            expect(headings(sidebar)).toStrictEqual(['Archive']);
            // The separator header C's empty-title rule draws, not a second heading.
            expect(sidebar.querySelectorAll('adw-sidebar .adw-sidebar-section-header.separator')).toHaveLength(1);
            host.remove();
        });

        await it('keeps a hidden page as a row, because C binds visible rather than dropping it', async () => {
            const { sidebar, host } = mount([
                { name: 'inbox', title: 'Inbox' },
                { name: 'drafts', title: 'Drafts', hidden: true },
            ]);
            expect(rows(sidebar)).toHaveLength(2);
            expect(rows(sidebar)[1].hidden).toBe(true);
            host.remove();
        });
    });

    await describe('<adw-view-switcher-sidebar> selection and activation', async () => {
        await it('marks the row of the stack’s visible page, and follows a later change', async () => {
            const { sidebar, stack, host } = mount([
                { name: 'inbox', title: 'Inbox' },
                { name: 'drafts', title: 'Drafts' },
            ]);
            expect(rows(sidebar)[0].classList.contains('selected')).toBe(true);
            stack.visibleChildName = 'drafts';
            expect(rows(sidebar)[1].classList.contains('selected')).toBe(true);
            expect(rows(sidebar)[0].classList.contains('selected')).toBe(false);
            host.remove();
        });

        await it('activates the page at the same index, and only then emits activated', async () => {
            const { sidebar, stack, host } = mount([
                { name: 'inbox', title: 'Inbox' },
                { name: 'drafts', title: 'Drafts' },
                { name: 'sent', title: 'Sent' },
            ]);
            const seen: { index: number; visible: string }[] = [];
            sidebar.addEventListener('activated', (event) => {
                seen.push({
                    index: (event as CustomEvent).detail.index,
                    // The stack has ALREADY moved — that is the C order (:104-112).
                    visible: stack.visibleChildName,
                });
            });
            rows(sidebar)[2].click();
            expect(stack.visibleChildName).toBe('sent');
            expect(seen).toStrictEqual([{ index: 2, visible: 'sent' }]);
            host.remove();
        });
    });

    await describe('<adw-view-switcher-sidebar> indicator (update_badge)', async () => {
        await it('draws no bin at all for a page with neither dot nor count', async () => {
            const { sidebar, host } = mount([{ name: 'inbox', title: 'Inbox' }]);
            expect(indicator(sidebar, 0).hidden).toBe(true);
            host.remove();
        });

        await it('draws a bare dot for needs-attention with no count', async () => {
            const { sidebar, host } = mount([{ name: 'inbox', title: 'Inbox', attention: true }]);
            const bin = indicator(sidebar, 0);
            expect(bin.hidden).toBe(false);
            expect(bin.classList.contains('dot')).toBe(true);
            expect(bin.classList.contains('needs-attention')).toBe(true);
            expect(bin.querySelector('.numeric')).toBeNull();
            host.remove();
        });

        await it('replaces the dot with the count, and caps it above 999', async () => {
            const { sidebar, host } = mount([
                { name: 'a', title: 'A', badge: '3' },
                { name: 'b', title: 'B', badge: '999' },
                { name: 'c', title: 'C', badge: '1000', attention: true },
            ]);
            expect(indicator(sidebar, 0).classList.contains('dot')).toBe(false);
            expect(indicator(sidebar, 0).querySelector('.numeric')?.textContent).toBe('3');
            // `> 999`, so 999 itself prints.
            expect(indicator(sidebar, 1).querySelector('.numeric')?.textContent).toBe('999');
            expect(indicator(sidebar, 2).querySelector('.numeric')?.textContent).toBe('999+');
            expect(indicator(sidebar, 2).classList.contains('needs-attention')).toBe(true);
            host.remove();
        });
    });

    await describe('<adw-view-switcher-sidebar> mode, filter and placeholder', async () => {
        await it('switches the sidebar between sidebar and page mode', async () => {
            const { sidebar, host } = mount([{ name: 'inbox', title: 'Inbox' }]);
            const inner = sidebar.querySelector('adw-sidebar') as HTMLElement;
            expect(inner.classList.contains('page')).toBe(false);
            sidebar.setAttribute('mode', 'page');
            expect(sidebar.mode).toBe('page');
            expect(inner.classList.contains('page')).toBe(true);
            host.remove();
        });

        await it('shows the placeholder when the filter takes every row, and hides it again', async () => {
            const { sidebar, host } = mount([
                { name: 'inbox', title: 'Inbox' },
                { name: 'drafts', title: 'Drafts' },
            ]);
            const placeholder = sidebar.querySelector('.view-switcher-sidebar-placeholder') as HTMLElement;
            expect(placeholder.hidden).toBe(true);

            const status = document.createElement('adw-status-page');
            status.setAttribute('icon', 'system-search');
            status.setAttribute('title', 'Nothing Found');
            sidebar.placeholder = status;
            sidebar.filter = (item) => (item.title ?? '') === 'Drafts';
            expect(placeholder.hidden).toBe(false);
            expect(placeholder.contains(status)).toBe(true);

            sidebar.filter = null;
            expect(placeholder.hidden).toBe(true);
            host.remove();
        });

        await it('accepts a stack by id, the way the property takes the element', async () => {
            const host = document.createElement('div');
            host.innerHTML =
                `<adw-view-stack id="pages"><adw-view-stack-page name="a" title="A"></adw-view-stack-page></adw-view-stack>` +
                `<adw-view-switcher-sidebar stack="pages"></adw-view-switcher-sidebar>`;
            document.body.appendChild(host);
            const sidebar = host.querySelector('adw-view-switcher-sidebar') as AdwViewSwitcherSidebar;
            expect(sidebar.stack).toBe(host.querySelector('adw-view-stack'));
            expect(rows(sidebar)).toHaveLength(1);
            host.remove();
        });

        await it('keeps prefix and suffix out of the item list', async () => {
            const host = document.createElement('div');
            host.innerHTML = `<adw-view-switcher-sidebar><span slot="prefix">Top</span><span slot="suffix">Bottom</span></adw-view-switcher-sidebar>`;
            document.body.appendChild(host);
            const sidebar = host.querySelector('adw-view-switcher-sidebar') as AdwViewSwitcherSidebar;
            expect(sidebar.prefixWidget?.textContent).toBe('Top');
            expect(sidebar.suffixWidget?.textContent).toBe('Bottom');
            expect(rows(sidebar)).toHaveLength(0);
            host.remove();
        });
    });
};

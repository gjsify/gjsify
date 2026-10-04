// DOM-level tests for <gtk-stack-sidebar>. The widget is three separable things: the
// ROW-VISIBILITY rule (which is NOT the switcher's — no icon fallback here), the
// two-way binding with the stack, and the list's own node contract.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkStack } from './elements/gtk-stack.js';
import type { GtkStackSidebar } from './elements/gtk-stack-sidebar.js';

interface Page {
    name: string;
    title?: string;
    icon?: string;
    hidden?: boolean;
    attention?: boolean;
}

/** A stack with its pages, a sidebar bound to it by id, both in the document. */
function mount(
    pages: Page[],
    attrs: Record<string, string> = {},
): { stack: GtkStack; sidebar: GtkStackSidebar; host: HTMLElement; stackId: string } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    // A UNIQUE id per mount: the switcher binds by id, so two stacks left in the document
    // under one id make `getElementById` answer with whichever came first. A counter in
    // this module is not enough, because the suite's cases are free to interleave.
    const stackId = `stack-under-test-${crypto.randomUUID()}`;
    const stack = document.createElement('gtk-stack') as GtkStack;
    stack.id = stackId;
    for (const page of pages) {
        const child = document.createElement('div');
        child.setAttribute('name', page.name);
        if (page.title !== undefined) child.setAttribute('title', page.title);
        if (page.icon !== undefined) child.setAttribute('icon-name', page.icon);
        if (page.hidden) child.setAttribute('hidden', '');
        if (page.attention) child.setAttribute('needs-attention', '');
        stack.appendChild(child);
    }
    const sidebar = document.createElement('gtk-stack-sidebar') as GtkStackSidebar;
    for (const [name, value] of Object.entries(attrs)) sidebar.setAttribute(name, value);
    sidebar.setAttribute('stack', stackId);
    host.append(stack, sidebar);
    return { stack, sidebar, host, stackId };
}

/** The rows, with hidden ones marked, as the visibility rule leaves them. */
function rows(el: GtkStackSidebar): string[] {
    return [...el.querySelectorAll<HTMLButtonElement>('.adw-stack-sidebar-row')].map((row) => {
        const parts = [row.querySelector('.adw-stack-sidebar-title')?.textContent ?? ''];
        if (row.hidden) parts.push('hidden');
        if (row.classList.contains('selected')) parts.push('selected');
        if (row.classList.contains('needs-attention')) parts.push('attention');
        return parts.filter(Boolean).join(' ');
    });
}

/** A turn of the event loop — a page's change reaches the sidebar through the stack's observer. */
function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

const THREE = [
    { name: 'a', title: 'Alpha' },
    { name: 'b', title: 'Beta' },
    { name: 'c', title: 'Gamma' },
];

export const GtkStackSidebarTest = async () => {
    await describe('<gtk-stack-sidebar> defaults', async () => {
        await it('builds one row per page, the first one selected', () => {
            const { sidebar, host } = mount(THREE);
            expect(rows(sidebar)).toStrictEqual(['Alpha selected', 'Beta', 'Gamma']);
            // C's own classes: `.sidebar` on the widget, `.navigation-sidebar` on the list
            // (gtkstacksidebar.c:155, :163).
            expect(sidebar.classList.contains('sidebar')).toBe(true);
            const list = sidebar.querySelector('.adw-stack-sidebar-list');
            expect(list?.classList.contains('navigation-sidebar')).toBe(true);
            expect(list?.getAttribute('role')).toBe('listbox');
            // The translated "Sidebar" of gtkstacksidebar.c:157-159.
            expect(list?.getAttribute('aria-label')).toBe('Sidebar');
            host.remove();
        });

        await it('a row is a link, selected state and all', () => {
            const { sidebar, host } = mount(THREE);
            const [first, second] = sidebar.querySelectorAll<HTMLButtonElement>('.adw-stack-sidebar-row');
            expect(first.getAttribute('role')).toBe('link');
            expect(first.getAttribute('aria-selected')).toBe('true');
            expect(second.getAttribute('aria-selected')).toBe('false');
            host.remove();
        });
    });

    await describe('<gtk-stack-sidebar> row visibility', async () => {
        await it('a page with a title shows a row', () => {
            const { sidebar, host } = mount([{ name: 'a', title: 'Alpha' }]);
            expect(rows(sidebar)).toStrictEqual(['Alpha selected']);
            host.remove();
        });

        await it('a page with an icon and NO title gets no row text and is hidden', () => {
            // gtkstacksidebar.c:186 — `visible && title != NULL`. `update_row` never
            // reads icon-name, so there is NO icon fallback here, which is the one rule
            // where this sidebar and the switcher disagree.
            const { sidebar, host } = mount([
                { name: 'a', icon: 'go-next-symbolic' },
                { name: 'b', title: 'Beta' },
            ]);
            // `a` is the first page, so it is the visible one — and its row has no text.
            expect(rows(sidebar)).toStrictEqual(['hidden selected', 'Beta']);
            host.remove();
        });

        await it('a hidden page is hidden whatever it carries', () => {
            const { sidebar, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta', hidden: true },
            ]);
            expect(rows(sidebar)).toStrictEqual(['Alpha selected', 'Beta hidden']);
            host.remove();
        });

        await it('needs-attention puts the class on the ROW', () => {
            // gtkstacksidebar.c:188-191 — the class goes on the row, not the label.
            const { sidebar, host } = mount([
                { name: 'a', title: 'Alpha', attention: true },
                { name: 'b', title: 'Beta' },
            ]);
            expect(rows(sidebar)).toStrictEqual(['Alpha selected attention', 'Beta']);
            host.remove();
        });
    });

    await describe('<gtk-stack-sidebar> the two-way binding', async () => {
        await it('clicking a row makes its page visible', () => {
            const { stack, sidebar, host } = mount(THREE);
            (sidebar.querySelectorAll('.adw-stack-sidebar-row')[2] as HTMLButtonElement).click();
            expect(stack.visibleChildName).toBe('c');
            expect(rows(sidebar)).toStrictEqual(['Alpha', 'Beta', 'Gamma selected']);
            host.remove();
        });

        await it('a page change re-marks the rows without rebuilding them', () => {
            // gtkstacksidebar.c:317-338 — selection_changed_cb never repopulates.
            const { stack, sidebar, host } = mount(THREE);
            const before = sidebar.querySelectorAll('.adw-stack-sidebar-row')[1];
            stack.setVisibleChildName('c');
            const after = sidebar.querySelectorAll('.adw-stack-sidebar-row')[1];
            expect(after).toBe(before);
            expect(rows(sidebar)).toStrictEqual(['Alpha', 'Beta', 'Gamma selected']);
            host.remove();
        });

        await it('clicking the CURRENT row leaves it selected', () => {
            // gtkstacksidebar.c:130-143 — only a SELECTION drives the model, so a click on
            // the current row is the same no-op the switcher's is.
            const { stack, sidebar, host } = mount(THREE);
            (sidebar.querySelectorAll('.adw-stack-sidebar-row')[0] as HTMLButtonElement).click();
            expect(stack.visibleChildName).toBe('a');
            expect(rows(sidebar)).toStrictEqual(['Alpha selected', 'Beta', 'Gamma']);
            host.remove();
        });

        await it('a page added later brings its own row', async () => {
            // items_changed_cb rebuilds the whole list (gtkstacksidebar.c:307-311).
            const { stack, sidebar, host } = mount(THREE);
            const added = document.createElement('div');
            added.setAttribute('name', 'd');
            added.setAttribute('title', 'Delta');
            stack.appendChild(added);
            await settle();
            expect(rows(sidebar)).toStrictEqual(['Alpha selected', 'Beta', 'Gamma', 'Delta']);
            host.remove();
        });

        await it('a page title change reaches the row', async () => {
            const { sidebar, host, stackId } = mount(THREE);
            const page = document.querySelector(`#${stackId} > div:nth-child(2)`);
            page?.setAttribute('title', 'Renamed');
            await settle();
            expect(rows(sidebar)).toStrictEqual(['Alpha selected', 'Renamed', 'Gamma']);
            host.remove();
        });
    });

    await describe('<gtk-stack-sidebar> binding and properties', async () => {
        await it('resolves the stack by id, and an unknown id leaves it unbound', () => {
            const { stack, sidebar, host } = mount(THREE);
            expect(sidebar.stack).toBe(stack);
            sidebar.setAttribute('stack', 'no-such-stack-anywhere');
            expect(sidebar.stack).toBe(null);
            expect(sidebar.querySelectorAll('.adw-stack-sidebar-row').length).toBe(0);
            host.remove();
        });

        await it('setStack notifies, and re-binding the SAME stack does not', () => {
            // gtkstacksidebar.c:422-433 — the early return before the notify.
            const { stack, sidebar, host } = mount(THREE);
            const events: unknown[] = [];
            sidebar.addEventListener('notify::stack', (e) => events.push((e as CustomEvent).detail));
            sidebar.setStack(stack);
            sidebar.setStack(null);
            expect(events).toStrictEqual([{ stack: null }]);
            host.remove();
        });

        await it('an unbound sidebar is empty, not broken', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const sidebar = document.createElement('gtk-stack-sidebar') as GtkStackSidebar;
            host.appendChild(sidebar);
            expect(sidebar.stack).toBe(null);
            expect(sidebar.querySelectorAll('.adw-stack-sidebar-row').length).toBe(0);
            host.remove();
        });
    });
};

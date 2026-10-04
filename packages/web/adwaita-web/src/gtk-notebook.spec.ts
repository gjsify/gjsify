// DOM-level tests for <gtk-notebook>. The widget is four separable things and each gets
// its own describe: WHICH PAGE is current (the guards in `set_current_page` and
// `real_switch_page`), the PAGE DESCRIPTOR (a GtkNotebookPage is a GObject, so its
// properties are attributes on the child), THE TAB STRIP (which the notebook builds
// itself, and what `tab-pos` does to it) and the NOTIFICATION contract.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkNotebook } from './elements/gtk-notebook.js';
import { buildSharedTree } from './shared-tree-builder.js';

interface Page {
    label?: string;
    menu?: string;
    fill?: boolean;
    expand?: boolean;
    reorderable?: boolean;
    detachable?: boolean;
    hidden?: boolean;
    body?: string;
}

/** A notebook with its pages, `<gtk-notebook>` already upgraded and rendered. */
function mount(pages: Page[] = [], attrs: Record<string, string> = {}): { el: GtkNotebook; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-notebook') as GtkNotebook;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    for (const page of pages) {
        const child = document.createElement('div');
        if (page.label !== undefined) child.setAttribute('tab-label', page.label);
        if (page.menu !== undefined) child.setAttribute('menu-label', page.menu);
        if (page.fill === false) child.setAttribute('tab-fill', 'false');
        if (page.expand) child.setAttribute('tab-expand', '');
        if (page.reorderable) child.setAttribute('reorderable', '');
        if (page.detachable) child.setAttribute('detachable', '');
        if (page.hidden) child.setAttribute('hidden', '');
        child.textContent = page.body ?? page.label ?? 'page';
        el.appendChild(child);
    }
    host.appendChild(el);
    return { el, host };
}

/** The tab buttons the render pass produced, as the strip holds them. */
function tabs(el: GtkNotebook): HTMLButtonElement[] {
    return Array.from(el.querySelectorAll('.adw-notebook-tab')) as HTMLButtonElement[];
}

/** The children in DOM order, with `visible-page` marked, as the render pass sees them. */
function marks(el: GtkNotebook): string[] {
    return (Array.from(el.children) as HTMLElement[])
        .filter((child) => child !== el.querySelector('.adw-notebook-header'))
        .map(
            (child) =>
                `${child.getAttribute('tab-label') ?? '?'}${child.classList.contains('visible-page') ? ':visible' : ''}`,
        );
}

export const GtkNotebookTest = async () => {
    await describe('<gtk-notebook> defaults', async () => {
        await it('shows the first page and marks only that one visible', () => {
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            expect(el.nPages).toBe(2);
            expect(el.page).toBe(0);
            expect(marks(el)).toStrictEqual(['One:visible', 'Two']);
            host.remove();
        });

        await it('labels a page with no tab-label "Page N", counting from one', () => {
            // gtk_notebook_update_labels (gtknotebook.c:4353-4373): `g_snprintf (string,
            // …, _("Page %u"), page_num++)` and `text = page->tab_text ?: string`, so the
            // number is the FALLBACK rather than a reason to have no tab.
            const { el, host } = mount([{ label: 'One' }, {}, {}]);
            expect(tabs(el).map((tab) => tab.textContent)).toStrictEqual(['One', 'Page 2', 'Page 3']);
            host.remove();
        });

        await it('counts the numbering over the VISIBLE pages only', () => {
            // `gtk_notebook_search_page (…, STEP_NEXT, FALSE)` walks the visible pages, so
            // a hidden one takes no number and does not shift the ones after it
            // (gtknotebook.c:4361-4364).
            const { el, host } = mount([{ label: 'One' }, { label: 'Two', hidden: true }, {}]);
            expect(tabs(el).map((tab) => tab.textContent)).toStrictEqual(['One', 'Two', 'Page 2']);
            expect(tabs(el)[1].hidden).toBe(true);
            host.remove();
        });

        await it('a hidden page does not make the observer spin', async () => {
            // The regression that HANGS the whole browser suite rather than failing one
            // test: `setAttribute` queues a mutation record even when the value is
            // unchanged, and the render pass writes `hidden` on the tabs, so an observer
            // that watched the whole subtree fed its own writes straight back in. The
            // await is the assertion — a spin starves the macrotask queue and the run
            // never finishes, which is how the bug presented.
            const { el, host } = mount([{ label: 'One', hidden: true }, { label: 'Two' }]);
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(tabs(el).map((tab) => tab.hidden)).toStrictEqual([true, false]);
            expect(el.page).toBe(1);
            host.remove();
        });

        await it('gives the current tab the checked state and aria-selected', () => {
            // `gtk_widget_set_state_flags (page->tab_widget, GTK_STATE_FLAG_CHECKED)` and
            // the accessible SELECTED that follows it (gtknotebook.c:5466, :5472-5474).
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            expect(tabs(el).map((tab) => tab.classList.contains('active'))).toStrictEqual([true, false]);
            expect(tabs(el).map((tab) => tab.getAttribute('aria-selected'))).toStrictEqual(['true', 'false']);
            host.remove();
        });

        await it('reports the tab position as top, and reflects it', () => {
            const { el, host } = mount([{ label: 'One' }]);
            expect(el.tabPos).toBe('top');
            expect(el.getAttribute('data-tab-pos')).toBe('top');
            host.remove();
        });

        await it('swaps left and right under RTL, which is what data-tab-pos is for', () => {
            // get_effective_tab_pos (gtknotebook.c:1741-1757) swaps only the two horizontal
            // edges; `top` and `bottom` are unaffected.
            const rtl = mount([{ label: 'One' }], { 'tab-pos': 'left' });
            rtl.el.setAttribute('dir', 'rtl');
            rtl.el.refresh();
            expect(rtl.el.getAttribute('data-tab-pos')).toBe('right');
            rtl.host.remove();

            const ltr = mount([{ label: 'One' }], { 'tab-pos': 'bottom' });
            ltr.el.setAttribute('dir', 'rtl');
            ltr.el.refresh();
            expect(ltr.el.getAttribute('data-tab-pos')).toBe('bottom');
            ltr.host.remove();
        });
    });

    await describe('<gtk-notebook> switching', async () => {
        await it('a negative page means the LAST page, not "none"', () => {
            // `if (page_num < 0) page_num = g_list_length (notebook->children) - 1`
            // (gtknotebook.c:6054).
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }, { label: 'Three' }]);
            expect(el.setCurrentPage(-1)).toBe(true);
            expect(el.page).toBe(2);
            host.remove();
        });

        await it('an out-of-range page does nothing at all', () => {
            // `list = g_list_nth (…); if (list) gtk_notebook_switch_page (…)`
            // (gtknotebook.c:6056-6058) — the guard, not a clamp and not a throw.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            expect(el.setCurrentPage(7)).toBe(false);
            expect(el.page).toBe(0);
            host.remove();
        });

        await it('refuses a page whose child is hidden', () => {
            // `notebook->cur_page == page || !gtk_widget_get_visible (GTK_WIDGET (child))`
            // is ONE condition (gtknotebook.c:5444), so a hidden page is not switchable
            // however it is asked for.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two', hidden: true }]);
            expect(el.setCurrentPage(1)).toBe(false);
            expect(el.page).toBe(0);
            host.remove();
        });

        await it('switching to the current page is not a change', () => {
            // The other half of :5444 — the guard returns before anything is notified.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            let switches = 0;
            el.addEventListener('switch-page', () => (switches += 1));
            expect(el.setCurrentPage(0)).toBe(false);
            expect(switches).toBe(0);
            host.remove();
        });

        await it('next and prev step OVER a hidden page', () => {
            // `gtk_notebook_search_page (…, STEP_NEXT, TRUE)` — the TRUE is `find_visible`
            // (gtknotebook.c:6078), which is why a hidden page does not end the walk.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two', hidden: true }, { label: 'Three' }]);
            expect(el.nextPage()).toBe(true);
            expect(el.page).toBe(2);
            expect(el.prevPage()).toBe(true);
            expect(el.page).toBe(0);
            host.remove();
        });

        await it('off either end next and prev do nothing', () => {
            // `if (!list) return` after the search (gtknotebook.c:6079-6080).
            const { el, host } = mount([{ label: 'One' }]);
            expect(el.prevPage()).toBe(false);
            expect(el.nextPage()).toBe(false);
            expect(el.page).toBe(0);
            host.remove();
        });

        await it('a click on a tab switches to that page', () => {
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            tabs(el)[1].click();
            expect(el.page).toBe(1);
            expect(el.currentPage?.getAttribute('tab-label')).toBe('Two');
            host.remove();
        });

        await it('reads page LIVE, and leaves the attribute as the input it was', () => {
            // `get_property` returns `gtk_notebook_get_current_page (notebook)`
            // (gtknotebook.c:1977-1979) rather than the value last written, so a switch
            // that reached the notebook by clicking a tab is visible through the property
            // even though nothing wrote the attribute.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            el.setAttribute('page', '1');
            expect(el.page).toBe(1);
            tabs(el)[0].click();
            expect(el.page).toBe(0);
            expect(el.getAttribute('page')).toBe('1');
            host.remove();
        });

        await it('switch-page is emitted BEFORE the switch, with the page switched TO', () => {
            // `gtk_notebook_switch_page` emits and the class handler `real_switch_page`
            // performs (gtknotebook.c:5518-5523), so a handler that vetoes by not drawing
            // is the documented use — the page still reads the OLD one at that moment.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            const seen: number[] = [];
            el.addEventListener('switch-page', (e) => seen.push((e as CustomEvent).detail.page, el.page));
            el.setCurrentPage(1);
            expect(seen).toStrictEqual([1, 0]);
            expect(el.page).toBe(1);
            host.remove();
        });

        await it('a handler that vetoes by not drawing leaves the page alone', async () => {
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            el.addEventListener('switch-page', (e) => e.preventDefault());
            el.setCurrentPage(1);
            expect(el.page).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-notebook> the page descriptor', async () => {
        await it('carries the five scalar page properties as attributes', () => {
            // A GtkNotebookPage is a GObject (gtknotebook.c:423), so its properties are the
            // attributes on the child and `getPage()` hands back the descriptor.
            const { el, host } = mount([{ label: 'One', menu: 'First', reorderable: true, detachable: true }]);
            const info = el.getPage(el.children[1] as HTMLElement);
            expect(info?.tabLabel).toBe('One');
            expect(info?.menuLabel).toBe('First');
            expect(info?.reorderable).toBe(true);
            expect(info?.detachable).toBe(true);
            host.remove();
        });

        await it('tab-fill defaults TRUE and tab-expand FALSE', () => {
            // `g_param_spec_boolean ("tab-expand", …, FALSE, …)` and `("tab-fill", …,
            // TRUE, …)` (gtknotebook.c:667-681), and `page->fill = TRUE` in the page's
            // `init` (gtknotebook.c:430).
            const { el, host } = mount([
                { label: 'One' },
                { label: 'Two', fill: false },
                { label: 'Three', expand: true },
            ]);
            expect(el.getPage(el.children[1] as HTMLElement)?.tabFill).toBe(true);
            expect(el.getPage(el.children[2] as HTMLElement)?.tabFill).toBe(false);
            expect(el.getPage(el.children[3] as HTMLElement)?.tabExpand).toBe(true);
            expect(tabs(el).map((tab) => tab.classList.contains('fill'))).toStrictEqual([true, false, true]);
            expect(tabs(el).map((tab) => tab.classList.contains('expand'))).toStrictEqual([false, false, true]);
            host.remove();
        });

        await it('maps the child index to a page number, both ways', () => {
            // `gtk_notebook_page_num` (gtknotebook.c:6006) and
            // `gtk_notebook_get_nth_page` (gtknotebook.c:5956), the latter counting from
            // the END for a negative index.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }, { label: 'Three' }]);
            const pages = Array.from(el.children).filter((child) => child !== el.querySelector('.adw-notebook-header'));
            expect(el.pageNum(pages[2] as HTMLElement)).toBe(2);
            expect(el.getNthPage(-1)).toBe(pages[2]);
            expect(el.getNthPage(9)).toBeNull();
            host.remove();
        });

        await it('appends a page, which becomes the current one only if there was none', () => {
            // `if (!gtk_notebook_has_current_page (notebook)) gtk_notebook_switch_page (…)`
            // (gtknotebook.c:4131-4134).
            const empty = mount([]);
            const added = document.createElement('div');
            added.setAttribute('tab-label', 'One');
            empty.el.appendPage(added);
            expect(empty.el.page).toBe(0);
            empty.host.remove();

            const { el, host } = mount([{ label: 'One' }]);
            const second = document.createElement('div');
            second.setAttribute('tab-label', 'Two');
            el.appendPage(second);
            expect(el.page).toBe(0);
            expect(el.nPages).toBe(2);
            host.remove();
        });

        await it('removing the current page hands over to the NEXT one, not the first', () => {
            // C takes `search_page (…, STEP_NEXT)` and falls back to `STEP_PREV` at the end
            // (gtknotebook.c:4281-4290) — so from the middle it is the page that follows.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }, { label: 'Three' }]);
            const pages = Array.from(el.children).filter((child) => child !== el.querySelector('.adw-notebook-header'));
            el.setCurrentPage(1);
            expect(el.removePage(pages[1] as HTMLElement)).toBe(true);
            expect(el.page).toBe(1);
            expect(el.getNthPage(1)?.getAttribute('tab-label')).toBe('Three');
            host.remove();
        });

        await it('removing the LAST current page falls back backwards', () => {
            // The `STEP_PREV` half of gtknotebook.c:4280-4282.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            const pages = Array.from(el.children).filter((child) => child !== el.querySelector('.adw-notebook-header'));
            el.setCurrentPage(1);
            el.removePage(pages[1] as HTMLElement);
            expect(el.page).toBe(0);
            expect(el.nPages).toBe(1);
            host.remove();
        });
    });

    await describe('<gtk-notebook> the tab strip', async () => {
        await it("builds the strip as header > tabs > tab, libadwaita's own tree", () => {
            // refs/libadwaita/src/stylesheet/widgets/_notebook.scss:4-10.
            const { el, host } = mount([{ label: 'One' }]);
            const header = el.querySelector('.adw-notebook-header') as HTMLElement;
            const strip = el.querySelector('.adw-notebook-tabs') as HTMLElement;
            expect(header.parentElement).toBe(el);
            expect(strip.parentElement).toBe(header);
            expect(tabs(el)[0].parentElement).toBe(strip);
            expect(strip.getAttribute('role')).toBe('tablist');
            expect(tabs(el)[0].getAttribute('role')).toBe('tab');
            host.remove();
        });

        await it('takes its tabs away with show-tabs, and puts them back', () => {
            // `gtk_widget_set_visible (header_widget, show_tabs)` (gtknotebook.c:5467).
            const { el, host } = mount([{ label: 'One' }]);
            const header = el.querySelector('.adw-notebook-header') as HTMLElement;
            expect(header.hidden).toBe(false);
            el.showTabs = false;
            expect(header.hidden).toBe(true);
            expect(el.nPages).toBe(1);
            el.showTabs = true;
            expect(header.hidden).toBe(false);
            host.remove();
        });

        await it('show-border is the .frame class, because in C it is a CSS class', () => {
            // `gtk_notebook_set_show_border` adds `.frame` and clearing the property removes
            // it (gtknotebook.c:6134-6146); it defaults TRUE (gtknotebook.c:1505). The
            // property is still an attribute — the CLASS is what the border hangs off, which
            // is the distinction a boolean attribute would have lost.
            const { el, host } = mount([{ label: 'One' }]);
            expect(el.showBorder).toBe(true);
            expect(el.classList.contains('frame')).toBe(true);
            el.showBorder = false;
            expect(el.classList.contains('frame')).toBe(false);
            expect(el.showBorder).toBe(false);
            expect(el.getAttribute('show-border')).toBe('false');
            host.remove();
        });

        await it('marks the page area, which is a GtkStack inside the C', () => {
            // `gtk_stack_set_visible_child (…, cur_page->child)` (gtknotebook.c:5476) — one
            // visible child, and libadwaita's `> stack:not(:only-child)` page background
            // (_notebook.scss:213-215) is what `.adw-notebook-page` is styled as.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            const area = Array.from(el.children).filter((child) => child !== el.querySelector('.adw-notebook-header'));
            expect(area.every((child) => child.classList.contains('adw-notebook-page'))).toBe(true);
            expect(area.map((child) => child.classList.contains('visible-page'))).toStrictEqual([true, false]);
            host.remove();
        });
    });

    await describe('<gtk-notebook> the popup menu', async () => {
        await it('opens a listbox of the pages on contextmenu, when enable-popup is set', async () => {
            // `gtk_notebook_popup_enable` builds a GtkPopoverMenu of the pages
            // (gtknotebook.c:6420-6462) and a right-click pops it up (gtknotebook.c:2684).
            const { el, host } = mount([{ label: 'One' }, { label: 'Two', menu: 'The second' }]);
            el.enablePopup = true;
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
            const menu = el.querySelector('.adw-notebook-menu') as HTMLElement;
            const items = Array.from(menu.querySelectorAll('.adw-notebook-menu-item')) as HTMLElement[];
            expect(menu.getAttribute('role')).toBe('listbox');
            expect(items.map((item) => item.textContent)).toStrictEqual(['One', 'The second']);
            expect(items[0].getAttribute('aria-selected')).toBe('true');
            host.remove();
        });

        await it("falls back to the tab label, and hides a hidden page's item", async () => {
            // `gtk_notebook_menu_item_create` builds the label from `menu_label`, falls
            // back to the tab label when it is a GtkLabel, and hides the item for a page
            // whose child is hidden (gtknotebook.c:5624-5649).
            const { el, host } = mount([{ label: 'One' }, { label: 'Two', hidden: true }, {}]);
            el.enablePopup = true;
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
            const items = Array.from(el.querySelectorAll('.adw-notebook-menu-item')) as HTMLElement[];
            expect(items.map((item) => item.textContent)).toStrictEqual(['One', 'Two', 'Page 2']);
            expect(items[1].hidden).toBe(true);
            host.remove();
        });

        await it('does nothing at all while enable-popup is off', () => {
            const { el, host } = mount([{ label: 'One' }]);
            expect(el.enablePopup).toBe(false);
            const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            el.dispatchEvent(event);
            expect(el.querySelector('.adw-notebook-menu')).toBeNull();
            expect(event.defaultPrevented).toBe(false);
            host.remove();
        });

        await it('closes on disconnect, which is where the menu goes', () => {
            const { el, host } = mount([{ label: 'One' }]);
            el.enablePopup = true;
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            expect(el.querySelector('.adw-notebook-menu')).not.toBeNull();
            host.remove();
            expect(el.querySelector('.adw-notebook-menu')).toBeNull();
        });
    });

    await describe('<gtk-notebook> re-parent', async () => {
        await it('keeps ONE header across a move, and never grows a second one', async () => {
            // The header is built once and stays a child of the notebook even while the
            // notebook itself is detached, because a GTK widget keeps its children across
            // a re-parent. Rebuilding it on the way back in would leave the old one behind,
            // and `_pages()` — which filters the header out BY IDENTITY — would read that
            // leftover as a page.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            const elsewhere = document.createElement('div');
            document.body.appendChild(elsewhere);
            elsewhere.appendChild(el);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(el.querySelectorAll('.adw-notebook-header')).toHaveLength(1);
            expect(el.nPages).toBe(2);
            expect(marks(el)).toStrictEqual(['One:visible', 'Two']);
            host.remove();
            elsewhere.remove();
        });

        await it('keeps the current page across a move', async () => {
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            tabs(el)[1].click();
            const elsewhere = document.createElement('div');
            document.body.appendChild(elsewhere);
            elsewhere.appendChild(el);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(el.page).toBe(1);
            host.remove();
            elsewhere.remove();
        });
    });

    await describe('<gtk-notebook> notification', async () => {
        await it('notifies page once per real switch', () => {
            // `g_object_notify_by_pspec (G_OBJECT (notebook), properties[PROP_PAGE])`
            // (gtknotebook.c:5497) is at the END of `real_switch_page`, so it fires once and
            // only after the switch took.
            const { el, host } = mount([{ label: 'One' }, { label: 'Two' }]);
            let notifies = 0;
            el.addEventListener('notify::page', () => (notifies += 1));
            el.setCurrentPage(1);
            expect(notifies).toBe(1);
            el.setCurrentPage(0);
            expect(notifies).toBe(2);
            host.remove();
        });

        await it('reports the parsed property, not the raw attribute', () => {
            const { el, host } = mount([{ label: 'One' }]);
            const details: unknown[] = [];
            el.addEventListener('notify::tab-pos', (e) => details.push((e as CustomEvent).detail));
            el.tabPos = 'bottom';
            expect(details).toStrictEqual([{ 'tab-pos': 'bottom' }]);
            host.remove();
        });

        await it('reports an inserted page as page-added and a removed one as page-removed', () => {
            // The two page-list signals the C raises around an insert and a remove
            // (gtknotebook.c:1380-1391 emitted at :4129, :1358-1369 emitted at :3551).
            const { el, host } = mount([{ label: 'One' }]);
            const events: string[] = [];
            el.addEventListener('page-added', () => events.push('added'));
            el.addEventListener('page-removed', () => events.push('removed'));
            const second = document.createElement('div');
            second.setAttribute('tab-label', 'Two');
            el.appendPage(second);
            el.removePage(second);
            expect(events).toStrictEqual(['added', 'removed']);
            host.remove();
        });

        await it('carries the position and the new page count with each of them', () => {
            const { el, host } = mount([{ label: 'One' }]);
            const details: unknown[] = [];
            el.addEventListener('page-added', (e) => details.push((e as CustomEvent).detail));
            const second = document.createElement('div');
            el.appendPage(second, 'Two');
            expect(details).toStrictEqual([{ position: 1, nPages: 2 }]);
            host.remove();
        });
    });

    await describe('a shared-tree page', async () => {
        await it('is written as the tab-label the notebook reads, and a stack reads name and title', () => {
            const notebook = buildSharedTree({
                tag: 'GtkNotebook',
                children: [{ tag: 'GtkLabel', page: { label: 'One' }, props: { label: 'first' } }],
            });
            expect(notebook.children[0].getAttribute('tab-label')).toBe('One');
            const stack = buildSharedTree({
                tag: 'GtkStack',
                children: [{ tag: 'GtkLabel', page: { name: 'a', label: 'A' } }],
            });
            expect(stack.children[0].getAttribute('name')).toBe('a');
            expect(stack.children[0].getAttribute('title')).toBe('A');
        });

        await it('is refused BY NAME on a parent with no pages', () => {
            expect(() =>
                buildSharedTree({ tag: 'GtkBox', children: [{ tag: 'GtkLabel', page: { label: 'X' } }] }),
            ).toThrow('has no pages');
        });
    });
};

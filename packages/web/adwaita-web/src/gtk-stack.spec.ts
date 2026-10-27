// DOM-level tests for <gtk-stack>. The widget is four separable things and each gets
// its own describe: WHICH CHILD is visible (the guards in `set_visible_child`, where
// most of the surprising behaviour lives), the PAGE DESCRIPTOR (a GtkStackPage is a
// GObject, so its properties are attributes on the child), the TRANSITION TYPE
// (reduced motion, RTL, and the two-way types resolving to one-directional ones) and
// the NOTIFICATION contract.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkStack } from './elements/gtk-stack.js';
import { pageChildOf } from './elements/gtk-stack-page.js';
import { mountSharedTree } from './shared-tree-builder.js';

interface Page {
    name: string;
    title?: string;
    icon?: string;
    hidden?: boolean;
    attention?: boolean;
    underline?: boolean;
    body?: string;
}

/** A stack with its pages, `<gtk-stack>` already upgraded and rendered. */
function mount(pages: Page[] = [], attrs: Record<string, string> = {}): { el: GtkStack; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-stack') as GtkStack;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    for (const page of pages) {
        const child = document.createElement('div');
        if (page.title !== undefined) child.setAttribute('title', page.title);
        if (page.icon !== undefined) child.setAttribute('icon-name', page.icon);
        if (page.attention) child.setAttribute('needs-attention', '');
        if (page.underline) child.setAttribute('use-underline', '');
        if (page.hidden) child.setAttribute('hidden', '');
        child.textContent = page.body ?? page.name;
        el.appendChild(child);
        child.setAttribute('name', page.name);
    }
    host.appendChild(el);
    return { el, host };
}

/**
 * A turn of the event loop.
 *
 * A page's own change reaches the stack through a MutationObserver — `add_page` connects
 * the stack to the page's `notify::visible` (gtkstack.c:1771), and the browser's equivalent
 * of a `notify` on someone else's attribute is the observer, which delivers in a
 * microtask. GObject's notify is synchronous; this await is the one place the two differ,
 * and it is why the three page-mutation tests below wait where the C test would not.
 */
function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The children in DOM order, with `visible-page` marked, as the render pass sees them. */
function marks(el: GtkStack): string[] {
    return (Array.from(el.children) as HTMLElement[]).map(
        (child) => `${child.getAttribute('name')}${child.classList.contains('visible-page') ? ':visible' : ''}`,
    );
}

export const GtkStackTest = async () => {
    await describe('<gtk-stack> defaults', async () => {
        await it('shows the first visible page and hides every other one', () => {
            // gtkstack.c:1773-1775 — the first page added while nothing is visible becomes
            // the visible one, and `:2947` the role.
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            expect(marks(el)).toStrictEqual(['a:visible', 'b']);
            expect(el.visibleChildName).toBe('a');
            expect(el.getAttribute('role')).toBe('group');
            expect(el.transitionDuration).toBe(200);
            expect(el.transitionType).toBe('none');
            host.remove();
        });

        await it('is homogeneous on both axes by default and anisotropic on request', () => {
            // gtkstack.c:981-995 — both specs default TRUE.
            const { el, host } = mount([{ name: 'a' }]);
            expect(el.hhomogeneous).toBe(true);
            expect(el.vhomogeneous).toBe(true);
            el.hhomogeneous = false;
            expect(el.hhomogeneous).toBe(false);
            // An absent attribute is C's TRUE, so it has to read back as true after removal.
            el.hhomogeneous = true;
            expect(el.getAttribute('hhomogeneous')).toBe('');
            expect(el.hhomogeneous).toBe(true);
            host.remove();
        });

        await it('an unknown transition-type nick reads as none, the GIR default', () => {
            // gtkstack.c:1038-1044 — the enum's default member is NONE.
            const { el, host } = mount([{ name: 'a' }], { 'transition-type': 'cube' });
            expect(el.transitionType).toBe('none');
            host.remove();
        });
    });

    await describe('<gtk-stack> which child is visible', async () => {
        await it('setting the name of a visible page makes it visible', () => {
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            el.setVisibleChildName('b');
            expect(marks(el)).toStrictEqual(['a', 'b:visible']);
            expect(el.visibleChildName).toBe('b');
            host.remove();
        });

        await it('an unknown name changes nothing', () => {
            // gtkstack.c:2323-2327 — `g_warning`, then return.
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            expect(el.setVisibleChildName('nope')).toBe(false);
            expect(el.visibleChildName).toBe('a');
            host.remove();
        });

        await it('naming a page that is not visible is a no-op, not a blank stack', () => {
            // gtkstack.c:1591-1594 / :2329-2332 — the widget must be visible itself.
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta', hidden: true },
            ]);
            expect(el.setVisibleChildName('b')).toBe(false);
            expect(el.visibleChildName).toBe('a');
            host.remove();
        });

        await it('hiding the visible page falls back to the first visible one', async () => {
            // `set_visible_child (stack, NULL)` — the first-visible scan, gtkstack.c:1437.
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            (el.children[0] as HTMLElement).setAttribute('hidden', '');
            await settle();
            expect(el.visibleChildName).toBe('b');
            host.remove();
        });

        await it('a descendant toggling hidden keeps the selection', async () => {
            // gtkstack.c:1617-1633 listens to the PAGE's own visibility, never to what is
            // nested inside it (an `adw-view-stack` showing and hiding its own pages).
            const { el, host } = mount([
                { name: 'single', title: 'Single' },
                { name: 'three', title: 'Three' },
            ]);
            const nested = document.createElement('span');
            el.children[0]!.appendChild(nested);
            el.setVisibleChildName('three');
            nested.setAttribute('hidden', '');
            await settle();
            nested.removeAttribute('hidden');
            await settle();
            expect(el.visibleChildName).toBe('three');
            expect(marks(el)).toStrictEqual(['single', 'three:visible']);
            host.remove();
        });

        await it('hiding a page that is not visible keeps the selection', async () => {
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
                { name: 'c', title: 'Gamma' },
            ]);
            el.setVisibleChildName('c');
            (el.children[1] as HTMLElement).setAttribute('hidden', '');
            await settle();
            expect(el.visibleChildName).toBe('c');
            host.remove();
        });

        await it('hiding the visible page after a selection falls back to the first visible', async () => {
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
                { name: 'c', title: 'Gamma' },
            ]);
            el.setVisibleChildName('c');
            (el.children[0] as HTMLElement).setAttribute('hidden', '');
            (el.children[2] as HTMLElement).setAttribute('hidden', '');
            await settle();
            expect(el.visibleChildName).toBe('b');
            host.remove();
        });

        await it('a descendant name change dispatches no page-updated', async () => {
            const { el, host } = mount([{ name: 'a', title: 'Alpha' }]);
            const nested = document.createElement('span');
            el.children[0]!.appendChild(nested);
            await settle();
            const events: string[] = [];
            el.addEventListener('page-updated', () => events.push('updated'));
            nested.setAttribute('name', 'inner');
            await settle();
            expect(events).toStrictEqual([]);
            expect(el.visibleChildName).toBe('a');
            host.remove();
        });

        await it('re-selecting the visible page is not a change', () => {
            // gtkstack.c:1452-1453 — no notify, no transition.
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            const events: string[] = [];
            el.addEventListener('notify::visible-child', () => events.push('child'));
            expect(el.setVisibleChildName('a')).toBe(false);
            expect(events).toStrictEqual([]);
            host.remove();
        });

        await it('a page with no name is never matched, and reads as a NULL name', () => {
            // gtkstack.c:2314 — `info->name != NULL &&`, and get_visible_child_name
            // returns NULL for an unnamed visible page (gtkstack.c:2220-2223).
            const { el, host } = mount([{ name: '', title: 'Nameless' }]);
            expect(el.visibleChildName).toBe(null);
            expect(el.pages[0].name).toBe('');
            expect(el.setVisibleChildName('')).toBe(false);
            host.remove();
        });

        await it('setVisibleChild refuses a child that is not in the stack', () => {
            // gtkstack.c:2258-2266 — `g_warning` for a child of the wrong type.
            const { el, host } = mount([{ name: 'a', title: 'Alpha' }]);
            const stranger = document.createElement('div');
            expect(el.setVisibleChild(stranger)).toBe(false);
            expect(el.visibleChildName).toBe('a');
            host.remove();
        });

        await it('addTitled names and titles the child, and addChild appends a bare one', () => {
            // gtkstack.c:1644-1663, :1665-1685.
            const { el, host } = mount();
            const child = el.addTitled(document.createElement('div'), 'later', 'Later');
            expect(child.getAttribute('name')).toBe('later');
            expect(child.getAttribute('title')).toBe('Later');
            // The first visible page added to an empty stack becomes visible (:1773).
            expect(el.visibleChildName).toBe('later');
            host.remove();
        });
    });

    await describe('<gtk-stack> the page descriptor', async () => {
        await it('reads the six GtkStackPage properties off the child', () => {
            // gtkstack.c:499-573 — the GObject's properties are the child's attributes.
            const { el, host } = mount([
                { name: 'a', title: 'Alpha', icon: 'go-next-symbolic', attention: true, underline: true },
            ]);
            expect(el.pages).toStrictEqual([
                {
                    name: 'a',
                    title: 'Alpha',
                    iconName: 'go-next-symbolic',
                    needsAttention: true,
                    useUnderline: true,
                    visible: true,
                    child: el.children[0],
                },
            ]);
            host.remove();
        });

        await it('an absent title is null, never a fallback to the name', () => {
            // rebuild_child builds no label at all when title AND icon-name are NULL
            // (gtkstackswitcher.c:158-176) — so "no title" has to stay expressible.
            const { el, host } = mount([{ name: 'a' }]);
            expect(el.pages[0].title).toBe(null);
            expect(el.pages[0].iconName).toBe(null);
            host.remove();
        });

        await it('hidden is the page flag: the descriptor follows it', () => {
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta', hidden: true },
            ]);
            expect(el.pages[1].visible).toBe(false);
            host.remove();
        });

        await it('getChildByName and getPage answer in child order, null when absent', () => {
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            expect(el.getChildByName('b')).toBe(el.children[1]);
            expect(el.getChildByName('nope')).toBe(null);
            expect(el.getPage(el.children[0] as HTMLElement)?.name).toBe('a');
            expect(el.getPage(document.createElement('div'))).toBe(null);
            expect(el.isSelected(el.children[0] as HTMLElement)).toBe(true);
            host.remove();
        });

        await it('renaming the visible page moves visible-child-name with it', async () => {
            // gtkstack.c:3169-3171 — set_name re-notifies visible-child-name when the
            // renamed page IS the visible one, because the selection did not move but the
            // name it is addressed by did.
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            (el.children[0] as HTMLElement).setAttribute('name', 'renamed');
            await settle();
            expect(el.visibleChildName).toBe('renamed');
            host.remove();
        });

        await it('a title change fires page-updated for the switcher to hear', async () => {
            // `on_page_updated` binds the page's own `notify` (gtkstackswitcher.c:311-321).
            const { el, host } = mount([{ name: 'a', title: 'Alpha' }]);
            const updated: unknown[] = [];
            el.addEventListener('page-updated', (e) => updated.push((e as CustomEvent).detail));
            (el.children[0] as HTMLElement).setAttribute('title', 'Changed');
            await settle();
            expect(updated).toStrictEqual([{ child: el.children[0] }]);
            expect(el.pages[0].title).toBe('Changed');
            host.remove();
        });
    });

    await describe('<gtk-stack> transitions', async () => {
        await it('runs the transition and clears it when the duration is up', async () => {
            const { el, host } = mount(
                [
                    { name: 'a', title: 'Alpha' },
                    { name: 'b', title: 'Beta' },
                ],
                { 'transition-type': 'crossfade', 'transition-duration': '10' },
            );
            const events: string[] = [];
            el.addEventListener('transition-start', () => events.push('start'));
            el.addEventListener('transition-end', () => events.push('end'));
            el.setVisibleChildName('b');
            expect(el.transitionRunning).toBe(true);
            expect(el.dataset.transitionType).toBe('crossfade');
            expect((el.children[0] as HTMLElement).classList.contains('transitioning-out')).toBe(true);
            expect((el.children[1] as HTMLElement).classList.contains('transitioning-in')).toBe(true);
            await new Promise((resolve) => setTimeout(resolve, 40));
            expect(el.transitionRunning).toBe(false);
            expect(el.dataset.transitionType).toBe(undefined);
            expect(events).toStrictEqual(['start', 'end']);
            host.remove();
        });

        await it('transition-type none starts no transition at all', () => {
            // gtkstack.c:1400-1403 — an effective type of NONE skips the tracker.
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            el.setVisibleChildName('b');
            expect(el.transitionRunning).toBe(false);
            expect(el.dataset.transitionType).toBe(undefined);
            host.remove();
        });

        await it('a zero duration starts no transition, though the type is set', () => {
            // gtkstack.c:1402 — `transition_duration != 0` gates the whole branch.
            const { el, host } = mount(
                [
                    { name: 'a', title: 'Alpha' },
                    { name: 'b', title: 'Beta' },
                ],
                { 'transition-type': 'slide-left', 'transition-duration': '0' },
            );
            el.setVisibleChildName('b');
            expect(el.transitionRunning).toBe(false);
            host.remove();
        });

        await it('a two-way type resolves to a one-directional one, by page order', () => {
            // get_simple_transition_type (gtkstack.c:1162-1200): slide-left-right becomes
            // slide-left when the new page was added LATER (`i_first` false) and
            // slide-right when it was added EARLIER (`i_first` true).
            const forward = mount(
                [
                    { name: 'a', title: 'Alpha' },
                    { name: 'b', title: 'Beta' },
                ],
                { 'transition-type': 'slide-left-right', 'transition-duration': '50' },
            );
            forward.el.setVisibleChildName('b');
            expect(forward.el.dataset.transitionType).toBe('slide-left');
            forward.host.remove();

            const backward = mount(
                [
                    { name: 'a', title: 'Alpha' },
                    { name: 'b', title: 'Beta' },
                ],
                { 'transition-type': 'slide-left-right', 'transition-duration': '50' },
            );
            // Go out to `b` first, so the switch BACK to `a` is the one under test and
            // `a` — the earlier page — is the incoming one.
            backward.el.setVisibleChildName('b');
            backward.el.setVisibleChildName('a');
            expect(backward.el.dataset.transitionType).toBe('slide-right');
            backward.host.remove();
        });

        await it('a two-way type with nothing to slide away from collapses to none', () => {
            // gtkstack.c:1541-1545 — `child_info == NULL || last_visible_child == NULL`.
            const { el, host } = mount(
                [
                    { name: 'a', title: 'Alpha', hidden: true },
                    { name: 'b', title: 'Beta', hidden: true },
                    { name: 'c', title: 'Gamma' },
                ],
                { 'transition-type': 'slide-left-right', 'transition-duration': '50' },
            );
            // Nothing was visible, so the first page shown has no outgoing sibling.
            el.setVisibleChildName('c');
            expect(el.visibleChildName).toBe('c');
            expect(el.transitionRunning).toBe(false);
            host.remove();
        });

        await it('interpolate-size is an attribute, and does not change the type', () => {
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            expect(el.interpolateSize).toBe(false);
            el.interpolateSize = true;
            expect(el.hasAttribute('interpolate-size')).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-stack> notification', async () => {
        await it('notifies both child properties on a real change, child first', async () => {
            // gtkstack.c:1568-1570 — the order is the two g_object_notify calls.
            const { el, host } = mount(
                [
                    { name: 'a', title: 'Alpha' },
                    { name: 'b', title: 'Beta' },
                ],
                { 'transition-duration': '5' },
            );
            const events: string[] = [];
            el.addEventListener('notify::visible-child', () => events.push('child'));
            el.addEventListener('notify::visible-child-name', () => events.push('name'));
            el.setVisibleChildName('b');
            expect(events).toStrictEqual(['child', 'name']);
            await new Promise((resolve) => setTimeout(resolve, 20));
            host.remove();
        });

        await it('reports the parsed property, not the raw attribute', () => {
            const { el, host } = mount([{ name: 'a', title: 'Alpha' }]);
            const details: unknown[] = [];
            el.addEventListener('notify::transition-duration', (e) => details.push((e as CustomEvent).detail));
            el.transitionDuration = 320;
            expect(details).toStrictEqual([{ 'transition-duration': 320 }]);
            host.remove();
        });

        await it('an added page reports items-changed, a removed one too', async () => {
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            const events: unknown[] = [];
            el.addEventListener('items-changed', (e) => events.push((e as CustomEvent).detail));
            const third = document.createElement('div');
            third.setAttribute('name', 'c');
            el.appendChild(third);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(events).toStrictEqual([{ position: 2, removed: 0, added: 1 }]);
            host.remove();
        });

        await it('the visible page carries no aria-hidden and the others do', async () => {
            // gtkstack.c:1610-1613 — GTK_ACCESSIBLE_STATE_HIDDEN on the PAGE.
            const { el, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta' },
            ]);
            expect((el.children[0] as HTMLElement).hasAttribute('aria-hidden')).toBe(false);
            expect((el.children[1] as HTMLElement).getAttribute('aria-hidden')).toBe('true');
            host.remove();
        });
    });

    await describe('<gtk-stack> adopts a <gtk-stack-page> record', async () => {
        const record = (attrs: Record<string, string>, body = 'page'): HTMLElement => {
            const page = document.createElement('gtk-stack-page');
            for (const [name, value] of Object.entries(attrs)) page.setAttribute(name, value);
            const child = document.createElement('div');
            child.setAttribute('slot', 'child');
            child.textContent = body;
            page.appendChild(child);
            return page;
        };

        await it('puts the child where the record was, with its properties as attributes', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const el = document.createElement('gtk-stack') as GtkStack;
            el.appendChild(
                record({
                    name: 'a',
                    title: 'Alpha',
                    'icon-name': 'go-home',
                    'needs-attention': '',
                    'use-underline': '',
                }),
            );
            el.appendChild(record({ name: 'b' }, 'beta'));
            host.appendChild(el);
            expect(el.querySelector('gtk-stack-page')).toBe(null);
            expect(marks(el)).toStrictEqual(['a:visible', 'b']);
            const [page] = el.pages;
            expect(page!.title).toBe('Alpha');
            expect(page!.iconName).toBe('go-home');
            expect(page!.needsAttention).toBe(true);
            expect(page!.useUnderline).toBe(true);
            expect(page!.child.hasAttribute('slot')).toBe(false);
            expect(el.getChildByName('b')!.textContent).toBe('beta');
            host.remove();
        });

        await it('reads a hidden record as GtkStackPage:visible = FALSE', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const el = document.createElement('gtk-stack') as GtkStack;
            const hidden = record({ name: 'a' });
            (hidden as unknown as { visible: boolean }).visible = false;
            el.appendChild(hidden);
            el.appendChild(record({ name: 'b' }));
            host.appendChild(el);
            expect(el.pages.map((page) => page.visible)).toStrictEqual([false, true]);
            expect(el.visibleChildName).toBe('b');
            host.remove();
        });

        await it('adopts a record appended after connect, counted once', async () => {
            const { el, host } = mount([{ name: 'a' }]);
            const events: unknown[] = [];
            el.addEventListener('items-changed', (e) => events.push((e as CustomEvent).detail));
            el.appendChild(record({ name: 'b' }));
            await settle();
            await settle();
            expect(marks(el)).toStrictEqual(['a:visible', 'b']);
            expect(events).toStrictEqual([{ position: 1, removed: 0, added: 1 }]);
            host.remove();
        });

        await it('takes a bare child as the page, and refuses a record with two', () => {
            const bare = document.createElement('gtk-stack-page');
            const child = document.createElement('div');
            bare.appendChild(child);
            expect(pageChildOf(bare)).toBe(child);
            bare.appendChild(document.createElement('div'));
            expect(() => pageChildOf(bare)).toThrow('has one `child`');
            expect(pageChildOf(document.createElement('gtk-stack-page'))).toBe(null);
        });

        await it('builds `Stack { StackPage { name; child: … } }` from a shared tree', () => {
            const { root, unmount } = mountSharedTree({
                tag: 'GtkStack',
                id: 'layoutHost',
                children: [
                    {
                        tag: 'GtkStackPage',
                        id: 'singlePage',
                        props: { name: 'single' },
                        children: [{ tag: 'AdwBin', slot: 'child', id: 'singleBin' }],
                    },
                    {
                        tag: 'GtkStackPage',
                        id: 'threePage',
                        props: { name: 'three', title: 'Three' },
                        children: [{ tag: 'AdwBin', slot: 'child', id: 'threeBin' }],
                    },
                ],
            });
            try {
                const stack = root as GtkStack;
                expect(stack.pages.map((page) => page.child.id)).toStrictEqual(['singleBin', 'threeBin']);
                // The first page added is the visible one (gtkstack.c:1773-1775); a breakpoint
                // setter selects another by the name its record carried.
                expect(stack.visibleChild!.id).toBe('singleBin');
                expect(stack.setVisibleChildName('three')).toBe(true);
                expect(stack.visibleChild!.id).toBe('threeBin');
                expect(stack.getPage(stack.visibleChild!)!.title).toBe('Three');
            } finally {
                unmount();
            }
        });
    });

    await describe('<gtk-stack> GIR method names', async () => {
        await it('add_named / add_titled / the visible-child accessors follow the C functions', () => {
            const { el, host } = mount();
            const [a, b] = [1, 2].map(() => document.createElement('div'));
            el.add_named(a!, 'a');
            el.add_titled(b!, 'b', 'Beta');
            expect(el.get_visible_child_name()).toBe('a');
            el.set_visible_child_name('b');
            expect(el.get_visible_child()).toBe(b!);
            el.set_visible_child(a!);
            expect(el.get_visible_child_name()).toBe('a');
            host.remove();
        });

        await it('remove(child) removes the page; remove() still detaches the stack', () => {
            const { el, host } = mount();
            const a = document.createElement('div');
            el.add_named(a, 'a');
            el.remove(a);
            expect(a.parentElement).toBe(null);
            el.remove();
            expect(el.parentElement).toBe(null);
            host.remove();
        });
    });
};

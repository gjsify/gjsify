// DOM-level tests for <gtk-stack-switcher>. The widget is three separable things:
// the BUTTON-VISIBILITY rule (which decides how many buttons exist at all), the
// TWO-WAY binding with the stack (including C's refusal to let a page be deselected),
// and the page-update path.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkStack } from './elements/gtk-stack.js';
import type { GtkStackSwitcher } from './elements/gtk-stack-switcher.js';

interface Page {
    name: string;
    title?: string;
    icon?: string;
    hidden?: boolean;
    attention?: boolean;
}

/** A stack with its pages, a switcher bound to it by id, both in the document. */
function mount(
    pages: Page[],
    attrs: Record<string, string> = {},
): { stack: GtkStack; switcher: GtkStackSwitcher; host: HTMLElement; stackId: string } {
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
    const switcher = document.createElement('gtk-stack-switcher') as GtkStackSwitcher;
    for (const [name, value] of Object.entries(attrs)) switcher.setAttribute(name, value);
    switcher.setAttribute('stack', stackId);
    host.append(stack, switcher);
    return { stack, switcher, host, stackId };
}

/** The buttons, with hidden ones marked, as the visibility rule leaves them. */
function buttons(el: GtkStackSwitcher): string[] {
    return [...el.querySelectorAll<HTMLButtonElement>('.adw-stack-switcher-button')].map((button) => {
        const title = button.querySelector('.adw-stack-switcher-title')?.textContent ?? '';
        const icon = button.querySelector('.adw-stack-switcher-icon')?.getAttribute('icon-name');
        const parts = [title];
        if (icon) parts.push(icon);
        if (button.hidden) parts.push('hidden');
        if (button.classList.contains('active')) parts.push('active');
        if (button.classList.contains('needs-attention')) parts.push('attention');
        return parts.filter(Boolean).join(' ');
    });
}

/** A turn of the event loop — a page's change reaches the switcher through the stack's observer. */
function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

const THREE = [
    { name: 'a', title: 'Alpha' },
    { name: 'b', title: 'Beta' },
    { name: 'c', title: 'Gamma' },
];

export const GtkStackSwitcherTest = async () => {
    await describe('<gtk-stack-switcher> defaults', async () => {
        await it('builds one button per page, the first one active', () => {
            const { switcher, host } = mount(THREE);
            expect(buttons(switcher)).toStrictEqual(['Alpha active', 'Beta', 'Gamma']);
            expect(switcher.getAttribute('role')).toBe('tablist');
            // `.linked` is what C puts on the switcher itself (gtkstackswitcher.c:49-57).
            expect(switcher.classList.contains('linked')).toBe(true);
            expect(switcher.orientation).toBe('horizontal');
            host.remove();
        });

        await it('a button is a tab, selected state and all', () => {
            const { switcher, host } = mount(THREE);
            const [first, second] = switcher.querySelectorAll<HTMLButtonElement>('.adw-stack-switcher-button');
            expect(first.getAttribute('role')).toBe('tab');
            expect(first.getAttribute('aria-selected')).toBe('true');
            expect(second.getAttribute('aria-selected')).toBe('false');
            host.remove();
        });
    });

    await describe('<gtk-stack-switcher> button visibility', async () => {
        await it('a page with a title shows a label button', () => {
            const { switcher, host } = mount([{ name: 'a', title: 'Alpha' }]);
            const label = switcher.querySelector<HTMLElement>('.adw-stack-switcher-title');
            const icon = switcher.querySelector<HTMLElement>('.adw-stack-switcher-icon');
            expect(label?.textContent).toBe('Alpha');
            expect(label?.hidden).toBe(false);
            expect(icon?.hidden).toBe(true);
            expect((switcher.querySelector('.adw-stack-switcher-button') as HTMLElement).dataset.buttonMode).toBe(
                'text',
            );
            host.remove();
        });

        await it('an icon AND a title show both, and the tooltip lands on the switcher', () => {
            // gtkstackswitcher.c:145-155 — the tooltip is set on `self`, not on the button.
            const { switcher, host } = mount([{ name: 'a', title: 'Alpha', icon: 'go-next-symbolic' }]);
            const icon = switcher.querySelector<HTMLElement>('.adw-stack-switcher-icon');
            expect(icon?.hidden).toBe(false);
            expect(icon?.getAttribute('icon-name')).toBe('go-next-symbolic');
            expect(switcher.title).toBe('Alpha');
            expect((switcher.querySelector('.adw-stack-switcher-button') as HTMLElement).dataset.buttonMode).toBe(
                'both',
            );
            host.remove();
        });

        await it('an icon WITHOUT a title takes the switcher tooltip and clears the label', () => {
            // gtkstackswitcher.c:146-147 sets the tooltip; :158-160 leaves no label child.
            const { switcher, host } = mount([{ name: 'a', icon: 'go-next-symbolic' }]);
            expect(switcher.querySelector<HTMLElement>('.adw-stack-switcher-title')?.hidden).toBe(true);
            expect(switcher.title).toBe('');
            host.remove();
        });

        await it('a page with NEITHER title nor icon is hidden', () => {
            // gtkstackswitcher.c:200 — `visible && (title != NULL || icon_name != NULL)`.
            const { switcher, host } = mount([{ name: 'a' }, { name: 'b', title: 'Beta' }]);
            // `a` is the FIRST page, so it is the visible one — and a visible page with
            // nothing to draw is still a hidden button, selected.
            expect(buttons(switcher)).toStrictEqual(['hidden active', 'Beta']);
            host.remove();
        });

        await it('a hidden page is hidden, whatever it carries', () => {
            const { switcher, host } = mount([
                { name: 'a', title: 'Alpha' },
                { name: 'b', title: 'Beta', hidden: true },
            ]);
            expect(buttons(switcher)).toStrictEqual(['Alpha active', 'Beta hidden']);
            host.remove();
        });

        await it('a title-only button CLEARS a tooltip an icon-only page set', () => {
            // gtkstackswitcher.c:168 — `gtk_widget_set_tooltip_text (self, NULL)`.
            const { switcher, host } = mount([
                { name: 'a', icon: 'go-next-symbolic' },
                { name: 'b', title: 'Beta' },
            ]);
            // The LAST page wins, and it has a title, so the tooltip is cleared.
            expect(switcher.title).toBe('');
            host.remove();
        });
    });

    await describe('<gtk-stack-switcher> the two-way binding', async () => {
        await it('clicking a button makes its page visible', () => {
            const { stack, switcher, host } = mount(THREE);
            (switcher.querySelectorAll('.adw-stack-switcher-button')[2] as HTMLButtonElement).click();
            expect(stack.visibleChildName).toBe('c');
            expect(buttons(switcher)).toStrictEqual(['Alpha', 'Beta', 'Gamma active']);
            host.remove();
        });

        await it('a page change re-marks the buttons without rebuilding them', () => {
            // gtkstackswitcher.c:359-381 — only the buttons in the changed range move.
            const { stack, switcher, host } = mount(THREE);
            const before = switcher.querySelectorAll('.adw-stack-switcher-button')[1];
            stack.setVisibleChildName('c');
            const after = switcher.querySelectorAll('.adw-stack-switcher-button')[1];
            expect(after).toBe(before);
            expect(buttons(switcher)).toStrictEqual(['Alpha', 'Beta', 'Gamma active']);
            host.remove();
        });

        await it('clicking the CURRENT page leaves it selected', () => {
            // gtkstackswitcher.c:126-131 — a deactivation is taken back from the model.
            const { stack, switcher, host } = mount(THREE);
            (switcher.querySelectorAll('.adw-stack-switcher-button')[0] as HTMLButtonElement).click();
            expect(stack.visibleChildName).toBe('a');
            expect(buttons(switcher)).toStrictEqual(['Alpha active', 'Beta', 'Gamma']);
            host.remove();
        });

        await it('needs-attention puts the class on the button', () => {
            const { switcher, host } = mount([
                { name: 'a', title: 'Alpha', attention: true },
                { name: 'b', title: 'Beta' },
            ]);
            expect(buttons(switcher)).toStrictEqual(['Alpha active attention', 'Beta']);
            host.remove();
        });

        await it('a page added later brings its own button', async () => {
            // `items_changed_cb` rebuilds the whole row (gtkstackswitcher.c:347-355).
            const { stack, switcher, host } = mount(THREE);
            const added = document.createElement('div');
            added.setAttribute('name', 'd');
            added.setAttribute('title', 'Delta');
            stack.appendChild(added);
            await settle();
            expect(buttons(switcher)).toStrictEqual(['Alpha active', 'Beta', 'Gamma', 'Delta']);
            host.remove();
        });
    });

    await describe('<gtk-stack-switcher> binding and properties', async () => {
        await it('resolves the stack by id, and an unknown id leaves it unbound', () => {
            const { stack, switcher, host } = mount(THREE);
            expect(switcher.stack).toBe(stack);
            switcher.setAttribute('stack', 'no-such-stack-anywhere');
            expect(switcher.stack).toBe(null);
            expect(switcher.querySelectorAll('.adw-stack-switcher-button').length).toBe(0);
            host.remove();
        });

        await it('setStack notifies, and re-binding the SAME stack does not', () => {
            // gtkstackswitcher.c:430-432 — the early return before the notify.
            const { stack, switcher, host } = mount(THREE);
            const events: unknown[] = [];
            switcher.addEventListener('notify::stack', (e) => events.push((e as CustomEvent).detail));
            switcher.setStack(stack);
            switcher.setStack(null);
            expect(events).toStrictEqual([{ stack: null }]);
            host.remove();
        });

        await it('orientation is a property and the switcher keeps its horizontal default', () => {
            const { switcher, host } = mount(THREE, { orientation: 'vertical' });
            expect(switcher.orientation).toBe('vertical');
            switcher.orientation = 'horizontal';
            expect(switcher.orientation).toBe('horizontal');
            host.remove();
        });

        await it('an unbound switcher is empty, not broken', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const switcher = document.createElement('gtk-stack-switcher') as GtkStackSwitcher;
            host.appendChild(switcher);
            expect(switcher.stack).toBe(null);
            expect(switcher.querySelectorAll('.adw-stack-switcher-button').length).toBe(0);
            host.remove();
        });
    });
};

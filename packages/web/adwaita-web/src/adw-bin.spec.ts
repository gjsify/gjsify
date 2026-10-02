// DOM-level tests for <adw-bin>: the ONE child a bin holds, that `setChild` REPLACES
// rather than stacks (adw-bin.c:193-219), and that a child which already has a parent
// is refused the way C's `g_return_if_fail (gtk_widget_get_parent (child) == NULL)`
// refuses it.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwBin } from './elements/adw-bin.js';

function mount(children: Node[] = []): { el: AdwBin; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('adw-bin') as AdwBin;
    host.appendChild(el);
    for (const child of children) el.appendChild(child);
    return { el, host };
}

export const AdwBinTest = async () => {
    await describe('<adw-bin> one child', async () => {
        await it('holds whatever it was given, and reports it as `child`', () => {
            const label = document.createElement('div');
            const { el, host } = mount([label]);
            expect(el.child).toBe(label);
            expect(el.childElementCount).toBe(1);
            host.remove();
        });

        await it('a second child REPLACES the first, which is what adw_bin_set_child does', async () => {
            const first = document.createElement('div');
            const second = document.createElement('div');
            const { el, host } = mount([first]);
            el.appendChild(second);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(el.child).toBe(second);
            expect(el.childElementCount).toBe(1);
            expect(first.parentNode).toBeNull();
            host.remove();
        });

        await it('setChild notifies once, and not for the child it already holds', async () => {
            const { el, host } = mount();
            const details: unknown[] = [];
            el.addEventListener('notify::child', (event) => details.push((event as CustomEvent).detail));
            const child = document.createElement('div');
            el.child = child;
            expect(el.child).toBe(child);
            el.setChild(child);
            expect(details).toStrictEqual([{ child }]);
            host.remove();
        });

        await it('refuses a child that already has a parent, as C does', () => {
            const other = document.createElement('div');
            document.body.appendChild(other);
            const stray = document.createElement('span');
            other.appendChild(stray);
            const { el, host } = mount();
            expect(() => el.setChild(stray)).toThrow();
            expect(el.child).toBeNull();
            host.remove();
            other.remove();
        });

        await it('an empty bin is a block box, and its only child fills it', () => {
            const { el, host } = mount([document.createElement('div')]);
            // A bin takes the size it is GIVEN and hands all of it to the child, which
            // `GtkBinLayout` does on both axes (gtkbinlayout.c:81).
            el.style.height = '120px';
            expect(getComputedStyle(el).display).toBe('block');
            const child = el.firstElementChild as HTMLElement;
            expect(child.getBoundingClientRect().height).toBe(120);
            host.remove();
        });
    });
};

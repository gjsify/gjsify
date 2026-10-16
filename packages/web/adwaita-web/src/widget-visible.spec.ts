// `Gtk.Widget:visible` on a built element: an authored `visible: false`, `get_visible()` /
// `set_visible()`, the property, and a breakpoint setter that writes it and restores it.
import { describe, expect, it } from '@gjsify/unit';
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import { mountSharedTree } from './shared-tree-builder.js';

function settle(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

type Widget = HTMLElement & { visible: boolean; get_visible(): boolean; set_visible(value: boolean): void };

const tree = (width: number, authored: boolean): SharedTreeNode => ({
    tag: 'AdwApplicationWindow',
    props: { 'default-width': width, 'default-height': 400 },
    breakpoints: [
        {
            condition: 'max-width: 599sp',
            setters: [{ object: 'target', property: 'visible', value: false }],
        },
    ],
    children: [
        {
            tag: 'GtkBox',
            slot: 'content',
            children: [{ tag: 'GtkButton', id: 'target', props: authored ? {} : { visible: false } }],
        },
    ],
});

export const AdwWidgetVisibleTest = async () => {
    await describe('adwaita-web: Gtk.Widget:visible on a built element', async () => {
        await it('an authored `visible: false` hides the widget', () => {
            const { root, unmount } = mountSharedTree({
                tag: 'GtkBox',
                children: [{ tag: 'GtkButton', id: 'b', props: { visible: false } }],
            });
            const button = root.querySelector('#b') as Widget;
            expect(button.hidden).toBe(true);
            expect(button.visible).toBe(false);
            expect(button.get_visible()).toBe(false);
            unmount();
        });

        await it('is visible by default, and an authored `true` shows it', () => {
            const { root, unmount } = mountSharedTree({
                tag: 'GtkBox',
                children: [
                    { tag: 'GtkButton', id: 'a' },
                    { tag: 'GtkButton', id: 'b', props: { visible: true } },
                ],
            });
            expect((root.querySelector('#a') as Widget).get_visible()).toBe(true);
            expect((root.querySelector('#b') as Widget).hidden).toBe(false);
            unmount();
        });

        await it('set_visible() and the property round-trip', () => {
            const { root, unmount } = mountSharedTree({
                tag: 'GtkBox',
                children: [{ tag: 'GtkButton', id: 'b' }],
            });
            const button = root.querySelector('#b') as Widget;
            button.set_visible(false);
            expect(button.hidden).toBe(true);
            button.visible = true;
            expect(button.hidden).toBe(false);
            expect(button.get_visible()).toBe(true);
            unmount();
        });

        await it('a breakpoint setter hides the widget and unapplying restores it', async () => {
            const narrow = mountSharedTree(tree(400, true));
            await settle();
            expect((narrow.root.querySelector('#target') as Widget).visible).toBe(false);
            narrow.unmount();

            const wide = mountSharedTree(tree(1000, true));
            await settle();
            expect((wide.root.querySelector('#target') as Widget).visible).toBe(true);
            wide.unmount();
        });

        await it('unapplying a breakpoint restores an authored `false`', async () => {
            const { root, unmount } = mountSharedTree(tree(1000, false));
            await settle();
            expect((root.querySelector('#target') as Widget).visible).toBe(false);
            unmount();
        });

        await it('<gtk-stack-page> and <adw-sidebar> keep their own `visible`', () => {
            const page = document.createElement('gtk-stack-page') as Widget;
            page.visible = false;
            expect(page.hasAttribute('hidden')).toBe(true);
            const item = document.createElement('adw-sidebar-item') as Widget;
            item.visible = false;
            expect(item.getAttribute('visible')).toBe('false');
            expect(item.hasAttribute('hidden')).toBe(true);
        });
    });
};

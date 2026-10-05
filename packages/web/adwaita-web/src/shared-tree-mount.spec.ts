// A showcase window mounted from its tree (ADR 0093): the shape every showcase `.blp` writes — a
// toggle button and a split view that bind to each other, two breakpoints that collapse the split
// view, and a window sized by `default-width`. What is held here is the exact cycle the showcases
// rely on, and `into`, the container a showcase mounts its window in.
import { describe, expect, it } from '@gjsify/unit';
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import { mountSharedTree } from './shared-tree-builder.js';

/** Wait for a ResizeObserver delivery (it runs after layout, before paint). */
function settle(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/** The showcase window, sized by `default-width` and adapting at 800sp. */
const tree = (width: number): SharedTreeNode => ({
    tag: 'AdwApplicationWindow',
    props: { 'default-width': width, 'default-height': 400 },
    breakpoints: [
        {
            condition: 'max-width: 799sp',
            setters: [
                { object: 'splitView', property: 'collapsed', value: true },
                { object: 'splitView', property: 'show-sidebar', value: false },
            ],
        },
        {
            condition: 'min-width: 800sp',
            setters: [
                { object: 'splitView', property: 'collapsed', value: false },
                { object: 'splitView', property: 'show-sidebar', value: true },
            ],
        },
    ],
    children: [
        {
            tag: 'GtkBox',
            slot: 'content',
            children: [
                {
                    tag: 'GtkToggleButton',
                    id: 'sidebarToggleButton',
                    bindings: { active: { source: 'splitView', property: 'show-sidebar' } },
                },
                {
                    tag: 'AdwOverlaySplitView',
                    id: 'splitView',
                    bindings: { 'show-sidebar': { source: 'sidebarToggleButton', property: 'active' } },
                    children: [
                        { tag: 'GtkBox', slot: 'sidebar' },
                        { tag: 'GtkBox', slot: 'content' },
                    ],
                },
            ],
        },
    ],
});

type SplitView = HTMLElement & { showSidebar: boolean; collapsed: boolean };
type Toggle = HTMLElement & { active: boolean };

export const AdwSharedTreeMountTest = async () => {
    await describe('adwaita-web: a showcase window mounted from its tree', async () => {
        await it('<adw-overlay-split-view> raises notify::show-sidebar once per real change', () => {
            const view = document.createElement('adw-overlay-split-view') as SplitView;
            document.body.append(view);
            const seen: boolean[] = [];
            view.addEventListener('notify::show-sidebar', (event) => {
                seen.push((event as CustomEvent<{ showSidebar: boolean }>).detail.showSidebar);
            });
            view.showSidebar = true;
            view.showSidebar = false;
            view.showSidebar = false;
            view.showSidebar = true;
            view.remove();
            expect(seen).toStrictEqual([false, true]);
        });

        await it('a wide window keeps the sidebar and the toggle follows the split view', async () => {
            const { root, unmount } = mountSharedTree(tree(1100));
            await settle();
            const split = root.querySelector('#splitView') as SplitView;
            expect(root.getBoundingClientRect().width).toBe(1100);
            expect(split.collapsed).toBe(false);
            expect(split.showSidebar).toBe(true);
            expect((root.querySelector('#sidebarToggleButton') as Toggle).active).toBe(true);
            unmount();
        });

        await it('a narrow window collapses the split view and the toggle follows it', async () => {
            const { root, unmount } = mountSharedTree(tree(500));
            await settle();
            const split = root.querySelector('#splitView') as SplitView;
            expect(split.collapsed).toBe(true);
            expect(split.showSidebar).toBe(false);
            expect((root.querySelector('#sidebarToggleButton') as Toggle).active).toBe(false);
            unmount();
        });

        await it('the toggle drives the split view back, and the cycle settles', async () => {
            const { root, unmount } = mountSharedTree(tree(1100));
            await settle();
            const toggle = root.querySelector('#sidebarToggleButton') as Toggle;
            const split = root.querySelector('#splitView') as SplitView;
            toggle.active = false;
            expect(split.showSidebar).toBe(false);
            split.showSidebar = true;
            expect(toggle.active).toBe(true);
            toggle.active = false;
            toggle.active = true;
            expect(split.showSidebar).toBe(true);
            expect(split.getAttribute('show-sidebar')).toBe('');
            unmount();
        });

        await it('a tree mounted into a container lives in it, and unmount takes only the tree', () => {
            const container = document.createElement('div');
            document.body.append(container);
            const { root, unmount } = mountSharedTree(tree(1100), { into: container });
            expect(root.parentElement).toBe(container);
            expect(container.querySelector('adw-application-window')).toBe(root);
            unmount();
            expect(container.childElementCount).toBe(0);
            expect(container.isConnected).toBe(true);
            container.remove();
        });
    });
};

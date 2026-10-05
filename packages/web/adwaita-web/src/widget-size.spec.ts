// `width-request`, `height-request` AND AN AUTHORED `hexpand: false`, LAID OUT.
//
// The three-loader-ldraw sidebar is `Gtk.ScrolledWindow { width-request: 320; hexpand: false }`
// beside an expanding canvas. Nothing read either property, so a scrolled window (which is
// `flex: 1 1 0%`) and its sibling split the row in half and the sidebar came out ~50% wide
// where GTK gives it 320px. The assertions are the laid-out geometry, never the attribute.

import { describe, expect, it } from '@gjsify/unit';
import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';

import { mountSharedTree, writeProp } from './shared-tree-builder.js';

/** A row of 800px: a scrolled window carrying `sidebarProps`, and a box that expands. */
function mountRow(sidebarProps: NonNullable<SharedTreeNode['props']>) {
    const tree: SharedTreeNode = {
        tag: 'GtkBox',
        props: { orientation: 'horizontal' },
        children: [
            {
                tag: 'GtkScrolledWindow',
                id: 'sidebar',
                props: { 'hscrollbar-policy': 'never', ...sidebarProps },
                children: [{ tag: 'GtkBox', props: { orientation: 'vertical' } }],
            },
            { tag: 'GtkBox', id: 'content', props: { hexpand: true } },
        ],
    };
    const mounted = mountSharedTree(tree);
    mounted.root.style.width = '800px';
    mounted.root.style.height = '300px';
    const byId = (id: string) => mounted.root.querySelector(`#${id}`) as HTMLElement;
    return { ...mounted, byId };
}

export const AdwWidgetSizeTest = async () => {
    await describe('adwaita-web: width-request and an authored hexpand: false', async () => {
        await it('a scrolled window with width-request 320 and hexpand false is 320px wide', async () => {
            const { unmount, byId } = mountRow({ 'width-request': 320, hexpand: false });
            try {
                expect(byId('sidebar').getBoundingClientRect().width).toBe(320);
                expect(byId('content').getBoundingClientRect().width).toBe(480);
            } finally {
                unmount();
            }
        });

        await it('without the authored false the scrolled window still shares the row', async () => {
            const { unmount, byId } = mountRow({ 'width-request': 320 });
            try {
                expect(byId('sidebar').getBoundingClientRect().width).toBe(400);
            } finally {
                unmount();
            }
        });

        await it('width-request is a minimum: a wider natural size wins', async () => {
            const tree: SharedTreeNode = {
                tag: 'GtkBox',
                props: { orientation: 'horizontal', 'width-request': 100, 'height-request': 40 },
                children: [{ tag: 'GtkBox', id: 'wide', props: { 'width-request': 600 } }],
            };
            const { root, unmount } = mountSharedTree(tree);
            try {
                const style = getComputedStyle(root);
                expect(`${style.minWidth} ${style.minHeight}`).toBe('100px 40px');
                expect(getComputedStyle(root.querySelector('#wide') as Element).minWidth).toBe('600px');
            } finally {
                unmount();
            }
        });

        await it('-1 is "not set", and clears a request written earlier', async () => {
            const { root, unmount } = mountSharedTree({ tag: 'GtkBox', props: { 'width-request': -1 } });
            try {
                expect(root.style.minWidth).toBe('');
                writeProp(root, 'width-request', 200);
                expect(root.style.minWidth).toBe('200px');
                writeProp(root, 'width-request', -1);
                expect(root.style.minWidth).toBe('');
            } finally {
                unmount();
            }
        });

        await it('vexpand false stops a scrolled window growing down a vertical box', async () => {
            const tree: SharedTreeNode = {
                tag: 'GtkBox',
                props: { orientation: 'vertical' },
                children: [
                    { tag: 'GtkScrolledWindow', id: 'top', props: { 'height-request': 100, vexpand: false } },
                    { tag: 'GtkBox', id: 'rest', props: { vexpand: true } },
                ],
            };
            const { root, unmount } = mountSharedTree(tree);
            try {
                root.style.width = '300px';
                root.style.height = '400px';
                expect((root.querySelector('#top') as HTMLElement).getBoundingClientRect().height).toBe(100);
            } finally {
                unmount();
            }
        });

        await it('a later hexpand true takes over from an authored false', async () => {
            const { unmount, byId } = mountRow({ 'width-request': 320, hexpand: false });
            try {
                const sidebar = byId('sidebar');
                expect(sidebar.getAttribute('hexpand')).toBe('false');
                writeProp(sidebar, 'hexpand', true);
                expect(sidebar.getAttribute('hexpand')).toBe('');
                expect(sidebar.getBoundingClientRect().width).toBe(400);
            } finally {
                unmount();
            }
        });
    });
};

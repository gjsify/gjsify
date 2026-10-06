// A responsive window SHELL built from one authored tree, the shape Learn6502's `main.window.blp`
// has: a template window whose breakpoints move the screens between a view stack and columns,
// a toggle bound to an overlay split view, and the screens written as sibling roots.
//
// On the TREES entry for the reason `containers.spec.ts` gives. The size is injected, because the
// platform double has no layout pass; what this holds is that every part of that shape builds and
// that the setters of each breakpoint reach the widget they name.

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build, buildInto, buildWithSiblings, registerTemplateClass } from './builder/index.js';
import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

class ShellScreen extends Gtk.Box {}
registerTemplateClass('ShellScreen', ShellScreen);

// A template class whose internals are its own tree, as `$MainButton : Adw.Bin` is in Learn6502.
const shellButtonTree: SharedTreeNode = {
    tag: 'AdwBin',
    template: 'ShellButton',
    children: [{ tag: 'GtkButton', id: 'button', slot: 'child', props: { label: 'Run' } }],
};
class ShellButton extends Adw.Bin {
    constructor() {
        super();
        buildInto(this, shellButtonTree);
    }
}
registerTemplateClass('ShellButton', ShellButton);

const NARROW = 'max-width: 799sp or max-height: 599sp';
const WIDE = 'min-width: 800sp and min-height: 600sp';

const shell: SharedTreeNode = {
    tag: 'AdwApplicationWindow',
    template: 'ShellWindow',
    breakpoints: [
        {
            condition: NARROW,
            setters: [
                { object: 'layoutHost', property: 'visible-child-name', value: 'single' },
                { object: 'switcherBar', property: 'reveal', value: true },
                { object: 'sidebar', property: 'show-sidebar', value: false },
                { object: 'toggle', property: 'visible', value: false },
            ],
        },
        {
            condition: WIDE,
            setters: [
                { object: 'layoutHost', property: 'visible-child-name', value: 'three' },
                { object: 'switcherBar', property: 'reveal', value: false },
                { object: 'sidebar', property: 'show-sidebar', value: true },
                { object: 'toggle', property: 'visible', value: true },
            ],
        },
    ],
    children: [
        {
            tag: 'AdwToolbarView',
            slot: 'content',
            children: [
                {
                    tag: 'AdwHeaderBar',
                    slot: 'top',
                    children: [
                        {
                            tag: 'GtkToggleButton',
                            id: 'toggle',
                            slot: 'start',
                            bindings: { active: { source: 'sidebar', property: 'show-sidebar' } },
                        },
                    ],
                },
                {
                    tag: 'GtkStack',
                    id: 'layoutHost',
                    slot: 'content',
                    children: [
                        {
                            tag: 'GtkStackPage',
                            id: 'singlePage',
                            props: { name: 'single' },
                            children: [{ tag: 'AdwViewStack', id: 'stack', slot: 'child' }],
                        },
                        {
                            tag: 'GtkStackPage',
                            id: 'threePage',
                            props: { name: 'three' },
                            children: [
                                {
                                    tag: 'AdwOverlaySplitView',
                                    id: 'sidebar',
                                    slot: 'child',
                                    bindings: { 'show-sidebar': { source: 'toggle', property: 'active' } },
                                    children: [
                                        { tag: 'GtkBox', id: 'leftColumn', slot: 'sidebar' },
                                        { tag: 'GtkBox', id: 'centerColumn', slot: 'content' },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                { tag: 'AdwViewSwitcherBar', id: 'switcherBar', slot: 'bottom' },
            ],
        },
    ],
    siblings: [
        { tag: 'ShellScreen', extern: true, id: 'learn' },
        { tag: 'AdwAlertDialog', id: 'dialog', props: { heading: 'Save changes?' } },
    ],
};

type Probe = { getViewById(id: string): Record<string, unknown> };

export const AdwWindowShellNsTest = async () => {
    await describe('a window shell built from one tree', async () => {
        const open = () => {
            let feed: ((size: { width: number; height: number }) => void) | undefined;
            const built = buildWithSiblings(shell, {
                observeSize: (_view, onSize) => {
                    feed = onSize;
                    return () => {};
                },
            });
            const root = built.root as unknown as Probe;
            return { ...built, at: (width: number, height: number) => feed!({ width, height }), root };
        };

        await it('hands the screens and the dialog back by id, outside the window', () => {
            const { root, siblings, objects } = open();
            expect([...siblings.keys()].join()).toBe('learn,dialog');
            expect(siblings.get('learn') instanceof ShellScreen).toBe(true);
            expect(root.getViewById('learn')).toBe(undefined);
            expect(objects.get('learn')).toBe(siblings.get('learn'));
        });

        await it('reaches a stack page by id, which getViewById cannot', () => {
            const { root, objects } = open();
            expect(root.getViewById('singlePage')).toBe(undefined);
            expect(objects.get('singlePage') instanceof Gtk.StackPage).toBe(true);
            expect(objects.get('threePage') instanceof Gtk.StackPage).toBe(true);
        });

        await it('switches layout, bar, sidebar and toggle with the window width', () => {
            const { root, at } = open();
            const state = () => ({
                layout: root.getViewById('layoutHost').visibleChildName,
                bar: root.getViewById('switcherBar').reveal,
                sidebar: root.getViewById('sidebar').showSidebar,
                toggle: root.getViewById('toggle').visibility,
            });
            at(390, 800);
            expect(state()).toStrictEqual({ layout: 'single', bar: true, sidebar: false, toggle: 'collapse' });
            at(1200, 800);
            expect(state()).toStrictEqual({ layout: 'three', bar: false, sidebar: true, toggle: 'visible' });
            at(1200, 500);
            expect(state().layout).toBe('single');
            at(1200, 800);
            expect(state().layout).toBe('three');
        });

        await it('builds a template class into its own instance, and the using tree styles that instance', () => {
            const root = build({
                tag: 'GtkBox',
                children: [{ tag: 'ShellButton', extern: true, id: 'run', props: { halign: 'end' } }],
            }) as unknown as Probe;
            const run = root.getViewById('run') as unknown as ShellButton & { halign: string };
            expect(run instanceof ShellButton).toBe(true);
            expect(run.halign).toBe('end');
            expect((root.getViewById('button') as unknown as { label: string }).label).toBe('Run');
        });

        await it('refuses to build a template into an instance of another class', () => {
            expect(() => buildInto(new Gtk.Box() as never, shellButtonTree)).toThrow('AdwBin');
        });

        await it('follows the toggle and the sidebar through two plain binds, one each way', () => {
            const { root, at } = open();
            at(1200, 800);
            const toggle = root.getViewById('toggle');
            const sidebar = root.getViewById('sidebar');
            expect(toggle.active).toBe(true);
            toggle.active = false;
            expect(sidebar.showSidebar).toBe(false);
            sidebar.showSidebar = true;
            expect(toggle.active).toBe(true);
        });
    });
};

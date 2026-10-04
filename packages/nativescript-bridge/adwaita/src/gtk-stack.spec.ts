// `Gtk.Stack` and `Gtk.StackPage`, built as the real classes against the platform double.
//
// The selection rules are `ViewStackState`'s and are held by the core's conformance vectors;
// what this holds is the GTK wiring around them — names, the two notifies, the record
// protocol a `.blp` authors a stack with.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Gtk from './namespace/gtk.js';
import { Label, type LayoutBase } from './testing/ns-core.mjs';

const label = (): never => new Label() as unknown as never;

const childrenOf = (layout: object): Label[] => {
    const base = layout as LayoutBase;
    return Array.from({ length: base.getChildrenCount() }, (_unused, index) => base.getChildAt(index) as Label);
};

export const GtkStackNsTest = async () => {
    await describe('Gtk.Stack', async () => {
        await it('shows the first page and collapses the rest', () => {
            const stack = new Gtk.Stack();
            const [one, two] = [label(), label()];
            stack.add_named(one, 'one');
            stack.add_named(two, 'two');
            const [a, b] = childrenOf(stack);
            expect(a?.visibility).toBe('visible');
            expect(b?.visibility).toBe('collapse');
            expect(stack.visibleChildName).toBe('one');
            expect(stack.visibleChild === (one as unknown)).toBe(true);
        });

        await it('visible-child-name switches the page and notifies both properties', () => {
            const stack = new Gtk.Stack();
            stack.add_named(label(), 'one');
            stack.add_named(label(), 'two');
            const seen: string[] = [];
            stack.connect('notify::visible-child-name', () => seen.push('name'));
            stack.connect('notify::visible-child', () => seen.push('child'));

            stack.visibleChildName = 'two';
            const [a, b] = childrenOf(stack);
            expect(a?.visibility).toBe('collapse');
            expect(b?.visibility).toBe('visible');
            expect(seen.sort()).toStrictEqual(['child', 'name']);
        });

        await it('visible-child selects by view, and a stranger selects nothing', () => {
            const stack = new Gtk.Stack();
            const [one, two] = [label(), label()];
            stack.add_named(one, 'one');
            stack.add_named(two, 'two');
            stack.visibleChild = two;
            expect(stack.visibleChildName).toBe('two');
            stack.visibleChild = label();
            expect(stack.visibleChildName).toBe('two');
        });

        await it('an unnamed page reads visible-child-name as null, as in C', () => {
            const stack = new Gtk.Stack();
            stack.add_child(label());
            expect(stack.visibleChildName).toBe(null);
            expect(stack.visibleChild === null).toBe(false);
        });

        await it('add_titled keeps the title; get_child_by_name finds a page', () => {
            const stack = new Gtk.Stack();
            const page = label();
            const info = stack.add_titled(page, 'settings', 'Settings');
            expect(info.title).toBe('Settings');
            expect(stack.get_child_by_name('settings') === (page as unknown)).toBe(true);
            expect(stack.get_child_by_name('missing')).toBe(null);
        });

        await it('remove takes the child out; removing the visible page leaves nothing shown', () => {
            const stack = new Gtk.Stack();
            const [one, two] = [label(), label()];
            stack.add_named(one, 'one');
            stack.add_named(two, 'two');
            expect(stack.remove(one)).toBe(true);
            expect(childrenOf(stack).length).toBe(1);
            expect(stack.visibleChild).toBe(null);
            expect(stack.remove(label())).toBe(false);
        });

        await it('holds transition-type and duration without rendering them, and refuses a stranger', () => {
            const stack = new Gtk.Stack();
            expect(stack.transitionType).toBe('none');
            stack.transitionType = 'slide-left-right';
            expect(stack.transitionType).toBe('slide-left-right');
            expect(() => (stack.transitionType = 'swing-up' as never)).toThrow('Gtk.StackTransitionType');
            expect(stack.transitionDuration).toBe(200);
        });

        await it('styleClasses and the css-class verbs work', () => {
            const stack = new Gtk.Stack();
            stack.styleClasses = 'card';
            expect(stack.className).toBe('card');
            stack.add_css_class('flat');
            expect(stack.get_css_classes()).toStrictEqual(['card', 'flat']);
        });
    });

    await describe('Gtk.Stack authored with StackPage records', async () => {
        await it('builds pages in document order, named by the record', () => {
            const stack = build({
                tag: 'GtkStack',
                children: [
                    { tag: 'GtkStackPage', props: { name: 'single' }, children: [{ tag: 'GtkBox', slot: 'child' }] },
                    { tag: 'GtkStackPage', props: { name: 'three' }, children: [{ tag: 'GtkLabel', slot: 'child' }] },
                ],
            }) as unknown as Gtk.Stack;
            const pages = childrenOf(stack);
            expect(pages.length).toBe(2);
            expect(pages[0] instanceof Gtk.Box).toBe(true);
            expect(stack.visibleChildName).toBe('single');
            expect(pages[1]?.visibility).toBe('collapse');
        });

        // MEASURED under gjs 1.88.1 / GTK 4.22.5 with Gtk.Builder: `visible-child-name` written
        // BEFORE the pages exist warns `Child name 'b' not found in GtkStack` and changes nothing,
        // so the first page stays visible. GtkBuilder sets a property when it builds the object,
        // before its children, and the port's builder does the same.
        await it('visible-child-name authored before the pages is a no-op, as in GtkBuilder', () => {
            const stack = build({
                tag: 'GtkStack',
                props: { 'visible-child-name': 'three' },
                children: [
                    { tag: 'GtkStackPage', props: { name: 'single' }, children: [{ tag: 'GtkBox', slot: 'child' }] },
                    { tag: 'GtkStackPage', props: { name: 'three' }, children: [{ tag: 'GtkLabel', slot: 'child' }] },
                ],
            }) as unknown as Gtk.Stack;
            expect(stack.visibleChildName).toBe('single');
        });

        await it('a page with an unnamed child is a nameless page', () => {
            const stack = build({
                tag: 'GtkStack',
                children: [{ tag: 'GtkStackPage', children: [{ tag: 'GtkLabel', slot: 'child' }] }],
            }) as unknown as Gtk.Stack;
            expect(childrenOf(stack).length).toBe(1);
            expect(stack.visibleChildName).toBe(null);
        });

        await it('a bare view in a stack is a page with no name', () => {
            const stack = build({ tag: 'GtkStack', children: [{ tag: 'GtkLabel' }] }) as unknown as Gtk.Stack;
            expect(childrenOf(stack).length).toBe(1);
        });

        await it('a hidden page is not selected; visible reaches the stack after adoption', () => {
            const stack = new Gtk.Stack();
            const hidden = new Gtk.StackPage({ name: 'a', child: label(), visible: false });
            const shown = new Gtk.StackPage({ name: 'b', child: label() });
            stack._addChildFromBuilder('', hidden);
            stack._addChildFromBuilder('', shown);
            expect(stack.visibleChildName).toBe('b');
            hidden.visible = true;
            expect(stack.visibleChildName).toBe('b');
        });

        await it('refuses a write to a page record the stack already read', () => {
            const stack = new Gtk.Stack();
            const page = new Gtk.StackPage({ name: 'a', child: label() });
            stack._addChildFromBuilder('', page);
            expect(() => (page.title = 'late')).toThrow('was read when its stack adopted it');
        });

        await it('a record handed over before its child takes its place once the child arrives', () => {
            const stack = new Gtk.Stack();
            const page = new Gtk.StackPage({ name: 'a' });
            stack._addChildFromBuilder('', page);
            expect(childrenOf(stack).length).toBe(0);
            page.child = label();
            expect(childrenOf(stack).length).toBe(1);
            expect(stack.visibleChildName).toBe('a');
        });

        await it('a record cannot belong to two stacks', () => {
            const page = new Gtk.StackPage({ name: 'a', child: label() });
            new Gtk.Stack()._addChildFromBuilder('', page);
            expect(() => new Gtk.Stack()._addChildFromBuilder('', page)).toThrow('already belongs to a stack');
        });

        await it('an authored slot on a stack is refused, as its children are pages in order', () => {
            expect(() => build({ tag: 'GtkStack', children: [{ tag: 'GtkLabel', slot: 'top' }] })).toThrow(
                'declares no such builder slot',
            );
        });
    });
};

export default GtkStackNsTest;

// `Gtk.Stack` ON A DEVICE (ADR 0105 § 2, route D) — `visible-child` and `visible-child-name`
// declared with `withSignals(GridLayout, …)`. The vectors are GTK 4.22's, measured on real Gtk;
// `gtk-stack-route-d.node-gi.spec.ts` runs them off-device on the real-GI engine,
// `gtk-stack.spec.ts` on the pure-JS one.
//
// The measured order is `notify::visible-child` FIRST, then `notify::visible-child-name`.
import { Gtk } from '@gjsify/adwaita-nativescript';

import { describe, expect, info, it } from '../reporter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const EMISSIONS = ['notify::visible-child', 'notify::visible-child-name'];

const watch = (stack: Gtk.Stack): string[] => {
    const seen: string[] = [];
    for (const name of EMISSIONS) stack.connect(name, () => seen.push(name));
    return seen;
};

export const gtkStackSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Gtk.Stack on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('starts empty, having emitted nothing', () => {
            const stack = new Gtk.Stack();
            const seen = watch(stack);
            expect(stack.visibleChildName).toBe(null);
            expect(stack.visibleChild).toBe(null);
            expect(seen.length).toBe(0);
        });

        await it('add_named of the first child emits visible-child, then visible-child-name', () => {
            const stack = new Gtk.Stack();
            const seen = watch(stack);
            stack.add_named(new Gtk.Label(), 'one');
            info(`seen=${seen.join('|')}`);
            expect(seen.join()).toBe('notify::visible-child,notify::visible-child-name');
            expect(stack.visibleChildName).toBe('one');
        });

        await it('visible-child-name selects the page and emits child, then name', () => {
            const stack = new Gtk.Stack();
            stack.add_named(new Gtk.Label(), 'one');
            stack.add_named(new Gtk.Label(), 'two');
            const seen = watch(stack);
            stack.visibleChildName = 'two';
            info(`seen=${seen.join('|')}`);
            expect(seen.join()).toBe('notify::visible-child,notify::visible-child-name');
            expect(stack.visibleChildName).toBe('two');
        });

        await it('visible-child selects by view and emits child, then name', () => {
            const stack = new Gtk.Stack();
            const one = new Gtk.Label();
            const two = new Gtk.Label();
            stack.add_named(one, 'one');
            stack.add_named(two, 'two');
            const seen = watch(stack);
            stack.visibleChild = two;
            info(`seen=${seen.join('|')}`);
            expect(seen.join()).toBe('notify::visible-child,notify::visible-child-name');
            expect(stack.visibleChildName).toBe('two');
        });

        await it('repeated and no-match writes emit nothing', () => {
            const stack = new Gtk.Stack();
            const one = new Gtk.Label();
            const two = new Gtk.Label();
            stack.add_named(one, 'one');
            stack.add_named(two, 'two');
            stack.visibleChildName = 'two';
            const seen = watch(stack);
            stack.visibleChildName = 'two';
            stack.visibleChild = two;
            stack.visibleChildName = 'missing';
            stack.visibleChild = new Gtk.Label();
            info(`seen=${seen.join('|')}`);
            expect(seen.length).toBe(0);
        });

        await it('removing the visible child clears it without notifying', () => {
            const stack = new Gtk.Stack();
            const one = new Gtk.Label();
            stack.add_named(one, 'one');
            const seen = watch(stack);
            expect(stack.remove(one)).toBe(true);
            expect(stack.visibleChild).toBe(null);
            expect(stack.visibleChildName).toBe(null);
            expect(seen.length).toBe(0);
        });

        await it('get/set_visible_child(_name) mirror the properties and notify through them', () => {
            const stack = new Gtk.Stack();
            const one = new Gtk.Label();
            const two = new Gtk.Label();
            stack.add_named(one, 'one');
            stack.add_named(two, 'two');
            const seen = watch(stack);
            stack.set_visible_child_name('two');
            expect((stack.get_visible_child() as Any) === (two as Any)).toBe(true);
            stack.set_visible_child(one);
            expect(stack.get_visible_child_name()).toBe('one');
            info(`seen=${seen.join('|')}`);
            expect(seen.join()).toBe(
                'notify::visible-child,notify::visible-child-name,notify::visible-child,notify::visible-child-name',
            );
        });
    });
};

export default gtkStackSpec;

// `Gtk.ToggleButton` — a `Gtk.Button` that stays pressed — against the platform double.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Gtk from './namespace/gtk.js';

/** A tap, as NativeScript delivers one to a `GridLayout` the button's constructor listens on. */
const tap = (button: object): void => (button as Gtk.Button).notify({ eventName: 'tap', object: button as never });

export const GtkToggleButtonNsTest = async () => {
    await describe('Gtk.ToggleButton', async () => {
        await it('is a Gtk.Button: label, icon-name, styles and clicked are all inherited', () => {
            const button = new Gtk.ToggleButton({ label: 'Sidebar' });
            expect(button instanceof Gtk.Button).toBe(true);
            expect(button.label).toBe('Sidebar');
            button.iconName = 'sidebar-show-symbolic';
            expect(button.iconName).toBe('sidebar-show-symbolic');
            button.styleClasses = 'flat';
            expect(button.styleClasses).toStrictEqual(['flat']);
        });

        await it('is inactive by default and wears `checked` only while active', () => {
            const button = new Gtk.ToggleButton();
            expect(button.active).toBe(false);
            expect(button.className).toBe('adw-button');
            button.active = true;
            expect(button.className).toBe('adw-button checked');
            button.active = false;
            expect(button.className).toBe('adw-button');
        });

        await it('`checked` is a state, not a style class: styleClasses reads back what was set', () => {
            const button = new Gtk.ToggleButton({ active: true });
            button.add_css_class('flat');
            expect(button.styleClasses).toStrictEqual(['flat']);
            expect(button.className).toBe('adw-button flat checked');
        });

        await it('emits toggled and notify::active on a change, and nothing on a repeat', () => {
            const button = new Gtk.ToggleButton();
            const seen: string[] = [];
            button.connect('toggled', () => seen.push('toggled'));
            button.connect('notify::active', () => seen.push('notify'));
            button.active = true;
            button.active = true;
            expect(seen).toStrictEqual(['toggled', 'notify']);
        });

        await it('a tap flips active BEFORE a clicked handler runs, so the handler reads the new value', () => {
            const button = new Gtk.ToggleButton();
            const seen: boolean[] = [];
            button.connect('clicked', (self: Gtk.ToggleButton) => seen.push(self.active));
            tap(button);
            tap(button);
            expect(seen).toStrictEqual([true, false]);
            expect(button.active).toBe(false);
        });

        await it('reads the string an XML attribute hands the setter — `"false"` is not truthy', () => {
            const button = build({ tag: 'GtkToggleButton', props: { active: false } }) as unknown as Gtk.ToggleButton;
            expect(button.active).toBe(false);
            const on = build({ tag: 'GtkToggleButton', props: { active: true } }) as unknown as Gtk.ToggleButton;
            expect(on.active).toBe(true);
        });

        await it('builds from a .blp: icon-name, tooltip-text and active together', () => {
            const button = build({
                tag: 'GtkToggleButton',
                id: 'sidebarToggleButton',
                props: { 'icon-name': 'sidebar-show-symbolic', 'tooltip-text': 'Toggle Sidebar', active: true },
            }) as unknown as Gtk.ToggleButton;
            expect(button.iconName).toBe('sidebar-show-symbolic');
            expect(button.tooltipText).toBe('Toggle Sidebar');
            expect(button.active).toBe(true);
        });

        await it('inherits the button child slot', () => {
            const button = build({
                tag: 'GtkToggleButton',
                children: [{ tag: 'GtkLabel', slot: 'child' }],
            }) as unknown as Gtk.ToggleButton;
            expect(button.child === null).toBe(false);
        });

        await it('group: the member that gained the link cannot be clicked off, and activating releases the others', () => {
            const a = new Gtk.ToggleButton({ label: 'A' });
            const b = new Gtk.ToggleButton({ label: 'B' });
            const c = new Gtk.ToggleButton({ label: 'C' });
            b.group = a;
            c.group = a;
            tap(b);
            expect(b.active).toBe(true);
            tap(b);
            expect(b.active).toBe(true);
            c.active = true;
            expect(b.active).toBe(false);
            expect(c.active).toBe(true);
            a.active = true;
            expect(c.active).toBe(false);
            expect(a.active).toBe(true);
        });

        await it('group: leaving releases the links, the same group twice notifies once, and a button is not its own group', () => {
            const a = new Gtk.ToggleButton();
            const b = new Gtk.ToggleButton();
            let notified = 0;
            b.addEventListener('notify::group', () => notified++);
            b.group = a;
            b.group = a;
            expect(notified).toBe(1);
            b.group = null;
            expect(notified).toBe(2);
            tap(b);
            tap(b);
            expect(b.active).toBe(false);
            const lone = new Gtk.ToggleButton();
            lone.group = lone;
            tap(lone);
            tap(lone);
            expect(lone.active).toBe(false);
        });
    });
};

export default GtkToggleButtonNsTest;

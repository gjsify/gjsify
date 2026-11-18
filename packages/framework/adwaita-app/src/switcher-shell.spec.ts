// @gjsify/adwaita-app — switcher shell: pages, wiring and the narrow breakpoint.
//
// GJS + a GTK runtime, no display. Assertions read widget properties of the real
// Adw widgets, never a rendered pixel.

import { describe, expect, it } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { createSwitcherShell } from './switcher-shell.js';

Gtk.init_check();

const pages = () => [
    { name: 'calendar', title: 'Calendar', icon: 'x-office-calendar-symbolic', widget: new Gtk.Label({ label: 'c' }) },
    { name: 'tasks', title: 'Tasks', icon: 'object-select-symbolic', widget: new Gtk.Label({ label: 't' }) },
];

export default async (): Promise<void> => {
    await describe('createSwitcherShell', async () => {
        await it('adds one titled, iconned stack page per entry, in order', async () => {
            const shell = createSwitcherShell(new Adw.ApplicationWindow(), { pages: pages() });
            const model = shell.stack.get_pages();
            expect(model.get_n_items()).toBe(2);
            const first = model.get_item(0) as Adw.ViewStackPage;
            const second = model.get_item(1) as Adw.ViewStackPage;
            expect(first.get_name()).toBe('calendar');
            expect(first.get_title()).toBe('Calendar');
            expect(first.get_icon_name()).toBe('x-office-calendar-symbolic');
            expect(second.get_name()).toBe('tasks');
        });

        await it('binds both switchers to the returned stack', async () => {
            const shell = createSwitcherShell(new Adw.ApplicationWindow(), { pages: pages() });
            expect(shell.switcher.get_stack()).toBe(shell.stack);
            expect(shell.switcherBar.get_stack()).toBe(shell.stack);
            expect(shell.headerBar.get_title_widget()).toBe(shell.switcher);
            expect(shell.toolbarView.get_content()).toBe(shell.stack);
        });

        await it('starts with the bottom bar hidden and follows the stack selection', async () => {
            const shell = createSwitcherShell(new Adw.ApplicationWindow(), { pages: pages() });
            expect(shell.switcherBar.get_reveal()).toBe(false);
            shell.stack.set_visible_child_name('tasks');
            expect(shell.stack.get_visible_child_name()).toBe('tasks');
        });

        await it('builds the narrow breakpoint below 600sp by default', async () => {
            const shell = createSwitcherShell(new Adw.ApplicationWindow(), { pages: pages() });
            expect(shell.breakpoint.get_condition()?.to_string()).toBe('max-width: 599sp');
        });

        await it('honours a custom narrow width', async () => {
            const shell = createSwitcherShell(new Adw.ApplicationWindow(), { pages: pages(), narrowWidth: 480 });
            expect(shell.breakpoint.get_condition()?.to_string()).toBe('max-width: 479sp');
        });
    });
};

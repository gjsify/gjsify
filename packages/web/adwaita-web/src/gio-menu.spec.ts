// `Gio.Menu` as an authoring door — held against the value it has to produce.
//
// THE CLAIM UNDER TEST is not "the class has methods": it is that a menu BUILT the GJS way
// and the same menu WRITTEN as an array reduce to one model, so a `menuModel` property
// cannot tell them apart. Every case below therefore asserts against
// `normalizeMenuModel(<the array a reader would have written>)` rather than against a
// hand-typed expectation — a hand-typed one would agree with whatever this file produces.
//
// Compared as JSON rather than with `toEqual`: `@gjsify/unit`'s `toEqual` is `==`, so two
// different objects pass it whatever they hold.

import { describe, expect, it } from '@gjsify/unit';
import { normalizeMenuModel } from '@gjsify/adwaita-core';

import { Menu, MenuItem } from './gio/menu.js';

/** What a `menuModel` property does with a value, on both spellings. */
const model = (value: readonly unknown[]) => JSON.stringify(normalizeMenuModel(value as never));

export const GioMenuTest = async () => {
    await describe('Gio.Menu is the array a menuModel already takes', async () => {
        await it('passes Array.isArray, which is the gate normalizeMenuModel opens on', () => {
            expect(Array.isArray(new Menu())).toBe(true);
        });

        await it('starts empty, as g_menu_new() does', () => {
            expect(new Menu().length).toBe(0);
        });
    });

    await describe('Gio.Menu.append', async () => {
        await it('builds the gallery menu the array spelling builds', () => {
            const menu = new Menu();
            menu.append('Save as…', 'app.save-as');
            menu.append('Export', 'app.export');
            menu.append('Print', 'app.print');

            expect(model(menu)).toBe(
                model([
                    { label: 'Save as…', action: 'app.save-as' },
                    { label: 'Export', action: 'app.export' },
                    { label: 'Print', action: 'app.print' },
                ]),
            );
        });

        await it('takes a label alone, the way the bare-string shorthand does', () => {
            const menu = new Menu();
            menu.append('Export');

            expect(model(menu)).toBe(model(['Export']));
        });
    });

    await describe('Gio.Menu.append_item and Gio.MenuItem', async () => {
        await it('appends an item built separately', () => {
            const menu = new Menu();
            menu.append_item(new MenuItem('Save as…', 'app.save-as'));

            expect(model(menu)).toBe(model([{ label: 'Save as…', action: 'app.save-as' }]));
        });

        await it('sets both halves after construction', () => {
            const item = new MenuItem();
            item.set_label('Print');
            item.set_detailed_action('app.print');

            expect(model([item])).toBe(model([{ label: 'Print', action: 'app.print' }]));
        });

        await it('REMOVES the attribute on null rather than carrying an undefined one', () => {
            const item = new MenuItem('Print', 'app.print');
            item.set_detailed_action(null);

            expect(Object.hasOwn(item, 'action')).toBe(false);
            expect(model([item])).toBe(model(['Print']));
        });

        await it('drops an item carrying neither half — g_menu_item_new(NULL, NULL)', () => {
            expect(model([new MenuItem()])).toBe(model([]));
        });
    });

    await describe('Gio.Menu.append_section', async () => {
        await it('produces the section LINK, not an item with a stray array', () => {
            const section = new Menu();
            section.append('Save as…', 'app.save-as');

            const menu = new Menu();
            menu.append_section(null, section);

            expect(model(menu)).toBe(model([{ section: [{ label: 'Save as…', action: 'app.save-as' }] }]));
        });

        await it('carries the heading when C would have one', () => {
            const menu = new Menu();
            menu.append_section('Document', ['Export']);

            expect(model(menu)).toBe(model([{ label: 'Document', section: ['Export'] }]));
        });

        await it('writes NO label attribute when there is none', () => {
            const menu = new Menu();
            menu.append_section(null, ['Export']);

            expect(Object.hasOwn(menu[0] as object, 'label')).toBe(false);
        });
    });

    await describe('Gio.Menu.append_submenu', async () => {
        await it('produces the submenu LINK', () => {
            const submenu = new Menu();
            submenu.append('Print', 'app.print');

            const menu = new Menu();
            menu.append_submenu('More', submenu);

            expect(model(menu)).toBe(model([{ label: 'More', submenu: [{ label: 'Print', action: 'app.print' }] }]));
        });
    });
};

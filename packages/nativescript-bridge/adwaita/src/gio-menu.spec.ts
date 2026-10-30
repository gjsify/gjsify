// `Gio.Menu` as an authoring door — held against the snapshot it has to produce.
//
// THE CLAIM UNDER TEST is not "the class has methods": it is that a menu BUILT the GJS way
// and the same menu WRITTEN as the portable tree reduce to one snapshot, so a `menuModel`
// property cannot tell them apart. Every case below therefore asserts against
// `normalizeMenuModel(<the tree a reader would have written>)` rather than against a
// hand-typed expectation — a hand-typed one would agree with whatever this file produces.
//
// WHY THE WIDGET HALF IS NOT HERE. The web port drives the `menu-model` property vectors of
// ADR 0128 in its own `gio-menu.spec.ts`, because a custom element needs no platform. This
// package cannot: every spec in `./test.mts` imports pure siblings only, and a widget module
// evaluates `@nativescript/core` at module scope (the header of `./test.trees.mts` has why
// the two entries stay apart). So `MENU_MODEL_DOOR_VECTORS` and `MENU_MODEL_NOTIFY_VECTORS`
// run from `./menu-model-door.spec.ts` under the tree entry, against the real widgets.
//
// The classes themselves live in `@gjsify/adwaita-core`; `./namespace/gio.ts` is the port's
// DOOR onto them and `./gio.spec.ts`'s sibling under the tree entry imports that barrel, so
// a barrel that stops resolving still fails in this package rather than in a consumer.
//
// Compared as JSON rather than with `toEqual`: `@gjsify/unit`'s `toEqual` is `==`, so two
// different objects pass it whatever they hold.

import { describe, expect, it } from '@gjsify/unit';
import { buildMenu, menuTree, normalizeMenuModel } from '@gjsify/adwaita-core';
import type { GioMenuModel } from '@gjsify/adwaita-core';

// From the core rather than through `./namespace/gio.js`: that barrel also holds
// `Application`, which needs `@nativescript/core`, and this pure entry cannot resolve it.
import { GioMenu as Menu, GioMenuItem as MenuItem, GioMenuModel as MenuModel } from '@gjsify/adwaita-core';

/** The snapshot a renderer reads out of a model — what every walker takes. */
const treeOf = (model: GioMenuModel) => JSON.stringify(menuTree(model));

/** The same menu written the portable way, which is what the model has to reduce to. */
const written = (tree: readonly unknown[]) => JSON.stringify(normalizeMenuModel(tree as never));

export default async () => {
    await describe('Gio.Menu is the tree a menuModel already takes', async () => {
        await it('IS a Gio.MenuModel, which is what the property is declared over', () => {
            // ADR 0128: the door is `value_type=GMenuModel`, so this `instanceof` is the
            // whole reason a menu can be assigned at all.
            expect(new Menu() instanceof MenuModel).toBe(true);
        });

        await it('starts empty, as g_menu_new() does', () => {
            expect(new Menu().get_n_items()).toBe(0);
        });
    });

    await describe('Gio.Menu.append', async () => {
        await it('builds the gallery menu the portable spelling builds', () => {
            const menu = new Menu();
            menu.append('Save as…', 'app.save-as');
            menu.append('Export', 'app.export');
            menu.append('Print', 'app.print');

            expect(treeOf(menu)).toBe(
                written([
                    { label: 'Save as…', action: 'app.save-as' },
                    { label: 'Export', action: 'app.export' },
                    { label: 'Print', action: 'app.print' },
                ]),
            );
        });

        await it('takes a label alone, the way the bare-string shorthand does', () => {
            const menu = new Menu();
            menu.append('Export');

            expect(treeOf(menu)).toBe(written(['Export']));
        });
    });

    await describe('Gio.Menu.append_item and Gio.MenuItem', async () => {
        await it('appends an item built separately', () => {
            const menu = new Menu();
            menu.append_item(new MenuItem('Save as…', 'app.save-as'));

            expect(treeOf(menu)).toBe(written([{ label: 'Save as…', action: 'app.save-as' }]));
        });

        await it('sets both halves after construction', () => {
            const item = new MenuItem();
            item.set_label('Print');
            item.set_detailed_action('app.print');

            const menu = new Menu();
            menu.append_item(item);
            expect(treeOf(menu)).toBe(written([{ label: 'Print', action: 'app.print' }]));
        });

        await it('REMOVES the attribute on null rather than carrying an undefined one', () => {
            const item = new MenuItem('Print', 'app.print');
            item.set_detailed_action(null);

            const menu = new Menu();
            menu.append_item(item);
            expect(menu.get_item_attribute_value(0, 'action', null)).toBeNull();
            expect(treeOf(menu)).toBe(written(['Print']));
        });
    });

    await describe('Gio.Menu.append_section', async () => {
        await it('produces the section LINK, not an item with a stray array', () => {
            const section = new Menu();
            section.append('Save as…', 'app.save-as');

            const menu = new Menu();
            menu.append_section(null, section);

            expect(treeOf(menu)).toBe(written([{ section: [{ label: 'Save as…', action: 'app.save-as' }] }]));
        });

        await it('carries the heading when C would have one', () => {
            const menu = new Menu();
            menu.append_section('Document', buildMenu(['Export']));

            expect(treeOf(menu)).toBe(written([{ label: 'Document', section: ['Export'] }]));
        });

        await it('writes NO label attribute when there is none', () => {
            const menu = new Menu();
            menu.append_section(null, buildMenu(['Export']));

            expect(menu.get_item_attribute_value(0, 'label', null)).toBeNull();
        });
    });

    await describe('Gio.Menu.append_submenu', async () => {
        await it('produces the submenu LINK', () => {
            const submenu = new Menu();
            submenu.append('Print', 'app.print');

            const menu = new Menu();
            menu.append_submenu('More', submenu);

            expect(treeOf(menu)).toBe(written([{ label: 'More', submenu: [{ label: 'Print', action: 'app.print' }] }]));
        });
    });
};

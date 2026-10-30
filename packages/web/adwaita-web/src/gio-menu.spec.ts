// `Gio.Menu` as an authoring door, and the `menu-model` PROPERTY the widgets expose.
//
// THE CLAIM UNDER TEST in the first half is not "the class has methods": it is that a menu
// BUILT the GJS way and the same menu WRITTEN as the portable tree reduce to one snapshot,
// so a `menuModel` property cannot tell them apart. Every case there asserts against
// `normalizeMenuModel(<the tree a reader would have written>)` rather than against a
// hand-typed expectation — a hand-typed one would agree with whatever this file produces.
//
// THE SECOND HALF IS WHAT THE CORE SPEC CANNOT DRIVE. ADR 0128 measured two of its tables on
// WIDGETS and not on the model: `MENU_MODEL_DOOR_VECTORS` (what a `menu-model` write accepts
// and the words it refuses with) and `MENU_MODEL_NOTIFY_VECTORS` (the identity guard
// `Adw.SplitButton` has and `Gtk.MenuButton` does not). Both run against BOTH widgets here,
// because a guard measured on one and applied to the other is the exact mistake the table
// exists to catch: GJS notifies once for a repeated write on the split button and twice on
// the menu button, and the asymmetry is upstream's, not a port decision.
//
// The classes themselves live in `@gjsify/adwaita-core`; what the first half drives is the
// port's own `Gio` DOOR onto them, so a barrel that stops resolving fails here rather than
// in a consumer.
//
// Compared as JSON rather than with `toEqual`: `@gjsify/unit`'s `toEqual` is `==`, so two
// different objects pass it whatever they hold.

import { describe, expect, it } from '@gjsify/unit';
import { ADW_MENU_SURFACE_WEB, buildMenu, menuTree, normalizeMenuModel } from '@gjsify/adwaita-core';
import { MENU_MODEL_DOOR_VECTORS, MENU_MODEL_NOTIFY_VECTORS } from '@gjsify/adwaita-core/conformance';
import type { MenuModelHolder, MenuModelWrite } from '@gjsify/adwaita-core/conformance';
import type { AdwMenuModel, GioMenuModel } from '@gjsify/adwaita-core';

import { Menu, MenuItem, MenuModel } from './namespace/gio.js';
import { StringList } from './namespace/gtk.js';

/** The snapshot a renderer reads out of a model — what every walker takes. */
const treeOf = (model: GioMenuModel) => JSON.stringify(menuTree(model));

/** The same menu written the portable way, which is what the model has to reduce to. */
const written = (tree: readonly unknown[]) => JSON.stringify(normalizeMenuModel(tree as never));

/** A `menu-model` holder, mounted: both widgets take the property and both are measured. */
interface MenuHolderElement extends HTMLElement {
    menuModel: AdwMenuModel | string | null;
}

const TAGS: Record<MenuModelHolder, string> = {
    'Adw.SplitButton': 'adw-split-button',
    'Gtk.MenuButton': 'gtk-menu-button',
};

function mount(widget: MenuModelHolder): MenuHolderElement {
    const el = document.createElement(TAGS[widget]) as MenuHolderElement;
    document.body.appendChild(el);
    return el;
}

function unmountAll(): void {
    for (const tag of Object.values(TAGS)) {
        for (const el of Array.from(document.querySelectorAll(tag))) el.remove();
    }
}

export const GioMenuTest = async () => {
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

    await describe('the menu-model door (ADR 0128 conformance vectors)', async () => {
        for (const widget of Object.keys(TAGS) as MenuModelHolder[]) {
            for (const vector of MENU_MODEL_DOOR_VECTORS) {
                await it(`${widget} ${vector.write}: ${vector.rule}`, () => {
                    const el = mount(widget);
                    const before = el.menuModel;

                    // The six writes the table names, built here so the refused ones are
                    // the values GJS was measured refusing, not stand-ins for them.
                    const value: unknown = {
                        menu: () => buildMenu([{ kind: 'item', label: 'Save', action: 'app.save' }]),
                        null: () => null,
                        'json-string': () => '[{"label":"Save","action":"app.save"}]',
                        array: () => [{ label: 'Save' }],
                        'plain-object': () => ({ label: 'Save' }),
                        // `Gtk.StringList` is the subset's one registered GObject that is not
                        // a menu model, so it reaches the TYPE refusal an array never gets to.
                        'wrong-gobject': () => new StringList({ strings: ['Save'] }),
                    }[vector.write]();

                    // `in` rather than `??`: a `null` under the key is MEANINGFUL — it says
                    // this surface accepts a write the shared row refuses. No row overrides
                    // THIS surface today, and reading the field anyway is the point: the
                    // NativeScript driver reads the same one, so a second row added there
                    // cannot quietly mean nothing here.
                    const override = vector.bySurface !== undefined && ADW_MENU_SURFACE_WEB.name in vector.bySurface;
                    const expected = override
                        ? (vector.bySurface as Record<string, string | null>)[ADW_MENU_SURFACE_WEB.name]
                        : vector.error;

                    if (expected === null) {
                        el.menuModel = value as AdwMenuModel | string | null;
                        if (vector.write === 'null') expect(el.menuModel).toBeNull();
                        // A real model is held BY IDENTITY; a JSON string becomes the
                        // surface's own authored model, which is a model all the same.
                        else if (vector.write === 'menu') expect(el.menuModel).toBe(value);
                        else expect(el.menuModel).not.toBeNull();
                        unmountAll();
                        return;
                    }

                    let message: string | null = null;
                    try {
                        el.menuModel = value as AdwMenuModel | string | null;
                    } catch (error) {
                        message = (error as Error).message;
                    }
                    // A shared row is matched WHOLE; a `bySurface` one is a fragment, because
                    // the full refusal names the widget class and that belongs to the caller.
                    if (override) expect(message).toContain(expected);
                    else expect(message).toBe(expected);
                    // A refusal leaves the widget holding what it held — the write never
                    // half-landed, which is what makes the throw safe to catch.
                    expect(el.menuModel).toBe(before);
                    unmountAll();
                });
            }
        }
    });

    await describe('notify::menu-model and the identity guard (ADR 0128 conformance vectors)', async () => {
        for (const vector of MENU_MODEL_NOTIFY_VECTORS) {
            const label = `${vector.widget} [${vector.writes.map((w) => w ?? 'null').join(', ')}]`;
            await it(`${label}: ${vector.rule}`, () => {
                const el = mount(vector.widget);
                // TWO DISTINCT models with EQUAL content, which is what separates an
                // identity guard from a value one: a serialisation-keyed widget would
                // report no change for the A→B write.
                const models: Record<'A' | 'B', GioMenuModel> = {
                    A: buildMenu([{ kind: 'item', label: 'Save', action: 'app.save' }]),
                    B: buildMenu([{ kind: 'item', label: 'Save', action: 'app.save' }]),
                };

                let notifies = 0;
                el.addEventListener('notify::menu-model', () => notifies++);

                const counted: number[] = [];
                const write = (name: MenuModelWrite) => {
                    notifies = 0;
                    el.menuModel = name === null ? null : models[name];
                    counted.push(notifies);
                };
                for (const name of vector.writes) write(name);

                if (vector.mutateHeldModel === true) {
                    // The last step is a MUTATION of the model the widget already holds.
                    // It is not a property change: the content arrives over
                    // `items-changed`, which is why a widget keyed on a serialisation of
                    // the model reports the wrong thing in both directions.
                    notifies = 0;
                    (el.menuModel as unknown as { append(label: string): void }).append('Export');
                    counted.push(notifies);
                }

                expect(counted).toStrictEqual([...vector.notifies]);
                unmountAll();
            });
        }
    });
};

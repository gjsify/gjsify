// The portable menu model against a REAL `Gio.Menu` (ADR 0042).
//
// The other two renderers assert the model against their own DOM and their own sheet;
// this suite is the one that can ask GIO. It drives the SAME vectors
// (`@gjsify/adwaita-core/conformance`) through `buildGioMenu` and back through
// `fromGioMenu`, so "the model maps onto Gio.Menu losslessly" is a measurement rather
// than a sentence in an ADR — and it drives the widgets themselves, so the claim that a
// declarative dialect can now write a menu is a widget that HAS one.

import Gio from 'gi://Gio?version=2.0';
// TYPE-ONLY, from `@girs/*` rather than `gi://`: it is used only to name what
// a widget is, and a runtime `gi://` import that nothing calls is a typelib this suite
// would load for nothing (the same reason `conformance/index.ts` types `Gtk` this way).
import type Adw from '@girs/adw-1';

import { describe, expect, it } from '@gjsify/unit';

import { normalizeMenuModel } from '@gjsify/adwaita-core';
import {
    MENU_DETAILED_ACTION_VECTORS,
    MENU_NORMALIZE_VECTORS,
    MENU_PARSE_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import { buildGioMenu, fromGioMenu, isPortableMenu } from './menu.js';
import { createElement, materialize, setProp } from './host.js';
import { registerBuiltinWidgets } from './descriptors/index.js';

registerBuiltinWidgets();

/** Every vector's model, deduplicated by content — the corpus this suite round-trips. */
const MODELS = [...MENU_NORMALIZE_VECTORS.map((v) => v.model), ...MENU_PARSE_VECTORS.map((v) => v.model)].filter(
    (model) => model.length > 0,
);

export default async () => {
    await describe('buildGioMenu builds a real Gio.Menu', async () => {
        await it('is a GMenuModel a GTK widget will accept', () => {
            const menu = buildGioMenu(['Save as…', 'Export']);
            expect(menu instanceof Gio.Menu).toBe(true);
            expect(menu instanceof Gio.MenuModel).toBe(true);
            expect(menu.get_n_items()).toBe(2);
        });

        await it('a section and a submenu become the LINKS GIO defines, not extra items', () => {
            const menu = buildGioMenu([
                { label: 'New' },
                { section: [{ label: 'Cut' }, { label: 'Copy' }] },
                { label: 'More', submenu: [{ label: 'Rename' }] },
            ]);
            expect(menu.get_n_items()).toBe(3);
            expect(menu.get_item_link(1, Gio.MENU_LINK_SECTION)?.get_n_items()).toBe(2);
            expect(menu.get_item_link(2, Gio.MENU_LINK_SUBMENU)?.get_n_items()).toBe(1);
            // The section link is not a submenu link and the other way round: GTK draws
            // one inline and opens the other.
            expect(menu.get_item_link(1, Gio.MENU_LINK_SUBMENU)).toBe(null);
            expect(menu.get_item_link(2, Gio.MENU_LINK_SECTION)).toBe(null);
        });

        await it('a detailed action is PARSED by GIO into an action plus its target', () => {
            const menu = buildGioMenu([{ label: 'List', action: 'app.view::list' }]);
            const action = menu.get_item_attribute_value(0, 'action', null);
            const target = menu.get_item_attribute_value(0, 'target', null);
            // The whole reason the model carries one string: GIO does the splitting, so
            // no JSON encoding for a GVariant had to be invented.
            expect(action?.get_string()[0]).toBe('app.view');
            expect(target?.get_string()[0]).toBe('list');
        });

        await it('an unread attribute survives — GMenuModel’s attribute space is open', () => {
            const menu = buildGioMenu([{ label: 'About', id: 'about' }]);
            expect(menu.get_item_attribute_value(0, 'id', null)?.get_string()[0]).toBe('about');
        });
    });

    await describe('the round trip is lossless (shared conformance vectors)', async () => {
        for (const model of MODELS) {
            await it(`survives Gio.Menu: ${JSON.stringify(model).slice(0, 90)}`, () => {
                expect(fromGioMenu(buildGioMenu(model))).toStrictEqual([...model]);
            });
        }

        await it('every attribute the model can carry, in one item', () => {
            const model = normalizeMenuModel([
                {
                    label: 'Undo',
                    action: 'app.undo::last',
                    icon: 'edit-undo-symbolic',
                    verbIcon: 'edit-undo-symbolic',
                    accel: '<Control>z',
                    hiddenWhen: 'action-disabled',
                    custom: 'undo-control',
                    useMarkup: true,
                    id: 'undo',
                },
            ]);
            expect(fromGioMenu(buildGioMenu(model))).toStrictEqual([...model]);
        });

        await it('a non-string action target takes the GVariant text form back', () => {
            const model = normalizeMenuModel([{ label: 'Zoom', action: 'win.zoom(2)' }]);
            // `2` parses as an int32, and `print(false)` writes it back as `2` — the
            // form `g_action_parse_detailed_name` reads.
            expect(fromGioMenu(buildGioMenu(model))).toStrictEqual([...model]);
        });

        await it('the two submenu attributes GTK reads and the first cut dropped', () => {
            const model = normalizeMenuModel([
                {
                    label: 'Recent',
                    submenu: [{ label: 'Report.pdf' }],
                    submenuAction: 'win.recent-shown',
                    macosSpecial: 'services',
                },
            ]);
            expect(fromGioMenu(buildGioMenu(model))).toStrictEqual([...model]);
        });

        await it('the round trip NORMALISES two spellings rather than preserving them', () => {
            // Stated, not hidden. GIO parses a detailed action on the way in and this
            // module prints it on the way out, so a quoted string target comes back in
            // the `::` form and whitespace inside `(…)` is gone. Both name the SAME
            // action to GLib — which is why they are normalisations and not losses — but
            // a byte-for-byte round trip they are not.
            expect(fromGioMenu(buildGioMenu([{ label: 'List', action: "app.view('list')" }]))).toStrictEqual([
                { kind: 'item', label: 'List', action: 'app.view::list' },
            ]);
            expect(fromGioMenu(buildGioMenu([{ label: 'Zoom', action: 'win.zoom( 2 )' }]))).toStrictEqual([
                { kind: 'item', label: 'Zoom', action: 'win.zoom(2)' },
            ]);
        });
    });

    await describe('GIO is the authority on a detailed action name (shared conformance vectors)', async () => {
        // THE DRIVE THE FIRST CUT WAS MISSING. `MENU_DETAILED_ACTION_VECTORS` is a
        // splitter table, and the splitter never throws — so a row declaring `'app.x('`
        // was read as "legal" while nothing handed it to GIO, which answers a malformed
        // name with `g_error()`: SIGABRT, exit 134, uncatchable. Seven of these eleven
        // rows killed the process before `requireDetailedAction` existed.
        for (const { detailed, gioValid, rule } of MENU_DETAILED_ACTION_VECTORS) {
            await it(`${JSON.stringify(detailed)} is ${gioValid ? 'built' : 'REFUSED'} — ${rule}`, () => {
                const build = () => buildGioMenu([{ label: 'x', action: detailed }]);
                if (!gioValid) {
                    // The MESSAGE, not the code: `toThrow` matches text, and the text is
                    // what a consumer reads out of an uncaught render.
                    expect(build).toThrow('GIO cannot parse');
                    return;
                }
                const menu = build();
                expect(menu.get_item_attribute_value(0, 'action', null)).not.toBe(null);
            });
        }

        await it('the refusal names the item and the string, and survives a nested position', () => {
            expect(() => buildGioMenu([{ section: [{ label: 'Quit', action: 'app.x(' }] }])).toThrow('Quit');
            expect(() => buildGioMenu([{ label: 'More', submenu: [{ label: 'Q', action: 'app.a b' }] }])).toThrow(
                'app.a b',
            );
        });
    });

    await describe('isPortableMenu tells a model from a GMenuModel', async () => {
        await it('an array is a model; a Gio.Menu is not', () => {
            expect(isPortableMenu([])).toBe(true);
            expect(isPortableMenu([{ label: 'x' }])).toBe(true);
            expect(isPortableMenu(new Gio.Menu())).toBe(false);
            expect(isPortableMenu(null)).toBe(false);
        });
    });

    await describe('the widgets take it (the whole point of ADR 0042)', async () => {
        for (const [tag, gtype] of [
            ['adw-split-button', 'AdwSplitButton'],
            ['gtk-menu-button', 'GtkMenuButton'],
            ['gtk-popover-menu', 'GtkPopoverMenu'],
        ] as const) {
            await it(`<${tag} menuModel={[…]}> reaches ${gtype} as a real GMenuModel`, () => {
                const el = createElement(tag);
                setProp(el, 'menuModel', [
                    { label: 'Save as…', action: 'app.save-as' },
                    { section: [{ label: 'Export', action: 'app.export' }] },
                ]);
                materialize(el);
                const widget = el.widget as unknown as { menuModel: Gio.MenuModel | null };
                expect(widget.menuModel instanceof Gio.MenuModel).toBe(true);
                // Two top-level items: the command and the section LINK.
                expect(widget.menuModel?.get_n_items()).toBe(2);
                // And it is the menu that was written, not a menu that merely exists.
                expect(fromGioMenu(widget.menuModel as Gio.MenuModel)).toStrictEqual([
                    { kind: 'item', label: 'Save as…', action: 'app.save-as' },
                    { kind: 'section', items: [{ kind: 'item', label: 'Export', action: 'app.export' }] },
                ]);
            });
        }

        await it('a real Gio.MenuModel still passes straight through', () => {
            // The imperative path every existing GJS application uses. `coerce` must not
            // touch it — an array is the ONLY thing the portable branch claims.
            const menu = new Gio.Menu();
            menu.append('Print', 'app.print');
            const el = createElement('adw-split-button');
            setProp(el, 'menuModel', menu);
            materialize(el);
            expect((el.widget as unknown as { menuModel: Gio.MenuModel }).menuModel).toBe(menu);
        });

        await it('the split button’s dropdown goes live, which is what a reader sees', () => {
            const el = createElement('adw-split-button');
            setProp(el, 'label', 'Save');
            materialize(el);
            const button = el.widget as unknown as Adw.SplitButton;
            // `if (self->menu_model == NULL) the dropdown is disabled`
            // (adw-split-button.c:376-378) — so this is the ONE observable that says the
            // menu arrived rather than merely being stored.
            expect(button.get_menu_model()).toBe(null);
            setProp(el, 'menuModel', ['Save as…', 'Export']);
            expect(button.get_menu_model()?.get_n_items()).toBe(2);
        });
    });
};

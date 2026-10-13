// The GTK properties whose name a NativeScript base already owns (ADR 0112,
// `widgets/shadowed-properties.ts`), held through every door that is not the JS accessor: the
// verbs, `get_property` / `set_property`, `notify::`, the construct bag and a Blueprint tree as
// `@gjsify/vite-plugin-blueprint` hands it over (kebab-case keys, enum NICKS as strings). Each
// case also reads the platform member of the same name, because the whole point of the rule is
// that the GTK write never lands there.
//
// On the TREES entry (`src/test.trees.mts`): it builds the port's real widget classes.

import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import { AdwDataGrid } from './widgets/adw-data-grid.js';
import type { AdwSplitButton } from './widgets/adw-split-button.js';
import { splitButtonArrowSvg } from './widgets/split-button.js';
import { SHADOWED_PROPERTIES, writeGtkProperty } from './widgets/shadowed-properties.js';

/** The arrow image the split button paints, read the way `_render` writes it. */
const arrowOf = (button: AdwSplitButton): string =>
    (button as unknown as { _chevron: { iconName: string } })._chevron.iconName;

/** NativeScript's layout direction on `view`: neither the CSS style nor an own `direction`. */
function expectLayoutDirectionUntouched(view: object): void {
    expect((view as { style: { direction?: unknown } }).style.direction ?? null).toBe(null);
    expect(Object.hasOwn(view, 'direction')).toBe(false);
}

export const AdwShadowedPropertiesNsTest = async () => {
    await describe('AdwSplitButton.direction: the arrow, never the layout direction', async () => {
        await it('set_direction(Gtk.ArrowType.UP) turns the arrow and reads back as the constant', () => {
            const button = new Adw.SplitButton();
            expect(button.get_direction()).toBe(Gtk.ArrowType.DOWN);

            button.set_direction(Gtk.ArrowType.UP);

            expect(button.get_direction()).toBe(Gtk.ArrowType.UP);
            expect(arrowOf(button)).toBe(splitButtonArrowSvg('up'));
            expectLayoutDirectionUntouched(button);
        });

        await it('a Blueprint `direction: up` reaches set_direction, not the platform member', () => {
            const button = build({
                tag: 'AdwSplitButton',
                props: { label: 'Open', direction: 'up' },
            }) as unknown as AdwSplitButton;

            expect(button.get_direction()).toBe(Gtk.ArrowType.UP);
            expect(arrowOf(button)).toBe(splitButtonArrowSvg('up'));
            expectLayoutDirectionUntouched(button);
        });

        await it('emits notify::direction once per move, and not for a write that changes nothing', () => {
            const button = new Adw.SplitButton();
            const seen: unknown[] = [];
            button.connect('notify::direction', (self) => seen.push(self.get_direction()));

            button.set_direction(Gtk.ArrowType.LEFT);
            button.set_direction(Gtk.ArrowType.LEFT);

            expect(seen).toStrictEqual([Gtk.ArrowType.LEFT]);
        });

        await it('get_property / set_property take the GTK name through the verbs', () => {
            const button = new Adw.SplitButton();

            button.set_property('direction', Gtk.ArrowType.RIGHT);

            expect(button.get_property('direction')).toBe(Gtk.ArrowType.RIGHT);
            expect(arrowOf(button)).toBe(splitButtonArrowSvg('right'));
            expectLayoutDirectionUntouched(button);
        });

        await it('the construct bag routes `direction` to set_direction', () => {
            const button = new Adw.SplitButton({ direction: Gtk.ArrowType.UP });

            expect(button.get_direction()).toBe(Gtk.ArrowType.UP);
            expectLayoutDirectionUntouched(button);
        });

        await it('refuses a value that is no Gtk.ArrowType, as GJS does', () => {
            expect(() => new Adw.SplitButton().set_direction(42)).toThrow();
        });
    });

    await describe('AdwBottomSheet.modal: the scrim flag, never the modal parent', async () => {
        await it('set_modal / the construct bag / set_property agree, and View.modal stays the platform getter', () => {
            const sheet = new Adw.BottomSheet({ modal: false });
            expect(sheet.get_modal()).toBe(false);

            sheet.set_property('modal', true);

            expect(sheet.get_modal()).toBe(true);
            expect(sheet.get_property('modal')).toBe(true);
            expect(Object.hasOwn(sheet, 'modal')).toBe(false);
        });
    });

    await describe('AdwDataGrid rows / columns: the data, never the track specs', async () => {
        await it('set_columns / set_rows carry the data and get_ reads it back', () => {
            const grid = new AdwDataGrid();

            grid.set_columns([{ key: 'name' }, { key: 'amount', numeric: true }]);
            grid.set_rows([{ name: 'a', amount: '1' }]);

            expect(grid.get_columns().map((column) => column.key)).toStrictEqual(['name', 'amount']);
            expect(grid.get_rows()).toStrictEqual([{ name: 'a', amount: '1' }]);
            expect(Object.hasOwn(grid, 'rows')).toBe(false);
            expect(Object.hasOwn(grid, 'columns')).toBe(false);
        });
    });

    await describe('a shadowed name the port does not implement is refused by name', async () => {
        await it('`modal` on a Gtk.Window', () => {
            expect(SHADOWED_PROPERTIES.modal.refused).toContain('GtkWindow');
            expect(() => writeGtkProperty(new Gtk.Window(), 'modal', true)).toThrow();
        });

        await it('`css-classes` in a tree, rather than replacing ViewBase.cssClasses', () => {
            expect(() =>
                build({ tag: 'GtkBox', children: [{ tag: 'GtkLabel', props: { 'css-classes': 'title' } }] }),
            ).toThrow();
        });
    });
};

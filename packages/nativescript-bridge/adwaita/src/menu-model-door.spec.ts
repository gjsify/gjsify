// The `menu-model` PROPERTY of ADR 0128, on this port's real widgets.
//
// TWO OF THE ADR'S TABLES WERE MEASURED ON WIDGETS AND NOT ON THE MODEL, so neither the core
// suite nor this package's pure `./gio-menu.spec.ts` can drive them:
//
//   * `MENU_MODEL_DOOR_VECTORS` — what a `menuModel` write accepts, and the words it refuses
//     with. One row answers differently HERE: the browser parses a JSON string, because an
//     authored `menu-model="[…]"` attribute is text by the time an element sees it, while
//     NativeScript's XML Builder writes an attribute straight onto the property and ADR 0042
//     kept that door shut. That is the `bySurface` field, and reading it is the whole reason
//     the same table can be held against two surfaces at all.
//   * `MENU_MODEL_NOTIFY_VECTORS` — the identity guard `Adw.SplitButton` has and
//     `Gtk.MenuButton` does not. Measured in GJS as `notify::menu-model`; here it arrives as
//     NativeScript's `menuModelChange`, which `notifyPropertyChange` emits. Both widgets run
//     every row, because a guard measured on one and applied to the other is the exact
//     mistake the table exists to catch.
//
// IT LIVES UNDER `./test.trees.mts` for the reason that entry exists: a widget module
// evaluates `@nativescript/core` at module scope, and only the tree bundles alias that onto
// `./testing/ns-core.mjs`.
//
// NOTHING IS SHOWN. Every case here is an ASSIGNMENT, and a `PopupMenu` is only built when a
// tap opens one (`./popup-menu-widgets.spec.ts` drives that half against a recording
// surface). What a refused write must leave behind is therefore checkable without a platform
// at all: the widget still holds what it held.

import { describe, expect, it } from '@gjsify/unit';
import { buildMenu } from '@gjsify/adwaita-core';
import { MENU_MODEL_DOOR_VECTORS, MENU_MODEL_NOTIFY_VECTORS } from '@gjsify/adwaita-core/conformance';
import type { MenuModelHolder, MenuModelWrite } from '@gjsify/adwaita-core/conformance';
import type { AdwMenuModel, GioMenuModel } from '@gjsify/adwaita-core';

import * as Adw from './namespace/adw.js';
import type * as Gio from './namespace/gio.js';
import * as Gtk from './namespace/gtk.js';

/** The surface this file answers for, as `MenuModelDoorVector.bySurface` keys it. */
const SURFACE = 'nativescript';

/** A `menuModel` holder — both widgets the table names, and both are measured. */
interface MenuHolder {
    menuModel: AdwMenuModel | null;
    addEventListener(eventName: string, callback: () => void): void;
}

const HOLDERS: Record<MenuModelHolder, () => MenuHolder> = {
    'Adw.SplitButton': () => new Adw.SplitButton({ label: 'Save' }) as unknown as MenuHolder,
    'Gtk.MenuButton': () => new Gtk.MenuButton() as unknown as MenuHolder,
};

export const MenuModelDoorNsTest = async () => {
    await describe('the menuModel door (ADR 0128 conformance vectors)', async () => {
        for (const widget of Object.keys(HOLDERS) as MenuModelHolder[]) {
            for (const vector of MENU_MODEL_DOOR_VECTORS) {
                await it(`${widget} ${vector.write}: ${vector.rule}`, () => {
                    const holder = HOLDERS[widget]();
                    const before = holder.menuModel;

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
                        'wrong-gobject': () => new Gtk.StringList({ strings: ['Save'] }),
                    }[vector.write]();

                    // `in` rather than `??`: a `null` under the key is MEANINGFUL — it says
                    // this surface accepts a write the shared row refuses.
                    const override = vector.bySurface !== undefined && SURFACE in vector.bySurface;
                    const expected = override
                        ? (vector.bySurface as Record<string, string | null>)[SURFACE]
                        : vector.error;

                    if (expected === null) {
                        holder.menuModel = value as AdwMenuModel | null;
                        if (vector.write === 'null') expect(holder.menuModel).toBeNull();
                        // A real model is held BY IDENTITY: there is no authored door here to
                        // turn a write into some other model.
                        else expect(holder.menuModel).toBe(value);
                        return;
                    }

                    let message: string | null = null;
                    try {
                        holder.menuModel = value as AdwMenuModel | null;
                    } catch (error) {
                        message = (error as Error).message;
                    }
                    // A shared row is matched WHOLE; a `bySurface` one is a fragment, because
                    // the full refusal names the widget class and that belongs to the caller.
                    if (override) expect(message).toContain(expected);
                    else expect(message).toBe(expected);
                    // A refusal leaves the widget holding what it held — the write never
                    // half-landed, which is what makes the throw safe to catch.
                    expect(holder.menuModel).toBe(before);
                });
            }
        }
    });

    await describe('menuModelChange and the identity guard (ADR 0128 conformance vectors)', async () => {
        for (const vector of MENU_MODEL_NOTIFY_VECTORS) {
            const label = `${vector.widget} [${vector.writes.map((w) => w ?? 'null').join(', ')}]`;
            await it(`${label}: ${vector.rule}`, () => {
                const holder = HOLDERS[vector.widget]();
                // TWO DISTINCT models with EQUAL content, which is what separates an
                // identity guard from a value one: a serialisation-keyed widget would
                // report no change for the A→B write.
                const models: Record<'A' | 'B', GioMenuModel> = {
                    A: buildMenu([{ kind: 'item', label: 'Save', action: 'app.save' }]),
                    B: buildMenu([{ kind: 'item', label: 'Save', action: 'app.save' }]),
                };

                let notifies = 0;
                holder.addEventListener('menuModelChange', () => notifies++);

                const counted: number[] = [];
                const write = (name: MenuModelWrite) => {
                    notifies = 0;
                    holder.menuModel = name === null ? null : models[name];
                    counted.push(notifies);
                };
                for (const name of vector.writes) write(name);

                if (vector.mutateHeldModel === true) {
                    // The last step is a MUTATION of the model the widget already holds.
                    // It is not a property change: the content arrives over
                    // `items-changed`, which is why a widget keyed on a serialisation of
                    // the model reports the wrong thing in both directions.
                    notifies = 0;
                    (holder.menuModel as Gio.Menu).append('Export');
                    counted.push(notifies);
                }

                expect(counted).toStrictEqual([...vector.notifies]);
            });
        }
    });
};

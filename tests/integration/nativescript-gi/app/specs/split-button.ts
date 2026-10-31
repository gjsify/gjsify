// `Adw.SplitButton` ON A DEVICE (ADR 0105 § 2, route D): `clicked` and `activate` are declared
// signals; `label`, `icon-name` (strings), `use-underline`, `can-shrink` (booleans),
// `dropdown-tooltip` (string) and `menu-model` (object) are declared properties. Both legs run
// the same vectors, so a difference is a defect in whichever engine disagrees. See
// `specs/button.ts` and `specs/button-content.ts` for the shapes this copies, and
// `specs/combo-row.ts` for what a device run can say about a seam-owned OBJECT property.
import { Adw } from '@gjsify/adwaita-nativescript';
import { buildMenu } from '@gjsify/adwaita-core';
import { GestureTypes } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** How many rows the slot currently holds — the dropdown the model built. */
const rowsOf = (button: Adw.SplitButton): number => (button as Any)._slot.tree.length;

// A finger reaches the action half through the gesture observer `addEventListener('tap')` builds.
const tapAction = (button: Adw.SplitButton): void => {
    const part = (button as Any)._actionPart;
    const observers = (part.getGestureObservers(GestureTypes.tap) ?? []) as Any[];
    for (const observer of observers) {
        observer.callback({ eventName: 'tap', object: part, view: part, type: GestureTypes.tap });
    }
};

export const splitButtonSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Adw.SplitButton on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('a tap emits clicked exactly once; activate does the same', () => {
            const button = new Adw.SplitButton({ label: 'Go' });
            let runs = 0;
            let ownSelf = true;
            button.connect('clicked', (self: Any) => {
                runs++;
                ownSelf = ownSelf && self === button;
            });
            tapAction(button);
            expect(runs).toBe(1);
            button.emit('activate');
            expect(runs).toBe(2);
            button.emit('clicked');
            expect(runs).toBe(3);
            expect(ownSelf).toBe(true);
        });

        await it('the declared events are not reachable through the NativeScript door', () => {
            const button = new Adw.SplitButton();
            for (const eventName of ['clicked', 'activate']) {
                expect(() => (button as Any).on(eventName, () => {})).toThrow();
                expect(() => (button as Any).addEventListener(eventName, () => {})).toThrow();
                expect(() => (button as Any).notify({ eventName, object: button })).toThrow();
            }
        });

        await it('starts at the C defaults', () => {
            const button = new Adw.SplitButton();
            expect(button.label).toBe(null);
            expect(button.iconName).toBe(null);
            expect(button.useUnderline).toBe(false);
            expect(button.canShrink).toBe(false);
            expect(button.dropdownTooltip).toBe('');
        });

        await it('notifies each property on a change only; the icon replaces the label', () => {
            const button = new Adw.SplitButton();
            const seen: string[] = [];
            for (const name of ['label', 'icon-name', 'use-underline', 'can-shrink', 'dropdown-tooltip']) {
                button.connect(`notify::${name}`, () => seen.push(name));
            }
            button.label = 'Save';
            button.label = 'Save';
            button.useUnderline = true;
            button.canShrink = true;
            button.canShrink = true;
            button.dropdownTooltip = 'More';
            button.dropdownTooltip = 'More';
            button.iconName = 'folder-symbolic';
            info(`seen=[${seen.join(',')}]`);
            // `icon-name` BEFORE the `label` it clears — the measured order of
            // `SPLIT_BUTTON_CONTENT_VECTORS`, which the off-device spec drives. The line used to
            // read the two the other way round and matched NEITHER leg: route D never called
            // `afterNotify`, so Android emitted no `label` at all here and this expectation could
            // not have been green on either engine. The seam calls it on both legs now.
            expect(seen.join()).toBe('label,use-underline,can-shrink,dropdown-tooltip,icon-name,label');
            expect(button.label).toBe(null);
            expect(button.iconName).toBe('folder-symbolic');
        });

        await it('coerces XML strings to the declared type', () => {
            const button = new Adw.SplitButton();
            (button as Any).useUnderline = 'true';
            (button as Any).canShrink = 'false';
            expect(button.useUnderline).toBe(true);
            expect(button.canShrink).toBe(false);
        });

        await it('holds the menu model BY IDENTITY, in all three spellings', () => {
            // Seam-owned like `Adw.ComboRow:model`: the pspec over `GMenuModel` is real on this
            // leg, but the value never enters the GObject, so the object that comes back is the
            // one that went in rather than a copy node-gi marshalled.
            const button = new Adw.SplitButton({ label: 'Save' });
            expect(button.menuModel).toBe(null);
            const model = buildMenu(['Save as…']);
            button.menuModel = model;
            expect((button as Any)['menu-model'] === model).toBe(true);
            expect((button as Any).menu_model === model).toBe(true);
            expect(button.menuModel === model).toBe(true);
        });

        await it('notifies menu-model on a CHANGE only — the measured C behaviour', () => {
            // `Adw.SplitButton` guards by identity where `Gtk.MenuButton` does not (measured:
            // 1,0,1,1,0 for A, A, B, null, null). The seam's own identity check is that guard,
            // so this widget declares no `changed` hook.
            const button = new Adw.SplitButton({ label: 'Save' });
            const seen: string[] = [];
            button.connect('notify::menu-model', () => seen.push('menu-model'));
            const a = buildMenu(['Save as…']);
            const b = buildMenu(['Export', 'Print']);
            button.menuModel = a;
            button.menuModel = a;
            button.menuModel = b;
            button.menuModel = null;
            button.menuModel = null;
            info(`seen=${seen.length}`);
            expect(seen.length).toBe(3);
        });

        await it('notifies LAST, so a handler sees the dropdown already rebuilt', () => {
            // What `explicitNotify: true` is for (pspec flags=1073742051, G_PARAM_EXPLICIT_NOTIFY):
            // C swaps the model, rebuilds the popover and only then notifies. Left to the seam the
            // emission would come first and the read below would be the PREVIOUS dropdown.
            const button = new Adw.SplitButton({ label: 'Save' });
            const rows: number[] = [];
            button.connect('notify::menu-model', () => rows.push(rowsOf(button)));
            button.menuModel = buildMenu(['Save as…', 'Export']);
            button.menuModel = null;
            info(`rows=[${rows.join(',')}]`);
            expect(rows.join()).toBe('2,0');
        });

        await it('re-snapshots a mutation of the held model, without notifying', () => {
            const button = new Adw.SplitButton({ label: 'Save' });
            const model = buildMenu(['Save as…']);
            button.menuModel = model;
            let seen = 0;
            button.connect('notify::menu-model', () => seen++);
            model.append('Export');
            expect(rowsOf(button)).toBe(2);
            expect(seen).toBe(0);
        });

        await it('refuses a string and a non-model, and shuts the NativeScript door', () => {
            // The XML door stays closed: `menuModel="app-menu"` in a template would otherwise
            // install a string where a `GMenuModel` belongs.
            const button = new Adw.SplitButton();
            expect(() => ((button as Any).menuModel = 'app-menu')).toThrow();
            expect(() => ((button as Any)['menu-model'] = {})).toThrow();
            expect(button.menuModel).toBe(null);
            expect(() => (button as Any).notify({ eventName: 'notify::menu-model', object: button })).toThrow();
        });
    });
};

export default splitButtonSpec;

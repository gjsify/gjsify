// `Adw.SplitButton` ON A DEVICE (ADR 0105 § 2, route D): `clicked` and `activate` are declared
// signals; `label`, `icon-name` (strings), `use-underline`, `can-shrink` (booleans) and
// `dropdown-tooltip` (string) are declared properties. Both legs run the same vectors, so a
// difference is a defect in whichever engine disagrees. See `specs/button.ts` and
// `specs/button-content.ts` for the shapes this copies.
import { Adw } from '@gjsify/adwaita-nativescript';
import { GestureTypes } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

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
            expect(seen.join()).toBe('label,use-underline,can-shrink,dropdown-tooltip,label,icon-name');
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
    });
};

export default splitButtonSpec;

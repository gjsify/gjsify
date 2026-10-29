// `Adw.SplitButton`'S `clicked` / `activate` SIGNALS AND CONTENT PROPERTIES AS DECLARED GObject
// MEMBERS, measured on the pure-JS leg (ADR 0105 § 2, route D).
//
// The action half used to dispatch `clicked` as a NativeScript event and keep `label` / `iconName`
// in a headless state machine that emitted nothing. They are declared now, so on Android with the
// real engine they are a registered GType and here, on iOS and in the browser, the seam's own
// store. `tests/integration/nativescript-gi/app/specs/split-button.ts` runs the same cases on a
// device.
//
// The content vectors are the SHARED ones (`SPLIT_BUTTON_CONTENT_VECTORS`), driven against the
// widget. `child` is not a property of this port, so each sequence stops at its first `child` step
// and `child` is filtered out of the expected notifications. `direction` and the object-typed
// properties are not declared (open-todos/nativescript.md), so nothing here claims them.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends GridLayout` evaluates
// `@nativescript/core` at module scope, reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';
import { SPLIT_BUTTON_CONTENT_VECTORS } from '@gjsify/adwaita-core/conformance';

import * as Adw from './namespace/adw.js';
import { emittedSignalsOf } from './widgets/signals.js';

interface SplitParts {
    _actionPart: { notify(data: { eventName: string; object: unknown }): void };
    _actionLabel: { text: string; className: string };
    _actionIcon: { iconName: string };
}

const partsOf = (button: Adw.SplitButton): SplitParts => button as unknown as SplitParts;

const tap = (button: Adw.SplitButton): void => {
    const part = partsOf(button)._actionPart;
    part.notify({ eventName: 'tap', object: part });
};

const loose = (button: Adw.SplitButton): Record<string, unknown> => button as unknown as Record<string, unknown>;

/** Record the `notify::` names a button emits, minus the ones this port has no property for. */
function watch(button: Adw.SplitButton): string[] {
    const seen: string[] = [];
    for (const name of ['label', 'icon-name', 'use-underline', 'can-shrink', 'dropdown-tooltip']) {
        button.connect(`notify::${name}`, () => seen.push(name));
    }
    return seen;
}

export const AdwSplitButtonPropertiesNsTest = async () => {
    await describe('Adw.SplitButton: clicked and activate are declared signals', async () => {
        await it('declares both', () => {
            const signals = emittedSignalsOf(Adw.SplitButton);
            expect(signals.includes('clicked')).toBe(true);
            expect(signals.includes('activate')).toBe(true);
        });

        await it('a tap on the action half runs each handler exactly once', () => {
            const button = new Adw.SplitButton({ label: 'Save' });
            let first = 0;
            let second = 0;
            button.connect('clicked', () => first++);
            button.connect('clicked', () => second++);
            tap(button);
            expect([first, second]).toStrictEqual([1, 1]);
        });

        await it('an insensitive button emits nothing on a tap', () => {
            const button = new Adw.SplitButton({ label: 'Save' });
            let runs = 0;
            button.connect('clicked', () => runs++);
            button.sensitive = false;
            tap(button);
            expect(runs).toBe(0);
        });

        await it('emit(clicked) from code runs the handlers, and a disconnect stops them', () => {
            const button = new Adw.SplitButton();
            let runs = 0;
            const id = button.connect('clicked', () => runs++);
            button.emit('clicked');
            expect(runs).toBe(1);
            button.disconnect(id);
            button.emit('clicked');
            tap(button);
            expect(runs).toBe(1);
        });

        await it('activate runs the action half once, as the C activate_cb does', () => {
            const button = new Adw.SplitButton();
            let clicked = 0;
            let activated = 0;
            button.connect('clicked', () => clicked++);
            button.connect('activate', () => activated++);
            button.emit('activate');
            expect([activated, clicked]).toStrictEqual([1, 1]);
        });

        await it('is GObject-only: the NativeScript verbs refuse both by name', () => {
            const button = new Adw.SplitButton();
            const listener = (): void => {};
            for (const eventName of ['clicked', 'activate']) {
                expect(() => button.addEventListener(eventName, listener)).toThrow();
                expect(() => button.notify({ eventName, object: button as never })).toThrow();
            }
        });
    });

    await describe('Adw.SplitButton content (shared conformance vectors)', async () => {
        for (const vector of SPLIT_BUTTON_CONTENT_VECTORS) {
            await it(`notifies and holds through: ${vector.name}`, () => {
                const button = new Adw.SplitButton();
                const seen = watch(button);

                for (const step of vector.steps) {
                    if (step.op === 'child') break;
                    seen.length = 0;
                    // No `child` property on this surface: the internal GtkLabel/GtkImage the C
                    // notifies has no counterpart here, so what is left of each sequence is the
                    // own property and the sibling slot it cleared — IN THAT ORDER.
                    const expected = step.notified.filter((name) => name !== 'child');

                    if (step.op === 'label') button.label = step.value ?? '';
                    else button.iconName = step.value ?? '';

                    expect(seen.join()).toBe(expected.join());
                    expect(button.label).toBe(step.label);
                    expect(button.iconName).toBe(step.iconName);
                }
            });
        }
    });

    await describe('Adw.SplitButton properties on the pure-JS engine', async () => {
        await it("starts at adw_split_button_init's defaults, having emitted nothing", () => {
            const button = new Adw.SplitButton();
            const seen = watch(button);
            expect(button.label).toBe(null);
            expect(button.iconName).toBe(null);
            expect(button.useUnderline).toBe(false);
            expect(button.canShrink).toBe(false);
            expect(button.dropdownTooltip).toBe('');
            expect(seen.length).toBe(0);
        });

        await it('answers each property in all three GObject spellings', () => {
            const button = new Adw.SplitButton();
            button.iconName = 'folder-symbolic';
            button.useUnderline = true;
            button.canShrink = true;
            button.dropdownTooltip = 'More';
            const props = loose(button);
            expect(props['icon-name']).toBe('folder-symbolic');
            expect(props.icon_name).toBe('folder-symbolic');
            expect(props['use-underline']).toBe(true);
            expect(props['can-shrink']).toBe(true);
            expect(props['dropdown-tooltip']).toBe('More');
        });

        await it('the three scalar properties notify on a change and on nothing else', () => {
            const button = new Adw.SplitButton();
            const seen = watch(button);
            button.useUnderline = true;
            button.useUnderline = true;
            button.canShrink = true;
            button.canShrink = true;
            // A read materialises the default, so the default-equal write below is no change.
            expect(button.dropdownTooltip).toBe('');
            button.dropdownTooltip = '';
            button.dropdownTooltip = 'More';
            button.dropdownTooltip = 'More';
            expect(seen).toStrictEqual(['use-underline', 'can-shrink', 'dropdown-tooltip']);
        });

        await it('a null label or icon-name is refused as GJS refuses it: nothing changes, nothing is emitted', () => {
            const button = new Adw.SplitButton({ label: 'Save' });
            const seen = watch(button);
            loose(button).label = null;
            loose(button)['icon-name'] = null;
            expect(button.label).toBe('Save');
            expect(button.iconName).toBe(null);
            expect(seen.length).toBe(0);
        });

        await it('a construct bag that names both keeps the one written last', () => {
            expect(new Adw.SplitButton({ iconName: 'x-symbolic', label: 'Open' }).iconName).toBe(null);
            expect(new Adw.SplitButton({ label: 'Open', iconName: 'x-symbolic' }).label).toBe(null);
        });

        await it('renders each half from its own notify, swapping the parented view', () => {
            const button = new Adw.SplitButton();
            const parts = partsOf(button);
            button.label = 'Save';
            expect(parts._actionLabel.text).toBe('Save');
            button.useUnderline = true;
            button.label = '_Save';
            expect(parts._actionLabel.text).toBe('Save');
            button.iconName = 'folder-symbolic';
            expect(parts._actionIcon.iconName).toBe('folder-symbolic');
            button.canShrink = true;
            expect(parts._actionLabel.className.split(/\s+/).includes('can-shrink')).toBe(true);
            button.canShrink = false;
            expect(parts._actionLabel.className.split(/\s+/).includes('can-shrink')).toBe(false);
        });

        await it('A/B: coerces XML strings to the declared type, and refuses what is neither', () => {
            const button = new Adw.SplitButton();
            loose(button).useUnderline = 'true';
            loose(button).canShrink = 'TRUE';
            expect(button.useUnderline).toBe(true);
            expect(button.canShrink).toBe(true);
            expect(() => {
                loose(button).useUnderline = 'maybe';
            }).toThrow();
            expect(button.useUnderline).toBe(true);
        });
    });
};

// `Gtk.MenuButton`'S `menu-model` AS A DECLARED GObject MEMBER, measured on the pure-JS leg
// (ADR 0105 § 2, route D).
//
// The TWIN of the `menu-model` block in `./split-button-properties.spec.ts`, and deliberately so:
// the two widgets share one slot (`widgets/menu-slot.ts`) behind two declarations that differ in
// exactly one hook — `changed: () => true` here, because `Gtk.MenuButton` has NO identity guard
// where `Adw.SplitButton` does. A copy that drifts is only caught if both are driven, so both are.
//
// WHAT IS NOT HERE: the measured notify counts. They are the ADR 0128 conformance table and run
// against BOTH widgets in `./menu-model-door.spec.ts`, which is also where the refusal wording is
// held. What is left for this file is what belongs to the declaration itself — the three
// spellings, the emission list, the GIR verbs that survived the migration, and the NativeScript
// verbs that no longer answer.
//
// `tests/integration/nativescript-gi/app/specs/menu-button.ts` runs the same cases on a device,
// where the property is a real ParamSpec over `GMenuModel` rather than the seam's own store.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends AdwImageButton` reaches
// `@nativescript/core` at module scope, resolvable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';
import { buildMenu } from '@gjsify/adwaita-core';

import * as Gtk from './namespace/gtk.js';
import { emittedSignalsOf } from './widgets/signals.js';

const loose = (button: Gtk.MenuButton): Record<string, unknown> => button as unknown as Record<string, unknown>;

const treeOf = (button: Gtk.MenuButton): readonly unknown[] =>
    (button as unknown as { _slot: { tree: readonly unknown[] } })._slot.tree;

/** Count every `notify::menu-model` the button emits. */
function watch(button: Gtk.MenuButton): () => number {
    let seen = 0;
    button.connect('notify::menu-model', () => seen++);
    return () => seen;
}

export const GtkMenuButtonPropertiesNsTest = async () => {
    await describe('Gtk.MenuButton:menu-model is a declared object property', async () => {
        await it('starts null, having emitted nothing', () => {
            const button = new Gtk.MenuButton();
            const seen = watch(button);
            expect(button.menuModel).toBe(null);
            expect(seen()).toBe(0);
        });

        await it('answers all three GObject spellings', () => {
            const button = new Gtk.MenuButton();
            const model = buildMenu(['About', 'Quit']);
            button.menuModel = model;
            const props = loose(button);
            expect(props['menu-model']).toBe(model);
            expect(props.menu_model).toBe(model);
            expect(props.menuModel).toBe(model);
        });

        await it('writes through every spelling, the GIR verbs included', () => {
            // The verbs are hand-written and stayed that way: C has them, and the seam declares
            // properties rather than methods. They go through the declared accessor, so they
            // notify like a write — which is what the assertion below is for.
            const button = new Gtk.MenuButton();
            const seen = watch(button);
            const model = buildMenu(['About']);

            button.set_menu_model(model);
            expect(button.get_menu_model()).toBe(model);
            expect(button.menuModel).toBe(model);

            loose(button)['menu-model'] = null;
            expect(button.get_menu_model()).toBe(null);
            expect(seen()).toBe(2);
        });

        await it('declares notify::menu-model among what the widget emits', () => {
            // The FIRST declared property in the `AdwImageButton` chain — which is why this is
            // `withProperties` over a base that is already `withSignals`.
            expect(emittedSignalsOf(Gtk.MenuButton).includes('notify::menu-model')).toBe(true);
        });

        await it('is GObject-only: menuModelChange is a dead event name now', () => {
            // CONSUMER-VISIBLE: `addEventListener('menuModelChange')` was the way to hear this
            // property change. The seam no longer calls `notifyPropertyChange`, so such a
            // listener is silent — `refuseDeclaredEvent` cannot name it, because it refuses
            // only the spellings GObject owns (`notify::menu-model` and friends).
            const button = new Gtk.MenuButton();
            const dead: unknown[] = [];
            button.addEventListener('menuModelChange', (data) => dead.push(data));
            const live = watch(button);

            button.menuModel = buildMenu(['About']);
            expect(dead.length).toBe(0);
            expect(live()).toBe(1);

            // And the GObject spellings ARE refused, on both verbs.
            expect(() => button.addEventListener('notify::menuModel', () => {})).toThrow();
            expect(() => button.notify({ eventName: 'notify::menu_model', object: button as never })).toThrow();
        });

        await it('takes the new tree on every write, equal ones included', () => {
            // `changed: () => true` means `afterNotify` runs for a write the seam would otherwise
            // call equal — so the slot re-snapshots and re-watches, exactly as the hand-rolled
            // setter did on every write.
            const button = new Gtk.MenuButton();
            const model = buildMenu(['About']);
            button.menuModel = model;
            expect(treeOf(button).length).toBe(1);
            model.append('Quit');
            expect(treeOf(button).length).toBe(2);

            // The same model again: a notify, and a tree that is still the model's.
            const seen = watch(button);
            button.menuModel = model;
            expect(seen()).toBe(1);
            expect(treeOf(button).length).toBe(2);
        });

        await it('re-snapshots on a mutation of the held model, without notifying', () => {
            const button = new Gtk.MenuButton();
            const model = buildMenu(['About']);
            button.menuModel = model;
            const seen = watch(button);
            model.append('Quit');
            expect(treeOf(button).length).toBe(2);
            expect(seen()).toBe(0);
        });

        await it('stops watching a model it no longer holds', () => {
            const button = new Gtk.MenuButton();
            const dropped = buildMenu(['About']);
            button.menuModel = dropped;
            button.menuModel = buildMenu(['Quit']);
            dropped.append('Stale');
            expect(treeOf(button).length).toBe(1);
        });
    });
};

export default GtkMenuButtonPropertiesNsTest;

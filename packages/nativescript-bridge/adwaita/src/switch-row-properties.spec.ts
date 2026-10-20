// THE FIRST *DERIVED* REGISTRATION, MEASURED ON THE PURE-JS LEG (ADR 0105 § 2, route D).
//
// `AdwSwitchRow extends withProperties(AdwActionRow, …)`: a declared class over a class that is
// ITSELF declared. On Android that is a GType registered over `AdwActionRow`'s GType, which is
// registered over the foreign `GridLayout` — a three-link chain node-gi had to learn to walk
// (`findParentGType` used to stop at the plain NativeScript class between the two registrations).
// Everywhere else — the browser, iOS (ADR 0105 § 6), and this file — the seam installs the same
// accessors one prototype down, over the same per-instance store.
//
// So what this file measures beyond "the property works" is INHERITANCE: a switch row answers its
// own `active` AND the four it gets from the action row, each notifies under its own detail, and
// `connect`/`disconnect`/`notify` — which exist only on the action row's mixin — resolve the
// LEAF's declarations, not the base's.
//
// This lives on the TREES entry (`src/test.trees.mts`): the chain evaluates `@nativescript/core`
// at module scope, reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import { NOTIFY_ACTIVE } from './widgets/adw-switch-row.js';
import { ACTIVATED } from './widgets/adw-action-row.js';

/** The `Switch` the row builds into its suffix slot, which `_apply()` is the only writer of. */
function sliderOf(row: Adw.SwitchRow): { checked: boolean; className: string } {
    return (row as unknown as { _switch: { checked: boolean; className: string } })._switch;
}

/** What NativeScript's XML builder does to an attribute: assign the raw string. */
function xml(row: Adw.SwitchRow, name: string, value: string): void {
    (row as unknown as Record<string, unknown>)[name] = value;
}

export const AdwSwitchRowPropertiesNsTest = async () => {
    await describe('Adw.SwitchRow properties on the pure-JS engine', async () => {
        await it('runs on the subset here, which is what the rest of this suite measures', () => {
            const mixin = Object.getPrototypeOf(Adw.SwitchRow) as object;
            expect(Object.hasOwn(mixin, '$gtype')).toBe(false);
            expect(Object.hasOwn(mixin, '$gtypeName')).toBe(false);
        });

        await it('starts off, activatable, with the slider as its activatable widget', () => {
            const row = new Adw.SwitchRow();
            expect(row.active).toBe(false);
            expect(sliderOf(row).checked).toBe(false);
            // `adw_switch_row_init` (C:160-162).
            expect(row.activatable).toBe(true);
            expect(row.activatableWidget).toBe(row.suffix);
        });

        await it('answers active in all three GObject spellings', () => {
            const row = new Adw.SwitchRow();
            row.active = true;
            const loose = row as unknown as Record<string, unknown>;
            expect(loose.active).toBe(true);
        });

        await it('answers the FOUR properties it inherits from the action row', () => {
            const row = new Adw.SwitchRow({ title: 'Wi-Fi', subtitle: 'Connected' });
            expect(row.title).toBe('Wi-Fi');
            expect(row.subtitle).toBe('Connected');
            expect(row.iconName).toBe('');
            row.iconName = 'network-wireless-symbolic';
            expect(row.iconName).toBe('network-wireless-symbolic');
            expect((row as unknown as Record<string, unknown>)['icon-name']).toBe('network-wireless-symbolic');
        });

        await it('writes the slider from active, through notify:: and not a setter', () => {
            const row = new Adw.SwitchRow();
            row.active = true;
            expect(sliderOf(row).checked).toBe(true);
            expect(sliderOf(row).className).toBe('adw-switch');
            row.active = false;
            expect(sliderOf(row).checked).toBe(false);
            expect(sliderOf(row).className).toBe('adw-switch off');
        });

        await it('follows a drag on the handle back into the property', () => {
            const row = new Adw.SwitchRow();
            const sw = row.suffix as unknown as { checked: boolean };
            // What the platform does when the user drags the handle.
            sw.checked = true;
            expect(row.active).toBe(true);
            sw.checked = false;
            expect(row.active).toBe(false);
        });

        await it('notifies a real change and stays silent on an equal write', () => {
            const row = new Adw.SwitchRow();
            const seen: boolean[] = [];
            row.connect(NOTIFY_ACTIVE, (self) => seen.push(self.active));
            row.active = true;
            row.active = true;
            row.active = false;
            expect(seen).toStrictEqual([true, false]);
        });

        await it('notifies an INHERITED property under its own detail, from the leaf', () => {
            // `connect` lives on the action row's mixin; it must resolve THIS class's chain.
            const row = new Adw.SwitchRow();
            const seen: string[] = [];
            row.connect('notify::title', (self) => seen.push(self.title));
            row.connect(NOTIFY_ACTIVE, () => seen.push('active'));
            row.title = 'Wi-Fi';
            expect(seen).toStrictEqual(['Wi-Fi']);
            row.active = true;
            expect(seen).toStrictEqual(['Wi-Fi', 'active']);
        });

        await it('takes the id back from connect and stops on disconnect', () => {
            const row = new Adw.SwitchRow();
            const seen: boolean[] = [];
            const id = row.connect(NOTIFY_ACTIVE, (self) => seen.push(self.active));
            row.active = true;
            row.disconnect(id);
            row.active = false;
            expect(seen).toStrictEqual([true]);
            expect(() => row.disconnect(id)).toThrow();
        });

        await it("emits notify::active from GJS's notify('active'), and the inherited ones too", () => {
            const row = new Adw.SwitchRow();
            const seen: string[] = [];
            row.connect(NOTIFY_ACTIVE, () => seen.push('active'));
            row.connect('notify::subtitle', () => seen.push('subtitle'));
            row.notify('active');
            row.notify('subtitle');
            expect(seen).toStrictEqual(['active', 'subtitle']);
            expect(() => row.notify('nope')).toThrow();
        });

        await it('takes the XML spellings as typed values and refuses garbage', () => {
            const row = new Adw.SwitchRow();
            xml(row, 'active', 'true');
            expect(row.active).toBe(true);
            expect(sliderOf(row).checked).toBe(true);
            xml(row, 'active', 'false');
            expect(row.active).toBe(false);
            expect(() => xml(row, 'active', 'maybe')).toThrow();
            expect(row.active).toBe(false);
        });

        await it('still answers the port one-argument property door, both levels', () => {
            const row = new Adw.SwitchRow();
            row.set_property('active', true);
            expect(row.get_property('active')).toBe(true);
            expect(sliderOf(row).checked).toBe(true);
            row.set_property('title', 'Wi-Fi');
            expect(row.get_property('title')).toBe('Wi-Fi');
        });

        await it('keeps get_active/set_active answering the property', () => {
            const row = new Adw.SwitchRow();
            row.set_active(true);
            expect(row.get_active()).toBe(true);
            expect(row.active).toBe(true);
        });

        await it('inverts on activate and then emits `activated`', () => {
            const row = new Adw.SwitchRow();
            const seen: string[] = [];
            row.connect(NOTIFY_ACTIVE, (self) => seen.push(String(self.active)));
            row.addEventListener(ACTIVATED, () => seen.push('activated'));
            row.activate();
            expect(row.active).toBe(true);
            expect(sliderOf(row).checked).toBe(true);
            // The notify comes FIRST — libadwaita forwards the activation to the slider, whose
            // `notify::active` runs before `adw_action_row_activate`'s own emission.
            expect(seen).toStrictEqual(['true', 'activated']);
            row.activate();
            expect(row.active).toBe(false);
        });

        await it('does not activate while unactivatable', () => {
            const row = new Adw.SwitchRow();
            row.activatable = false;
            row.activate();
            expect(row.active).toBe(false);
        });

        await it('takes active beside the inherited properties as construct props', () => {
            const row = new Adw.SwitchRow({ title: 'Wi-Fi', active: true });
            expect(row.title).toBe('Wi-Fi');
            expect(row.active).toBe(true);
            expect(sliderOf(row).checked).toBe(true);
        });

        await it('declares notify::active in emittedSignals, merged with the inherited ones', () => {
            const emitted = (Adw.SwitchRow as unknown as { emittedSignals: readonly string[] }).emittedSignals;
            expect(emitted.includes(NOTIFY_ACTIVE)).toBe(true);
        });

        await it('does not shadow the action row with a second set of accessors', () => {
            // The derived declaration adds ONLY `active`: the four inherited spellings must stay
            // the base prototype's, or a write would land in one store and a read in another.
            const own = Object.getPrototypeOf(Adw.SwitchRow.prototype) as object;
            expect(Object.hasOwn(own, 'active')).toBe(true);
            expect(Object.hasOwn(own, 'title')).toBe(false);
            expect(Object.hasOwn(own, 'icon-name')).toBe(false);
        });
    });
};

export default AdwSwitchRowPropertiesNsTest;

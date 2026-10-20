// THE THIRD MIGRATED WIDGET, MEASURED ON THE PURE-JS LEG (ADR 0105 § 2, route D).
//
// `AdwActionRow` no longer writes `get title()` / `set title()` / `get iconName()` /
// `get activatable()`: `title`, `subtitle`, `icon-name` and `activatable` are DECLARED at its
// `extends` and built by `widgets/signals.ts`. On Android that seam registers a GType over
// `GridLayout`; everywhere else — the browser, iOS (ADR 0105 § 6), and every off-device test
// including this one — it installs its own accessors instead. This file holds the leg iOS ships
// on to the same properties, the same notifies and the same labels the Android twin produces.
//
// WHY THIS WIDGET IS THE INTERESTING ONE: it is the base of the FIRST derived registration
// (`AdwSwitchRow`, see `switch-row-properties.spec.ts`), so the chain-aware half of the seam is
// what these two files jointly measure — here from below, where nothing is derived yet.
//
// WHAT IS *NOT* DECLARED, and the assertion that pins it: `activated` stays a NativeScript event.
// A declared signal routes `emit` to GObject only, which would make `on('activated')` silent on
// the real leg — so the row keeps emitting it through `notify({ eventName })`, and the spec below
// checks that `addEventListener('activated')` still hears it.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends GridLayout` evaluates
// `@nativescript/core` at module scope, reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';
import { Label, Switch } from '@nativescript/core';

import * as Adw from './namespace/adw.js';
import { ACTIVATED } from './widgets/adw-action-row.js';

/** The two `Label`s the widget keeps, which `_applyLabels()` is the only writer of. */
interface Labels {
    _titleLabel: { text: string; visibility: string };
    _subtitleLabel: { text: string; visibility: string };
}

function labelsOf(widget: Adw.ActionRow): Labels {
    return widget as unknown as Labels;
}

/** Every spelling GObject answers a property in, as the seam installs them. */
function spellings(widget: Adw.ActionRow): Record<string, unknown> {
    return widget as unknown as Record<string, unknown>;
}

/** What NativeScript's XML builder does to an attribute: assign the raw string. */
function xml(widget: Adw.ActionRow, name: string, value: string): void {
    (widget as unknown as Record<string, unknown>)[name] = value;
}

export const AdwActionRowPropertiesNsTest = async () => {
    await describe('Adw.ActionRow properties on the pure-JS engine', async () => {
        await it('runs on the subset here, which is what the rest of this suite measures', () => {
            // The seam registers on the MIXIN class, so that is where a GType would land.
            const mixin = Object.getPrototypeOf(Adw.ActionRow) as object;
            expect(Object.hasOwn(mixin, '$gtype')).toBe(false);
            expect(Object.hasOwn(mixin, '$gtypeName')).toBe(false);
        });

        await it('starts with empty labels, collapsed, and unactivatable', () => {
            const row = new Adw.ActionRow();
            expect(row.title).toBe('');
            expect(row.subtitle).toBe('');
            expect(row.iconName).toBe('');
            // The template's `<property name="activatable">False</property>`.
            expect(row.activatable).toBe(false);
            expect(labelsOf(row)._titleLabel.visibility).toBe('collapse');
            expect(labelsOf(row)._subtitleLabel.visibility).toBe('collapse');
        });

        await it('answers each property in all three GObject spellings', () => {
            const row = new Adw.ActionRow();
            row.iconName = 'folder-symbolic';
            expect(spellings(row).iconName).toBe('folder-symbolic');
            expect(spellings(row)['icon-name']).toBe('folder-symbolic');
            expect(spellings(row).icon_name).toBe('folder-symbolic');
        });

        await it('pushes title and subtitle onto their labels, through notify:: and not a setter', () => {
            const row = new Adw.ActionRow();
            row.title = 'Wi-Fi';
            expect(labelsOf(row)._titleLabel.text).toBe('Wi-Fi');
            expect(labelsOf(row)._titleLabel.visibility).toBe('visible');
            row.subtitle = 'Connected';
            expect(labelsOf(row)._subtitleLabel.text).toBe('Connected');
            expect(labelsOf(row)._subtitleLabel.visibility).toBe('visible');
            row.subtitle = '';
            expect(labelsOf(row)._subtitleLabel.visibility).toBe('collapse');
        });

        await it('builds the prefix icon from icon-name and clears it when emptied', () => {
            const row = new Adw.ActionRow();
            row.iconName = 'folder-symbolic';
            const icon = row.prefix;
            expect(icon).not.toBe(null);
            expect((icon as unknown as { iconName: string }).iconName).toBe('folder-symbolic');
            row.iconName = 'network-wireless-symbolic';
            expect(row.prefix).toBe(icon);
            expect((icon as unknown as { iconName: string }).iconName).toBe('network-wireless-symbolic');
            row.iconName = '';
            expect(row.prefix).toBe(null);
            expect(row.iconName).toBe('');
        });

        await it('REPLACES an add_prefix() widget rather than refusing the slot', () => {
            // THE ONE CONSUMER-VISIBLE REGRESSION OF THIS MIGRATION. The twin threw a TypeError
            // here ("needs the prefix slot, which add_prefix() already filled"), and a refusal
            // cannot live on this leg's twin any more: on the real leg the write lands in the
            // GObject store first and `_applyIconName` runs from a `notify::` handler, where
            // node-gi SWALLOWS a thrown exception (gi.js:431) and the property keeps the value.
            // A throw that only happens off-device is worse than no throw, so the slot now
            // follows `add_prefix`'s own one-slot replace rule instead.
            const row = new Adw.ActionRow();
            const badge = new Label();
            row.add_prefix(badge);
            row.iconName = 'folder-symbolic';
            expect(row.prefix).not.toBe(badge);
            expect((row.prefix as unknown as { iconName: string }).iconName).toBe('folder-symbolic');
            expect(row.iconName).toBe('folder-symbolic');
        });

        await it('forgets its icon when add_prefix() takes the slot back', () => {
            const row = new Adw.ActionRow();
            row.iconName = 'folder-symbolic';
            const badge = new Label();
            row.add_prefix(badge);
            expect(row.iconName).toBe('');
            row.iconName = 'network-wireless-symbolic';
            expect(row.prefix).not.toBe(badge);
        });

        await it('takes the XML spellings as typed values', () => {
            const row = new Adw.ActionRow();
            xml(row, 'activatable', 'true');
            expect(row.activatable).toBe(true);
            xml(row, 'activatable', 'false');
            expect(row.activatable).toBe(false);
            xml(row, 'title', 'Wi-Fi');
            expect(row.title).toBe('Wi-Fi');
        });

        await it('refuses an activatable that is neither true nor false instead of defaulting', () => {
            // Was `xmlBoolean(value, false)`: garbage silently read as `false`.
            const row = new Adw.ActionRow();
            expect(() => xml(row, 'activatable', 'maybe')).toThrow();
            expect(row.activatable).toBe(false);
        });

        await it('notifies a real change and stays silent on an equal write', () => {
            const row = new Adw.ActionRow();
            const titles: string[] = [];
            const subtitles: string[] = [];
            row.connect('notify::title', (self) => titles.push(self.title));
            row.connect('notify::subtitle', (self) => subtitles.push(self.subtitle));
            row.title = 'Wi-Fi';
            row.title = 'Wi-Fi';
            row.title = 'Bluetooth';
            row.subtitle = 'Connected';
            expect(titles).toStrictEqual(['Wi-Fi', 'Bluetooth']);
            expect(subtitles).toStrictEqual(['Connected']);
        });

        await it('notifies icon-name under its canonical detail', () => {
            const row = new Adw.ActionRow();
            const seen: string[] = [];
            row.connect('notify::icon-name', (self) => seen.push(self.iconName));
            row.iconName = 'folder-symbolic';
            row.iconName = 'folder-symbolic';
            expect(seen).toStrictEqual(['folder-symbolic']);
        });

        await it('takes the id back from connect and stops on disconnect', () => {
            const row = new Adw.ActionRow();
            const seen: string[] = [];
            const id = row.connect('notify::title', (self) => seen.push(self.title));
            row.title = 'Wi-Fi';
            row.disconnect(id);
            row.title = 'Bluetooth';
            expect(seen).toStrictEqual(['Wi-Fi']);
            expect(() => row.disconnect(id)).toThrow();
        });

        await it("emits notify::title from GJS's notify('title')", () => {
            const row = new Adw.ActionRow();
            const seen: number[] = [];
            row.connect('notify::title', () => seen.push(1));
            row.notify('title');
            expect(seen.length).toBe(1);
            expect(() => row.notify('nope')).toThrow();
        });

        await it('still answers the port one-argument property door', () => {
            const row = new Adw.ActionRow();
            row.set_property('title', 'Wi-Fi');
            expect(row.get_property('title')).toBe('Wi-Fi');
            expect(labelsOf(row)._titleLabel.text).toBe('Wi-Fi');
            row.set_property('icon-name', 'folder-symbolic');
            expect(row.get_property('icon-name')).toBe('folder-symbolic');
        });

        await it('takes every declared property as a construct prop', () => {
            const row = new Adw.ActionRow({
                title: 'Wi-Fi',
                subtitle: 'Connected',
                iconName: 'network-wireless-symbolic',
                activatable: true,
            });
            expect(row.title).toBe('Wi-Fi');
            expect(row.subtitle).toBe('Connected');
            expect(row.iconName).toBe('network-wireless-symbolic');
            expect(row.activatable).toBe(true);
            expect(labelsOf(row)._titleLabel.text).toBe('Wi-Fi');
            expect(labelsOf(row)._subtitleLabel.text).toBe('Connected');
        });

        await it('declares every notify in emittedSignals, from the seam', () => {
            const emitted = (Adw.ActionRow as unknown as { emittedSignals: readonly string[] }).emittedSignals;
            for (const name of ['notify::title', 'notify::subtitle', 'notify::icon-name', 'notify::activatable']) {
                expect(emitted.includes(name)).toBe(true);
            }
        });

        await it('keeps `activated` a NativeScript event, NOT a declared signal', () => {
            // A declared signal would route `emit` to GObject alone and leave this listener —
            // the door every consumer and every XML `activated="onRow"` binding uses — silent.
            const row = new Adw.ActionRow({ activatable: true });
            const seen: string[] = [];
            row.addEventListener(ACTIVATED, (data) => seen.push(data.eventName));
            row.activate();
            expect(seen).toStrictEqual([ACTIVATED]);
            // `connect` reaches the same emission, because it is not a declared name.
            const viaConnect: number[] = [];
            row.connect(ACTIVATED, () => viaConnect.push(1));
            row.activate();
            expect(viaConnect.length).toBe(1);
        });

        await it('does not activate while unactivatable', () => {
            const row = new Adw.ActionRow();
            const seen: number[] = [];
            row.addEventListener(ACTIVATED, () => seen.push(1));
            row.activate();
            expect(seen.length).toBe(0);
            row.activatable = true;
            row.activate();
            expect(seen.length).toBe(1);
        });

        await it('copies the activatable widget sensitivity into the declared property', () => {
            // `ActionRowState` still owns this binding (ADR 0004); what changed is that the
            // result is MIRRORED into the declared property, so the notify fires with it.
            const row = new Adw.ActionRow();
            const seen: boolean[] = [];
            row.connect('notify::activatable', (self) => seen.push(self.activatable));
            const sw = new Switch();
            row.activatableWidget = sw;
            expect(row.activatable).toBe(true);
            expect(seen).toStrictEqual([true]);
            sw.isUserInteractionEnabled = false;
            row.syncActivatableWidgetSensitivity();
            expect(row.activatable).toBe(false);
            expect(seen).toStrictEqual([true, false]);
        });

        await it('lets a direct activatable write stand against an unchanged re-assert', () => {
            // The one-way GBinding rule (adwaita-core's `setActivatable` docs): a direct write
            // lands, and re-reading an UNCHANGED sensitivity must not undo it.
            const row = new Adw.ActionRow();
            const sw = new Switch();
            row.activatableWidget = sw;
            row.activatable = false;
            row.syncActivatableWidgetSensitivity();
            expect(row.activatable).toBe(false);
        });
    });
};

export default AdwActionRowPropertiesNsTest;

// THE FIRST REGISTERED-OVER-REGISTERED PAIR ON A DEVICE (ADR 0105 § 2, route D).
//
// `specs/window-title.ts` and `specs/spinner.ts` each drive ONE migrated widget over a foreign
// `@nativescript/core` base. This file drives the shape that question turns into next: `Adw.Row`
// is a GType over `GridLayout`, and `Adw.SwitchRow` is a GType over THAT GType — with an ordinary
// NativeScript class (`AdwActionRow` itself) sitting between the two registrations, because the
// seam registers on a mixin and the widget extends the mixin plainly.
//
// That middle class is what node-gi had to learn: its parent walk read the mixin's `$gtypeName`
// through the class-side prototype chain, saw a dotless name with no registry entry and threw.
// It now steps over a class whose name is INHERITED and takes the registered ancestor above it,
// which is the answer gjs gives (`packages/node-gi/node-gi/test/foreign-parent.test.mjs`
// measures both halves off-device; this file is the same claim on the V8/Java runtime).
//
// THE FIRST SUITE RUNS IN BOTH LEGS, for the reason `specs/views.ts` gives: every case is a
// statement about the two widgets, so a difference between the runs is a defect in whichever
// engine disagrees. The SECOND is real-GObject only — a GType chain, `type_parent`, inherited
// `get_property` and `bind_property` across the inheritance are what route D buys here.
import { Adw } from '@gjsify/adwaita-nativescript';
import { GestureTypes, GridLayout, Label, Switch, TextField, View, ViewBase } from '@nativescript/core';
import type { Image } from '@nativescript/core';

import { describe, expect, info, it } from '../reporter.js';
import { requireGi } from '../opt-in.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** The two `Label`s and the `Switch` the rows keep; their `notify::` handlers are the only writers. */
interface Internals {
    _titleLabel: Label;
    _subtitleLabel: Label;
    _switch: Switch;
}

const inner = (widget: Adw.ActionRow | Adw.SwitchRow): Internals => widget as unknown as Internals;

/** The views an entry row composes; like {@link Internals}, only its own renderer writes them. */
interface EntryInternals extends Internals {
    _field: TextField;
    _emptyTitle: Label;
    _editIcon: Image;
    _indicator: Image;
    _applyButton: View;
}

const entryInner = (widget: Adw.EntryRow): EntryInternals => widget as unknown as EntryInternals;

/** How many tap GESTURE observers a view carries — `on('tap')` lands here, not in the observer map. */
const tapObservers = (view: View): number => ((view as Any).getGestureObservers(GestureTypes.tap) ?? []).length;

/**
 * The focus / return-key inputs, as the platform delivers them.
 *
 * A device cannot type: `focus`, `blur` and `returnPress` reach the row only from a real
 * keyboard. `Observable.notify` is the same door NativeScript's own view code posts them
 * through, so the row's handlers run exactly as they would — while `text` is written onto the
 * field directly, because NativeScript's `textProperty` fires `textChange` for a programmatic
 * write too and that IS the typing path.
 */
const emitOn = (view: View, eventName: string): void => {
    view.notify({ eventName, object: view });
};

export const rowsSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    // The MIXIN classes are where the seam registers, so they are where the two GTypes land.
    const rowMixin = Object.getPrototypeOf(Adw.ActionRow) as Any;
    const switchMixin = Object.getPrototypeOf(Adw.SwitchRow) as Any;
    const entryMixin = Object.getPrototypeOf(Adw.EntryRow) as Any;

    await describe(`Adw.ActionRow on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('constructs as a real NativeScript GridLayout with two labels', () => {
            const row = new Adw.ActionRow();
            info(
                `ctor=${row.constructor?.name} gtypeName=${rowMixin.$gtypeName ?? 'none'} ` +
                    `skipped=[${(rowMixin.$foreignSkipped ?? []).join(',')}]`,
            );
            expect(row instanceof GridLayout).toBe(true);
            expect(row instanceof View).toBe(true);
            expect(row instanceof ViewBase).toBe(true);
            expect(inner(row)._titleLabel instanceof Label).toBe(true);
            expect(inner(row)._subtitleLabel instanceof Label).toBe(true);
        });

        await it('starts with every declared property at its default', () => {
            const row = new Adw.ActionRow();
            expect(row.title).toBe('');
            expect(row.subtitle).toBe('');
            expect(row.iconName).toBe('');
            expect(row.activatable).toBe(false);
            expect(typeof row.activatable).toBe('boolean');
            expect(inner(row)._titleLabel.visibility).toBe('collapse');
        });

        await it('a title write reaches the label through notify::', () => {
            const row = new Adw.ActionRow();
            const seen: string[] = [];
            row.connect('notify::title', (self: Adw.ActionRow) => seen.push(self.title));
            row.title = 'Wi-Fi';
            row.title = 'Wi-Fi';
            row.subtitle = 'Connected';
            info(`seen=[${seen.join('|')}] label=${inner(row)._titleLabel.text}`);
            expect(seen.join('|')).toBe('Wi-Fi');
            expect(inner(row)._titleLabel.text).toBe('Wi-Fi');
            expect(inner(row)._titleLabel.visibility).toBe('visible');
            expect(inner(row)._subtitleLabel.text).toBe('Connected');
        });

        await it('all three spellings of icon-name reach the same property', () => {
            const row = new Adw.ActionRow();
            row.iconName = 'network-wireless-symbolic';
            expect((row as Any)['icon-name']).toBe('network-wireless-symbolic');
            expect((row as Any).icon_name).toBe('network-wireless-symbolic');
            (row as Any)['icon-name'] = 'audio-volume-high-symbolic';
            expect(row.iconName).toBe('audio-volume-high-symbolic');
        });

        await it('icon-name builds a prefix image, and clearing it takes the slot back', () => {
            const row = new Adw.ActionRow();
            expect(row.prefix).toBe(null);
            row.iconName = 'network-wireless-symbolic';
            const image = row.prefix as Any;
            info(`prefix=${image?.constructor?.name} iconName=${image?.iconName}`);
            expect(image instanceof View).toBe(true);
            expect(image.iconName).toBe('network-wireless-symbolic');
            row.iconName = '';
            expect(row.prefix).toBe(null);
        });

        await it('a prefix widget REPLACES the icon, and clears the property with it', () => {
            const row = new Adw.ActionRow({ iconName: 'network-wireless-symbolic' });
            expect(row.iconName).toBe('network-wireless-symbolic');
            const label = new Label();
            // The twin threw here. A declared property cannot refuse from a notify:: handler —
            // node-gi logs and SWALLOWS the exception — so this is `add_prefix`'s own one-slot rule.
            row.add_prefix(label);
            expect(row.prefix === label).toBe(true);
            expect(row.iconName).toBe('');
        });

        await it('activate() is gated on activatable and emits as a NativeScript event', () => {
            const row = new Adw.ActionRow();
            const fired: string[] = [];
            row.addEventListener('activated', () => fired.push('activated'));
            row.activate();
            expect(fired.length).toBe(0);
            row.activatable = true;
            row.activate();
            info(`fired=[${fired.join(',')}]`);
            expect(fired.join(',')).toBe('activated');
        });

        await it('the activatable-widget binding mirrors BOTH ways', () => {
            const row = new Adw.ActionRow();
            const target = new Label();
            target.isUserInteractionEnabled = false;
            row.activatableWidget = target;
            expect(row.activatable).toBe(false);
            target.isUserInteractionEnabled = true;
            row.syncActivatableWidgetSensitivity();
            expect(row.activatable).toBe(true);
            // A direct write is what the binding half must now hold, or the next unchanged
            // re-assert would undo it.
            row.activatable = false;
            row.syncActivatableWidgetSensitivity();
            info(`activatable=${row.activatable}`);
            expect(row.activatable).toBe(false);
        });

        await it('coerces XML strings and refuses one it cannot read', () => {
            const row = new Adw.ActionRow();
            (row as Any).activatable = 'true';
            expect(row.activatable).toBe(true);
            (row as Any).activatable = 'false';
            expect(row.activatable).toBe(false);
            expect(() => {
                (row as Any).activatable = 'maybe';
            }).toThrow();
        });

        await it('takes every declared property as a construct prop', () => {
            const row = new Adw.ActionRow({ title: 'Sound', subtitle: 'Output', activatable: true });
            expect(`${row.title}/${row.subtitle}/${row.activatable}`).toBe('Sound/Output/true');
            const fromXml = new Adw.ActionRow({ title: 'Sound', activatable: 'true' } as Any);
            expect(fromXml.activatable).toBe(true);
        });
    });

    await describe(`Adw.SwitchRow on '${engine}' (the derived registration)`, async () => {
        await it('is an action row, a GridLayout, and owns a Switch in its suffix', () => {
            const row = new Adw.SwitchRow();
            info(
                `ctor=${row.constructor?.name} gtypeName=${switchMixin.$gtypeName ?? 'none'} ` +
                    `skipped=[${(switchMixin.$foreignSkipped ?? []).join(',')}]`,
            );
            expect(row instanceof Adw.ActionRow).toBe(true);
            expect(row instanceof GridLayout).toBe(true);
            expect(row instanceof ViewBase).toBe(true);
            expect(inner(row)._switch instanceof Switch).toBe(true);
            expect(row.suffix === inner(row)._switch).toBe(true);
        });

        await it('starts off, activatable, with the slider as its activatable widget', () => {
            const row = new Adw.SwitchRow();
            expect(row.active).toBe(false);
            expect(row.activatable).toBe(true);
            expect(row.activatableWidget === inner(row)._switch).toBe(true);
            expect(inner(row)._switch.checked).toBe(false);
        });

        await it('reads and writes the properties it INHERITS from the action row', () => {
            const row = new Adw.SwitchRow({ title: 'Dark style', subtitle: 'Follow the system' });
            expect(row.title).toBe('Dark style');
            expect(inner(row)._titleLabel.text).toBe('Dark style');
            const seen: string[] = [];
            row.connect('notify::subtitle', (self: Adw.SwitchRow) => seen.push(self.subtitle));
            row.subtitle = 'Always on';
            info(`inherited notify=[${seen.join('|')}]`);
            expect(seen.join('|')).toBe('Always on');
            expect(inner(row)._subtitleLabel.text).toBe('Always on');
        });

        await it('a write reaches the slider and its class through notify::active', () => {
            const row = new Adw.SwitchRow();
            const seen: boolean[] = [];
            const id = row.connect('notify::active', (self: Adw.SwitchRow) => seen.push(self.active));
            row.active = true;
            row.active = true;
            info(`seen=[${seen.join(',')}] checked=${inner(row)._switch.checked}`);
            expect(seen.join(',')).toBe('true');
            expect(inner(row)._switch.checked).toBe(true);
            expect(inner(row)._switch.className).toBe('adw-switch');
            row.disconnect(id);
            row.active = false;
            expect(seen.join(',')).toBe('true');
            expect(inner(row)._switch.className).toBe('adw-switch off');
        });

        await it("the slider's own checkedChange funnels back into the property", () => {
            const row = new Adw.SwitchRow();
            const seen: boolean[] = [];
            row.connect('notify::active', (self: Adw.SwitchRow) => seen.push(self.active));
            // What a drag on the handle produces — NativeScript fires it for this write too.
            inner(row)._switch.checked = true;
            info(`after slider write: active=${row.active} seen=[${seen.join(',')}]`);
            expect(row.active).toBe(true);
            expect(seen.join(',')).toBe('true');
        });

        await it('activate() inverts the state and then activates like any row', () => {
            const row = new Adw.SwitchRow();
            const fired: string[] = [];
            row.addEventListener('activated', () => fired.push('activated'));
            row.activate();
            expect(row.active).toBe(true);
            row.activate();
            info(`active=${row.active} fired=${fired.length}`);
            expect(row.active).toBe(false);
            expect(fired.length).toBe(2);
            expect(row.get_active()).toBe(false);
            row.set_active(true);
            expect(row.active).toBe(true);
        });

        await it('declares exactly one emitted signal — notify::active', () => {
            const row = new Adw.SwitchRow();
            expect((row.constructor as Any).emittedSignals.join()).toBe('notify::active');
        });

        await it('takes inherited and own construct props together, strings included', () => {
            const row = new Adw.SwitchRow({ title: 'Dark style', active: true });
            expect(`${row.title}/${row.active}`).toBe('Dark style/true');
            expect(inner(row)._switch.checked).toBe(true);
            const fromXml = new Adw.SwitchRow({ active: 'true', iconName: 'weather-clear-night-symbolic' } as Any);
            expect(fromXml.active).toBe(true);
            expect(fromXml.prefix !== null).toBe(true);
            expect(() => new Adw.SwitchRow({ active: 'maybe' } as Any)).toThrow();
        });
    });

    // THE SECOND DERIVED REGISTRATION, and the first one whose properties are not independent of
    // each other (ADR 0105 § 2, route D). `AdwEntryRow` used to hold an `EntryRowState` beside
    // itself and expose it through plain getters; its six values are now declared properties, so
    // on 'real-gio' every one of them is a real pspec and every write lands in node-gi.
    //
    // What that moves onto the device, beyond "six more properties work":
    //   · `text-length` is derived by a NORMALIZER that reads its SIBLING `text` off the
    //     instance. node-gi's `set_property` has to hand the instance to the seam's wrapper, or
    //     the derivation reads `undefined` on the real leg while passing off-device.
    //   · `notify::text-length` is emitted from INSIDE the `notify::text` emission, which on this
    //     leg is a `g_object_notify_by_pspec` re-entered during another one.
    //   · `apply` and `entry-activated` are real GSignals here, reached through `connect` and
    //     `emit` rather than through the NativeScript event table they used before.
    await describe(`Adw.EntryRow on '${engine}' (six declared properties, two signals)`, async () => {
        await it('is an action row over a GridLayout, with a real TextField in its title column', () => {
            const row = new Adw.EntryRow();
            info(
                `ctor=${row.constructor?.name} gtypeName=${entryMixin.$gtypeName ?? 'none'} ` +
                    `skipped=[${(entryMixin.$foreignSkipped ?? []).join(',')}]`,
            );
            expect(row instanceof Adw.ActionRow).toBe(true);
            expect(row instanceof GridLayout).toBe(true);
            expect(entryInner(row)._field instanceof TextField).toBe(true);
            expect(entryInner(row)._applyButton instanceof View).toBe(true);
        });

        await it("starts at adw_entry_row_init's defaults", () => {
            const row = new Adw.EntryRow();
            info(
                `text='${row.text}' length=${row.textLength} max=${row.maxLength} ` +
                    `editable=${row.editable} apply=${row.showApplyButton} activates=${row.activatesDefault}`,
            );
            expect(row.text).toBe('');
            expect(row.textLength).toBe(0);
            expect(row.maxLength).toBe(0);
            expect(row.editable).toBe(true);
            expect(row.showApplyButton).toBe(false);
            expect(row.activatesDefault).toBe(false);
        });

        await it('carries the field both ways — property to view, typing back to property', () => {
            const row = new Adw.EntryRow();
            const seen: string[] = [];
            row.connect('notify::text', (self: Adw.EntryRow) => seen.push(self.text));
            row.text = 'Ada';
            row.text = 'Ada';
            expect(entryInner(row)._field.text).toBe('Ada');
            // What a keystroke produces: NativeScript posts `textChange` for this write too.
            entryInner(row)._field.text = 'Ada L';
            info(`seen=[${seen.join('|')}] field='${entryInner(row)._field.text}'`);
            expect(row.text).toBe('Ada L');
            expect(seen.join('|')).toBe('Ada|Ada L');
        });

        await it('derives text-length from its SIBLING, and settles it before either notify', () => {
            // The normalizer ignores what was written and recomputes from `text`, which is how a
            // G_PARAM_READABLE property is spelled in a seam with no read-only flag.
            const row = new Adw.EntryRow();
            const seen: string[] = [];
            row.connect('notify::text-length', (self: Adw.EntryRow) =>
                seen.push(`len:${self.textLength}:${self.text}`),
            );
            row.connect('notify::text', (self: Adw.EntryRow) => seen.push(`text:${self.text}:${self.textLength}`));
            row.text = 'Ada';
            (row as Any).textLength = 99;
            info(`seen=[${seen.join(' ')}] length=${row.textLength}`);
            // The derived notify nests INSIDE the text one; the direct write resolves to the
            // value already held, so the equal-write rule drops it.
            expect(seen.join(' ')).toBe('len:3:Ada text:Ada:3');
            expect(row.textLength).toBe(3);
        });

        await it('counts CHARACTERS, not UTF-16 units — on this runtime too', () => {
            const row = new Adw.EntryRow({ text: '👩‍💻' });
            info(`length=${row.textLength} units=${row.text.length}`);
            // One grapheme, three code points, five UTF-16 units: the C counts with
            // g_utf8_strlen, so the only wrong answer a JS port gives for free is 5.
            expect(row.textLength).toBe(3);
        });

        await it('truncates to max-length inside the normalizer, in both write directions', () => {
            const row = new Adw.EntryRow({ text: 'Ada Lovelace', maxLength: 5 });
            expect(row.text).toBe('Ada L');
            expect(entryInner(row)._field.text).toBe('Ada L');
            entryInner(row)._field.text = 'Grace Hopper';
            info(`typed-then-clamped='${row.text}' field='${entryInner(row)._field.text}'`);
            expect(row.text).toBe('Grace');
            expect(entryInner(row)._field.text).toBe('Grace');
        });

        await it('truncates what it already holds when the limit DROPS, as an ordinary change', () => {
            const row = new Adw.EntryRow({ text: 'Ada Lovelace' });
            const seen: string[] = [];
            row.connect('notify::text', (self: Adw.EntryRow) => seen.push(self.text));
            row.maxLength = 5;
            info(`seen=[${seen.join('|')}] text='${row.text}'`);
            expect(row.text).toBe('Ada L');
            expect(seen.join('|')).toBe('Ada L');
            // A limit that truncates nothing produces an equal write, which the property drops.
            row.maxLength = 4000;
            expect(seen.join('|')).toBe('Ada L');
        });

        await it('paints the five outputs of update_empty through one derivation', () => {
            const row = new Adw.EntryRow({ title: 'Name', showApplyButton: true });
            const views = entryInner(row);
            expect(views._emptyTitle.visibility).toBe('visible');
            expect(views._editIcon.visibility).toBe('visible');
            expect(views._applyButton.visibility).toBe('collapse');

            emitOn(views._field, 'focus');
            views._field.text = 'Ada';
            info(
                `editing=${row.editing} changed=${row.textChanged} empty=${views._emptyTitle.visibility} ` +
                    `pencil=${views._editIcon.visibility} apply=${views._applyButton.visibility} ` +
                    `class='${row.className}'`,
            );
            expect(row.editing).toBe(true);
            expect(row.textChanged).toBe(true);
            // text_changed hides the pencil and shows the apply button; the filled title takes over.
            expect(views._emptyTitle.visibility).toBe('collapse');
            expect(views._titleLabel.visibility).toBe('visible');
            expect(views._editIcon.visibility).toBe('collapse');
            expect(views._applyButton.visibility).toBe('visible');
            expect(row.className.indexOf('focused') >= 0).toBe(true);
        });

        await it('goes insensitive-but-visible on a read-only row, and locks the field', () => {
            const row = new Adw.EntryRow();
            row.editable = false;
            info(`opacity=${entryInner(row)._editIcon.opacity} field.editable=${entryInner(row)._field.editable}`);
            // No insensitive widget state in NativeScript — the C's set_sensitive is an opacity,
            // and the pencil STAYS shown.
            expect(entryInner(row)._editIcon.visibility).toBe('visible');
            expect(entryInner(row)._editIcon.opacity < 1).toBe(true);
            expect(entryInner(row)._field.editable).toBe(false);
        });

        await it('re-derives on EVERY setShowIndicator, which is why it stayed a method', () => {
            // C:1281-1296 has no equality guard; a declared property would add the one it must
            // not have, so the indicator input is the one that did NOT become a property.
            const row = new Adw.EntryRow();
            emitOn(entryInner(row)._field, 'focus');
            row.setShowIndicator(true);
            expect(entryInner(row)._indicator.visibility).toBe('visible');
            entryInner(row)._indicator.visibility = 'collapse';
            row.setShowIndicator(true);
            info(`after redundant call: ${entryInner(row)._indicator.visibility}`);
            expect(entryInner(row)._indicator.visibility).toBe('visible');
        });

        await it('emits apply from the button and from the return key, and clears the latch', () => {
            const row = new Adw.EntryRow({ showApplyButton: true });
            const seen: string[] = [];
            row.connect('apply', (self: Adw.EntryRow) => seen.push(`apply:${self.text}`));
            row.connect('entry-activated', () => seen.push('entry-activated'));

            emitOn(entryInner(row)._field, 'focus');
            entryInner(row)._field.text = 'Ada';
            // The button's `tap` is a GESTURE on this platform: `addEventListener('tap')` builds
            // a `GesturesObserver` that attaches its detector on `loaded`, so a tap exists
            // neither in the observable's table nor at all on an unmounted row (measured in
            // `specs/foreign-parent.ts`, which mounts one and drives a real `MotionEvent` pair).
            // What belongs HERE is that the row wired the handler and that the handler's work is
            // the same work the return key does — so: one observer, then the method it calls.
            expect(tapObservers(entryInner(row)._applyButton)).toBe(1);
            row.apply();
            expect(row.textChanged).toBe(false);
            expect(entryInner(row)._applyButton.visibility).toBe('collapse');

            entryInner(row)._field.text = 'Grace';
            emitOn(entryInner(row)._field, 'returnPress');
            info(`seen=[${seen.join('|')}] changed=${row.textChanged}`);
            // C:248-249 — with something to apply the return key emits `apply`, never both.
            expect(seen.join('|')).toBe('apply:Ada|apply:Grace');
            expect(row.textChanged).toBe(false);
        });

        await it('emits entry-activated when there is nothing to apply', () => {
            const row = new Adw.EntryRow({ text: 'Ada' });
            const seen: string[] = [];
            row.connect('apply', () => seen.push('apply'));
            // The signal carries NO parameter, as upstream declares it: what the host needs is
            // the row's own `activates-default`, read off the emitter.
            row.connect('entry-activated', (self: Adw.EntryRow) => seen.push(`activated:${self.activatesDefault}`));
            emitOn(entryInner(row)._field, 'returnPress');
            row.activatesDefault = true;
            emitOn(entryInner(row)._field, 'returnPress');
            info(`seen=[${seen.join('|')}]`);
            expect(seen.join('|')).toBe('activated:false|activated:true');
        });

        await it('retracts a pending apply when show-apply-button is turned OFF', () => {
            const row = new Adw.EntryRow({ showApplyButton: true });
            emitOn(entryInner(row)._field, 'focus');
            entryInner(row)._field.text = 'Ada';
            expect(row.textChanged).toBe(true);
            row.showApplyButton = false;
            info(`changed=${row.textChanged} apply=${entryInner(row)._applyButton.visibility}`);
            expect(row.textChanged).toBe(false);
            expect(entryInner(row)._applyButton.visibility).toBe('collapse');
        });

        await it('takes inherited and own construct props together, XML strings included', () => {
            const row = new Adw.EntryRow({ title: 'Name', text: 'Ada', maxLength: 5 });
            expect(`${row.title}/${row.text}/${row.textLength}`).toBe('Name/Ada/3');
            const fromXml = new Adw.EntryRow({ maxLength: '5', editable: 'false' } as Any);
            info(`fromXml max=${fromXml.maxLength} (${typeof fromXml.maxLength}) editable=${fromXml.editable}`);
            expect(fromXml.maxLength).toBe(5);
            expect(fromXml.editable).toBe(false);
            expect(() => new Adw.EntryRow({ maxLength: 'five' } as Any)).toThrow();
        });

        await it('gives the password row its indicator with no state object in between', () => {
            const row = new Adw.PasswordEntryRow();
            const views = entryInner(row as unknown as Adw.EntryRow);
            emitOn(views._field, 'focus');
            row.setCapsLockOn(true);
            expect(views._indicator.visibility).toBe('visible');
            row.setCapsLockOn(false);
            info(`after caps off: ${views._indicator.visibility}`);
            expect(views._indicator.visibility).toBe('collapse');
            // …and it answers the six it inherits.
            expect(new Adw.PasswordEntryRow({ text: 'hunter2', maxLength: 5 }).text).toBe('hunte');
        });
    });

    // ONE DOOR PER DECLARED MEMBER, on the device and in both legs. This is the suite that can
    // see what the off-device specs cannot: before it, `addEventListener('notify::active')` added
    // a listener nothing ever called on 'real-gio' — the emission belongs to the GObject — while
    // the same line worked on 'pure-js', so a widget's own specs passed and the device was silent.
    // Five verbs are refused through two overrides, because `on`, `once` and `off` delegate to
    // `addEventListener` / `removeEventListener` in `@nativescript/core`; this run is what proves
    // the installed version still does on the host that matters.
    await describe(`a declared member has one door on '${engine}'`, async () => {
        await it('refuses every NativeScript event verb for notify::active', () => {
            const row = new Adw.SwitchRow() as Any;
            for (const verb of ['addEventListener', 'removeEventListener', 'on', 'once', 'off']) {
                expect(() => row[verb]('notify::active', () => {})).toThrow();
            }
            let message = '';
            try {
                row.addEventListener('notify::active', () => {});
            } catch (error) {
                message = (error as Error).message;
            }
            info(`refusal=${message}`);
            expect(message.indexOf('connect(') >= 0).toBe(true);
        });

        await it('refuses an inherited declared property under every spelling', () => {
            const row = new Adw.SwitchRow() as Any;
            for (const name of ['notify::icon-name', 'notify::icon_name', 'notify::iconName']) {
                expect(() => row.addEventListener(name, () => {})).toThrow();
            }
        });

        await it('refuses a declared SIGNAL too, not just a notify', () => {
            // `apply` and `entry-activated` were NativeScript events before route D reached this
            // widget, so this is the line a caller of the old API writes.
            const row = new Adw.EntryRow() as Any;
            for (const name of ['apply', 'entry-activated', 'notify::text', 'notify::text-length']) {
                expect(() => row.addEventListener(name, () => {})).toThrow();
            }
        });

        // `activated` is NOT declared, so all five verbs still answer it. The two listeners are
        // DISTINCT on purpose: `Observable.addEventListener` drops a repeat of the same
        // (callback, thisArg) pair, so subscribing one function through both verbs would measure
        // the host's de-duplication rather than that both verbs reached the event.
        await it('leaves a NativeScript event on every verb', () => {
            const row = new Adw.ActionRow({ activatable: true });
            const fired: string[] = [];
            const viaAddEventListener = (): void => {
                fired.push('addEventListener');
            };
            const viaOn = (): void => {
                fired.push('on');
            };
            row.addEventListener('activated', viaAddEventListener);
            (row as Any).on('activated', viaOn);
            row.activate();
            (row as Any).off('activated', viaOn);
            row.removeEventListener('activated', viaAddEventListener);
            row.activate();
            info(`fired=[${fired.join(',')}]`);
            expect(fired.join(',')).toBe('addEventListener,on');
        });

        await it("refuses notify({ eventName }) and keeps notify('active')", () => {
            const row = new Adw.SwitchRow();
            const seen: boolean[] = [];
            row.connect('notify::active', (self: Adw.SwitchRow) => seen.push(self.active));
            expect(() => (row as Any).notify({ eventName: 'notify::active', object: row })).toThrow();
            // The GObject door: `g_object_notify`, which re-emits without a write.
            (row as Any).notify('active');
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join(',')).toBe('false');
        });

        await it('logs a handler exception, runs the next handler, and keeps the write', () => {
            const row = new Adw.SwitchRow();
            const seen: boolean[] = [];
            row.connect('notify::active', () => {
                throw new Error('gjsify: deliberate, the next handler must still run');
            });
            row.connect('notify::active', (self: Adw.SwitchRow) => seen.push(self.active));
            // GJS's rule, measured off-device: the assignment returns normally and the value stays.
            row.active = true;
            info(`seen=[${seen.join(',')}] active=${row.active} checked=${inner(row)._switch.checked}`);
            expect(seen.join(',')).toBe('true');
            expect(row.active).toBe(true);
            expect(inner(row)._switch.checked).toBe(true);
        });
    });

    if (engine !== 'real-gio') return;

    const GObject = requireGi('GObject', '2.0') as Any;
    const Gio = requireGi('Gio', '2.0') as Any;
    const Plain = GObject.registerClass(
        {
            GTypeName: 'GjsifyRowPlain',
            Properties: {
                active: GObject.ParamSpec.boolean('active', '', '', GObject.ParamFlags.READWRITE, false),
                title: GObject.ParamSpec.string('title', '', '', GObject.ParamFlags.READWRITE, ''),
            },
        },
        class Plain extends GObject.Object {},
    );

    await describe('the two GTypes are one inheritance chain on the real engine', async () => {
        await it('the switch row registers OVER the action row, which registers over nothing', () => {
            const parent = GObject.type_name(GObject.type_parent(switchMixin.$gtype));
            const root = GObject.type_name(GObject.type_parent(rowMixin.$gtype));
            info(`AdwSwitchRow -> ${parent} -> ${root}`);
            expect(GObject.type_name(switchMixin.$gtype)).toBe('AdwSwitchRow');
            expect(GObject.type_name(rowMixin.$gtype)).toBe('AdwActionRow');
            // The plain `AdwActionRow` class between the two registrations contributes no GType:
            // the walk steps over an INHERITED dotless `$gtypeName` and takes the mixin above it.
            expect(parent).toBe('AdwActionRow');
            // `GridLayout` is a NativeScript class and has no GType at all, so the base
            // registration roots at GObject rather than at its host parent.
            expect(root).toBe('GObject');
        });

        await it('a switch row is both GTypes and a GObject.Object', () => {
            const row = new Adw.SwitchRow();
            expect(row instanceof GObject.Object).toBe(true);
            expect(GObject.type_is_a((row as Any).$gtype ?? switchMixin.$gtype, rowMixin.$gtype)).toBe(true);
            expect(new Adw.ActionRow() instanceof Adw.SwitchRow).toBe(false);
        });

        await it('the derived registration SKIPS the GObject verbs it inherits', () => {
            const skipped: string[] = [...(switchMixin.$foreignSkipped ?? [])];
            info(`switch skipped=[${skipped.sort().join(',')}]`);
            expect(skipped.includes('connect')).toBe(true);
            expect(skipped.includes('disconnect')).toBe(true);
            expect(skipped.includes('emit')).toBe(true);
            // So the PARENT's captured thunks are what a switch row runs — including for the
            // property only the leaf declares.
            expect(Object.prototype.hasOwnProperty.call(switchMixin.prototype, 'connect')).toBe(false);
        });

        await it('get_property/set_property reach the own AND the inherited property', () => {
            const row = new Adw.SwitchRow();
            (row as Any).set_property('active', true);
            expect(row.get_property('active')).toBe(true);
            expect(inner(row)._switch.checked).toBe(true);
            (row as Any).set_property('title', 'Dark style');
            expect(row.get_property('title')).toBe('Dark style');
            expect(inner(row)._titleLabel.text).toBe('Dark style');
            expect(typeof row.get_property('active')).toBe('boolean');
        });

        await it('bind_property binds across the inheritance, both directions', () => {
            const row = new Adw.SwitchRow();
            const plain = new Plain();
            const own = (row as Any).bind_property('active', plain, 'active', GObject.BindingFlags.BIDIRECTIONAL);
            const inherited = (row as Any).bind_property('title', plain, 'title', GObject.BindingFlags.DEFAULT);
            row.active = true;
            expect(plain.active).toBe(true);
            plain.active = false;
            info(`after plain write: active=${row.active} checked=${inner(row)._switch.checked}`);
            expect(row.active).toBe(false);
            expect(inner(row)._switch.checked).toBe(false);
            row.title = 'Dark style';
            expect(plain.title).toBe('Dark style');
            own.unbind();
            inherited.unbind();
        });

        await it('Gio.ListStore hands back the same widget, with both halves intact', () => {
            const store = new Gio.ListStore({ item_type: GObject.Object.$gtype });
            const row = new Adw.SwitchRow({ title: 'Dark style', active: true });
            store.append(row);
            const back = store.get_item(0);
            expect(back === row).toBe(true);
            expect(back.active).toBe(true);
            expect(back.title).toBe('Dark style');
            expect(back instanceof GridLayout).toBe(true);
        });
    });

    await describe('the entry row is a GObject with six pspecs and two GSignals', async () => {
        await it('registers over the action row, like the switch row beside it', () => {
            const parent = GObject.type_name(GObject.type_parent(entryMixin.$gtype));
            info(`AdwEntryRow -> ${parent}`);
            expect(GObject.type_name(entryMixin.$gtype)).toBe('AdwEntryRow');
            expect(parent).toBe('AdwActionRow');
            expect(new Adw.EntryRow() instanceof GObject.Object).toBe(true);
        });

        await it('lists its six properties as real pspecs, each with the declared type', () => {
            // `list_properties` is STATIC on the constructor and reads the class it is CALLED on,
            // so the mixin — where the registration landed — is the receiver.
            const found: Record<string, string> = {};
            for (const pspec of GObject.Object.list_properties.call(entryMixin) as Any[]) {
                found[pspec.get_name()] = GObject.type_name(pspec.value_type);
            }
            info(`pspecs=${JSON.stringify(found)}`);
            expect(found['text']).toBe('gchararray');
            expect(found['text-length']).toBe('guint');
            expect(found['max-length']).toBe('gint');
            expect(found['editable']).toBe('gboolean');
            expect(found['show-apply-button']).toBe('gboolean');
            expect(found['activates-default']).toBe('gboolean');
            // …beside the four it inherits from the action row, on the same class.
            expect(found['title']).toBe('gchararray');
        });

        await it('normalizes on the GObject path too — set_property truncates and re-derives', () => {
            // The direct C entry point into a property. If node-gi reached the stored value
            // without the seam's wrapper, this is where the truncation and the sibling-read
            // would both disappear while the JS accessors kept passing.
            const row = new Adw.EntryRow() as Any;
            row.set_property('max-length', 5);
            row.set_property('text', 'Ada Lovelace');
            info(`text='${row.get_property('text')}' length=${row.get_property('text-length')}`);
            expect(row.get_property('text')).toBe('Ada L');
            expect(row.get_property('text-length')).toBe(5);
            expect(entryInner(row as Adw.EntryRow)._field.text).toBe('Ada L');
            // …and the inherited one still resolves to the action row's store.
            row.set_property('title', 'Name');
            expect(row.get_property('title')).toBe('Name');
        });

        await it('binds text across the inheritance like any other property', () => {
            const row = new Adw.EntryRow();
            const plain = new Plain();
            const binding = (row as Any).bind_property('text', plain, 'title', GObject.BindingFlags.BIDIRECTIONAL);
            row.text = 'Ada';
            expect(plain.title).toBe('Ada');
            plain.title = 'Grace';
            info(`after plain write: text='${row.text}' field='${entryInner(row)._field.text}'`);
            expect(row.text).toBe('Grace');
            expect(entryInner(row)._field.text).toBe('Grace');
            binding.unbind();
        });

        await it('emits apply and entry-activated as GSignals, through emit', () => {
            const row = new Adw.EntryRow();
            const seen: string[] = [];
            const id = row.connect('apply', () => seen.push('apply'));
            row.connect('entry-activated', () => seen.push('entry-activated'));
            (row as Any).emit('apply');
            (row as Any).emit('entry-activated');
            row.disconnect(id);
            (row as Any).emit('apply');
            info(`seen=[${seen.join('|')}]`);
            expect(seen.join('|')).toBe('apply|entry-activated');

            // `emit` is GObject's: a name no class DECLARED throws, as in GJS. A NativeScript event
            // goes through `notify({ eventName })` and reaches the observable.
            const heard: string[] = [];
            (row as Any).on('custom-host-event', () => heard.push('host'));
            let refused = '';
            try {
                (row as Any).emit('custom-host-event');
            } catch (error) {
                refused = String((error as Error).message);
            }
            expect(refused.startsWith("No signal 'custom-host-event' on object '")).toBe(true);
            expect(heard.length).toBe(0);
            (row as Any).notify({ eventName: 'custom-host-event', object: row });
            info(`notify reached the observable: [${heard.join('|')}]`);
            expect(heard.join('|')).toBe('host');
        });

        await it('hands the same widget back out of a Gio.ListStore, text intact', () => {
            const store = new Gio.ListStore({ item_type: GObject.Object.$gtype });
            const row = new Adw.EntryRow({ title: 'Name', text: 'Ada', maxLength: 5 });
            store.append(row);
            const back = store.get_item(0);
            expect(back === row).toBe(true);
            expect(`${back.text}/${back.textLength}/${back.maxLength}`).toBe('Ada/3/5');
            expect(back instanceof GridLayout).toBe(true);
        });
    });
};

export default rowsSpec;

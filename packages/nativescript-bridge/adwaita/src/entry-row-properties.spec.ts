// THE SIX DECLARED PROPERTIES OF `AdwEntryRow`, ON THE REAL WIDGET (ADR 0105 § 2, route D).
//
// The entry row's store used to be an `EntryRowState` held beside the widget; it is now six
// GObject properties of the class itself. That swap moves things this package had no test for:
// `text` is truncated by a property NORMALIZER rather than by a setter, `text-length` is
// read-only BY derivation rather than by having no setter at all, and every change reaches a
// consumer as a `notify::` that carries no value — so what used to be an event payload is now
// read off the emitter.
//
// WHY THE VECTORS ARE REPLAYED HERE AND NOT ONLY IN `entry-rows.spec.ts`. That file drives the
// headless `EntryRowState` plus the painter, which is what `@gjsify/adwaita-web` shares; this
// one drives the WIDGET — typing into the `TextField` it composed, focusing it, pressing its
// return key — and reads the views it actually built. Between the two there used to be a
// transcription that could drift: the row wired state→painter itself, and nothing held the
// wiring to the table. The conformance header asks for exactly this ("a renderer suite can
// replay them against a real widget"), and route D is what made the derivation reachable
// without the state object in between.
//
// This lives on the TREES entry (`src/test.trees.mts`): the widget chain evaluates
// `@nativescript/core` at module scope, reachable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import {
    ENTRY_MAX_LENGTH_VECTORS,
    ENTRY_ROW_ACTIVATION_VECTORS,
    ENTRY_ROW_STATE_VECTORS,
    ENTRY_TEXT_LENGTH_VECTORS,
    type EntryRowStep,
} from '@gjsify/adwaita-core/conformance';

import * as Adw from './namespace/adw.js';
import {
    NOTIFY_ACTIVATES_DEFAULT,
    NOTIFY_EDITABLE,
    NOTIFY_MAX_LENGTH,
    NOTIFY_SHOW_APPLY_BUTTON,
    NOTIFY_TEXT,
    NOTIFY_TEXT_LENGTH,
    SIGNAL_APPLY,
    SIGNAL_ENTRY_ACTIVATED,
} from './widgets/adw-entry-row.js';
import { NS_EDIT_ICON_CLASS, NS_ENTRY_ROW_CLASS, NS_INSENSITIVE_OPACITY } from './widgets/entry-row-view.js';

/** A NativeScript view as this suite reads it, plus the stub's own event door. */
interface StubView {
    visibility: string;
    className: string;
    opacity: number;
    text: string;
    editable: boolean;
    _emit(eventName: string): void;
}

/**
 * The views the row composed in its constructor, read off the row.
 *
 * Deliberately NOT a set of stand-ins: the point of this file is that the widget's own
 * `TextField` and icons carry the painted state, so a render the row forgot to run is a
 * failure here rather than a value the test supplied itself.
 */
function viewsOf(row: Adw.EntryRow): Record<string, StubView> {
    const loose = row as unknown as Record<string, StubView>;
    return {
        field: loose._field,
        emptyTitle: loose._emptyTitle,
        title: loose._titleLabel,
        editIcon: loose._editIcon,
        indicator: loose._indicator,
        applyButton: loose._applyButton,
    };
}

/** What NativeScript's XML builder does to an attribute: assign the raw string. */
function xml(row: Adw.EntryRow, name: string, value: string): void {
    (row as unknown as Record<string, unknown>)[name] = value;
}

/**
 * One conformance step as the PLATFORM gesture it stands for.
 *
 * `setText` types into the field rather than writing the property, so the field→property
 * wiring is under test too — including the case where the normalizer truncates what was typed
 * and the row has to paint the shorter value back.
 */
function applyStep(row: Adw.EntryRow, step: EntryRowStep): void {
    const views = viewsOf(row);
    switch (step.op) {
        case 'setText':
            views.field.text = step.value;
            return;
        case 'setEditing':
            views.field._emit(step.value ? 'focus' : 'blur');
            return;
        case 'setEditable':
            row.editable = step.value;
            return;
        case 'setMaxLength':
            row.maxLength = step.value;
            return;
        case 'setShowApplyButton':
            row.showApplyButton = step.value;
            return;
        case 'setShowIndicator':
            row.setShowIndicator(step.value);
            return;
        case 'setActivatesDefault':
            row.activatesDefault = step.value;
            return;
        case 'apply':
            row.apply();
            return;
    }
}

/** NS `visibility` for a boolean, spelled out so the expectation is not the code under test. */
function visible(shown: boolean): string {
    return shown ? 'visible' : 'collapse';
}

export const AdwEntryRowPropertiesNsTest = async () => {
    await describe('Adw.EntryRow declared properties on the pure-JS engine', async () => {
        await it('runs on the subset here, which is what the rest of this suite measures', () => {
            const mixin = Object.getPrototypeOf(Adw.EntryRow) as object;
            expect(Object.hasOwn(mixin, '$gtype')).toBe(false);
            expect(Object.hasOwn(mixin, '$gtypeName')).toBe(false);
        });

        await it('starts at the defaults `adw_entry_row_init` leaves behind', () => {
            const row = new Adw.EntryRow();
            expect(row.text).toBe('');
            expect(row.textLength).toBe(0);
            expect(row.maxLength).toBe(0);
            // GtkText starts editable; a read-only row is the opt-out.
            expect(row.editable).toBe(true);
            expect(row.showApplyButton).toBe(false);
            expect(row.activatesDefault).toBe(false);
            expect(row.editing).toBe(false);
            expect(row.textChanged).toBe(false);
        });

        await it('answers every property in its kebab spelling too', () => {
            const row = new Adw.EntryRow();
            const loose = row as unknown as Record<string, unknown>;
            row.maxLength = 5;
            row.showApplyButton = true;
            expect(loose['max-length']).toBe(5);
            expect(loose['show-apply-button']).toBe(true);
            expect(loose['text-length']).toBe(0);
            expect(loose['activates-default']).toBe(false);
        });

        await it('does not shadow the action row with a second set of accessors', () => {
            // The derived declaration adds only the six: a write landing in one store and a
            // read in another is exactly what route D removed.
            const own = Object.getPrototypeOf(Adw.EntryRow.prototype) as object;
            expect(Object.hasOwn(own, 'text')).toBe(true);
            expect(Object.hasOwn(own, 'text-length')).toBe(true);
            expect(Object.hasOwn(own, 'title')).toBe(false);
            expect(Object.hasOwn(own, 'icon-name')).toBe(false);
        });

        await it('declares its notifies and its two signals in emittedSignals', () => {
            const emitted = (Adw.EntryRow as unknown as { emittedSignals: readonly string[] }).emittedSignals;
            for (const name of [
                NOTIFY_TEXT,
                NOTIFY_TEXT_LENGTH,
                NOTIFY_MAX_LENGTH,
                NOTIFY_EDITABLE,
                NOTIFY_SHOW_APPLY_BUTTON,
                NOTIFY_ACTIVATES_DEFAULT,
                SIGNAL_APPLY,
                SIGNAL_ENTRY_ACTIVATED,
            ]) {
                expect(emitted.includes(name)).toBe(true);
            }
        });

        await it('takes the six beside the inherited properties as construct props', () => {
            const row = new Adw.EntryRow({ title: 'Name', text: 'Ada', maxLength: 5, showApplyButton: true });
            expect(row.title).toBe('Name');
            expect(row.text).toBe('Ada');
            expect(row.textLength).toBe(3);
            expect(row.maxLength).toBe(5);
            expect(row.showApplyButton).toBe(true);
            expect(viewsOf(row).field.text).toBe('Ada');
        });
    });

    await describe('Adw.EntryRow text and text-length', async () => {
        await it('writes the composed field from the property', () => {
            const row = new Adw.EntryRow();
            row.text = 'Ada';
            expect(viewsOf(row).field.text).toBe('Ada');
        });

        await it('follows typing in the field back into the property', () => {
            const row = new Adw.EntryRow();
            viewsOf(row).field.text = 'Ada';
            expect(row.text).toBe('Ada');
        });

        await it('counts CHARACTERS, not UTF-16 units', () => {
            const row = new Adw.EntryRow();
            for (const { text, length, rule } of ENTRY_TEXT_LENGTH_VECTORS) {
                row.text = text;
                expect(row.textLength, rule).toBe(length);
            }
        });

        await it('ignores a write to text-length — read-only, by derivation', () => {
            // Upstream declares it G_PARAM_READABLE; this seam has no read-only flag, so the
            // normalizer derives the value from the row's own text and drops what was written.
            const row = new Adw.EntryRow();
            row.text = 'Ada';
            row.textLength = 99;
            expect(row.textLength).toBe(3);
            const seen: number[] = [];
            row.connect(NOTIFY_TEXT_LENGTH, (self) => seen.push(self.textLength));
            row.textLength = 0;
            // The write resolved to the value already held, so the equal-write rule dropped it.
            expect(seen).toStrictEqual([]);
        });

        await it('notifies a real text change and stays silent on an equal write', () => {
            const row = new Adw.EntryRow();
            const seen: string[] = [];
            row.connect(NOTIFY_TEXT, (self) => seen.push(self.text));
            row.text = 'Ada';
            row.text = 'Ada';
            row.text = '';
            expect(seen).toStrictEqual(['Ada', '']);
        });

        await it('has text-length settled by the time either notify reaches a consumer', () => {
            // `text-length` is derived INSIDE the `notify::text` emission, so a consumer of
            // either one reads a row whose two values agree — which is the whole reason the
            // payload-carrying events could go.
            const row = new Adw.EntryRow();
            const seen: string[] = [];
            row.connect(NOTIFY_TEXT_LENGTH, (self) => seen.push(`length:${self.textLength}:${self.text}`));
            row.connect(NOTIFY_TEXT, (self) => seen.push(`text:${self.text}:${self.textLength}`));
            row.text = 'Ada';
            expect(seen).toStrictEqual(['length:3:Ada', 'text:Ada:3']);
        });

        await it('truncates to max-length on the way IN, counting characters', () => {
            for (const { text, maxLength, clamped, length, rule } of ENTRY_MAX_LENGTH_VECTORS) {
                const row = new Adw.EntryRow();
                row.maxLength = maxLength;
                row.text = text;
                expect(row.text, rule).toBe(clamped);
                expect(row.textLength, rule).toBe(length);
                expect(viewsOf(row).field.text, rule).toBe(clamped);
            }
        });

        await it('truncates typing too, and paints the shorter value back into the field', () => {
            const row = new Adw.EntryRow({ maxLength: 5 });
            viewsOf(row).field.text = 'Ada Lovelace';
            expect(row.text).toBe('Ada L');
            expect(viewsOf(row).field.text).toBe('Ada L');
        });

        await it('truncates what it already holds when the limit DROPS', () => {
            const row = new Adw.EntryRow({ text: 'Ada Lovelace' });
            const seen: string[] = [];
            row.connect(NOTIFY_TEXT, (self) => seen.push(self.text));
            row.maxLength = 5;
            expect(row.text).toBe('Ada L');
            expect(viewsOf(row).field.text).toBe('Ada L');
            // The truncation arrives as an ordinary text change, not as a silent rewrite.
            expect(seen).toStrictEqual(['Ada L']);
        });

        await it('leaves the text alone when a new limit truncates nothing', () => {
            const row = new Adw.EntryRow({ text: 'Ada' });
            const seen: string[] = [];
            row.connect(NOTIFY_TEXT, (self) => seen.push(self.text));
            row.maxLength = 5;
            expect(row.text).toBe('Ada');
            expect(seen).toStrictEqual([]);
        });

        await it('notifies max-length itself — g_object_set_property does, even where the C setter does not', () => {
            // `adw_entry_row_set_max_length` (C:1329-1343) carries no g_object_notify_by_pspec,
            // and ENTRY_ROW_GUARD_VECTORS pins that. It is about the DIRECT C entry point:
            // GObject's generic property path notifies after `set_property` returns, so
            // `row.maxLength = n` — which is what a GJS consumer writes — notifies in GTK too.
            const row = new Adw.EntryRow();
            const seen: number[] = [];
            row.connect(NOTIFY_MAX_LENGTH, (self) => seen.push(self.maxLength));
            row.maxLength = 5;
            row.maxLength = 5;
            expect(seen).toStrictEqual([5]);
        });

        await it('floors a negative max-length at 0 rather than truncating to empty', () => {
            const row = new Adw.EntryRow({ text: 'Ada' });
            row.maxLength = -1;
            expect(row.maxLength).toBe(0);
            expect(row.text).toBe('Ada');
        });
    });

    await describe('Adw.EntryRow XML attributes', async () => {
        await it('parses the typed value out of the string NativeScript assigns', () => {
            const row = new Adw.EntryRow();
            xml(row, 'maxLength', '5');
            expect(row.maxLength).toBe(5);
            xml(row, 'editable', 'false');
            expect(row.editable).toBe(false);
            xml(row, 'show-apply-button', 'true');
            expect(row.showApplyButton).toBe(true);
            xml(row, 'text', 'Ada L');
            expect(row.text).toBe('Ada L');
        });

        await it('clamps an XML max-length through the same normalizer as a typed write', () => {
            const row = new Adw.EntryRow({ text: 'Ada Lovelace' });
            xml(row, 'max-length', '5');
            expect(row.maxLength).toBe(5);
            expect(row.text).toBe('Ada L');
        });

        await it('refuses garbage rather than storing it', () => {
            const row = new Adw.EntryRow();
            expect(() => xml(row, 'editable', 'maybe')).toThrow();
            expect(row.editable).toBe(true);
            expect(() => xml(row, 'maxLength', 'five')).toThrow();
            expect(row.maxLength).toBe(0);
        });
    });

    await describe('Adw.EntryRow painting (libadwaita conformance vectors, on the widget)', async () => {
        for (const { name, steps, expected, rule } of ENTRY_ROW_STATE_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const row = new Adw.EntryRow();
                for (const step of steps) applyStep(row, step);
                const views = viewsOf(row);

                expect(row.text).toBe(expected.text);
                expect(row.textLength).toBe(expected.textLength);
                expect(row.editing).toBe(expected.editing);
                expect(row.editable).toBe(expected.editable);
                expect(row.textChanged).toBe(expected.textChanged);

                expect(views.field.text).toBe(expected.text);
                expect(views.field.editable).toBe(expected.editable);
                // The two titles are the endpoints of libadwaita's cross-fade;
                // the NS CSS subset swaps instead of lerping.
                expect(views.emptyTitle.visibility).toBe(visible(expected.emptyTarget === 0));
                expect(views.title.visibility).toBe(visible(expected.emptyTarget === 1));
                expect(views.editIcon.visibility).toBe(visible(expected.editIconVisible));
                // No insensitive widget state in NS — the C's set_sensitive is an opacity.
                expect(views.editIcon.opacity).toBe(expected.editIconSensitive ? 1 : NS_INSENSITIVE_OPACITY);
                expect(views.indicator.visibility).toBe(visible(expected.indicatorVisible));
                expect(views.applyButton.visibility).toBe(visible(expected.applyButtonVisible));

                const classes = (row.className ?? '').split(' ');
                expect((row.className ?? '').startsWith(NS_ENTRY_ROW_CLASS)).toBe(true);
                expect(classes.includes('focused')).toBe(expected.editing);
                expect(classes.includes('empty')).toBe(expected.empty);
            });
        }

        await it('keeps the pencil class list intact while it is sensitive', () => {
            expect(viewsOf(new Adw.EntryRow()).editIcon.className).toBe(NS_EDIT_ICON_CLASS);
        });

        await it('re-derives on EVERY setShowIndicator, redundant or not', () => {
            // C:1281-1296 has no equality guard, deliberately unlike setShowApplyButton — which
            // is why this one stayed a method instead of becoming a declared property: a
            // property would add the guard it must not have.
            const row = new Adw.EntryRow();
            viewsOf(row).field._emit('focus');
            row.setShowIndicator(true);
            expect(viewsOf(row).indicator.visibility).toBe(visible(true));
            // The painter is the only writer; blanking it proves the second call repaints.
            viewsOf(row).indicator.visibility = 'collapse';
            row.setShowIndicator(true);
            expect(viewsOf(row).indicator.visibility).toBe(visible(true));
        });

        await it('retracts a pending apply when show-apply-button is turned OFF', () => {
            const row = new Adw.EntryRow({ showApplyButton: true });
            viewsOf(row).field._emit('focus');
            viewsOf(row).field.text = 'Ada';
            expect(row.textChanged).toBe(true);
            row.showApplyButton = false;
            expect(row.textChanged).toBe(false);
            expect(viewsOf(row).applyButton.visibility).toBe(visible(false));
        });
    });

    await describe('Adw.EntryRow return key (text_activated_cb)', async () => {
        for (const { name, steps, activation, textChangedAfter, rule } of ENTRY_ROW_ACTIVATION_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const row = new Adw.EntryRow();
                for (const step of steps) applyStep(row, step);

                const seen: string[] = [];
                row.connect(SIGNAL_APPLY, () => seen.push('apply'));
                // `entry-activated` carries NO parameter, as upstream declares it: what the host
                // needs is the row's own `activates-default`, read off the emitter.
                row.connect(SIGNAL_ENTRY_ACTIVATED, (self) => seen.push(`entry-activated:${self.activatesDefault}`));
                viewsOf(row).field._emit('returnPress');

                if (activation.signal === 'apply') {
                    expect(seen).toStrictEqual(['apply']);
                } else {
                    expect(seen).toStrictEqual([`entry-activated:${activation.activateDefault}`]);
                }
                expect(row.textChanged).toBe(textChangedAfter);
                // …and the paint follows: an applied row puts its button away.
                expect(viewsOf(row).applyButton.visibility).toBe(visible(false));
            });
        }

        await it('emits apply from the apply button and clears the latch', () => {
            const row = new Adw.EntryRow({ showApplyButton: true });
            viewsOf(row).field._emit('focus');
            viewsOf(row).field.text = 'Ada';
            expect(viewsOf(row).applyButton.visibility).toBe(visible(true));

            const seen: string[] = [];
            row.connect(SIGNAL_APPLY, (self) => seen.push(self.text));
            (viewsOf(row).applyButton as unknown as { _emit(name: string): void })._emit('tap');
            expect(seen).toStrictEqual(['Ada']);
            expect(row.textChanged).toBe(false);
            expect(viewsOf(row).applyButton.visibility).toBe(visible(false));
        });
    });

    await describe('Adw.PasswordEntryRow over the declared parent', async () => {
        await it('drives the parent row through setShowIndicator, with no state object between', () => {
            // `PasswordEntryRowState` now composes the ROW itself (the structural
            // `EntryRowIndicatorSink`), because there is no `EntryRowState` beside it to take.
            const row = new Adw.PasswordEntryRow();
            const views = viewsOf(row as unknown as Adw.EntryRow);
            views.field._emit('focus');
            row.setCapsLockOn(true);
            expect(views.indicator.visibility).toBe(visible(true));
            row.setCapsLockOn(false);
            expect(views.indicator.visibility).toBe(visible(false));
        });

        await it('still answers the six it inherits from the entry row', () => {
            const row = new Adw.PasswordEntryRow({ text: 'hunter2', maxLength: 5 });
            expect(row.text).toBe('hunte');
            expect(row.textLength).toBe(5);
            expect(row.editable).toBe(true);
        });
    });
};

export default AdwEntryRowPropertiesNsTest;

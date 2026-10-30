// `Gtk.Entry`'S FIVE DECLARED PROPERTIES AND TWO SIGNALS, measured on the pure-JS leg
// (ADR 0105 § 2, route D).
//
// The entry used to hold `_text` and `_maxLength` as class fields behind hand-rolled accessors,
// with an `_applyText` funnel guarding the re-entrancy between the field and the widget. `text`,
// `text-length`, `max-length`, `placeholder-text` and `editable` are GObject properties now, and
// `changed` / `activate` are declared signals — so on Android they are a registered GType's
// members, and here, on iOS and in the browser, the seam's own store.
//
// WHY THIS FILE EXISTS BESIDE `entry.spec.ts`: that one drives `clampEntryText` /
// `entryTextLength` directly, from the non-trees entry, because the widget cannot be imported
// there at all. This one drives the WIDGET — typing into the `TextField` it composed, pressing
// its return key — and the column it drives is the one the arithmetic suite cannot reach: the
// EMISSION ORDER measured on GTK 4.22.5.
//
// That order is the reason `text` and `max-length` are `explicitNotify` and therefore SEAM-OWNED
// (`isSeamOwned` in `widgets/signals.ts`): their accessor reads the seam's store on BOTH legs,
// which is what lets this off-device file speak for route D, where there is no harness at all.
// `text-length`, `placeholder-text` and `editable` are not seam-owned — on route D their value
// lives in the GObject and node-gi's accessor notifies — so what this file pins for those three
// is the normalizer and the hook, not the store.
//
// It also pins what the migration CHANGED for a consumer: a `notify::text` carries no payload
// past the sender (it was a NativeScript event with `{ text, textLength }`), `changed` is new,
// and `max-length` now notifies where the hand-rolled setter was silent.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends GridLayout` reaches
// `@nativescript/core` at module scope, resolvable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import { ENTRY_ROW_MAX_LENGTH_LIMIT } from '@gjsify/adwaita-core';
import { ENTRY_MAX_LENGTH_VECTORS, ENTRY_TEXT_LENGTH_VECTORS } from '@gjsify/adwaita-core/conformance';

import * as Gtk from './namespace/gtk.js';
import { emittedSignalsOf } from './widgets/signals.js';
import {
    ACTIVATE,
    CHANGED,
    NOTIFY_EDITABLE,
    NOTIFY_MAX_LENGTH,
    NOTIFY_PLACEHOLDER_TEXT,
    NOTIFY_TEXT,
    NOTIFY_TEXT_LENGTH,
} from './widgets/gtk-entry.js';

/** The five property names, canonical spelling, as the pspecs declare them. */
const DECLARED = ['text', 'text-length', 'max-length', 'placeholder-text', 'editable'] as const;

/** Everything the entry can emit, so a watcher never silently misses a name. */
const EMISSIONS = [
    CHANGED,
    ACTIVATE,
    NOTIFY_TEXT,
    NOTIFY_TEXT_LENGTH,
    NOTIFY_MAX_LENGTH,
    NOTIFY_PLACEHOLDER_TEXT,
    NOTIFY_EDITABLE,
] as const;

const loose = (entry: Gtk.Entry): Record<string, unknown> => entry as unknown as Record<string, unknown>;

/** The `TextField` the entry composed, as this suite reads and drives it. */
const fieldOf = (entry: Gtk.Entry): { text: string; hint: string; editable: boolean; _emit(name: string): void } =>
    entry.field as unknown as { text: string; hint: string; editable: boolean; _emit(name: string): void };

/**
 * The keyboard. Writing the stub's `text` dispatches `textChange`, which is the same event the
 * platform's field fires as the user types — so the field→property wiring is under test too,
 * including the case where the normalizer truncates what was typed and the entry has to paint
 * the shorter value back.
 */
const type = (entry: Gtk.Entry, text: string): void => {
    fieldOf(entry).text = text;
};

/** Record every signal and `notify::` the entry emits, in order. */
function watch(entry: Gtk.Entry): string[] {
    const seen: string[] = [];
    for (const name of EMISSIONS) entry.connect(name, () => seen.push(name));
    return seen;
}

export const GtkEntryPropertiesNsTest = async () => {
    await describe('Gtk.Entry: five declared properties, two declared signals', async () => {
        await it("starts at gtk_entry_init's defaults, having emitted nothing", () => {
            const entry = new Gtk.Entry();
            const seen = watch(entry);
            expect(entry.text).toBe('');
            expect(entry.textLength).toBe(0);
            expect(entry.maxLength).toBe(0);
            expect(entry.placeholderText).toBe('');
            expect(entry.editable).toBe(true);
            expect(seen.length).toBe(0);
        });

        await it('declares what it emits: widget signals, then its signals, then one notify each', () => {
            // The seam composes this list (`declaredEmissionsOf`), where the class used to carry a
            // hand-written `static emittedSignals`. `construct-vectors.spec.ts` pins the same
            // string through the XML builder; this reads it off the class.
            expect(emittedSignalsOf(Gtk.Entry).join()).toBe(
                'map,unmap,changed,activate,notify::text,notify::text-length,notify::max-length,' +
                    'notify::placeholder-text,notify::editable',
            );
        });

        await it('answers each property in all three GObject spellings', () => {
            const entry = new Gtk.Entry();
            entry.text = 'Ada';
            entry.maxLength = 12;
            entry.placeholderText = 'Name';
            entry.editable = false;
            const props = loose(entry);
            expect(props.text).toBe('Ada');
            expect(props.textLength).toBe(3);
            expect(props['text-length']).toBe(3);
            expect(props.text_length).toBe(3);
            expect(props.maxLength).toBe(12);
            expect(props['max-length']).toBe(12);
            expect(props.max_length).toBe(12);
            expect(props['placeholder-text']).toBe('Name');
            expect(props.placeholder_text).toBe('Name');
            expect(props.editable).toBe(false);
        });

        await it('is GObject-only: notify() refuses the declared names by payload', () => {
            // `notify::text` used to be a NativeScript event with a `{ text, textLength }` body
            // (`NotifyEntryTextEventData`, now gone). Dispatching one throws rather than quietly
            // reaching no GObject handler.
            const entry = new Gtk.Entry();
            for (const name of DECLARED) {
                expect(() => entry.notify({ eventName: `notify::${name}`, object: entry as never })).toThrow();
            }
        });
    });

    await describe('Gtk.Entry text emission order (measured on GTK 4.22.5)', async () => {
        await it('emits `changed` BEFORE `notify::text` on a programmatic write', () => {
            // `gtk_editable_set_text` emits the signal and then notifies. `text-length` follows,
            // as the vendored `Adw.EntryRow` measures.
            const entry = new Gtk.Entry();
            const seen = watch(entry);
            entry.text = 'Ada';
            expect(seen).toStrictEqual([CHANGED, NOTIFY_TEXT, NOTIFY_TEXT_LENGTH]);
            expect(fieldOf(entry).text).toBe('Ada');
        });

        await it('emits `notify::text` BEFORE `changed` on a typed one — the order REVERSES', () => {
            // `insert_text` / `delete_text`, the keyboard's path, notify and then emit. A
            // `changed` handler that reads the widget has to see the same sequence here as on GTK,
            // which is the whole reason `text` is `explicitNotify` and the entry carries `_typing`.
            const entry = new Gtk.Entry();
            const seen = watch(entry);
            type(entry, 'Ada');
            expect(seen).toStrictEqual([NOTIFY_TEXT, CHANGED, NOTIFY_TEXT_LENGTH]);
            expect(entry.text).toBe('Ada');
        });

        await it('answers an EQUAL write with silence, typed or programmatic', () => {
            // DIVERGENCE #1 from the measurement, deliberate: GTK emits `changed` twice plus a
            // `notify::text` even for an equal write, because `gtk_editable_set_text` is
            // `delete_text (0, -1)` then `insert_text` and a handler between the two reads `''`.
            // This port has no `GtkEntryBuffer` and no such decomposition, so there is no
            // transient `''` to report — see the widget's header.
            const entry = new Gtk.Entry();
            entry.text = 'Ada';
            const seen = watch(entry);
            entry.text = 'Ada';
            type(entry, 'Ada');
            expect(seen.length).toBe(0);
            expect(entry.text).toBe('Ada');
        });

        await it('says nothing for the default-equal write a fresh entry gets', () => {
            const entry = new Gtk.Entry();
            const seen = watch(entry);
            entry.text = '';
            expect(seen.length).toBe(0);
        });

        await it('clears to the empty string and says so once', () => {
            const entry = new Gtk.Entry();
            entry.text = 'Ada';
            const seen = watch(entry);
            entry.text = '';
            expect(seen).toStrictEqual([CHANGED, NOTIFY_TEXT, NOTIFY_TEXT_LENGTH]);
            expect(entry.text).toBe('');
            expect(entry.textLength).toBe(0);
            expect(fieldOf(entry).text).toBe('');
        });

        await it('REFUSES a null, leaving the value standing — the measurement, not the row', () => {
            // DIVERGENCE #3, and the one place this class parts with `AdwEntryRow`, which resolves
            // a `null` to `''`. Upstream refuses it: `gtk_editable_set_text` asserts
            // `text != NULL`, the value does not move and nothing is emitted. The normalizer
            // answers with the text already held, so the equal-write rule drops the write.
            const entry = new Gtk.Entry();
            entry.text = 'Ada';
            const seen = watch(entry);
            loose(entry).text = null;
            loose(entry).text = undefined;
            expect(entry.text).toBe('Ada');
            expect(seen.length).toBe(0);
        });

        await it("emits `activate` on the field's return key", () => {
            const entry = new Gtk.Entry();
            const seen = watch(entry);
            fieldOf(entry)._emit('returnPress');
            expect(seen).toStrictEqual([ACTIVATE]);
        });
    });

    await describe('Gtk.Entry text-length (read-only by derivation)', async () => {
        for (const { text, length, rule } of ENTRY_TEXT_LENGTH_VECTORS) {
            await it(`${JSON.stringify(text)} → ${length} — ${rule}`, () => {
                const entry = new Gtk.Entry();
                entry.text = text;
                expect(entry.textLength).toBe(length);
            });
        }

        await it('ignores a write and keeps answering the count of its own text', () => {
            // Upstream declares it `G_PARAM_READABLE` alone (measured), and there is no such flag
            // at this seam — so the normalizer derives the value and a write resolves to what is
            // already held. `AdwEntryRow:text-length` states the same thing the same way.
            const entry = new Gtk.Entry();
            entry.text = 'Ada';
            const seen = watch(entry);
            entry.textLength = 99;
            loose(entry)['text-length'] = 0;
            expect(entry.textLength).toBe(3);
            expect(seen.length).toBe(0);
        });
    });

    await describe('Gtk.Entry max-length (shared conformance vectors)', async () => {
        for (const vector of ENTRY_MAX_LENGTH_VECTORS) {
            await it(`limit first: ${JSON.stringify(vector.text)} @ ${vector.maxLength} — ${vector.rule}`, () => {
                const entry = new Gtk.Entry();
                entry.maxLength = vector.maxLength;
                entry.text = vector.text;
                expect(entry.text).toBe(vector.clamped);
                expect(entry.textLength).toBe(vector.length);
                expect(fieldOf(entry).text).toBe(vector.clamped);
            });

            await it(`text first: ${JSON.stringify(vector.text)} @ ${vector.maxLength} — ${vector.rule}`, () => {
                // The same row through the OTHER door: a limit arriving after the text has to
                // truncate what is already held. NativeScript's XML builder assigns attributes in
                // document order, so both orders are reachable from markup alone.
                const entry = new Gtk.Entry();
                entry.text = vector.text;
                entry.maxLength = vector.maxLength;
                expect(entry.text).toBe(vector.clamped);
                expect(entry.textLength).toBe(vector.length);
                expect(fieldOf(entry).text).toBe(vector.clamped);
            });

            await it(`typed: ${JSON.stringify(vector.text)} @ ${vector.maxLength} — ${vector.rule}`, () => {
                // And through the keyboard, which is where a truncation is visible: the entry has
                // to paint the shorter value back into the field it was typed into.
                const entry = new Gtk.Entry();
                entry.maxLength = vector.maxLength;
                type(entry, vector.text);
                expect(entry.text).toBe(vector.clamped);
                expect(fieldOf(entry).text).toBe(vector.clamped);
            });
        }

        await it('announces a truncating shrink TEXT-FIRST: changed, notify::text, notify::max-length', () => {
            // Measured, and the reason `max-length` is `explicitNotify`: the seam's own notify
            // would otherwise have come ahead of the text it moves.
            const entry = new Gtk.Entry();
            entry.text = 'Ada Lovelace';
            const seen = watch(entry);
            entry.maxLength = 3;
            expect(seen).toStrictEqual([CHANGED, NOTIFY_TEXT, NOTIFY_TEXT_LENGTH, NOTIFY_MAX_LENGTH]);
            expect(entry.text).toBe('Ada');
        });

        await it('announces a non-truncating write as the limit alone, and restores nothing', () => {
            const entry = new Gtk.Entry();
            entry.text = 'Ada';
            entry.maxLength = 3;
            const seen = watch(entry);
            entry.maxLength = 12;
            expect(seen).toStrictEqual([NOTIFY_MAX_LENGTH]);
            expect(entry.text).toBe('Ada');
        });

        await it('answers an equal limit with silence', () => {
            const entry = new Gtk.Entry();
            entry.maxLength = 5;
            const seen = watch(entry);
            entry.maxLength = 5;
            expect(seen.length).toBe(0);
        });

        await it('clamps the limit into 0…65535, so `-1` is unlimited rather than empty', () => {
            const entry = new Gtk.Entry();
            entry.maxLength = -1;
            expect(entry.maxLength).toBe(0);
            entry.maxLength = 1000000;
            expect(entry.maxLength).toBe(ENTRY_ROW_MAX_LENGTH_LIMIT);
            entry.text = 'Ada Lovelace';
            expect(entry.text).toBe('Ada Lovelace');
        });

        await it('reads `maxLength="3"` from markup as the number 3', () => {
            // The XML door: NativeScript assigns the raw attribute string, and
            // `readDeclaredValue` in front of the clamp is what keeps `'3'` from reaching the
            // ceiling arithmetic as text.
            const entry = new Gtk.Entry();
            loose(entry).maxLength = '3';
            expect(entry.maxLength).toBe(3);
            entry.text = 'Ada Lovelace';
            expect(entry.text).toBe('Ada');
        });
    });

    await describe('Gtk.Entry placeholder-text and editable', async () => {
        await it('notifies `placeholder-text` on EVERY write, equal ones included', () => {
            // Measured: `gtk_entry_set_placeholder_text` guards on nothing at all. `GtkImage`'s
            // `icon-name` and `AdwActionRow`'s `subtitle` are the other two declarations that
            // cannot use the seam's identity answer.
            const entry = new Gtk.Entry();
            entry.placeholderText = 'Name';
            const seen = watch(entry);
            entry.placeholderText = 'Name';
            entry.placeholderText = 'Name';
            expect(seen).toStrictEqual([NOTIFY_PLACEHOLDER_TEXT, NOTIFY_PLACEHOLDER_TEXT]);
            expect(fieldOf(entry).hint).toBe('Name');
        });

        await it('reads a null placeholder back as the empty string, as upstream does', () => {
            const entry = new Gtk.Entry();
            loose(entry).placeholderText = null;
            expect(entry.placeholderText).toBe('');
            expect(fieldOf(entry).hint).toBe('');
        });

        await it('gates the keyboard and NOTHING else: a non-editable entry still takes a write', () => {
            // Measured: `editable = false` refuses neither a programmatic write nor an
            // `insert_text`. It reaches the field's own `editable` and takes part in no refusal.
            const entry = new Gtk.Entry();
            entry.editable = false;
            expect(fieldOf(entry).editable).toBe(false);
            const seen = watch(entry);
            entry.text = 'Ada';
            expect(entry.text).toBe('Ada');
            expect(seen).toStrictEqual([CHANGED, NOTIFY_TEXT, NOTIFY_TEXT_LENGTH]);
        });

        await it('guards an equal `editable` write', () => {
            const entry = new Gtk.Entry();
            entry.editable = false;
            const seen = watch(entry);
            entry.editable = false;
            expect(seen.length).toBe(0);
            entry.editable = true;
            expect(seen).toStrictEqual([NOTIFY_EDITABLE]);
        });

        await it('reads `editable="false"` from markup as the boolean', () => {
            const entry = new Gtk.Entry();
            loose(entry).editable = 'false';
            expect(entry.editable).toBe(false);
            expect(fieldOf(entry).editable).toBe(false);
        });
    });

    await describe('Gtk.Entry construct props', async () => {
        await it('applies every declared property handed to the constructor', () => {
            const entry = new Gtk.Entry({
                text: 'Ada Lovelace',
                maxLength: 3,
                placeholderText: 'Name',
                editable: false,
            });
            expect(entry.text).toBe('Ada');
            expect(entry.textLength).toBe(3);
            expect(entry.maxLength).toBe(3);
            expect(entry.placeholderText).toBe('Name');
            expect(entry.editable).toBe(false);
        });

        await it('exposes the GTK-spelled methods over the same store', () => {
            const entry = new Gtk.Entry();
            entry.set_text('Ada');
            expect(entry.get_text()).toBe('Ada');
            entry.set_max_length(2);
            expect(entry.get_max_length()).toBe(2);
            expect(entry.get_text()).toBe('Ad');
        });
    });
};

// `Gtk.Entry` ON A DEVICE (ADR 0105 § 2, route D): five declared properties, two of them
// `explicitNotify` and therefore SEAM-OWNED (`isSeamOwned` in `widgets/signals.ts`) because
// each owes an emission order a change-based store cannot produce.
//
// What makes this widget worth a device leg is `text`: it is a `GtkEditable` property upstream,
// not a `GtkEntry` one, and the question that had to be answered before declaring it was whether
// node-gi's registration trips over that. It does not — the port registers its own GType and
// implements no real interface, so there is no interface slot to collide with. This file is where
// that holds or does not: if the GType could not carry a pspec named `text`, the first case fails
// on `real-gio` and passes on `pure-js`.
//
// Beyond that: the accessor pair the seam installed answers in all three spellings, the two
// measured emission orders (`changed` before `notify::text` when written, after it when typed)
// hold on both engines, `text-length` stays read-only by derivation, a shrinking `max-length`
// truncates before it announces itself, and the NativeScript door is shut.
//
// Both legs run the same cases, so a difference is a defect in whichever engine disagrees.
// See `specs/combo-row.ts` for the shape this copies.
import { Gtk } from '@gjsify/adwaita-nativescript';

import { describe, expect, info, it } from '../reporter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Record every declared emission the entry makes, in order. */
const watch = (entry: Gtk.Entry): string[] => {
    const seen: string[] = [];
    for (const name of ['text', 'text-length', 'max-length', 'placeholder-text', 'editable']) {
        entry.connect(`notify::${name}`, () => seen.push(`notify::${name}`));
    }
    entry.connect('changed', () => seen.push('changed'));
    return seen;
};

export const entrySpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Gtk.Entry on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('carries all five pspecs — including `text`, which is a GtkEditable property upstream', () => {
            // THE CASE THIS FILE EXISTS FOR. `Gtk.Entry.find_property('text').owner_type` is
            // `GtkEditable` on GTK, and declaring an interface property on a class that does not
            // implement the interface is what could have blocked route D here. The port
            // registers its own GType and implements nothing, so the name is free — and the
            // proof is that the accessor answers on the engine that really registers a GType.
            const entry = new Gtk.Entry();
            expect(entry.text).toBe('');
            expect(entry.textLength).toBe(0);
            expect(entry.maxLength).toBe(0);
            expect(entry.placeholderText).toBe('');
            expect(entry.editable).toBe(true);
        });

        await it('answers `text` in all three spellings off one store', () => {
            const entry = new Gtk.Entry();
            entry.text = 'ab';
            expect((entry as Any).text).toBe('ab');
            expect((entry as Any)['text']).toBe('ab');
            expect((entry as Any).get_text()).toBe('ab');
        });

        await it('emits `changed` BEFORE notify::text on a programmatic write', () => {
            const entry = new Gtk.Entry();
            const seen = watch(entry);
            entry.text = 'set';
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('changed,notify::text,notify::text-length');
        });

        await it('emits `changed` AFTER notify::text when the keyboard typed it', () => {
            // The reversed order, measured on `insert_text`. The field's `textChange` is the
            // keyboard's path here, and `_typing` is what carries the origin into the emission.
            const entry = new Gtk.Entry();
            const seen = watch(entry);
            entry.field.text = 'typed';
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('notify::text,changed,notify::text-length');
            expect(entry.text).toBe('typed');
        });

        await it('says nothing on an equal write, and nothing when a null is refused', () => {
            // Both deliberate divergences from the measurement, recorded in the module header of
            // `widgets/gtk-entry.ts`: GTK decomposes the write into delete+insert and so emits
            // twice with a transient `''`; this port has no `GtkEntryBuffer`. A `null` trips a
            // `text != NULL` assertion upstream and leaves the value standing — same here.
            const entry = new Gtk.Entry();
            entry.text = 'ab';
            const seen = watch(entry);
            entry.text = 'ab';
            (entry as Any).text = null;
            info(`seen=[${seen.join(',')}]`);
            expect(seen.length).toBe(0);
            expect(entry.text).toBe('ab');
        });

        await it('counts CODE POINTS, so a truncation never splits a surrogate pair', () => {
            const entry = new Gtk.Entry();
            entry.text = '🔒é';
            expect(entry.textLength).toBe(2);
            entry.maxLength = 1;
            expect(entry.text).toBe('🔒');
            expect(entry.textLength).toBe(1);
        });

        await it('a SHRINKING max-length truncates first and announces itself last', () => {
            const entry = new Gtk.Entry();
            entry.text = 'abcdef';
            const seen = watch(entry);
            entry.maxLength = 3;
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('changed,notify::text,notify::text-length,notify::max-length');
            expect(entry.text).toBe('abc');
        });

        await it('growing max-length restores nothing, and an equal write is silent', () => {
            const entry = new Gtk.Entry();
            entry.text = 'abcdef';
            entry.maxLength = 3;
            const seen = watch(entry);
            entry.maxLength = 10;
            entry.maxLength = 10;
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('notify::max-length');
            expect(entry.text).toBe('abc');
        });

        await it('clamps max-length to 0 … 65535, as Adw.EntryRow does', () => {
            const entry = new Gtk.Entry();
            entry.maxLength = -1;
            expect(entry.maxLength).toBe(0);
            entry.set_max_length(1000000);
            expect(entry.get_max_length()).toBe(65535);
        });

        await it('text-length is read-only by derivation: a write changes nothing', () => {
            const entry = new Gtk.Entry();
            entry.text = 'abc';
            (entry as Any)['text-length'] = 99;
            expect(entry.textLength).toBe(3);
        });

        await it('placeholder-text notifies on an EQUAL write, where every sibling guards', () => {
            // `gtk_entry_set_placeholder_text` guards on nothing at all (measured), which is why
            // this one property declares `changed: () => true`.
            const entry = new Gtk.Entry();
            entry.placeholderText = 'Name';
            const seen = watch(entry);
            entry.placeholderText = 'Name';
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('notify::placeholder-text');
        });

        await it('editable gates the keyboard and REFUSES NO WRITE', () => {
            const entry = new Gtk.Entry();
            entry.editable = false;
            entry.text = 'still lands';
            expect(entry.text).toBe('still lands');
            expect(entry.field.editable).toBe(false);
        });

        await it('emits `activate` when the return key is pressed', () => {
            const entry = new Gtk.Entry();
            let fired = 0;
            entry.connect('activate', () => (fired += 1));
            entry.field.notify({ eventName: 'returnPress', object: entry.field });
            expect(fired).toBe(1);
        });

        await it('the declared properties are not reachable through the NativeScript door', () => {
            const entry = new Gtk.Entry();
            for (const name of ['text', 'text-length', 'max-length', 'placeholder-text', 'editable']) {
                expect(() => (entry as Any).notify({ eventName: `notify::${name}`, object: entry })).toThrow();
            }
        });
    });
};

export default entrySpec;

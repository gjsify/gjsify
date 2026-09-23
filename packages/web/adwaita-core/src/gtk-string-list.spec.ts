// `Gtk.StringList` as an authoring door — held against the value it has to produce.
//
// THE CLAIM UNDER TEST is not "the class has methods": it is that a list BUILT the GJS way
// and the same list WRITTEN as an array reduce to one model, so a `model` property cannot
// tell them apart. The equality cases therefore assert against
// `normalizeComboOptions(<the array a reader would have written>)` and against
// `ComboState`, which is the object both ports' `model` setters actually drive — the
// widget door is three lines of wiring over it.
//
// Compared as JSON rather than with `toEqual`: `@gjsify/unit`'s `toEqual` is `==`, so two
// different objects pass it whatever they hold.

import { describe, expect, it } from '@gjsify/unit';

import { ComboState } from './rows.js';
import { normalizeComboOptions } from './list.js';
import type { AdwListModelInput } from './list.js';
import { GtkStringList } from './gtk-string-list.js';

/** What a `model` property does with a value, on either spelling. */
const model = (value: AdwListModelInput) => JSON.stringify(normalizeComboOptions(value));

/** What the state machine behind every `model` setter holds after taking one. */
const stateAfter = (value: AdwListModelInput) => {
    const state = new ComboState();
    state.setModel(normalizeComboOptions(value));
    return JSON.stringify({ model: state.model, selected: state.selectedIndex, value: state.selectedValue });
};

const COLOURS = ['Blue', 'Teal', 'Green', 'Orange', 'Purple'];

export default async () => {
    await describe('Gtk.StringList is the array a model already takes', async () => {
        await it('passes Array.isArray, which is the gate normalizeComboOptions opens on', () => {
            expect(Array.isArray(new GtkStringList())).toBe(true);
        });

        await it('starts empty, as gtk_string_list_new(NULL) does', () => {
            expect(new GtkStringList().length).toBe(0);
            expect(new GtkStringList({ strings: null }).length).toBe(0);
        });

        await it('takes the GJS construct bag — new Gtk.StringList({ strings })', () => {
            expect([...new GtkStringList({ strings: COLOURS })].join(',')).toBe(COLOURS.join(','));
        });
    });

    await describe('Gtk.StringList and a plain array are the SAME WRITE', async () => {
        await it('reduces to the same model the gallery array reduces to', () => {
            expect(model(new GtkStringList({ strings: COLOURS }))).toBe(model(COLOURS));
        });

        await it('leaves ComboState in the same state, selection included', () => {
            expect(stateAfter(new GtkStringList({ strings: COLOURS }))).toBe(stateAfter(COLOURS));
        });

        await it('is the same write after it has been appended to', () => {
            const list = new GtkStringList({ strings: ['Blue'] });
            list.append('Teal');
            list.take('Green');

            expect(stateAfter(list)).toBe(stateAfter(['Blue', 'Teal', 'Green']));
        });

        await it('an EMPTY list reads as an empty model, not as an absent one', () => {
            expect(stateAfter(new GtkStringList())).toBe(stateAfter([]));
        });
    });

    await describe('Gtk.StringList.append / take / remove', async () => {
        await it('appends to the end, as g_list_store_append does', () => {
            const list = new GtkStringList();
            list.append('Blue');
            list.append('Teal');

            expect([...list].join(',')).toBe('Blue,Teal');
        });

        await it('take is append — a JS string has no copy to avoid', () => {
            const list = new GtkStringList();
            list.take('Blue');

            expect([...list].join(',')).toBe('Blue');
        });

        await it('removes the string at a position and closes the gap', () => {
            const list = new GtkStringList({ strings: COLOURS });
            list.remove(1);

            expect([...list].join(',')).toBe('Blue,Green,Orange,Purple');
        });
    });

    await describe('Gtk.StringList.splice takes BOTH spellings', async () => {
        await it('takes the GIR additions ARRAY, as gtk_string_list_splice does', () => {
            const list = new GtkStringList({ strings: COLOURS });
            list.splice(1, 2, ['Cyan', 'Lime']);

            expect([...list].join(',')).toBe('Blue,Cyan,Lime,Orange,Purple');
        });

        await it("takes Array.prototype.splice's rest arguments too", () => {
            const list = new GtkStringList({ strings: COLOURS });
            list.splice(1, 2, 'Cyan', 'Lime');

            expect([...list].join(',')).toBe('Blue,Cyan,Lime,Orange,Purple');
        });

        await it('removes to the end when nRemovals is omitted', () => {
            const list = new GtkStringList({ strings: COLOURS });
            list.splice(2);

            expect([...list].join(',')).toBe('Blue,Teal');
        });

        await it('hands back the removed strings, which is what Array.prototype.splice promises', () => {
            const list = new GtkStringList({ strings: COLOURS });

            expect(list.splice(0, 2).join(',')).toBe('Blue,Teal');
        });
    });

    await describe('Gtk.StringList.get_string / get_n_items', async () => {
        await it('answers the string at a position', () => {
            expect(new GtkStringList({ strings: COLOURS }).get_string(2)).toBe('Green');
        });

        await it('answers null past the end, as C returns NULL', () => {
            expect(new GtkStringList({ strings: COLOURS }).get_string(9)).toBe(null);
        });

        await it('counts its items', () => {
            expect(new GtkStringList({ strings: COLOURS }).get_n_items()).toBe(5);
        });
    });

    await describe('the species override, which the constructor makes load-bearing', async () => {
        await it('map hands back a plain Array rather than calling the props constructor', () => {
            const mapped = new GtkStringList({ strings: COLOURS }).map((name) => name.toLowerCase());

            expect(mapped instanceof GtkStringList).toBe(false);
            expect(mapped.join(',')).toBe('blue,teal,green,orange,purple');
        });

        await it('normalizeComboOptions — which maps — sees every item', () => {
            expect(normalizeComboOptions(new GtkStringList({ strings: COLOURS })).length).toBe(5);
        });

        await it('filter and slice keep their items too', () => {
            const list = new GtkStringList({ strings: COLOURS });

            expect(list.filter((name) => name.startsWith('G')).join(',')).toBe('Green');
            expect(list.slice(0, 2).join(',')).toBe('Blue,Teal');
        });
    });
};

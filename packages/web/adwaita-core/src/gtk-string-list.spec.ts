// `Gtk.StringList` as a REAL list model — held against what GJS answers for the real type.
//
// THE CLAIM UNDER TEST CHANGED WITH ADR 0122. It used to be "a list and an array are one
// write"; it is now the opposite: the list is a `Gio.ListModel` of `Gtk.StringObject`s, an
// array is not one, and nothing here may quietly turn one into the other. So the cases below
// are the measured behaviour of the C type — its emission order, its identity rule, its
// CRITICALs, its argument refusals — and every expected string in them was READ OFF GJS
// 1.88.01 / GTK 4.22.5 (`~/.cache/gjsify-android/p4.js` … `p7.js`), not chosen here.
//
// These run on EVERY engine, including iOS, because `registerBaseClass` pins the type to the
// pure-JS engine. The same facts are pinned against real GJS and against node-gi by
// `conformance/list.ts`, which is where the oracle comparison lives; this file is the unit
// spec that keeps the pure leg honest when no GObject library is in the room.

import { describe, expect, it } from '@gjsify/unit';

import { GtkStringList, GtkStringObject, INVALID_LIST_POSITION } from './gtk-string-list.js';
import { ListModel, TYPE_OBJECT } from './gobject.js';
import { normalizeComboOptions } from './list.js';

const COLOURS = ['Blue', 'Teal', 'Green', 'Orange', 'Purple'];

/** The list's strings, read the only way a model can be read. */
function strings(list: GtkStringList): string[] {
    return Array.from({ length: list.get_n_items() }, (_, position) => list.get_string(position) ?? '<null>');
}

/** Runs `body` with `console.warn` captured — the CRITICALs GTK logs are not test output. */
async function silenced<T>(body: () => T | Promise<T>): Promise<{ result: T; warnings: string[] }> {
    const original = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args.join(' '));
    try {
        return { result: await body(), warnings };
    } finally {
        console.warn = original;
    }
}

/** Every `items-changed` and `notify::n-items` a list emits, in the order it emits them. */
function recordEmissions(list: GtkStringList): string[] {
    const log: string[] = [];
    list.connect('items-changed', (_source: unknown, ...args: unknown[]) => {
        log.push(`items-changed(${args.join(',')})`);
    });
    list.connect('notify::n-items', () => void log.push('notify::n-items'));
    return log;
}

export default async () => {
    await describe('Gtk.StringList is a Gio.ListModel, and NOT an array', async () => {
        await it('does not pass Array.isArray, whatever a model setter used to gate on', () => {
            expect(Array.isArray(new GtkStringList())).toBe(false);
        });

        await it('implements Gio.ListModel, which is what instanceof answers on', () => {
            expect(new GtkStringList() instanceof ListModel).toBe(true);
            expect(new GtkStringObject() instanceof ListModel).toBe(false);
        });

        await it('has no length, no index access and no map — real Gtk.StringList has none', () => {
            const list = new GtkStringList({ strings: COLOURS });

            expect((list as unknown as { length?: unknown }).length).toBe(undefined);
            expect((list as unknown as Record<number, unknown>)[0]).toBe(undefined);
            expect((list as unknown as { map?: unknown }).map).toBe(undefined);
        });

        await it('is not iterable — [...list] throws, as it does in GJS', () => {
            const list = new GtkStringList({ strings: COLOURS });

            expect(() => [...(list as unknown as Iterable<unknown>)]).toThrow();
        });
    });

    await describe('Gtk.StringList construction', async () => {
        await it('starts empty, as gtk_string_list_new(NULL) does', () => {
            expect(new GtkStringList().get_n_items()).toBe(0);
            expect(new GtkStringList({ strings: null }).get_n_items()).toBe(0);
            expect(GtkStringList.new(null).get_n_items()).toBe(0);
        });

        await it('takes the GJS construct bag — new Gtk.StringList({ strings })', () => {
            expect(strings(new GtkStringList({ strings: COLOURS }))).toStrictEqual(COLOURS);
        });

        await it('reads the strings as a C strv: a null ELEMENT terminates it', () => {
            expect(strings(new GtkStringList({ strings: ['a', null, 'b'] }))).toStrictEqual(['a']);
        });

        await it('refuses a non-string element the way a strv conversion does', () => {
            expect(() => new GtkStringList({ strings: [7 as unknown as string] })).toThrow(
                'Invalid element in string array',
            );
        });

        await it('refuses an unknown construct key by name', () => {
            expect(() => new GtkStringList({ nope: 1 } as unknown as { strings?: string[] })).toThrow(
                'No property nope on GtkStringList',
            );
        });
    });

    await describe('the Gio.ListModel surface the core installed', async () => {
        await it('get_item hands out a Gtk.StringObject holding the string', () => {
            const item = new GtkStringList({ strings: COLOURS }).get_item(2);

            expect(item instanceof GtkStringObject).toBe(true);
            expect(item?.string).toBe('Green');
            expect(item?.get_string()).toBe('Green');
        });

        await it('get_item answers null past the end, as g_list_model_get_item returns NULL', () => {
            expect(new GtkStringList({ strings: COLOURS }).get_item(9)).toBe(null);
        });

        await it('reports GObject as its item type — measured, and not GtkStringObject', () => {
            const list = new GtkStringList({ strings: COLOURS });

            expect(list.get_item_type()).toBe(TYPE_OBJECT);
            expect(list.item_type).toBe(TYPE_OBJECT);
            expect(list.itemType).toBe(TYPE_OBJECT);
        });

        await it('counts its items through both the method and the property aliases', () => {
            const list = new GtkStringList({ strings: COLOURS });

            expect(list.get_n_items()).toBe(5);
            expect(list.n_items).toBe(5);
            expect((list as unknown as { nItems: number }).nItems).toBe(5);
        });

        await it("refuses a short items_changed call with GJS's own arity message", () => {
            expect(() => (new GtkStringList().items_changed as (...args: number[]) => void)(0, 0)).toThrow(
                'method Gio.ListModel.items_changed: At least 3 arguments required, but only 2 passed',
            );
        });
    });

    await describe('Gtk.StringList.append / take / remove', async () => {
        await it('appends to the end, as gtk_string_list_append does', () => {
            const list = new GtkStringList();
            list.append('Blue');
            list.append('Teal');

            expect(strings(list)).toStrictEqual(['Blue', 'Teal']);
        });

        await it('take is append — a JS string has no copy to avoid', () => {
            const list = new GtkStringList();
            list.take('Blue');

            expect(strings(list)).toStrictEqual(['Blue']);
        });

        await it('removes the string at a position and closes the gap', () => {
            const list = new GtkStringList({ strings: COLOURS });
            list.remove(1);

            expect(strings(list)).toStrictEqual(['Blue', 'Green', 'Orange', 'Purple']);
        });
    });

    await describe('Gtk.StringList.splice takes the C signature, and only that', async () => {
        await it('takes the GIR additions ARRAY, as gtk_string_list_splice does', () => {
            const list = new GtkStringList({ strings: COLOURS });
            list.splice(1, 2, ['Cyan', 'Lime']);

            expect(strings(list)).toStrictEqual(['Blue', 'Cyan', 'Lime', 'Orange', 'Purple']);
        });

        await it('takes null additions as the empty vector', () => {
            const list = new GtkStringList({ strings: COLOURS });
            list.splice(0, 2, null);

            expect(strings(list)).toStrictEqual(['Green', 'Orange', 'Purple']);
        });

        await it("refuses a short call with GJS's arity message, not Array.prototype.splice", () => {
            const list = new GtkStringList({ strings: COLOURS });

            expect(() => (list.splice as (...args: unknown[]) => void)(2)).toThrow(
                'method Gtk.StringList.splice: At least 3 arguments required, but only 1 passed',
            );
            expect(() => (list.splice as (...args: unknown[]) => void)(0, 1)).toThrow(
                'method Gtk.StringList.splice: At least 3 arguments required, but only 2 passed',
            );
            expect(strings(list)).toStrictEqual(COLOURS);
        });

        await it('refuses a bare string where a strv belongs', () => {
            expect(() => new GtkStringList().splice(0, 0, 'Only' as unknown as string[])).toThrow(
                "Cannot convert string to array of 'utf8'",
            );
        });

        await it('refuses undefined additions, which is not the same as null', () => {
            expect(() => new GtkStringList().splice(0, 0, undefined as unknown as null)).toThrow(
                "Expected type utf8 for Argument 'additions' but got type 'undefined'",
            );
        });
    });

    // Measured in `p5.js`: the signal comes FIRST and the notify only when the count moved.
    // A renderer that rebuilds on `notify::n-items` alone misses `splice(1,2,[a,b])` entirely,
    // which is why the order and the condition are pinned rather than left to the emitter.
    await describe('the items-changed / notify::n-items emission rule', async () => {
        await it('emits items-changed before notify::n-items on an append', () => {
            const list = new GtkStringList({ strings: ['Blue'] });
            const log = recordEmissions(list);
            list.append('Teal');

            expect(log).toStrictEqual(['items-changed(1,0,1)', 'notify::n-items']);
        });

        await it('emits both on a remove', () => {
            const list = new GtkStringList({ strings: COLOURS });
            const log = recordEmissions(list);
            list.remove(1);

            expect(log).toStrictEqual(['items-changed(1,1,0)', 'notify::n-items']);
        });

        await it('emits NO notify when removed === added — the count did not move', () => {
            const list = new GtkStringList({ strings: COLOURS });
            const log = recordEmissions(list);
            list.splice(1, 2, ['Cyan', 'Lime']);

            expect(log).toStrictEqual(['items-changed(1,2,2)']);
        });

        await it('emits NOTHING for a splice that removes nothing and adds nothing', () => {
            const list = new GtkStringList({ strings: COLOURS });
            const log = recordEmissions(list);
            list.splice(1, 0, []);
            list.splice(0, 0, null);

            expect(log).toStrictEqual([]);
        });
    });

    // Measured in `p5.js`: an item is an object that MOVES with a splice. A renderer may hold
    // one and still be holding the same row afterwards — which is the whole reason
    // `selected-item` can be a property rather than a recomputed index.
    await describe('item identity', async () => {
        await it('hands back the SAME object for the same position', () => {
            const list = new GtkStringList({ strings: COLOURS });

            expect(list.get_item(2)).toBe(list.get_item(2));
        });

        await it('moves an item with the splice that shifted it', () => {
            const list = new GtkStringList({ strings: COLOURS });
            const green = list.get_item(2);
            list.splice(0, 0, ['Red']);

            expect(list.get_item(3)).toBe(green);
            expect(list.get_item(2)).not.toBe(green);
        });

        await it('makes a NEW object when a string is replaced by an equal one', () => {
            const list = new GtkStringList({ strings: COLOURS });
            const green = list.get_item(2);
            list.splice(2, 1, ['Green']);

            expect(list.get_string(2)).toBe('Green');
            expect(list.get_item(2)).not.toBe(green);
        });

        await it('does not equate two Gtk.StringObjects holding the same string', () => {
            expect(GtkStringObject.new('x')).not.toBe(GtkStringObject.new('x'));
        });
    });

    // Measured in `p6.js`: out of range is a CRITICAL and a NO-OP, never an exception. A
    // widget that spliced past the end therefore keeps running with the model it had, and the
    // text below is the assertion GTK prints.
    await describe('out of range is a CRITICAL and a no-op', async () => {
        const ASSERTION =
            "gtk_string_list_splice: assertion 'position + n_removals <= objects_get_size (&self->items)' failed";

        await it('leaves the list alone when a splice starts past the end', async () => {
            const list = new GtkStringList({ strings: ['Blue', 'Teal'] });
            const { warnings } = await silenced(() => list.splice(5, 0, ['Nope']));

            expect(strings(list)).toStrictEqual(['Blue', 'Teal']);
            expect(warnings.length).toBe(1);
            expect(warnings[0]?.includes(ASSERTION)).toBe(true);
        });

        await it('leaves the list alone when a splice removes more than it has', async () => {
            const list = new GtkStringList({ strings: ['Blue', 'Teal'] });
            const { warnings } = await silenced(() => list.splice(1, 4, []));

            expect(strings(list)).toStrictEqual(['Blue', 'Teal']);
            expect(warnings.length).toBe(1);
        });

        await it('lands remove past the end on the same assertion — remove IS a splice in C', async () => {
            const list = new GtkStringList({ strings: ['Blue'] });
            const { warnings } = await silenced(() => list.remove(7));

            expect(strings(list)).toStrictEqual(['Blue']);
            expect(warnings[0]?.includes(ASSERTION)).toBe(true);
        });

        await it('reads past the end silently, with no CRITICAL at all', async () => {
            const list = new GtkStringList({ strings: ['Blue'] });
            const { result, warnings } = await silenced(() => list.get_string(9));

            expect(result).toBe(null);
            expect(warnings).toStrictEqual([]);
        });
    });

    await describe('string arguments, with GJS\u2019s own two refusals', async () => {
        await it('names null for what it is', () => {
            expect(() => new GtkStringList().append(null as unknown as string)).toThrow(
                'Argument string may not be null',
            );
            expect(() => new GtkStringList().find(null as unknown as string)).toThrow(
                'Argument string may not be null',
            );
            expect(() => GtkStringObject.new(null as unknown as string)).toThrow('Argument string may not be null');
        });

        await it('names anything else by its type', () => {
            expect(() => new GtkStringList().append(7 as unknown as string)).toThrow(
                "Expected type string for argument 'string' but got type number",
            );
            expect(() => new GtkStringList().find(7 as unknown as string)).toThrow(
                "Expected type string for argument 'string' but got type number",
            );
        });
    });

    await describe('Gtk.StringList.find takes GTK\u2019s meaning of the name', async () => {
        await it('answers the POSITION of the first equal string', () => {
            expect(new GtkStringList({ strings: COLOURS }).find('Green')).toBe(2);
        });

        await it('answers the FIRST of two equal strings', () => {
            expect(new GtkStringList({ strings: ['a', 'b', 'a'] }).find('a')).toBe(0);
        });

        await it('answers GTK_INVALID_LIST_POSITION when there is none', () => {
            expect(new GtkStringList({ strings: COLOURS }).find('Cyan')).toBe(INVALID_LIST_POSITION);
            expect(INVALID_LIST_POSITION).toBe(4294967295);
        });
    });

    await describe('the read-only properties answer like a C object, not a JS class', async () => {
        await it('refuses a write to n-items by name', () => {
            expect(() => void ((new GtkStringList() as { n_items: number }).n_items = 5)).toThrow(
                'Property GtkStringList.n-items is not writable',
            );
        });

        await it('refuses a write to item-type by name, under both spellings', () => {
            expect(() => void ((new GtkStringList() as { item_type: unknown }).item_type = null)).toThrow(
                'Property GtkStringList.item-type is not writable',
            );
            expect(() => void ((new GtkStringList() as { itemType: unknown }).itemType = null)).toThrow(
                'Property GtkStringList.item-type is not writable',
            );
        });

        await it('refuses a write to Gtk.StringObject:string, assigned or constructed', () => {
            expect(() => void ((GtkStringObject.new('a') as { string: string }).string = 'b')).toThrow(
                'Property GtkStringObject.string is not writable',
            );
            expect(() => new GtkStringObject({ string: 'a' })).toThrow(
                'Property GtkStringObject.string is not writable',
            );
        });

        await it('answers null for a bare-constructed Gtk.StringObject, as GJS does', () => {
            expect(new GtkStringObject().string).toBe(null);
        });

        await it('refuses an unknown construct key on Gtk.StringObject by name', () => {
            expect(() => new GtkStringObject({ nope: 1 })).toThrow('No property nope on GtkStringObject');
        });
    });

    // Measured in `p7.js`: `strings` is construct-only, so GJS leaves BOTH halves of the
    // accessor in place and GObject refuses the write with a CRITICAL rather than an
    // exception. Dropping the pair would turn `list.strings = […]` into a silent own-property
    // write that reads back and looks like it worked.
    await describe('Gtk.StringList:strings after construction', async () => {
        await it('reads undefined, because the property is write-at-construct only', () => {
            expect(new GtkStringList({ strings: COLOURS }).strings).toBe(undefined);
        });

        await it('does not throw on assignment, logs the CRITICAL, and changes nothing', async () => {
            const list = new GtkStringList({ strings: ['Old'] });
            const { warnings } = await silenced(() => void (list.strings = ['Blue', 'Teal']));

            expect(strings(list)).toStrictEqual(['Old']);
            expect(warnings[0]?.includes('construct property "strings"')).toBe(true);
            expect(warnings[0]?.includes("can't be set after construction")).toBe(true);
        });
    });

    // The model door the five `model` setters go through. It is NOT the old claim that a list
    // and an array are the same write — the list is a model and the array is not — but that a
    // model and the array MIRRORING it normalise to the same items, which is what keeps the
    // conformance vectors in `conformance/list.ts` expressible as arrays.
    await describe('normalizeComboOptions reads it AS a model', async () => {
        await it('reduces to the items the mirroring array reduces to', () => {
            expect(normalizeComboOptions(new GtkStringList({ strings: COLOURS }))).toStrictEqual(
                normalizeComboOptions(COLOURS),
            );
        });

        await it('sees a mutation that happened after the list was built', () => {
            const list = new GtkStringList({ strings: ['Blue'] });
            list.append('Teal');

            expect(normalizeComboOptions(list)).toStrictEqual(normalizeComboOptions(['Blue', 'Teal']));
        });

        await it('reads an EMPTY list as an empty model, not as an absent one', () => {
            expect(normalizeComboOptions(new GtkStringList())).toStrictEqual([]);
        });

        await it('stays total for an object that is not a model at all', () => {
            expect(normalizeComboOptions({ length: 2 } as unknown as string[])).toStrictEqual([]);
        });
    });
};


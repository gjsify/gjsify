// `GjsifyOptionList` — the core's own `Gio.ListModel`, held to the same contract as the GTK one.
//
// WHAT IS AND IS NOT MEASURED HERE. The emission rule, the identity rule and the out-of-range
// CRITICAL are `Gio.ListModel`'s, measured on the real library through `Gtk.StringList`
// (`gtk-string-list.spec.ts`, GJS 1.88.01 / GTK 4.22.5) — these cases hold THIS type to the same
// answers, so the two models in the core cannot drift apart. What has no oracle is the part
// GTK has no type for: a two-field item and the `reconcile` door. Those cases state the rule
// ADR 0122 § 6 settles and nothing claims a C line behind them.
//
// These run on EVERY engine, including iOS: `registerBaseClass` pins the type to the pure-JS
// engine, so this is the same class everywhere.

import { describe, expect, it } from '@gjsify/unit';

import { GjsifyOptionList, GjsifyOptionObject, readModelWrite } from './option-list.js';
import { ListModel } from './gobject.js';
import { INVALID_LIST_POSITION } from './gtk-string-list.js';
import { normalizeComboOptions } from './list.js';

const COUNTRIES = [
    { value: 'de', label: 'Deutschland' },
    { value: 'fr', label: 'France' },
    { value: 'pl', label: 'Polska' },
];

/** Runs `body` with `console.warn` captured — the CRITICALs a list logs are not test output. */
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
function recordEmissions(list: GjsifyOptionList): string[] {
    const log: string[] = [];
    list.connect('items-changed', (_source: unknown, ...args: unknown[]) => {
        log.push(`items-changed(${args.join(',')})`);
    });
    list.connect('notify::n-items', () => void log.push('notify::n-items'));
    return log;
}

export default async () => {
    await describe('GjsifyOptionList is a Gio.ListModel', async () => {
        await it('implements Gio.ListModel, which is what instanceof answers on', () => {
            expect(new GjsifyOptionList() instanceof ListModel).toBe(true);
            expect(new GjsifyOptionObject() instanceof ListModel).toBe(false);
        });

        await it('does not pass Array.isArray — the array door is what ADR 0122 closed', () => {
            expect(Array.isArray(new GjsifyOptionList())).toBe(false);
        });

        await it('reports the SPECIFIC item type: this list holds nothing else', () => {
            const list = new GjsifyOptionList();

            expect(list.get_item_type()).toBe((GjsifyOptionObject as unknown as { $gtype: { name: string } }).$gtype);
            expect(list.get_item_type().name).toBe('GjsifyOptionObject');
        });

        await it('answers null past the end, as g_list_model_get_item returns NULL', () => {
            const list = GjsifyOptionList.new(COUNTRIES);

            expect(list.get_item(3)).toBe(null);
            expect(list.get_item(0)?.value).toBe('de');
        });
    });

    await describe('GjsifyOptionList construction', async () => {
        await it('starts empty, and so does one built from null', () => {
            expect(new GjsifyOptionList().get_n_items()).toBe(0);
            expect(new GjsifyOptionList({ options: null }).get_n_items()).toBe(0);
            expect(GjsifyOptionList.new(null).get_n_items()).toBe(0);
        });

        await it('takes descriptors and bare strings through the shared normaliser', () => {
            expect(GjsifyOptionList.new(COUNTRIES).toOptions()).toStrictEqual(COUNTRIES);
            expect(GjsifyOptionList.new(['Blue', 'Teal']).toOptions()).toStrictEqual(
                normalizeComboOptions(['Blue', 'Teal']),
            );
        });

        await it('fills in the missing half of a partial descriptor, as the normaliser does', () => {
            expect(GjsifyOptionList.new([{ label: 'Apple' }]).toOptions()).toStrictEqual([
                { value: 'Apple', label: 'Apple' },
            ]);
        });

        await it('refuses an unknown construct key, as every registered class does', () => {
            expect(() => new GjsifyOptionList({ strings: ['a'] } as never)).toThrow();
        });
    });

    await describe('GjsifyOptionObject', async () => {
        await it('holds both halves of the descriptor — the field Gtk.StringObject has not', () => {
            const item = GjsifyOptionObject.new('de', 'Deutschland');

            expect(item.value).toBe('de');
            expect(item.label).toBe('Deutschland');
            expect(item.toOption()).toStrictEqual({ value: 'de', label: 'Deutschland' });
        });

        await it('has NO string property — one would lose the value through readListModel', () => {
            const list = GjsifyOptionList.new(COUNTRIES);

            expect((list.get_item(0) as unknown as { string?: unknown }).string).toBe(undefined);
            expect(normalizeComboOptions(list)).toStrictEqual(COUNTRIES);
        });

        await it('refuses a write to either property: a model reports content through items-changed', () => {
            const item = GjsifyOptionObject.new('de', 'Deutschland');

            expect(() => {
                item.value = 'fr';
            }).toThrow('Property GjsifyOptionObject.value is not writable');
            expect(() => {
                item.label = 'France';
            }).toThrow('Property GjsifyOptionObject.label is not writable');
        });

        await it('hands out a COPY, so a caller cannot mutate what the list compares against', () => {
            const item = GjsifyOptionObject.new('de', 'Deutschland');
            item.toOption().label = 'mutated';

            expect(item.label).toBe('Deutschland');
        });

        await it('is two objects for two equal descriptors — identity means this entry', () => {
            expect(GjsifyOptionObject.new('de', 'D')).not.toBe(GjsifyOptionObject.new('de', 'D'));
        });
    });

    await describe('GjsifyOptionList mutation emits what a GListModel emits', async () => {
        await it('emits items-changed BEFORE notify::n-items', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const log = recordEmissions(list);
            list.append({ value: 'cz', label: 'Česko' });

            expect(log).toStrictEqual(['items-changed(3,0,1)', 'notify::n-items']);
        });

        await it('notifies n-items ONLY when the count moved', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const log = recordEmissions(list);
            list.splice(1, 1, [{ value: 'fr', label: 'République française' }]);

            expect(log).toStrictEqual(['items-changed(1,1,1)']);
        });

        await it('emits NEITHER for a splice that removes nothing and adds nothing', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const log = recordEmissions(list);
            list.splice(1, 0, []);

            expect(log).toStrictEqual([]);
        });

        await it('logs a CRITICAL and changes nothing for a splice past the end', async () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const log = recordEmissions(list);
            const { warnings } = await silenced(() => list.splice(2, 5, []));

            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain('g_list_store_splice');
            expect(log).toStrictEqual([]);
            expect(list.get_n_items()).toBe(3);
        });

        await it('removes the option at a position, and finds one by its VALUE', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            list.remove(1);

            expect(list.toOptions()).toStrictEqual([COUNTRIES[0]!, COUNTRIES[2]!]);
            expect(list.find('pl')).toBe(1);
            expect(list.find('fr')).toBe(INVALID_LIST_POSITION);
        });

        await it('finds by value and not by label — the two halves are allowed to differ', () => {
            const list = GjsifyOptionList.new(COUNTRIES);

            expect(list.find('de')).toBe(0);
            expect(list.find('Deutschland')).toBe(INVALID_LIST_POSITION);
        });

        await it('keeps the ITEM identity of everything outside the splice', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const first = list.get_item(0);
            list.append({ value: 'cz', label: 'Česko' });

            expect(list.get_item(0)).toBe(first);
        });
    });

    await describe('GjsifyOptionList.reconcile — the markup door', async () => {
        await it('keeps the list IDENTITY: re-parsing an attribute is not a new model', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            list.reconcile([...COUNTRIES, { value: 'cz', label: 'Česko' }]);

            expect(list.get_n_items()).toBe(4);
            expect(list.get_item(0)).toBe(list.get_item(0));
        });

        await it('emits the ONE minimal splice, not one per item', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const log = recordEmissions(list);
            list.reconcile([...COUNTRIES, { value: 'cz', label: 'Česko' }]);

            expect(log).toStrictEqual(['items-changed(3,0,1)', 'notify::n-items']);
        });

        await it('leaves the shared prefix and suffix items untouched', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const [first, , last] = [list.get_item(0), list.get_item(1), list.get_item(2)];
            list.reconcile([COUNTRIES[0]!, { value: 'at', label: 'Österreich' }, COUNTRIES[2]!]);

            expect(list.get_item(0)).toBe(first);
            expect(list.get_item(2)).toBe(last);
            expect(list.get_item(1)?.value).toBe('at');
        });

        await it('emits NOTHING for an equal model, as GTK emits nothing', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const log = recordEmissions(list);
            list.reconcile(COUNTRIES.map((option) => ({ ...option })));

            expect(log).toStrictEqual([]);
        });

        await it('treats a changed LABEL at an unchanged value as a change', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const log = recordEmissions(list);
            list.reconcile([COUNTRIES[0]!, { value: 'fr', label: 'France métropolitaine' }, COUNTRIES[2]!]);

            expect(log).toStrictEqual(['items-changed(1,1,1)']);
        });

        await it('empties the list for null, in one splice', () => {
            const list = GjsifyOptionList.new(COUNTRIES);
            const log = recordEmissions(list);
            list.reconcile(null);

            expect(log).toStrictEqual(['items-changed(0,3,0)', 'notify::n-items']);
            expect(list.get_n_items()).toBe(0);
        });
    });

    await describe('GjsifyOptionList through the portable reader', async () => {
        await it('reads as the descriptors it holds, both halves kept', () => {
            expect(normalizeComboOptions(GjsifyOptionList.new(COUNTRIES))).toStrictEqual(COUNTRIES);
        });

        await it('sees a mutation that happened after the list was built', () => {
            const list = GjsifyOptionList.new([COUNTRIES[0]!]);
            list.append(COUNTRIES[1]!);

            expect(normalizeComboOptions(list)).toStrictEqual([COUNTRIES[0]!, COUNTRIES[1]!]);
        });

        await it('reads an EMPTY list as an empty model, not as an absent one', () => {
            expect(normalizeComboOptions(new GjsifyOptionList())).toStrictEqual([]);
        });
    });

    // `readModelWrite` is the ONE `model` setter behind four surfaces (ADR 0122 § 5/§ 6), so its
    // rules are measured once, here, rather than four times through four widgets. What the widgets
    // then own is only that they CALL it — which is what their own `model`-door cases assert.
    await describe('readModelWrite — the one model door', async () => {
        await it('hands a real model through by IDENTITY, leaving the authored list alone', () => {
            const authored = GjsifyOptionList.new([COUNTRIES[0]!]);
            const given = GjsifyOptionList.new(COUNTRIES);

            expect(readModelWrite(given, authored) === given).toBe(true);
            expect(authored.n_items).toBe(1);
        });

        // The duck test, not `implementsInterface`: a real `Gio.ListStore` through node-gi is no
        // registered class of this subset, and handing one to `model` is the point of having it.
        await it('takes a model that is no registered class, because the two getters are the test', () => {
            const foreign = {
                get_n_items: () => 2,
                get_item: (position: number) => (position < 2 ? GjsifyOptionObject.new(`v${position}`, '') : null),
            };

            expect(readModelWrite(foreign, new GjsifyOptionList()) === foreign).toBe(true);
        });

        await it('reads null and undefined as "no model", which is a value the property takes', () => {
            const authored = GjsifyOptionList.new(COUNTRIES);

            expect([readModelWrite(null, authored), readModelWrite(undefined, authored)]).toStrictEqual([null, null]);
        });

        // A STRING is the JSON markup attribute, and it reconciles the surface's OWN list instead
        // of replacing it — the identity is what keeps an appended option a splice rather than a
        // new model, which is what resets the selection.
        await it('parses a string into the AUTHORED list and returns that same list', () => {
            const authored = GjsifyOptionList.new([COUNTRIES[0]!]);

            const read = readModelWrite(JSON.stringify(COUNTRIES), authored);

            expect(read === authored).toBe(true);
            expect(normalizeComboOptions(authored)).toStrictEqual(COUNTRIES);
        });

        await it('reconciles a second string write without replacing the list', () => {
            const authored = GjsifyOptionList.new(COUNTRIES);
            const log = recordEmissions(authored);

            readModelWrite(JSON.stringify([...COUNTRIES, { value: 'cz', label: 'Česko' }]), authored);

            expect(log.join(' ')).toBe('items-changed(3,0,1) notify::n-items');
        });

        // THE REFUSAL IS THE PROPERTY'S — `checkPropertyValue` against `model`'s own ParamSpec, so
        // the wording is the one measured on `Gtk.DropDown:model` under GJS. An ARRAY above all:
        // that is the Array-era write ADR 0122 closes, and it must name the type it wanted.
        for (const [what, value, says] of [
            ['an array', COUNTRIES, "Object is not a subclass of GObject_Object, it's a Array"],
            ['a plain object', { value: 'de' }, "Object is not a subclass of GObject_Object, it's a Object"],
            ['a number', 7, 'Wrong type number; object GListModel expected'],
            ['a boolean', true, 'Wrong type boolean; object GListModel expected'],
        ] as const) {
            await it(`refuses ${what} by naming the type the property wanted`, () => {
                expect(() => readModelWrite(value, new GjsifyOptionList())).toThrow(says);
            });
        }
    });
};

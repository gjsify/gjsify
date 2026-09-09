// The portable list model against a REAL `Gtk.StringList` (ADR 0046 § Amendment).
//
// The browser and NativeScript renderers assert the model against their own option
// nodes; this suite is the one that can ask GTK. It drives the SAME vectors
// (`@gjsify/adwaita-core/conformance`) through `buildStringList` and back through
// `fromStringList`, so "the labels reach GTK and the value does not cross" is a
// measurement rather than a sentence — and it drives the two widgets themselves, so the
// claim that a declarative dialect can now write a combo row is a row that HAS one.

import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
// Type position only — the descriptors pull Adw in for value use themselves.
import type Adw from 'gi://Adw?version=1';

import { expect, it, on } from '@gjsify/unit';

import { LIST_NORMALIZE_VECTORS, LIST_PARSE_VECTORS, type ListNormalizeVector } from '@gjsify/adwaita-core/conformance';

import { installDiagnosticsGate } from './conformance/index.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import { createElement, materialize, setProp } from './host.js';
import { buildStringList, fromStringList, isPortableListModel, stringsOf } from './list-model.js';
import { paramSpecs } from './props.js';
import { GTK_HOSTS, gated } from './testing/gate.mjs';
import { codeOf } from './testing/refusal.mjs';

/** What a widget's `model` holds — `[]` for anything but a `Gtk.StringList`, so a wrong model reads as no strings. */
const heldStrings = (model: Gio.ListModel | null): string[] =>
    model instanceof Gtk.StringList ? stringsOf(model) : [];

/** A widget with a `model` and a `selected` position: what the two string-list widgets share. */
interface StringListWidget {
    model: Gio.ListModel | null;
    selected: number;
    selectedItem: Gtk.StringObject | null;
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();

        // GTK's failure mode is exit 0: a model GObject refuses is a CRITICAL and an empty
        // widget. Every block below asserts GTK reported nothing.
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'buildStringList builds a real Gtk.StringList', async () => {
            await it('is a Gio.ListModel a GTK widget will accept', () => {
                const model = buildStringList(['Blue', 'Teal']);
                expect(model instanceof Gtk.StringList).toBe(true);
                expect(GObject.type_is_a(Gtk.StringList.$gtype, Gio.ListModel.$gtype)).toBe(true);
                expect(stringsOf(model)).toStrictEqual(['Blue', 'Teal']);
            });

            await it('an array is a model; a Gtk.StringList is not', () => {
                expect(isPortableListModel([])).toBe(true);
                expect(isPortableListModel(['x'])).toBe(true);
                expect(isPortableListModel(new Gtk.StringList({ strings: ['x'] }))).toBe(false);
                expect(isPortableListModel('x')).toBe(false);
                expect(isPortableListModel(null)).toBe(false);
            });
        });

        await gated(diagnostics, 'the labels survive GTK (shared conformance vectors)', async () => {
            for (const { input, model, rule } of LIST_NORMALIZE_VECTORS) {
                await it(`${JSON.stringify(input)} — ${rule}`, () => {
                    const list = buildStringList(input);
                    expect(stringsOf(list)).toStrictEqual(model.map((item) => item.label));
                    // What comes BACK is each label as its own value — the one field this
                    // seam does not carry, asserted so a row whose value differs from its
                    // label reads as the measured loss and never as a defect.
                    expect(fromStringList(list)).toStrictEqual(model.map(({ label }) => ({ value: label, label })));
                });
            }

            await it('`value` is what does not cross, and the table has a row that shows it', () => {
                // The premise first: without such a row the assertion below is vacuous.
                const row = LIST_NORMALIZE_VECTORS.find((v) => v.model.some((item) => item.value !== item.label));
                expect(row === undefined).toBe(false);
                const { input, model } = row as ListNormalizeVector;
                expect(fromStringList(buildStringList(input)).map((item) => item.value)).toStrictEqual(
                    model.map((item) => item.label),
                );
            });
        });

        await gated(diagnostics, 'the markup door is not this door (shared conformance vectors)', async () => {
            // `LIST_PARSE_VECTORS` are JSON STRINGS, and the browser element parses them
            // because an attribute can carry nothing else. A JSX attribute carries the
            // value itself, so a string here is not a list to parse — it is the wrong
            // shape, and the TOTAL parser would have answered an EMPTY list for four of
            // these five rows without a word. Every row is refused by name instead.
            for (const { attribute, rule } of LIST_PARSE_VECTORS) {
                await it(`${JSON.stringify(attribute)} is refused, not parsed — ${rule}`, () => {
                    const el = createElement('adw-combo-row');
                    expect(codeOf(() => setProp(el, 'model', attribute))).toBe('bad-list-model');
                });
            }
        });

        await gated(diagnostics, 'the widgets take it (the point of the amendment)', async () => {
            for (const [tag, gtype] of [
                ['adw-combo-row', 'AdwComboRow'],
                ['gtk-drop-down', 'GtkDropDown'],
            ] as const) {
                await it(`<${tag} model={[…]}> reaches ${gtype} as a real Gtk.StringList`, () => {
                    const el = createElement(tag);
                    setProp(el, 'model', ['Blue', { value: 'teal', label: 'Teal' }, 'Green']);
                    const widget = materialize(el) as unknown as { model: Gio.ListModel | null };
                    expect(widget.model instanceof Gtk.StringList).toBe(true);
                    // The model that was written, not a model that merely exists.
                    expect(heldStrings(widget.model)).toStrictEqual(['Blue', 'Teal', 'Green']);
                });

                await it(`<${tag}> selects the position it was given, on the model it was given`, () => {
                    // `selected` is authored AFTER `model`, and the order is load-bearing: the
                    // host writes props in author order, and a position written into a widget
                    // that has no model yet is clamped away by GtkSingleSelection — the same
                    // fact `spin-row.gtk.tsx` records for a value and its range. The gallery
                    // trees author them in this order for this reason.
                    const el = createElement(tag, { model: ['Automatic', 'Always', 'Never'], selected: 2 });
                    const widget = materialize(el) as unknown as {
                        selected: number;
                        selectedItem: Gtk.StringObject | null;
                    };
                    expect(widget.selected).toBe(2);
                    // What a reader SEES — the drawn item — and not only the stored index.
                    expect(widget.selectedItem?.string).toBe('Never');
                });
            }

            await it('a real Gio.ListModel still passes straight through', () => {
                // The imperative path every existing GJS application uses. `coerce` must not
                // touch it — an array is the ONLY thing the portable branch claims.
                const model = new Gtk.StringList({ strings: ['x'] });
                const el = createElement('adw-combo-row');
                setProp(el, 'model', model);
                materialize(el);
                expect((el.widget as unknown as Adw.ComboRow).model).toBe(model);
            });
        });

        await gated(diagnostics, 'a list the seam built is updated in place, and the selection survives', async () => {
            // THE PREMISE, measured rather than assumed: replacing the model is what drops the
            // selection — even when the strings are the same three. If GTK ever keeps it, this
            // row turns red and the splice below can retire with its paragraph.
            for (const tag of ['adw-combo-row', 'gtk-drop-down'] as const) {
                await it(`<${tag}> given a NEW Gtk.StringList of the same strings lands on 0 — the reason to splice`, () => {
                    const widget = materialize(
                        createElement(tag, { model: ['a', 'b', 'c'], selected: 2 }),
                    ) as unknown as StringListWidget;
                    expect(widget.selected).toBe(2);
                    widget.model = new Gtk.StringList({ strings: ['a', 'b', 'c'] });
                    expect(widget.selected).toBe(0);
                });
            }

            const mounted = (tag: 'adw-combo-row' | 'gtk-drop-down') => {
                const el = createElement(tag, { model: ['a', 'b', 'c'], selected: 2 });
                const widget = materialize(el) as unknown as StringListWidget;
                expect(widget.selected).toBe(2);
                return { el, widget, list: widget.model };
            };

            for (const tag of ['adw-combo-row', 'gtk-drop-down'] as const) {
                await it(`<${tag}> keeps the SAME Gtk.StringList across a write, and the selection with it`, () => {
                    const { el, widget, list } = mounted(tag);
                    setProp(el, 'model', ['A', 'b', 'c']);
                    // Identity: the object GTK holds is the one it held. A reader with a
                    // reference to it — a factory, a filter model — is not left with a dead one.
                    expect(widget.model).toBe(list);
                    expect(heldStrings(widget.model)).toStrictEqual(['A', 'b', 'c']);
                    expect(widget.selected).toBe(2);
                    expect(widget.selectedItem?.string).toBe('c');
                });

                await it(`<${tag}> re-handed an EQUAL array writes nothing — no memo needed upstream`, () => {
                    // What `combo-row.gtk.tsx` in @gjsify/adwaita-react-native used to carry a
                    // content-keyed memo for: an inline `model={['a','b','c']}` literal is a new
                    // array on every render, and a new model per render reset the selection.
                    const { el, widget, list } = mounted(tag);
                    setProp(el, 'model', ['a', 'b', 'c']);
                    expect(widget.model).toBe(list);
                    expect(widget.selected).toBe(2);
                });

                await it(`<${tag}> changing the SELECTED label keeps the position and shows the new label`, () => {
                    const { el, widget } = mounted(tag);
                    setProp(el, 'model', ['a', 'b', 'C']);
                    expect(widget.selected).toBe(2);
                    expect(widget.selectedItem?.string).toBe('C');
                });

                await it(`<${tag}> prepending moves the selection WITH its item`, () => {
                    const { el, widget } = mounted(tag);
                    setProp(el, 'model', ['z', 'a', 'b', 'c']);
                    expect(widget.selected).toBe(3);
                    expect(widget.selectedItem?.string).toBe('c');
                });

                await it(`<${tag}> shrinking past the selection is clamped by GTK, in place`, () => {
                    const { el, widget, list } = mounted(tag);
                    setProp(el, 'model', ['only']);
                    expect(widget.model).toBe(list);
                    expect(heldStrings(widget.model)).toStrictEqual(['only']);
                    expect(widget.selected).toBe(0);
                });
            }

            await it('a real Gtk.StringList written over a seam-built one REPLACES it — the imperative object wins', () => {
                const { el, widget, list } = mounted('adw-combo-row');
                const own = new Gtk.StringList({ strings: ['x'] });
                setProp(el, 'model', own);
                expect(widget.model).toBe(own);
                expect(widget.model === list).toBe(false);
            });

            await it('an array written over an application-owned Gtk.StringList replaces it, never splices it', () => {
                // The application's object is not the seam's to mutate: it may be shared with
                // another widget, and it stays as the application left it.
                const own = new Gtk.StringList({ strings: ['x', 'y'] });
                const el = createElement('adw-combo-row', { model: own });
                const widget = materialize(el) as unknown as StringListWidget;
                setProp(el, 'model', ['p', 'q']);
                expect(widget.model === own).toBe(false);
                expect(stringsOf(own)).toStrictEqual(['x', 'y']);
                expect(heldStrings(widget.model)).toStrictEqual(['p', 'q']);
            });
        });

        await gated(diagnostics, 'what the branch refuses, by name', async () => {
            await it('a string is not a list to parse here — bad-list-model, naming the tag and the kind', () => {
                const el = createElement('adw-combo-row');
                expect(() => setProp(el, 'model', 'Blue')).toThrow(
                    '<AdwComboRow>.model is a Gio.ListModel and got a string',
                );
                // And nothing was written down: `materialize` replays `el.props` verbatim, so
                // a refused value kept there would throw again from inside the next rebuild.
                expect('model' in el.props).toBe(false);
            });

            await it('an object is one item, not a list — refused the same way', () => {
                const el = createElement('gtk-drop-down');
                expect(codeOf(() => setProp(el, 'model', { value: 'a', label: 'A' }))).toBe('bad-list-model');
            });

            await it('the naive write is SILENT: set_property turns the mismatch into NULL and this gate sees nothing', () => {
                // THE INCIDENT the second ParamSpec question exists for, pinned on raw GTK so the
                // refusal below cannot be mistaken for belt-and-braces. Measured on GTK 4.22.4 /
                // GLib 2.88.3: `g_object_set_property` transforms an object that is not of the
                // property's type into NULL and logs NOTHING — not a CRITICAL, not a WARNING — so
                // the view is empty at exit 0 and even this diagnostics gate is quiet, which the
                // gated block asserts. (Constructed with it, GJS throws a TypeError from inside
                // `materialize` instead — after `el.props` has recorded the array a rebuild would
                // replay.) `set_property` is the route `writeProperty` takes for a GObject value.
                const view = new Gtk.ListView();
                view.set_property('model', new Gtk.StringList({ strings: ['a'] }));
                expect(view.model).toBe(null);
            });

            await it('a list-shaped property the string list cannot satisfy is refused naming the type GTK wants', () => {
                // THE PREMISE, so the vector cannot pass for the wrong reason: `GtkListView:model`
                // IS a Gio.ListModel — the first ParamSpec test says yes — and is NOT satisfied
                // by a Gtk.StringList — the second says no. A branch keyed on the name `model`
                // or on list-ness alone would build the string list and hand it to the silent
                // write above.
                const spec = paramSpecs(Gtk.ListView, 'GtkListView').get('model');
                expect(spec === undefined).toBe(false);
                const valueType = (spec as GObject.ParamSpec).value_type;
                expect(GObject.type_name(valueType)).toBe('GtkSelectionModel');
                expect(GObject.type_is_a(valueType, Gio.ListModel.$gtype)).toBe(true);
                expect(GObject.type_is_a(Gtk.StringList.$gtype, valueType)).toBe(false);

                const el = createElement('gtk-list-view');
                expect(() => setProp(el, 'model', ['a', 'b'])).toThrow('GtkSelectionModel');
                expect(codeOf(() => setProp(el, 'model', ['a', 'b']))).toBe('list-model-mismatch');
                expect('model' in el.props).toBe(false);
            });
        });
    });
};

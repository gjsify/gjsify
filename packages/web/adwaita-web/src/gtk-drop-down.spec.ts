// DOM-level behaviour tests for <gtk-drop-down>, in a real browser via the
// @gjsify/adwaita-web browser test axis.
//
// The SELECTION half is driven by the SAME table the NativeScript renderer asserts
// against (`COMBO_SELECTION_VECTORS`, `@gjsify/adwaita-core/conformance`), replayed
// through the API a consumer would use and read back as what a user would see: the
// button label, `selected`/`selectedValue` and the `change` stream. `<adw-combo-row>`
// composes the same `ComboState` and drives the same table from its own DOM
// (`adw-row-state.spec.ts`) — it could not while two of its four step ops had no DOM
// spelling there, its model arriving through an attribute at connect time only (#1525).
// The two used to part on ONE row — `an index past the end`, which this element rejected
// and the row accepted — and that carve-out is GONE: ADR 0122 § 4 measured libadwaita,
// found the rejection right, and the row adopted it. Both selectors now drive every row.
import { describe, it, expect } from '@gjsify/unit';

import {
    COMBO_SELECTION_VECTORS,
    LIST_ITEMS_CHANGED_VECTORS,
    LIST_MODEL_OWNERSHIP_VECTORS,
    LIST_NORMALIZE_VECTORS,
    LIST_PARSE_VECTORS,
    applyListMutation,
    applyListReadback,
    listModelForInput,
} from '@gjsify/adwaita-core/conformance';
import type { ComboSelectionStep } from '@gjsify/adwaita-core/conformance';
import { GjsifyOptionList } from '@gjsify/adwaita-core';
import type { AdwComboOptionInput } from '@gjsify/adwaita-core';

import type { GtkDropDown } from './elements/gtk-drop-down.js';

function makeDropDown(): GtkDropDown {
    const el = document.createElement('gtk-drop-down') as GtkDropDown;
    document.body.appendChild(el);
    return el;
}

/**
 * Assign a model built out of an authored array.
 *
 * The array itself no longer goes to the property — ADR 0122 § 4 narrowed `model` to a real
 * `Gio.ListModel` — so every test below that is about something OTHER than the door says so
 * in one place. The tests that ARE about the door (`LIST_NORMALIZE_VECTORS` and the array
 * refusal in `gtk-value-doors.spec.ts`) write to `model` directly.
 */
function setModel(dd: GtkDropDown, options: readonly AdwComboOptionInput[]): GjsifyOptionList {
    const list = GjsifyOptionList.new(options);
    dd.model = list;
    return list;
}

/** The text the closed button shows — the rendered `selectedLabel`. */
function labelText(dd: GtkDropDown): string {
    return dd.querySelector('.adw-drop-down-label')?.textContent ?? '';
}

/** Open the chooser the way a user does. A no-op over an empty model, as the element guards. */
function openChooser(dd: GtkDropDown): void {
    (dd.querySelector('.adw-drop-down-button') as HTMLButtonElement).click();
}

/**
 * Replay one vector step against the real element — property sets for the
 * programmatic ops, a popover gesture for the interactive one.
 *
 * Every `setModel` builds a FRESH list, which is what makes `setModelAgain` — assigning the
 * identity the element already holds — a distinct step rather than a repeat of the one above
 * it.
 */
function applyStep(dd: GtkDropDown, step: ComboSelectionStep): void {
    switch (step.op) {
        case 'setModel':
            setModel(dd, [...step.model]);
            return;
        case 'setModelAgain': {
            const held = dd.model;
            dd.model = held;
            return;
        }
        case 'setSelectedIndex':
            dd.selected = step.index;
            return;
        case 'setSelectedValue':
            dd.selectedValue = step.value;
            return;
        case 'select':
            openChooser(dd);
            if (step.index < 0) {
                // The dismissed chooser: the popover closes with nothing picked — here an
                // outside pointerdown rather than a cancelled native sheet.
                document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                return;
            }
            (dd.querySelectorAll('.adw-drop-down-item')[step.index] as HTMLButtonElement | undefined)?.click();
            return;
    }
}

/** Mount a drop-down and record every `change` detail it dispatches. */
function mountRecording(): { dd: GtkDropDown; changes: unknown[] } {
    const dd = makeDropDown();
    const changes: unknown[] = [];
    dd.addEventListener('change', (event) => changes.push((event as CustomEvent).detail));
    return { dd, changes };
}

export const GtkDropDownTest = async () => {
    await describe('gtk-drop-down selection (libadwaita conformance vectors)', async () => {
        for (const vector of COMBO_SELECTION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, async () => {
                const { dd, changes } = mountRecording();
                for (const step of vector.steps) applyStep(dd, step);

                expect(dd.selected).toBe(vector.selected);
                expect(dd.selectedValue).toBe(vector.value);
                expect(labelText(dd)).toBe(vector.label);
                // `change` is this element's DOM spelling of the `interactive` flag: it
                // fires for a user pick and never for a programmatic set, so the
                // interactive frames of the stream ARE the events a listener sees.
                expect(changes).toStrictEqual(
                    vector.emitted
                        .filter((change) => change.interactive)
                        .map((change) => ({ index: change.selected, value: change.value, label: change.label })),
                );
                dd.remove();
            });
        }
    });

    await describe('gtk-drop-down model', async () => {
        await it('accepts a string[] (value === label)', async () => {
            const dd = makeDropDown();
            setModel(dd, ['One', 'Two', 'Three']);
            expect(dd.options.length).toBe(3);
            expect(dd.options[0]).toStrictEqual({ value: 'One', label: 'One' });
            expect(dd.querySelector('.adw-drop-down-label')?.textContent).toBe('One');
            dd.remove();
        });

        await it('accepts {value,label}[] and shows the selected label', async () => {
            const dd = makeDropDown();
            setModel(dd, [
                { value: 'a', label: 'Apple' },
                { value: 'b', label: 'Banana' },
            ]);
            dd.selected = 1;
            expect(dd.querySelector('.adw-drop-down-label')?.textContent).toBe('Banana');
            expect(dd.selectedValue).toBe('b');
            dd.remove();
        });

        await it('parses the model from the JSON attribute', async () => {
            const dd = document.createElement('gtk-drop-down') as GtkDropDown;
            dd.setAttribute('model', '[{"value":"x","label":"Ex"},{"value":"y","label":"Why"}]');
            dd.setAttribute('selected', '1');
            document.body.appendChild(dd);
            expect(dd.options.length).toBe(2);
            expect(dd.selected).toBe(1);
            expect(dd.selectedValue).toBe('y');
            dd.remove();
        });

        await it('renders one popover item per option', async () => {
            const dd = makeDropDown();
            setModel(dd, ['a', 'b', 'c']);
            expect(dd.querySelectorAll('.adw-drop-down-item').length).toBe(3);
            dd.remove();
        });

        for (const vector of LIST_NORMALIZE_VECTORS) {
            await it(`normalize — ${vector.rule}`, async () => {
                const dd = makeDropDown();
                // `listModelForInput` is the table's own answer to which door a row reaches
                // through now that `model` takes no array (ADR 0122 § 4).
                dd.model = listModelForInput(vector.input);
                expect(dd.options).toStrictEqual([...vector.model]);
                expect(
                    [...dd.querySelectorAll('.adw-drop-down-item-label')].map((label) => label.textContent),
                ).toStrictEqual(vector.model.map((item) => item.label));
                dd.remove();
            });
        }

        // The `model` ATTRIBUTE door, driven here as well as on `<adw-combo-row>`: both
        // selectors read it through the SAME `parseListModel`, so a table asserted on one
        // of them says nothing about the other's `attributeChangedCallback` branch — which
        // is the half that was write-once on the row for its whole life (#1525).
        for (const vector of LIST_PARSE_VECTORS) {
            await it(`attribute — ${vector.rule}`, async () => {
                const dd = makeDropDown();
                // Set AFTER connect, so the attribute reaches the callback rather than the
                // seeding path: a total parser has to be total on the live door too.
                dd.setAttribute('model', vector.attribute);
                expect(dd.options).toStrictEqual([...vector.model]);
                dd.remove();
            });
        }

        // The half no pure test reaches: a markup update must SPLICE the row buttons, not
        // rebuild them. Identity is what says which happened — and it is what a user feels,
        // because a rebuilt row loses its focus and the popover its scroll position.
        //
        // Driven through the ATTRIBUTE, which is the door that still computes a splice: it
        // reconciles the element's own authored list (ADR 0122 amendment A4) and so keeps its
        // identity. A `model` PROPERTY write cannot answer these rows any more — a different
        // list is a replacement, and a replacement carries nothing over by definition.
        for (const vector of LIST_ITEMS_CHANGED_VECTORS) {
            await it(`items-changed — ${vector.rule}`, async () => {
                const dd = makeDropDown();
                dd.setAttribute('model', JSON.stringify(vector.previous));
                const before = [...dd.querySelectorAll('.adw-drop-down-item')];

                dd.setAttribute('model', JSON.stringify(vector.next));

                const after = [...dd.querySelectorAll('.adw-drop-down-item')];
                expect(after.map((item) => item.querySelector('.adw-drop-down-item-label')?.textContent)).toStrictEqual(
                    vector.next.map((item) => item.label),
                );
                expect(before.filter((item) => after.includes(item)).length).toBe(vector.survivors);
                dd.remove();
            });
        }

        // WHO OWNS the options either side of the model, and what the model's own API moves
        // — the row buttons are what shows it, for the reason `adw-row-state.spec.ts` gives
        // on the same table.
        for (const vector of LIST_MODEL_OWNERSHIP_VECTORS) {
            await it(`ownership — ${vector.rule}`, async () => {
                const dd = makeDropDown();
                const input = vector.initial.map((item) => ({ ...item }));
                const list = setModel(dd, input);
                const before = [...dd.querySelectorAll('.adw-drop-down-item')];

                if (vector.source === 'model') applyListMutation(list, vector.op);
                else applyListReadback(vector.source === 'input' ? input : dd.options, vector.op);

                expect(dd.options).toStrictEqual([...vector.model]);
                // None of these ops is a replacement, so the element must still be pointing
                // at the list it was handed.
                expect(dd.model).toBe(list);
                const after = [...dd.querySelectorAll('.adw-drop-down-item')];
                expect(after.map((item) => item.querySelector('.adw-drop-down-item-label')?.textContent)).toStrictEqual(
                    vector.model.map((item) => item.label),
                );
                expect(before.filter((item) => after.includes(item)).length).toBe(vector.survivors);
                dd.remove();
            });
        }

        // The defect the splice exposed: each row's click handler used to close over the
        // index it was BUILT at, which a rebuild always refreshed. Under a splice it does
        // not, so the handler asks the list where the row is now.
        await it('a row that a splice shifted still selects itself', async () => {
            const dd = makeDropDown();
            // Through the attribute door, the one that splices — see the items-changed loop.
            dd.setAttribute('model', '["b","c"]');
            const rowForB = dd.querySelectorAll('.adw-drop-down-item')[0] as HTMLButtonElement;
            dd.setAttribute('model', '["a","b","c"]');
            expect(dd.querySelectorAll('.adw-drop-down-item')[1]).toBe(rowForB);

            (dd.querySelector('.adw-drop-down-button') as HTMLButtonElement).click();
            rowForB.click();
            expect(dd.selectedValue).toBe('b');
            dd.remove();
        });
    });

    await describe('gtk-drop-down selected ↔ value sync', async () => {
        await it('selectedValue setter finds the index by value', async () => {
            const dd = makeDropDown();
            setModel(dd, [
                { value: 'r', label: 'Red' },
                { value: 'g', label: 'Green' },
                { value: 'b', label: 'Blue' },
            ]);
            dd.selectedValue = 'b';
            expect(dd.selected).toBe(2);
            expect(dd.querySelector('.adw-drop-down-label')?.textContent).toBe('Blue');
            dd.remove();
        });

        await it('get_selected / set_selected are the GTK spelling of `selected`', async () => {
            const dd = makeDropDown();
            setModel(dd, ['a', 'b', 'c']);
            (dd as unknown as { set_selected(n: number): void }).set_selected(2);
            expect(dd.selected).toBe(2);
            expect((dd as unknown as { get_selected(): number }).get_selected()).toBe(2);
            (dd as unknown as { set_selected(n: number): void }).set_selected(9);
            expect(dd.selected).toBe(2);
            dd.remove();
        });

        await it('selected reflects to the attribute + marks the row', async () => {
            const dd = makeDropDown();
            setModel(dd, ['a', 'b']);
            dd.selected = 1;
            expect(dd.getAttribute('selected')).toBe('1');
            const items = dd.querySelectorAll('.adw-drop-down-item');
            expect(items[1].classList.contains('selected')).toBe(true);
            expect(items[1].getAttribute('aria-selected')).toBe('true');
            dd.remove();
        });

        // `selected-item` is the MODEL'S OWN item, by identity (ADR 0122 § 4) — not a
        // `{ value, label }` descriptor, which is what this read used to hand back. The
        // identity is the point: it is what every `selected-item` consumer compares.
        await it('selectedItem is the model’s own item, by identity', async () => {
            const dd = makeDropDown();
            const list = setModel(dd, [{ value: 'k', label: 'Key' }]);
            expect(dd.selectedItem).toBe(list.get_item(0));
            expect((dd as unknown as { get_selected_item(): unknown }).get_selected_item()).toBe(list.get_item(0));
            dd.remove();
        });

        await it('selectedItem is null with no model and with no selection', async () => {
            const dd = makeDropDown();
            expect(dd.model).toBeNull();
            expect(dd.selectedItem).toBeNull();
            setModel(dd, []);
            expect(dd.selectedItem).toBeNull();
            dd.remove();
        });

        await it('setting options + selected before connect does not crash + applies on connect', async () => {
            // The property setters can run BEFORE connectedCallback builds the DOM, where
            // _updateLabel would touch an undefined label element.
            const dd = document.createElement('gtk-drop-down') as GtkDropDown;
            setModel(dd, ['a', 'b', 'c']);
            dd.selected = 2;
            expect(dd.isConnected).toBe(false);
            document.body.appendChild(dd);
            expect(dd.selected).toBe(2);
            expect(dd.querySelector('.adw-drop-down-label')?.textContent).toBe('c');
            expect(dd.querySelectorAll('.adw-drop-down-item').length).toBe(3);
            dd.remove();
        });
    });

    await describe('gtk-drop-down notify-on-change', async () => {
        await it('a programmatic set fires notify::selected but NOT change (DOM <select> semantics)', async () => {
            const dd = makeDropDown();
            setModel(dd, ['a', 'b', 'c']);
            let notifyCount = 0;
            let changeCount = 0;
            dd.addEventListener('notify::selected', () => notifyCount++);
            dd.addEventListener('change', () => changeCount++);
            // Programmatic `.selected`: notify::selected fires (GObject property-notify), but the
            // user-facing DOM `change` must NOT — native `select.value = x` fires no `change` either.
            dd.selected = 2;
            expect(notifyCount).toBe(1);
            expect(changeCount).toBe(0);
            // Programmatic `.selectedValue` is likewise silent on `change`.
            dd.selectedValue = 'a';
            expect(notifyCount).toBe(2);
            expect(changeCount).toBe(0);
            // Re-selecting the same value fires neither event again.
            dd.selectedValue = 'a';
            expect(notifyCount).toBe(2);
            expect(changeCount).toBe(0);
            dd.remove();
        });

        await it('a popover item click selects, fires change + closes', async () => {
            const dd = makeDropDown();
            setModel(dd, ['a', 'b', 'c']);
            let change: unknown = null;
            dd.addEventListener('change', (e) => {
                change = (e as CustomEvent).detail;
            });
            (dd.querySelector('.adw-drop-down-button') as HTMLButtonElement).click();
            expect(dd.active).toBe(true);
            const items = dd.querySelectorAll('.adw-drop-down-item');
            (items[1] as HTMLButtonElement).click();
            expect(dd.selected).toBe(1);
            expect(change).toStrictEqual({ index: 1, value: 'b', label: 'b' });
            expect(dd.active).toBe(false);
            dd.remove();
        });
    });

    await describe('gtk-drop-down popover behaviour', async () => {
        await it('opens on button click and closes on outside pointerdown', async () => {
            const dd = makeDropDown();
            setModel(dd, ['a', 'b']);
            const button = dd.querySelector('.adw-drop-down-button') as HTMLButtonElement;
            const popover = dd.querySelector('.adw-drop-down-popover') as HTMLElement;
            expect(popover.hidden).toBe(true);
            button.click();
            expect(dd.active).toBe(true);
            expect(popover.hidden).toBe(false);
            // Outside pointerdown dismisses.
            document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(dd.active).toBe(false);
            expect(popover.hidden).toBe(true);
            dd.remove();
        });

        await it('a disabled dropdown does not open', async () => {
            const dd = makeDropDown();
            setModel(dd, ['a', 'b']);
            dd.setAttribute('disabled', '');
            (dd.querySelector('.adw-drop-down-button') as HTMLButtonElement).click();
            expect(dd.active).toBe(false);
            dd.remove();
        });
    });

    await describe('gtk-drop-down search', async () => {
        await it('renders a search entry and filters the list', async () => {
            const dd = makeDropDown();
            setModel(dd, ['Apple', 'Banana', 'Cherry']);
            dd.enableSearch = true;
            const search = dd.querySelector('.adw-drop-down-search') as HTMLInputElement;
            expect(search).toBeTruthy();
            (dd.querySelector('.adw-drop-down-button') as HTMLButtonElement).click();
            search.value = 'ban';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            const visible = Array.from(dd.querySelectorAll('.adw-drop-down-item')).filter(
                (b) => !(b as HTMLElement).hidden,
            );
            expect(visible.length).toBe(1);
            expect(visible[0].textContent).toContain('Banana');
            dd.remove();
        });
    });
};

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
// The two are worth driving separately because they part on ONE row, below.
import { describe, it, expect } from '@gjsify/unit';

import {
    COMBO_SELECTION_VECTORS,
    LIST_ITEMS_CHANGED_VECTORS,
    LIST_MODEL_OWNERSHIP_VECTORS,
    LIST_NORMALIZE_VECTORS,
    LIST_PARSE_VECTORS,
    applyListReadback,
} from '@gjsify/adwaita-core/conformance';
import type { ComboSelectionStep, ComboSelectionVector } from '@gjsify/adwaita-core/conformance';

import type { GtkDropDown } from './elements/gtk-drop-down.js';

function makeDropDown(): GtkDropDown {
    const el = document.createElement('gtk-drop-down') as GtkDropDown;
    document.body.appendChild(el);
    return el;
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
 */
function applyStep(dd: GtkDropDown, step: ComboSelectionStep): void {
    switch (step.op) {
        case 'setModel':
            dd.model = step.model;
            return;
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

/**
 * The ONE row this element answers differently, on purpose: its published `selected`
 * contract REJECTS an out-of-range set (`_selectIndex` gates on `ComboState.hasIndex`)
 * where the core state accepts it and reports an empty value — the split
 * `ComboState.hasIndex`'s doc records and `<adw-combo-row>` takes the other side of. The
 * row is still driven below, against the element's answer, so neither policy can change
 * silently.
 */
const DROP_DOWN_REJECTS = 'an index past the end';

/** The named vector — a hard failure if the table renamed it out from under the carve-out. */
function vectorNamed(name: string): ComboSelectionVector {
    const vector = COMBO_SELECTION_VECTORS.find((v) => v.name === name);
    if (!vector) throw new Error(`COMBO_SELECTION_VECTORS has no row "${name}" — this spec's carve-out is stale`);
    return vector;
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
            if (vector.name === DROP_DOWN_REJECTS) continue;

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

        await it(`${DROP_DOWN_REJECTS} — rejected here: the element's published contract, not the state's`, async () => {
            const vector = vectorNamed(DROP_DOWN_REJECTS);
            const { dd, changes } = mountRecording();

            for (const step of vector.steps.slice(0, -1)) applyStep(dd, step);
            const before = { selected: dd.selected, value: dd.selectedValue, label: labelText(dd) };
            // The out-of-range set itself, which the core state would accept and report
            // as nothing-to-draw (`value`/`label` both empty below).
            expect(vector.value).toBe('');
            expect(vector.label).toBe('');
            applyStep(dd, vector.steps[vector.steps.length - 1]);

            // The element refused it: the selection did not move, and a refusal
            // is not a change, so nothing was dispatched either.
            expect({ selected: dd.selected, value: dd.selectedValue, label: labelText(dd) }).toStrictEqual(before);
            expect(changes).toStrictEqual([]);
            dd.remove();
        });
    });

    await describe('gtk-drop-down model', async () => {
        await it('accepts a string[] (value === label)', async () => {
            const dd = makeDropDown();
            dd.model = ['One', 'Two', 'Three'];
            expect(dd.model.length).toBe(3);
            expect(dd.model[0]).toStrictEqual({ value: 'One', label: 'One' });
            expect(dd.querySelector('.adw-drop-down-label')?.textContent).toBe('One');
            dd.remove();
        });

        await it('accepts {value,label}[] and shows the selected label', async () => {
            const dd = makeDropDown();
            dd.model = [
                { value: 'a', label: 'Apple' },
                { value: 'b', label: 'Banana' },
            ];
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
            expect(dd.model.length).toBe(2);
            expect(dd.selected).toBe(1);
            expect(dd.selectedValue).toBe('y');
            dd.remove();
        });

        await it('renders one popover item per option', async () => {
            const dd = makeDropDown();
            dd.model = ['a', 'b', 'c'];
            expect(dd.querySelectorAll('.adw-drop-down-item').length).toBe(3);
            dd.remove();
        });

        for (const vector of LIST_NORMALIZE_VECTORS) {
            await it(`normalize — ${vector.rule}`, async () => {
                const dd = makeDropDown();
                dd.model = vector.input;
                expect(dd.model).toStrictEqual([...vector.model]);
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
                expect(dd.model).toStrictEqual([...vector.model]);
                dd.remove();
            });
        }

        // The half no pure test reaches: a replaced model must SPLICE the row buttons, not
        // rebuild them. Identity is what says which happened — and it is what a user feels,
        // because a rebuilt row loses its focus and the popover its scroll position.
        for (const vector of LIST_ITEMS_CHANGED_VECTORS) {
            await it(`items-changed — ${vector.rule}`, async () => {
                const dd = makeDropDown();
                dd.model = vector.previous;
                const before = [...dd.querySelectorAll('.adw-drop-down-item')];

                dd.model = vector.next;

                const after = [...dd.querySelectorAll('.adw-drop-down-item')];
                expect(after.map((item) => item.querySelector('.adw-drop-down-item-label')?.textContent)).toStrictEqual(
                    vector.next.map((item) => item.label),
                );
                expect(before.filter((item) => after.includes(item)).length).toBe(vector.survivors);
                dd.remove();
            });
        }

        // WHO OWNS the array `model` hands back — the row buttons are what shows it, for
        // the reason `adw-row-state.spec.ts` gives on the same table.
        for (const vector of LIST_MODEL_OWNERSHIP_VECTORS) {
            await it(`ownership — ${vector.rule}`, async () => {
                const dd = makeDropDown();
                const input = vector.initial.map((item) => ({ ...item }));
                dd.model = input;
                const before = [...dd.querySelectorAll('.adw-drop-down-item')];

                const mutated = applyListReadback(vector.source === 'input' ? input : dd.model, vector.op);
                if (vector.assign) dd.model = mutated;

                expect(dd.model).toStrictEqual([...vector.model]);
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
            dd.model = ['b', 'c'];
            const rowForB = dd.querySelectorAll('.adw-drop-down-item')[0] as HTMLButtonElement;
            dd.model = ['a', 'b', 'c'];
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
            dd.model = [
                { value: 'r', label: 'Red' },
                { value: 'g', label: 'Green' },
                { value: 'b', label: 'Blue' },
            ];
            dd.selectedValue = 'b';
            expect(dd.selected).toBe(2);
            expect(dd.querySelector('.adw-drop-down-label')?.textContent).toBe('Blue');
            dd.remove();
        });

        await it('selected reflects to the attribute + marks the row', async () => {
            const dd = makeDropDown();
            dd.model = ['a', 'b'];
            dd.selected = 1;
            expect(dd.getAttribute('selected')).toBe('1');
            const items = dd.querySelectorAll('.adw-drop-down-item');
            expect(items[1].classList.contains('selected')).toBe(true);
            expect(items[1].getAttribute('aria-selected')).toBe('true');
            dd.remove();
        });

        await it('selectedItem returns the descriptor', async () => {
            const dd = makeDropDown();
            dd.model = [{ value: 'k', label: 'Key' }];
            expect(dd.selectedItem).toStrictEqual({ value: 'k', label: 'Key' });
            dd.remove();
        });

        await it('setting options + selected before connect does not crash + applies on connect', async () => {
            // The property setters can run BEFORE connectedCallback builds the DOM, where
            // _updateLabel would touch an undefined label element.
            const dd = document.createElement('gtk-drop-down') as GtkDropDown;
            dd.model = ['a', 'b', 'c'];
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
            dd.model = ['a', 'b', 'c'];
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
            dd.model = ['a', 'b', 'c'];
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
            dd.model = ['a', 'b'];
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
            dd.model = ['a', 'b'];
            dd.setAttribute('disabled', '');
            (dd.querySelector('.adw-drop-down-button') as HTMLButtonElement).click();
            expect(dd.active).toBe(false);
            dd.remove();
        });
    });

    await describe('gtk-drop-down search', async () => {
        await it('renders a search entry and filters the list', async () => {
            const dd = makeDropDown();
            dd.model = ['Apple', 'Banana', 'Cherry'];
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

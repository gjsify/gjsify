// DOM-level behaviour tests for the rows whose state machines now come from
// `@gjsify/adwaita-core` (ADR 0004): <adw-combo-row> (ComboState),
// <adw-spin-row> (SpinState), <adw-toggle-group> (ToggleGroupState) and
// <adw-expander-row> (ExpanderState).
//
// They pin the contract the composition must preserve — most importantly the
// programmatic-vs-interactive split this port has always had: a user interaction
// emits the `notify::*` event, a programmatic property/attribute set updates the
// display silently.
import { describe, expect, it } from '@gjsify/unit';

import { COMBO_CHOOSER_VECTORS, COMBO_SELECTION_VECTORS } from '@gjsify/adwaita-core/conformance';
import type { ComboSelectionStep } from '@gjsify/adwaita-core/conformance';

import type { AdwComboRow } from './elements/adw-combo-row.js';
import type { AdwExpanderRow } from './elements/adw-expander-row.js';
import type { AdwSpinRow } from './elements/adw-spin-row.js';
import type { AdwToggleGroup } from './elements/adw-toggle-group.js';

/** Parse markup so attributes are present when connectedCallback runs. */
function parse<T extends HTMLElement>(html: string, selector: string): { el: T; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = html;
    return { el: host.querySelector(selector) as T, host };
}

/** Collect the `detail` of every `event` dispatched on `el` while `run()` executes. */
function record(el: HTMLElement, event: string): { details: unknown[]; stop: () => void } {
    const details: unknown[] = [];
    const listener = (e: Event) => details.push((e as CustomEvent).detail);
    el.addEventListener(event, listener);
    return { details, stop: () => el.removeEventListener(event, listener) };
}

/**
 * Replay one `COMBO_SELECTION_VECTORS` step against a live `<adw-combo-row>` — the
 * property sets a consumer has for the programmatic ops, a real `<select>` pick for the
 * interactive one.
 *
 * The row can drive the table at all only because the model and the select-by-value are
 * now published; the conformance header names that as the condition for it inheriting
 * these rows. It drives EVERY row, including `an index past the end`, which
 * `<gtk-drop-down>` carves out: the row keeps `ComboState`'s permissive answer where the
 * drop-down's published `selected` contract rejects the set, and `ComboState.hasIndex`'s
 * doc is where that split is stated. So the carve-out is now visible from both sides.
 */
function applyComboStep(row: AdwComboRow, step: ComboSelectionStep): void {
    const select = row.querySelector('select') as HTMLSelectElement;
    switch (step.op) {
        case 'setOptions':
            row.options = step.options;
            return;
        case 'setSelectedIndex':
            row.selected = step.index;
            return;
        case 'setSelectedValue':
            row.selectedValue = step.value;
            return;
        case 'select':
            // A dismissed chooser: the native dropdown closes with nothing picked, which
            // dispatches no `change` at all — there is no gesture to replay.
            if (step.index < 0) return;
            select.selectedIndex = step.index;
            select.dispatchEvent(new Event('change'));
            return;
    }
}

export const AdwRowStateTest = async () => {
    await describe('adw-combo-row (ComboState)', async () => {
        await it('renders the selected label and notifies only on a user pick', async () => {
            const { el: row, host } = parse<AdwComboRow>(
                `<adw-combo-row title="Colour" items='["Red","Green","Blue"]' selected="1"></adw-combo-row>`,
                'adw-combo-row',
            );
            const select = row.querySelector('select') as HTMLSelectElement;
            const value = row.querySelector('.adw-row-value') as HTMLSpanElement;
            const events = record(row, 'notify::selected');

            expect(row.selected).toBe(1);
            expect(value.textContent).toBe('Green');
            expect(select.selectedIndex).toBe(1);

            // A user pick through the native <select>.
            select.selectedIndex = 2;
            select.dispatchEvent(new Event('change'));
            expect(row.selected).toBe(2);
            expect(value.textContent).toBe('Blue');
            expect(row.getAttribute('selected')).toBe('2');
            expect(events.details.length).toBe(1);
            expect((events.details[0] as { selected: number }).selected).toBe(2);

            // A programmatic set refreshes the display but stays silent.
            row.selected = 0;
            expect(value.textContent).toBe('Red');
            expect(select.selectedIndex).toBe(0);
            expect(events.details.length).toBe(1);

            events.stop();
            host.remove();
        });

        await it('renders an empty value for an out-of-range selection', async () => {
            const { el: row, host } = parse<AdwComboRow>(
                `<adw-combo-row title="Empty" items='[]' selected="3"></adw-combo-row>`,
                'adw-combo-row',
            );
            expect((row.querySelector('.adw-row-value') as HTMLSpanElement).textContent).toBe('');
            host.remove();
        });

        for (const { count, presentsChooser, rule } of COMBO_CHOOSER_VECTORS) {
            await it(`${count} option(s) → ${presentsChooser ? 'a chooser' : 'not a chooser'}: ${rule}`, async () => {
                const items = JSON.stringify(Array.from({ length: count }, (_, i) => `Item ${i}`));
                const { el: row, host } = parse<AdwComboRow>(
                    `<adw-combo-row title="Pick" items='${items}'></adw-combo-row>`,
                    'adw-combo-row',
                );
                const value = row.querySelector('.adw-row-value') as HTMLSpanElement;
                const select = row.querySelector('select') as HTMLSelectElement;

                // The ARROW: `.adw-row-value::after` is masked in and the
                // `[data-presents-chooser='false']` block removes it. Asserted as "not
                // none" rather than against the authored `inline-block`, because
                // `.adw-row-value` is a flex container and blockifies its children.
                expect(getComputedStyle(value, '::after').display === 'none').toBe(!presentsChooser);
                // …and the ROW being activatable, which here is the overlaid <select>
                // taking clicks at all: hiding the arrow alone leaves a row that still
                // opens a one-entry popup.
                expect(select.disabled).toBe(!presentsChooser);

                host.remove();
            });
        }

        await it('gains its arrow back when the model grows past one item', async () => {
            const { el: row, host } = parse<AdwComboRow>(
                `<adw-combo-row title="Pick" items='["Only"]'></adw-combo-row>`,
                'adw-combo-row',
            );
            const select = row.querySelector('select') as HTMLSelectElement;
            expect(select.disabled).toBe(true);

            // Through the PUBLISHED path a consumer has — the same `items` property
            // `<gtk-drop-down>` publishes, not a reach into the composed state.
            row.items = ['One', 'Two'];
            expect(select.disabled).toBe(false);
            expect(row.dataset.presentsChooser).toBe('true');

            host.remove();
        });

        // The model is INPUT, so replacing it after connect has to reach the DOM — the
        // half `<gtk-drop-down>` has had all along (`options`/`items` setters + both
        // attributes observed) and this row did not: it parsed `items` once in
        // `connectedCallback`, observed `['title','subtitle','selected']`, and published
        // no accessor, so `row.items = […]` wrote an expando onto the element and
        // `setAttribute('items', …)` reached no callback. Both spellings are asserted
        // because a consumer reaches for whichever its framework binds.
        await it('rebuilds the options when the model is replaced after connect', async () => {
            const { el: row, host } = parse<AdwComboRow>(
                `<adw-combo-row title="Colour" items='["Red","Green"]'></adw-combo-row>`,
                'adw-combo-row',
            );
            const select = row.querySelector('select') as HTMLSelectElement;
            const value = row.querySelector('.adw-row-value') as HTMLSpanElement;
            expect(select.options.length).toBe(2);

            // The PROPERTY, with the plain-string vocabulary both selectors accept.
            row.items = ['Cyan', 'Magenta', 'Yellow'];
            expect([...select.options].map((o) => o.textContent).join('|')).toBe('Cyan|Magenta|Yellow');
            expect(row.items.map((o) => o.label).join('|')).toBe('Cyan|Magenta|Yellow');
            // The model was replaced under an index the new one still has, so autoselect
            // keeps 0 and the inline label has to follow the NEW option at that index.
            expect(value.textContent).toBe('Cyan');

            // The ATTRIBUTE, the spelling markup and every attribute-binding framework use.
            row.setAttribute('items', '["Only"]');
            expect([...select.options].map((o) => o.textContent).join('|')).toBe('Only');
            expect(value.textContent).toBe('Only');
            // …and the chooser rule re-runs off the replaced model.
            expect(select.disabled).toBe(true);
            expect(row.dataset.presentsChooser).toBe('false');

            host.remove();
        });

        // `<gtk-drop-down>` publishes `options` as the primary spelling and `items` as its
        // alias; the row now answers both the same way, so a consumer moving a model
        // between the two selectors does not have to rename it.
        await it('accepts the `options` spelling and descriptor objects too', async () => {
            const { el: row, host } = parse<AdwComboRow>(
                `<adw-combo-row title="Colour"></adw-combo-row>`,
                'adw-combo-row',
            );
            const select = row.querySelector('select') as HTMLSelectElement;

            row.options = [
                { value: 'r', label: 'Red' },
                { value: 'g', label: 'Green' },
            ];
            expect([...select.options].map((o) => o.textContent).join('|')).toBe('Red|Green');
            expect(row.options.map((o) => o.value).join('|')).toBe('r|g');

            // And selection by VALUE, the drop-down's other published setter.
            row.selectedValue = 'g';
            expect(row.selected).toBe(1);
            expect((row.querySelector('.adw-row-value') as HTMLSpanElement).textContent).toBe('Green');

            host.remove();
        });
    });

    // The SAME table `<gtk-drop-down>` and the NativeScript renderer are held to
    // (`COMBO_SELECTION_VECTORS`), replayed through this row's own DOM and read back as
    // what a user would see: the inline value label, `selected`/`selectedValue`, and the
    // `notify::selected` stream. Two of the four step ops had no spelling here until the
    // model and the select-by-value were published, which is what the conformance header
    // names as the condition for this row inheriting the rows.
    await describe('adw-combo-row selection (libadwaita conformance vectors)', async () => {
        for (const vector of COMBO_SELECTION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, async () => {
                const { el: row, host } = parse<AdwComboRow>(
                    `<adw-combo-row title="Pick"></adw-combo-row>`,
                    'adw-combo-row',
                );
                const value = row.querySelector('.adw-row-value') as HTMLSpanElement;
                const events = record(row, 'notify::selected');

                for (const step of vector.steps) applyComboStep(row, step);

                expect(row.selected).toBe(vector.selected);
                expect(row.selectedValue).toBe(vector.value);
                expect(value.textContent).toBe(vector.label);
                // `notify::selected` is this row's DOM spelling of the `interactive`
                // flag: a user pick emits, a programmatic set repaints silently. So the
                // interactive frames of the state's stream ARE the events a listener sees.
                expect(events.details).toStrictEqual(
                    vector.emitted
                        .filter((change) => change.interactive)
                        .map((change) => ({ selected: change.selected })),
                );

                events.stop();
                host.remove();
            });
        }
    });

    await describe('adw-spin-row (SpinState)', async () => {
        await it('steps at step precision and notifies only on a stepper press', async () => {
            const { el: row, host } = parse<AdwSpinRow>(
                '<adw-spin-row title="Amount" min="0" max="10" step="0.1" value="0"></adw-spin-row>',
                'adw-spin-row',
            );
            const input = row.querySelector('input') as HTMLInputElement;
            const inc = row.querySelector('.adw-spin-inc') as HTMLButtonElement;
            const events = record(row, 'notify::value');

            expect(input.value).toBe('0.0');

            inc.click();
            inc.click();
            inc.click();
            // Without the step-precision rounding this drifts to 0.30000000000000004.
            expect(row.value).toBe(0.3);
            expect(input.value).toBe('0.3');
            expect(events.details.length).toBe(3);

            // A programmatic set clamps to max and stays silent.
            row.value = 99;
            expect(row.value).toBe(10);
            expect(input.value).toBe('10.0');
            expect(events.details.length).toBe(3);

            events.stop();
            host.remove();
        });

        await it('clamps to the lower bound and re-clamps when a bound moves', async () => {
            const { el: row, host } = parse<AdwSpinRow>(
                '<adw-spin-row title="Amount" min="2" max="8" step="1" value="5"></adw-spin-row>',
                'adw-spin-row',
            );
            const input = row.querySelector('input') as HTMLInputElement;

            row.value = -4;
            expect(row.value).toBe(2);

            // Moving the upper bound below the value pulls the value into range.
            row.value = 8;
            row.setAttribute('max', '6');
            expect(row.value).toBe(6);
            expect(input.value).toBe('6');

            host.remove();
        });
    });

    await describe('adw-toggle-group (ToggleGroupState)', async () => {
        await it('tracks the active segment and notifies only on a click', async () => {
            const { el: group, host } = parse<AdwToggleGroup>(
                `<adw-toggle-group active="1">
                    <adw-toggle label="One"></adw-toggle>
                    <adw-toggle label="Two"></adw-toggle>
                    <adw-toggle label="Three"></adw-toggle>
                </adw-toggle-group>`,
                'adw-toggle-group',
            );
            const buttons = Array.from(group.querySelectorAll('button.adw-toggle')) as HTMLButtonElement[];
            const events = record(group, 'notify::active');

            expect(buttons.length).toBe(3);
            expect(group.active).toBe(1);
            expect(buttons[1].classList.contains('active')).toBe(true);
            // `aria-checked`, not `aria-pressed`: upstream declares the group a
            // `RADIO_GROUP` and each toggle a `RADIO` (adw-toggle-group.c:1191, :860),
            // and `aria-pressed` is the independent toolbar toggle-BUTTON pattern. This
            // line pinned the wrong one until the roles landed.
            expect(buttons[1].getAttribute('aria-checked')).toBe('true');
            expect(buttons[1].getAttribute('role')).toBe('radio');

            buttons[2].click();
            expect(group.active).toBe(2);
            expect(buttons[2].classList.contains('active')).toBe(true);
            expect(buttons[1].classList.contains('active')).toBe(false);
            expect(group.getAttribute('active')).toBe('2');
            expect(events.details.length).toBe(1);

            // Re-clicking the active segment is a no-op.
            buttons[2].click();
            expect(events.details.length).toBe(1);

            // A programmatic set moves the pill without notifying.
            group.active = 0;
            expect(group.active).toBe(0);
            expect(buttons[0].classList.contains('active')).toBe(true);
            // The roving tabindex and the state attribute move with the pill. Reading
            // only `classList` here would pass on a `_render` that repainted the group
            // and left Tab entering on the toggle that is no longer active.
            expect(buttons.map((btn) => btn.tabIndex)).toStrictEqual([0, -1, -1]);
            expect(buttons.map((btn) => btn.getAttribute('aria-checked'))).toStrictEqual(['true', 'false', 'false']);
            expect(events.details.length).toBe(1);

            events.stop();
            host.remove();
        });

        await it('clamps an out-of-range active attribute to the last segment', async () => {
            const { el: group, host } = parse<AdwToggleGroup>(
                `<adw-toggle-group active="99">
                    <adw-toggle label="One"></adw-toggle>
                    <adw-toggle label="Two"></adw-toggle>
                </adw-toggle-group>`,
                'adw-toggle-group',
            );
            expect(group.active).toBe(1);
            host.remove();
        });
    });

    await describe('adw-expander-row (ExpanderState)', async () => {
        await it('discloses on a header click and notifies only then', async () => {
            const { el: row, host } = parse<AdwExpanderRow>(
                '<adw-expander-row title="More"><adw-action-row title="Nested"></adw-action-row></adw-expander-row>',
                'adw-expander-row',
            );
            const header = row.querySelector('.adw-expander-row-header') as HTMLDivElement;
            const events = record(row, 'notify::expanded');

            expect(row.expanded).toBe(false);
            expect(row.classList.contains('expanded')).toBe(false);

            header.click();
            expect(row.expanded).toBe(true);
            expect(row.hasAttribute('expanded')).toBe(true);
            expect(row.classList.contains('expanded')).toBe(true);
            expect(events.details.length).toBe(1);

            // A programmatic collapse reflects to the attribute but stays silent.
            row.expanded = false;
            expect(row.hasAttribute('expanded')).toBe(false);
            expect(row.classList.contains('expanded')).toBe(false);
            expect(events.details.length).toBe(1);

            events.stop();
            host.remove();
        });

        await it('adopts a declarative expanded attribute', async () => {
            const { el: row, host } = parse<AdwExpanderRow>(
                '<adw-expander-row title="Open" expanded></adw-expander-row>',
                'adw-expander-row',
            );
            expect(row.expanded).toBe(true);
            expect(row.classList.contains('expanded')).toBe(true);
            host.remove();
        });
    });
};

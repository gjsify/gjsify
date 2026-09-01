// DOM-level tests for <gtk-check-button> and <adw-radio>, plus the browser side of
// the `RADIO_GROUP_VECTORS` conformance table.
//
// The browser's native radio exclusivity is NOT enough: `<input type="radio" name="g">`
// unchecks its sibling INPUT and stops there, while the sibling `<adw-radio>` HOST keeps
// its `checked` attribute — the element's published state and the selector
// `_checks.scss` paints from — so a group left to the browser draws two selected radios.
// Every vector below reads back the HOST attribute of every member for that reason.
//
// The vectors run under a per-scenario group-name prefix because `RadioGroupState` is
// document-global by design (as a bare `<input type=radio name=x>` outside a form is),
// so two scenarios sharing the literal name `colour` would share a selection.

import { describe, expect, it } from '@gjsify/unit';
import { RADIO_GROUP_VECTORS } from '@gjsify/adwaita-core/conformance';

import type { GtkCheckButton, AdwRadio } from './elements/checks.js';

function host(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function mountCheckbox(): { el: GtkCheckButton; parent: HTMLElement } {
    const parent = host();
    const el = document.createElement('gtk-check-button') as GtkCheckButton;
    parent.appendChild(el);
    return { el, parent };
}

/** The parts, by the markup contract the stylesheet selects on. */
function parts(check: HTMLElement): { input: HTMLInputElement; indicator: HTMLElement; label: HTMLElement } {
    return {
        input: check.querySelector('input.adw-check-input') as HTMLInputElement,
        indicator: check.querySelector('.adw-check-indicator') as HTMLElement,
        label: check.querySelector('.adw-check-label') as HTMLElement,
    };
}

/** Collect the `detail` of every `event` bubbling to `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

/** The glyph the indicator's mask is currently painting. */
function glyph(check: HTMLElement): string {
    return getComputedStyle(parts(check).indicator, '::after').getPropertyValue('mask-image');
}

export const AdwChecksTest = async () => {
    await describe('<gtk-check-button> state', async () => {
        await it('builds the input + indicator + label markup', () => {
            const { el, parent } = mountCheckbox();
            const { input, indicator, label } = parts(el);
            expect(input).toBeTruthy();
            expect(input.type).toBe('checkbox');
            expect(indicator).toBeTruthy();
            // The focus ring is `input:focus-visible ~ .adw-check-indicator`, so the
            // input MUST precede the indicator.
            expect(input.nextElementSibling).toBe(indicator);
            expect(el.checked).toBe(false);
            expect(input.getAttribute('aria-checked')).toBe('false');
            expect(label.hidden).toBe(true);
            parent.remove();
        });

        await it('adopts authored child nodes as the label, and the attribute wins', () => {
            const parent = host();
            const authored = document.createElement('gtk-check-button') as GtkCheckButton;
            authored.textContent = 'Enable';
            parent.appendChild(authored);
            expect(parts(authored).label.textContent).toBe('Enable');
            expect(parts(authored).label.hidden).toBe(false);

            const labelled = document.createElement('gtk-check-button') as GtkCheckButton;
            labelled.setAttribute('label', 'From the attribute');
            labelled.textContent = 'ignored';
            parent.appendChild(labelled);
            expect(parts(labelled).label.textContent).toBe('From the attribute');
            parent.remove();
        });

        await it('a programmatic set notifies, and re-setting the same value does not', () => {
            const { el, parent } = mountCheckbox();
            const events = record(el, 'notify::checked');
            el.checked = true;
            expect(events).toStrictEqual([{ checked: true }]);
            expect(parts(el).input.checked).toBe(true);
            el.checked = true;
            expect(events.length).toBe(1);
            el.checked = false;
            expect(events.length).toBe(2);
            parent.remove();
        });

        await it('a click toggles exactly once', () => {
            const { el, parent } = mountCheckbox();
            const events = record(el, 'notify::checked');
            el.click();
            expect(el.checked).toBe(true);
            expect(el.hasAttribute('checked')).toBe(true);
            expect(events.length).toBe(1);
            parent.remove();
        });

        await it('a click on the hidden input toggles exactly once', () => {
            // The input is 0x0 so a pointer never reaches it, but keyboard activation and
            // `input.click()` do — and the host listener must not toggle a second time.
            const { el, parent } = mountCheckbox();
            const events = record(el, 'notify::checked');
            parts(el).input.click();
            expect(el.checked).toBe(true);
            expect(events.length).toBe(1);
            parent.remove();
        });

        await it('a disabled checkbox does not toggle on a click', () => {
            const { el, parent } = mountCheckbox();
            el.disabled = true;
            const events = record(el, 'notify::checked');
            el.click();
            expect(el.checked).toBe(false);
            expect(events.length).toBe(0);
            expect(parts(el).input.disabled).toBe(true);
            // …but it is not frozen: a programmatic set still applies, matching
            // GObject property semantics (sensitivity gates INPUT, not value).
            el.checked = true;
            expect(events).toStrictEqual([{ checked: true }]);
            parent.remove();
        });
    });

    await describe('<gtk-check-button> indeterminate', async () => {
        await it('announces as mixed and outranks checked', () => {
            const { el, parent } = mountCheckbox();
            el.checked = true;
            el.indeterminate = true;
            const { input } = parts(el);
            // HTML has a native mixed CHECKBOX; the radio has none, so an explicit
            // aria-checked makes it read the same way.
            expect(input.indeterminate).toBe(true);
            expect(input.getAttribute('aria-checked')).toBe('mixed');
            parent.remove();
        });

        await it('draws the dash even when also checked', () => {
            // In `_checks.scss` the `:indeterminate` glyph is re-declared AFTER both
            // `:checked` rules at equal specificity, so the dash wins. Comparing all
            // three states proves the cascade, not just that a mask exists.
            const parent = host();
            const make = (attrs: string[]) => {
                const el = document.createElement('gtk-check-button') as GtkCheckButton;
                for (const attr of attrs) el.setAttribute(attr, '');
                parent.appendChild(el);
                return el;
            };
            const checked = make(['checked']);
            const mixed = make(['indeterminate']);
            const both = make(['checked', 'indeterminate']);

            expect(glyph(both)).toBe(glyph(mixed));
            expect(glyph(both)).not.toBe(glyph(checked));
            parent.remove();
        });

        await it('activating an indeterminate checkbox clears it and checks', () => {
            // HTML's pre-click activation steps, not a reading of
            // GtkCheckButton:inconsistent, which is not verifiable in this tree.
            const { el, parent } = mountCheckbox();
            el.indeterminate = true;
            el.click();
            expect(el.indeterminate).toBe(false);
            expect(el.checked).toBe(true);
            parent.remove();
        });
    });

    await describe('check and radio share one stylesheet', async () => {
        await it('both draw the 14px + 3px indicator, differing only in the radius', () => {
            const parent = host();
            const check = document.createElement('gtk-check-button') as GtkCheckButton;
            const radio = document.createElement('adw-radio') as AdwRadio;
            parent.append(check, radio);

            for (const el of [check, radio]) {
                const style = getComputedStyle(parts(el).indicator);
                // GTK sizes the CONTENT box at 14px and grows the drawn control with
                // `padding: 3px` — content-box, not the ADR-0010 border-box pin.
                expect(style.width).toBe('14px');
                expect(style.height).toBe('14px');
                expect(style.paddingTop).toBe('3px');
            }

            // `check { border-radius: 6px }` vs
            // `radio { border-radius: 100% }`.
            expect(getComputedStyle(parts(check).indicator).borderTopLeftRadius).toBe('6px');
            expect(getComputedStyle(parts(radio).indicator).borderTopLeftRadius).toContain('%');
            parent.remove();
        });

        await it('a checked radio FILLS, with the SAME accent background as a checked check', () => {
            // refs/adwaita-web's `_radio.scss` colours only the border and the dot,
            // leaving the indicator on the view background; libadwaita fills the whole
            // control from the block it SHARES with the checkbox, and libadwaita wins —
            // so the two fills must be identical.
            //
            // THREE elements rather than one flipped in place: the indicator TRANSITIONS
            // `background`, so a computed read right after `checked = true` returns the
            // INTERPOLATED colour. Declaring the state before insertion leaves no
            // transition part-way through, and distinct names keep seeding one group from
            // reaching the reference radio.
            const parent = host();
            const plain = document.createElement('adw-radio') as AdwRadio;
            plain.setAttribute('name', 'fill-plain');
            const radio = document.createElement('adw-radio') as AdwRadio;
            radio.setAttribute('name', 'fill-checked');
            radio.setAttribute('value', 'x');
            radio.setAttribute('checked', '');
            const check = document.createElement('gtk-check-button') as GtkCheckButton;
            check.setAttribute('checked', '');
            parent.append(plain, radio, check);

            const before = getComputedStyle(parts(plain).indicator).backgroundColor;
            const after = getComputedStyle(parts(radio).indicator).backgroundColor;

            expect(after).not.toBe(before);
            expect(after).toBe(getComputedStyle(parts(check).indicator).backgroundColor);
            parent.remove();
        });
    });

    await describe('<adw-radio> group exclusivity (conformance vectors)', async () => {
        for (const [index, vector] of RADIO_GROUP_VECTORS.entries()) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const parent = host();
                const scope = (name: string) => `v${index}-${name}`;

                const members = vector.members.map(([name, value]) => {
                    const el = document.createElement('adw-radio') as AdwRadio;
                    el.setAttribute('name', scope(name));
                    el.setAttribute('value', value);
                    parent.appendChild(el);
                    return el;
                });
                const events = record(parent, 'notify::checked');

                for (const step of vector.steps) {
                    const target = members.find((el) => el.name === scope(step.name) && el.value === step.value);
                    expect(target).toBeTruthy();
                    (target as AdwRadio).click();
                }

                const expected = new Map(vector.selected.map(([name, value]) => [scope(name), value]));
                for (const [i, el] of members.entries()) {
                    const [name, value] = vector.members[i];
                    const shouldHold = expected.get(scope(name)) === value;
                    // The HOST attribute, not the input: this is precisely what
                    // the browser's own exclusivity leaves stale.
                    expect(el.hasAttribute('checked')).toBe(shouldHold);
                    expect(parts(el).input.checked).toBe(shouldHold);
                }

                // Every emitted change repaints the winner AND the loser when there was
                // one; that second repaint is why the group state exists.
                const expectedEvents = vector.emitted.reduce(
                    (total, change) => total + (change.deselected === null ? 1 : 2),
                    0,
                );
                expect(events.length).toBe(expectedEvents);
                parent.remove();
            });
        }
    });

    await describe('<adw-radio> group behaviour the browser alone gets wrong', async () => {
        await it('picking a second member clears the first HOST attribute', () => {
            const parent = host();
            const first = document.createElement('adw-radio') as AdwRadio;
            first.setAttribute('name', 'stale-check');
            first.setAttribute('value', 'a');
            first.setAttribute('checked', '');
            const second = document.createElement('adw-radio') as AdwRadio;
            second.setAttribute('name', 'stale-check');
            second.setAttribute('value', 'b');
            parent.append(first, second);

            second.click();

            expect(second.checked).toBe(true);
            expect(first.checked).toBe(false);
            expect(first.hasAttribute('checked')).toBe(false);
            expect(parts(first).input.checked).toBe(false);
            parent.remove();
        });

        await it('groups are scoped by name', () => {
            const parent = host();
            const make = (name: string, value: string) => {
                const el = document.createElement('adw-radio') as AdwRadio;
                el.setAttribute('name', name);
                el.setAttribute('value', value);
                parent.appendChild(el);
                return el;
            };
            const left = make('scoped-a', 'x');
            const right = make('scoped-b', 'x');

            left.click();
            right.click();

            expect(left.checked).toBe(true);
            expect(right.checked).toBe(true);
            parent.remove();
        });

        await it('a NAMELESS radio is not in a group', () => {
            // HTML forms a radio group only from a non-empty `name`; without that rule
            // every nameless radio lands in one `''` group and fights over it, which is
            // what a registry keyed by name does unless it guards the empty key.
            const parent = host();
            const first = document.createElement('adw-radio') as AdwRadio;
            const second = document.createElement('adw-radio') as AdwRadio;
            parent.append(first, second);

            first.click();
            second.click();

            expect(first.checked).toBe(true);
            expect(second.checked).toBe(true);
            parent.remove();
        });

        await it('a value falls back to the label text so a bare group still works', () => {
            const parent = host();
            const make = (text: string) => {
                const el = document.createElement('adw-radio') as AdwRadio;
                el.setAttribute('name', 'bare');
                el.setAttribute('label', text);
                parent.appendChild(el);
                return el;
            };
            const red = make('Red');
            const green = make('Green');

            expect(red.value).toBe('Red');
            red.click();
            green.click();

            expect(red.checked).toBe(false);
            expect(green.checked).toBe(true);
            parent.remove();
        });
    });
};

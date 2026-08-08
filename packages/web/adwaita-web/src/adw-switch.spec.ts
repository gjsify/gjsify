// DOM-level tests for <adw-switch>, plus the REGRESSION PROOF that lifting it
// out of <adw-switch-row> and <adw-expander-row> left both rows working.
//
// What the extraction removed: `_expander_row.scss:73-121` was a
// character-for-character copy of `_switch_row.scss:15-63` (same 44×24 box, same
// hidden input, same 20px knob, same `translateX(20px)`, same focus ring),
// because `_switch_row.scss:9` opened `adw-switch-row {` and nested `.adw-switch`
// inside it — so the class did not exist anywhere else and the expander row could
// not reuse it. Two consequences this suite pins down:
//
//   - the GEOMETRY now comes from ONE unscoped partial. `measure()` compares the
//     computed box of the row's switch against the expander's; before the lift
//     they were two independently-maintained blocks that happened to agree, and
//     deleting either one silently unstyled its widget.
//   - the EVENTS are unchanged. Both rows compose an element that emits its own
//     `notify::active`, so each row stops it at the switch and publishes its own
//     name — a row listener must still see exactly one event per toggle.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwExpanderRow } from './elements/adw-expander-row.js';
import type { AdwSwitch } from './elements/adw-switch.js';
import type { AdwSwitchRow } from './elements/adw-switch-row.js';

function mount<T extends HTMLElement>(tag: string): { el: T; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement(tag) as T;
    host.appendChild(el);
    return { el, host };
}

/** Collect the `detail` of every `event` dispatched on (or bubbling to) `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

/** The switch's own parts, by the markup contract the stylesheet selects on. */
function parts(sw: AdwSwitch): { input: HTMLInputElement; slider: HTMLElement } {
    return {
        input: sw.querySelector('input[type="checkbox"]') as HTMLInputElement,
        slider: sw.querySelector('.adw-switch-slider') as HTMLElement,
    };
}

/** The rendered track box — the thing the two copies used to declare separately. */
function measure(sw: HTMLElement): { width: string; height: string; radius: string } {
    const box = getComputedStyle(sw);
    const slider = getComputedStyle(sw.querySelector('.adw-switch-slider') as HTMLElement);
    return { width: box.width, height: box.height, radius: slider.borderTopLeftRadius };
}

export const AdwSwitchTest = async () => {
    await describe('<adw-switch> state', async () => {
        await it('starts off and builds the input + slider markup', () => {
            const { el, host } = mount<AdwSwitch>('adw-switch');
            const { input, slider } = parts(el);
            expect(el.active).toBe(false);
            expect(input).toBeTruthy();
            expect(input.checked).toBe(false);
            // The focus ring is `input:focus-visible + .adw-switch-slider`, so the
            // slider MUST be the input's immediate next sibling.
            expect(input.nextElementSibling).toBe(slider);
            expect(el.classList.contains('adw-switch')).toBe(true);
            host.remove();
        });

        await it('adopts a declarative active attribute without emitting', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const el = document.createElement('adw-switch') as AdwSwitch;
            el.setAttribute('active', '');
            const events = record(el, 'notify::active');
            host.appendChild(el);
            expect(el.active).toBe(true);
            expect(parts(el).input.checked).toBe(true);
            expect(events.length).toBe(0);
            host.remove();
        });

        await it('a programmatic set notifies, and re-setting the same value does not', () => {
            const { el, host } = mount<AdwSwitch>('adw-switch');
            const events = record(el, 'notify::active');
            el.active = true;
            expect(events).toStrictEqual([{ active: true }]);
            el.active = true;
            expect(events.length).toBe(1);
            el.active = false;
            expect(events.length).toBe(2);
            expect(parts(el).input.checked).toBe(false);
            host.remove();
        });

        await it('a click on the track toggles exactly once', () => {
            const { el, host } = mount<AdwSwitch>('adw-switch');
            const events = record(el, 'notify::active');
            parts(el).slider.click();
            expect(el.active).toBe(true);
            expect(el.hasAttribute('active')).toBe(true);
            expect(events.length).toBe(1);
            host.remove();
        });

        await it('a click on the hidden checkbox toggles exactly once', () => {
            // The checkbox is 0×0, so a pointer never reaches it — but keyboard
            // activation and `input.click()` do, and the track listener must not
            // toggle a second time on the way out.
            const { el, host } = mount<AdwSwitch>('adw-switch');
            const events = record(el, 'notify::active');
            parts(el).input.click();
            expect(el.active).toBe(true);
            expect(events.length).toBe(1);
            host.remove();
        });

        await it('a disabled switch does not toggle', () => {
            const { el, host } = mount<AdwSwitch>('adw-switch');
            el.disabled = true;
            const events = record(el, 'notify::active');
            parts(el).slider.click();
            expect(el.active).toBe(false);
            expect(events.length).toBe(0);
            expect(parts(el).input.disabled).toBe(true);
            expect(el.classList.contains('disabled')).toBe(true);
            // …but it is not frozen: a programmatic set still applies, matching
            // GObject property semantics (sensitivity gates INPUT, not the value).
            el.active = true;
            expect(events).toStrictEqual([{ active: true }]);
            host.remove();
        });
    });

    await describe('<adw-switch-row> still toggles and emits through <adw-switch>', async () => {
        await it('a programmatic row.active drives the switch and emits once', () => {
            const { el: row, host } = mount<AdwSwitchRow>('adw-switch-row');
            const events = record(row, 'notify::active');
            const sw = row.querySelector('adw-switch') as AdwSwitch;
            expect(sw).toBeTruthy();

            row.active = true;

            expect(sw.active).toBe(true);
            expect(parts(sw).input.checked).toBe(true);
            expect(row.getAttribute('aria-checked')).toBe('true');
            // ONE event: the composed switch's identically-named notify is
            // stopped at the switch so it cannot reach a row listener as a second.
            expect(events).toStrictEqual([{ active: true }]);
            host.remove();
        });

        await it('a click on the row toggles and emits once', () => {
            const { el: row, host } = mount<AdwSwitchRow>('adw-switch-row');
            const events = record(row, 'notify::active');
            row.click();
            expect(row.active).toBe(true);
            expect((row.querySelector('adw-switch') as AdwSwitch).active).toBe(true);
            expect(events.length).toBe(1);
            host.remove();
        });

        await it('a click on the switch toggles the row once, not twice', () => {
            const { el: row, host } = mount<AdwSwitchRow>('adw-switch-row');
            const events = record(row, 'notify::active');
            const sw = row.querySelector('adw-switch') as AdwSwitch;
            parts(sw).slider.click();
            expect(row.active).toBe(true);
            expect(events.length).toBe(1);
            host.remove();
        });
    });

    await describe('<adw-expander-row> still toggles its enable switch', async () => {
        await it('a user toggle flips enable-expansion and emits once', () => {
            const { el: row, host } = mount<AdwExpanderRow>('adw-expander-row');
            row.setAttribute('show-enable-switch', '');
            const events = record(row, 'notify::enable-expansion');
            const sw = row.querySelector('adw-switch') as AdwSwitch;
            expect(sw.active).toBe(true); // enable-expansion defaults to true

            parts(sw).slider.click();

            expect(row.enableExpansion).toBe(false);
            expect(row.getAttribute('enable-expansion')).toBe('false');
            expect(events).toStrictEqual([{ enableExpansion: false }]);
            host.remove();
        });

        await it('a programmatic enableExpansion re-syncs the switch silently', () => {
            // The row's published event is for USER changes, as it always was —
            // the composed switch notifies on every change, so the row has to
            // know which writes are its own.
            const { el: row, host } = mount<AdwExpanderRow>('adw-expander-row');
            row.setAttribute('show-enable-switch', '');
            const enableEvents = record(row, 'notify::enable-expansion');
            const activeEvents = record(row, 'notify::active');

            row.enableExpansion = false;

            expect((row.querySelector('adw-switch') as AdwSwitch).active).toBe(false);
            expect(enableEvents.length).toBe(0);
            // The switch's own notify never escapes the row either.
            expect(activeEvents.length).toBe(0);
            host.remove();
        });

        await it('a click on the enable switch does not disclose the row', () => {
            const { el: row, host } = mount<AdwExpanderRow>('adw-expander-row');
            row.setAttribute('show-enable-switch', '');
            const sw = row.querySelector('adw-switch') as AdwSwitch;

            parts(sw).slider.click();
            expect(row.expanded).toBe(false);

            (row.querySelector('.adw-expander-row-header') as HTMLElement).click();
            expect(row.expanded).toBe(true);
            host.remove();
        });
    });

    await describe('one switch stylesheet reaches both rows', async () => {
        await it('the row and the expander render the SAME track box', () => {
            const { el: row, host: rowHost } = mount<AdwSwitchRow>('adw-switch-row');
            const { el: expander, host: expanderHost } = mount<AdwExpanderRow>('adw-expander-row');
            expander.setAttribute('show-enable-switch', '');

            const rowBox = measure(row.querySelector('adw-switch') as HTMLElement);
            const expanderBox = measure(expander.querySelector('adw-switch') as HTMLElement);

            expect(rowBox).toStrictEqual(expanderBox);
            // Pin the actual numbers too, so "both unstyled" cannot pass as
            // "both agree". This is refs/adwaita-web's geometry, NOT libadwaita's
            // (which is a 3px-padded trough around a 20px slider) — see the
            // fidelity note in scss/_switch.scss.
            expect(rowBox.width).toBe('44px');
            expect(rowBox.height).toBe('24px');

            rowHost.remove();
            expanderHost.remove();
        });
    });
};

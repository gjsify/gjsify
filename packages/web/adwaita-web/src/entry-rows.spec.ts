// DOM-level conformance tests for <adw-entry-row> and <adw-password-entry-row>,
// driven by the SAME vectors the NativeScript renderer asserts against
// (`@gjsify/adwaita-core/conformance`).
//
// Everything these vectors describe used to be MISSING here, not merely
// different: `update_empty`'s truth table, the apply button (declared `true` in
// the shared story metadata all along), the Enter key, max-length, the caps-lock
// warning and its two suppression rules. Nothing failed, because nothing
// compared this renderer to the C. This suite is that comparison — it drives the
// real elements through each scenario and reads back what a user would see.
import { describe, expect, it } from '@gjsify/unit';

import {
    ENTRY_MAX_LENGTH_VECTORS,
    ENTRY_ROW_ACTIVATION_VECTORS,
    ENTRY_ROW_STATE_VECTORS,
    ENTRY_TEXT_LENGTH_VECTORS,
    PASSWORD_ENTRY_ROW_VECTORS,
    PASSWORD_REVEAL_GUARD_VECTORS,
    type EntryRowStep,
    type PasswordEntryRowStep,
} from '@gjsify/adwaita-core/conformance';

import type { AdwEntryRow } from './elements/adw-entry-row.js';
import type { AdwPasswordEntryRow } from './elements/adw-password-entry-row.js';

/** The rendered parts one render snapshot drives. */
interface RowParts {
    row: AdwEntryRow;
    host: HTMLElement;
    input: HTMLInputElement;
    emptyTitle: HTMLElement;
    title: HTMLElement;
    editIcon: HTMLElement;
    indicator: HTMLElement;
    applyButton: HTMLButtonElement;
}

/** Mount a row of `tag` and collect its parts. `prefix` is the element's part-class prefix. */
function mount(tag: string, prefix: string, markup = ''): RowParts {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = `<${tag} title="Display name">${markup}</${tag}>`;
    const row = host.querySelector(tag) as AdwEntryRow;
    return {
        row,
        host,
        input: row.querySelector(`.${prefix}-input`) as HTMLInputElement,
        emptyTitle: row.querySelector(`.${prefix}-empty-title`) as HTMLElement,
        title: row.querySelector(`.${prefix}-title`) as HTMLElement,
        editIcon: row.querySelector(`.${prefix}-edit`) as HTMLElement,
        indicator: row.querySelector(`.${prefix}-indicator`) as HTMLElement,
        applyButton: row.querySelector(`.${prefix}-apply`) as HTMLButtonElement,
    };
}

/**
 * Replay one vector step against the real element, through the API a consumer
 * would use — focus/blur for `editing`, the button for `apply`.
 */
function applyStep(parts: RowParts, step: EntryRowStep): void {
    switch (step.op) {
        case 'setText':
            parts.row.text = step.value;
            return;
        case 'setEditing':
            if (step.value) parts.input.focus();
            else parts.input.blur();
            return;
        case 'setEditable':
            parts.row.editable = step.value;
            return;
        case 'setMaxLength':
            parts.row.maxLength = step.value;
            return;
        case 'setShowApplyButton':
            parts.row.showApplyButton = step.value;
            return;
        case 'setShowIndicator':
            parts.row.setShowIndicator(step.value);
            return;
        case 'setActivatesDefault':
            parts.row.activatesDefault = step.value;
            return;
        case 'apply':
            parts.applyButton.click();
            return;
    }
}

/** Assert the whole render snapshot against the DOM. */
function expectSnapshot(parts: RowParts, expected: (typeof ENTRY_ROW_STATE_VECTORS)[number]['expected']): void {
    expect(parts.input.value).toBe(expected.text);
    expect(parts.row.getAttribute('text-length')).toBe(String(expected.textLength));
    expect(parts.row.classList.contains('empty')).toBe(expected.empty);
    expect(parts.row.classList.contains('focused')).toBe(expected.editing);
    expect(parts.input.readOnly).toBe(!expected.editable);
    expect(parts.emptyTitle.hidden).toBe(expected.emptyTarget !== 0);
    expect(parts.title.hidden).toBe(expected.emptyTarget !== 1);
    expect(parts.editIcon.hidden).toBe(!expected.editIconVisible);
    expect(parts.editIcon.getAttribute('aria-disabled')).toBe(String(!expected.editIconSensitive));
    expect(parts.indicator.hidden).toBe(!expected.indicatorVisible);
    expect(parts.applyButton.hidden).toBe(!expected.applyButtonVisible);
}

/** Collect the names of `events` dispatched on `el`, in order. */
function recordEvents(el: HTMLElement, events: string[]): { names: string[] } {
    const names: string[] = [];
    for (const name of events) el.addEventListener(name, () => names.push(name));
    return { names };
}

/** Press Enter in the field the way a user would. */
function pressEnter(parts: RowParts): void {
    parts.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

export const AdwEntryRowsTest = async () => {
    await describe('adw-entry-row update_empty (libadwaita conformance vectors)', async () => {
        for (const { name, steps, expected, rule } of ENTRY_ROW_STATE_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const parts = mount('adw-entry-row', 'adw-entry-row');
                for (const step of steps) applyStep(parts, step);
                expectSnapshot(parts, expected);
                parts.host.remove();
            });
        }

        await it('reflects the CHARACTER count, not the UTF-16 unit count', () => {
            const parts = mount('adw-entry-row', 'adw-entry-row');
            for (const { text, length } of ENTRY_TEXT_LENGTH_VECTORS) {
                parts.row.text = text;
                expect(parts.row.getAttribute('text-length')).toBe(String(length));
            }
            parts.host.remove();
        });

        await it('truncates typed text by characters', () => {
            const parts = mount('adw-entry-row', 'adw-entry-row');
            for (const { text, maxLength, clamped } of ENTRY_MAX_LENGTH_VECTORS) {
                parts.row.maxLength = 0;
                parts.row.text = '';
                parts.row.maxLength = maxLength;
                // Type it: the `input` event path must clamp exactly like the
                // property path, which is why `input.maxLength` (UTF-16 units)
                // is deliberately left unset.
                parts.input.value = text;
                parts.input.dispatchEvent(new Event('input', { bubbles: true }));
                expect(parts.input.value).toBe(clamped);
                expect(parts.row.text).toBe(clamped);
            }
            parts.host.remove();
        });
    });

    await describe('adw-entry-row Enter dispatch (text_activated_cb)', async () => {
        for (const { name, steps, activation, rule } of ENTRY_ROW_ACTIVATION_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const parts = mount('adw-entry-row', 'adw-entry-row');
                for (const step of steps) applyStep(parts, step);
                const recorded = recordEvents(parts.row, ['apply', 'entry-activated']);
                pressEnter(parts);
                expect(recorded.names).toStrictEqual([activation.signal]);
                parts.host.remove();
            });
        }

        await it('activates the default BEFORE emitting entry-activated', () => {
            // C:253-256 — gtk_widget_activate_default is line 254, the signal is
            // line 256. Implicit form submission is the web's default activation.
            const host = document.createElement('div');
            document.body.appendChild(host);
            host.innerHTML = '<form><adw-entry-row title="T" activates-default></adw-entry-row></form>';
            const form = host.querySelector('form') as HTMLFormElement;
            const row = host.querySelector('adw-entry-row') as AdwEntryRow;
            const input = row.querySelector('.adw-entry-row-input') as HTMLInputElement;

            const order: string[] = [];
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                order.push('submit');
            });
            row.addEventListener('entry-activated', () => order.push('entry-activated'));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

            expect(order).toStrictEqual(['submit', 'entry-activated']);
            host.remove();
        });

        await it('leaves the default alone when activates-default is unset', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            host.innerHTML = '<form><adw-entry-row title="T"></adw-entry-row></form>';
            const form = host.querySelector('form') as HTMLFormElement;
            const row = host.querySelector('adw-entry-row') as AdwEntryRow;
            const input = row.querySelector('.adw-entry-row-input') as HTMLInputElement;

            const order: string[] = [];
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                order.push('submit');
            });
            row.addEventListener('entry-activated', () => order.push('entry-activated'));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

            expect(order).toStrictEqual(['entry-activated']);
            host.remove();
        });
    });

    await describe('adw-entry-row change signals', async () => {
        await it('emits both GtkEditable spellings on every buffer change', () => {
            // libadwaita implements GtkEditable through a delegate (C:87-93,
            // :821-834), so an AdwEntryRow emits `changed` AND `notify::text`.
            // The two ports had each picked one and drifted apart.
            const parts = mount('adw-entry-row', 'adw-entry-row');
            const recorded = recordEvents(parts.row, ['changed', 'notify::text', 'notify::text-length']);
            parts.row.text = 'Ada';
            expect(recorded.names).toStrictEqual(['changed', 'notify::text', 'notify::text-length']);
            parts.host.remove();
        });

        await it('says nothing when the text does not actually change', () => {
            const parts = mount('adw-entry-row', 'adw-entry-row');
            parts.row.text = 'Ada';
            const recorded = recordEvents(parts.row, ['changed', 'notify::text', 'notify::text-length']);
            parts.row.text = 'Ada';
            expect(recorded.names).toStrictEqual([]);
            parts.host.remove();
        });

        await it('emits notify::text-length only when the COUNT moves', () => {
            const parts = mount('adw-entry-row', 'adw-entry-row');
            parts.row.text = 'Ada';
            const recorded = recordEvents(parts.row, ['notify::text-length']);
            parts.row.text = 'Bob';
            expect(recorded.names).toStrictEqual([]);
            parts.row.text = 'Bobs';
            expect(recorded.names).toStrictEqual(['notify::text-length']);
            parts.host.remove();
        });

        await it('emits apply exactly once from the button', () => {
            const parts = mount('adw-entry-row', 'adw-entry-row');
            parts.row.showApplyButton = true;
            parts.input.focus();
            parts.row.text = 'A';
            const recorded = recordEvents(parts.row, ['apply', 'entry-activated']);
            parts.applyButton.click();
            expect(recorded.names).toStrictEqual(['apply']);
            expect(parts.applyButton.hidden).toBe(true);
            parts.host.remove();
        });
    });

    await describe('adw-entry-row light-DOM children (GtkBuildable)', async () => {
        await it('keeps author children instead of discarding them', () => {
            // `replaceChildren(text, edit)` used to throw every authored child
            // away silently. add_suffix (C:885-899) appends into a BOX.
            const parts = mount('adw-entry-row', 'adw-entry-row', '<button id="go">Go</button>');
            const go = parts.row.querySelector('#go') as HTMLElement;
            expect(go).not.toBe(null);
            expect(go.closest('.adw-entry-row-suffixes')).not.toBe(null);
            parts.host.remove();
        });

        await it('routes slot="prefix" children to the prefix box', () => {
            const parts = mount('adw-entry-row', 'adw-entry-row', '<span id="p" slot="prefix">P</span>');
            const p = parts.row.querySelector('#p') as HTMLElement;
            expect(p.closest('.adw-entry-row-prefixes')).not.toBe(null);
            parts.host.remove();
        });

        await it('hides an empty affordance box', () => {
            const parts = mount('adw-entry-row', 'adw-entry-row');
            expect((parts.row.querySelector('.adw-entry-row-suffixes') as HTMLElement).hidden).toBe(true);
            expect((parts.row.querySelector('.adw-entry-row-prefixes') as HTMLElement).hidden).toBe(true);
            parts.host.remove();
        });
    });

    await describe('adw-entry-row click-to-focus (pressed_cb)', async () => {
        await it('focuses the entry when the row body is clicked', () => {
            // C:201-227 — the click lands on the row, the header, the editable
            // area, the indicator or an affordance box, and grabs focus. The port
            // had this inverted: only the pencil focused, the body was inert.
            const parts = mount('adw-entry-row', 'adw-entry-row');
            parts.row.click();
            expect(document.activeElement).toBe(parts.input);
            parts.host.remove();
        });

        await it('focuses when the pencil is clicked — it is can-target=False upstream', () => {
            const parts = mount('adw-entry-row', 'adw-entry-row');
            parts.editIcon.click();
            expect(document.activeElement).toBe(parts.input);
            parts.host.remove();
        });

        await it('leaves a suffix control alone', () => {
            const parts = mount('adw-entry-row', 'adw-entry-row', '<button id="go">Go</button>');
            (parts.row.querySelector('#go') as HTMLElement).click();
            expect(document.activeElement).not.toBe(parts.input);
            parts.host.remove();
        });
    });

    await describe('adw-password-entry-row (libadwaita conformance vectors)', async () => {
        /** Replay one password vector step against the real element. */
        function applyPasswordStep(parts: RowParts, step: PasswordEntryRowStep): void {
            const row = parts.row as AdwPasswordEntryRow;
            switch (step.op) {
                case 'setRevealed':
                    row.revealed = step.value;
                    return;
                case 'togglePeek':
                    (parts.row.querySelector('.adw-password-entry-row-toggle') as HTMLButtonElement).click();
                    return;
                case 'setCapsLockOn':
                    row.setCapsLockOn(step.value);
                    return;
                case 'entry':
                    applyStep(parts, step.step);
                    return;
            }
        }

        for (const { name, steps, expected, entryIndicatorVisible, rule } of PASSWORD_ENTRY_ROW_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const parts = mount('adw-password-entry-row', 'adw-password-entry-row');
                const toggle = parts.row.querySelector('.adw-password-entry-row-toggle') as HTMLButtonElement;
                const toggleIcon = toggle.firstElementChild as HTMLElement;
                for (const step of steps) applyPasswordStep(parts, step);

                expect(parts.input.type).toBe(expected.revealed ? 'text' : 'password');
                expect(toggleIcon.dataset.iconName).toBe(expected.peekIconName);
                expect(toggle.getAttribute('aria-label')).toBe(expected.peekLabel);
                expect(toggle.getAttribute('aria-pressed')).toBe(String(expected.revealed));
                expect(parts.indicator.dataset.iconName).toBe(expected.indicatorIconName);
                expect(parts.indicator.getAttribute('aria-label')).toBe(expected.indicatorTooltip);
                expect(parts.indicator.hidden).toBe(!entryIndicatorVisible);
                parts.host.remove();
            });
        }

        for (const { name, steps, notifications, rule } of PASSWORD_REVEAL_GUARD_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                const parts = mount('adw-password-entry-row', 'adw-password-entry-row');
                const recorded = recordEvents(parts.row, ['notify::revealed']);
                for (const step of steps) applyPasswordStep(parts, step);
                expect(recorded.names).toHaveLength(notifications);
                parts.host.remove();
            });
        }

        await it('reads Caps Lock off keyboard events', () => {
            const parts = mount('adw-password-entry-row', 'adw-password-entry-row');
            parts.input.focus();
            parts.input.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'a', bubbles: true, modifierCapsLock: true } as KeyboardEventInit),
            );
            expect((parts.row as AdwPasswordEntryRow).capsLockOn).toBe(true);
            expect(parts.indicator.hidden).toBe(false);
            parts.host.remove();
        });

        await it('keeps the peek toggle when a consumer adds a suffix', () => {
            // add_suffix appends into a box (C:885-899) and the toggle is
            // installed through it (adw-password-entry-row.c:152), so both stay.
            const parts = mount('adw-password-entry-row', 'adw-password-entry-row', '<button id="go">Go</button>');
            const suffixes = parts.row.querySelector('.adw-password-entry-row-suffixes') as HTMLElement;
            expect(suffixes.querySelector('.adw-password-entry-row-toggle')).not.toBe(null);
            expect(suffixes.querySelector('#go')).not.toBe(null);
            // C:152 — the row's own toggle is the FIRST suffix.
            expect(suffixes.children[0]?.classList.contains('adw-password-entry-row-toggle')).toBe(true);
            parts.host.remove();
        });

        await it('inherits the entry row rather than copying it', () => {
            // The two element files used to be a normalized-diff-identical
            // copy-paste; the password row now IS an entry row.
            const parts = mount('adw-password-entry-row', 'adw-password-entry-row');
            parts.row.showApplyButton = true;
            parts.input.focus();
            parts.row.text = 'secret';
            expect(parts.applyButton.hidden).toBe(false);
            expect(parts.row.getAttribute('text-length')).toBe('6');
            parts.host.remove();
        });
    });
};

// DOM-level behaviour tests for <adw-drop-down>. Runs in a real browser via the
// @gjsify/adwaita-web browser test axis. Asserts option parsing, selected↔value
// sync, notify-on-change semantics, popover open/close, item selection, search
// filtering and the disabled guard.
import { describe, it, expect } from '@gjsify/unit';

import type { AdwDropDown } from './elements/adw-drop-down.js';

function makeDropDown(): AdwDropDown {
    const el = document.createElement('adw-drop-down') as AdwDropDown;
    document.body.appendChild(el);
    return el;
}

export const AdwDropDownTest = async () => {
    await describe('adw-drop-down options', async () => {
        await it('accepts a string[] (value === label)', async () => {
            const dd = makeDropDown();
            dd.options = ['One', 'Two', 'Three'];
            expect(dd.options.length).toBe(3);
            expect(dd.options[0]).toStrictEqual({ value: 'One', label: 'One' });
            expect(dd.querySelector('.adw-drop-down-label')?.textContent).toBe('One');
            dd.remove();
        });

        await it('accepts {value,label}[] and shows the selected label', async () => {
            const dd = makeDropDown();
            dd.options = [
                { value: 'a', label: 'Apple' },
                { value: 'b', label: 'Banana' },
            ];
            dd.selected = 1;
            expect(dd.querySelector('.adw-drop-down-label')?.textContent).toBe('Banana');
            expect(dd.selectedValue).toBe('b');
            dd.remove();
        });

        await it('parses options from the JSON attribute', async () => {
            const dd = document.createElement('adw-drop-down') as AdwDropDown;
            dd.setAttribute('options', '[{"value":"x","label":"Ex"},{"value":"y","label":"Why"}]');
            dd.setAttribute('selected', '1');
            document.body.appendChild(dd);
            expect(dd.options.length).toBe(2);
            expect(dd.selected).toBe(1);
            expect(dd.selectedValue).toBe('y');
            dd.remove();
        });

        await it('renders one popover item per option', async () => {
            const dd = makeDropDown();
            dd.options = ['a', 'b', 'c'];
            expect(dd.querySelectorAll('.adw-drop-down-item').length).toBe(3);
            dd.remove();
        });
    });

    await describe('adw-drop-down selected ↔ value sync', async () => {
        await it('selectedValue setter finds the index by value', async () => {
            const dd = makeDropDown();
            dd.options = [
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
            dd.options = ['a', 'b'];
            dd.selected = 1;
            expect(dd.getAttribute('selected')).toBe('1');
            const items = dd.querySelectorAll('.adw-drop-down-item');
            expect(items[1].classList.contains('selected')).toBe(true);
            expect(items[1].getAttribute('aria-selected')).toBe('true');
            dd.remove();
        });

        await it('selectedItem returns the descriptor', async () => {
            const dd = makeDropDown();
            dd.options = [{ value: 'k', label: 'Key' }];
            expect(dd.selectedItem).toStrictEqual({ value: 'k', label: 'Key' });
            dd.remove();
        });

        await it('setting options + selected before connect does not crash + applies on connect', async () => {
            // Regression: the property setters ran before connectedCallback built
            // the DOM, so _updateLabel touched an undefined label element.
            const dd = document.createElement('adw-drop-down') as AdwDropDown;
            dd.options = ['a', 'b', 'c'];
            dd.selected = 2;
            expect(dd.isConnected).toBe(false);
            document.body.appendChild(dd);
            expect(dd.selected).toBe(2);
            expect(dd.querySelector('.adw-drop-down-label')?.textContent).toBe('c');
            expect(dd.querySelectorAll('.adw-drop-down-item').length).toBe(3);
            dd.remove();
        });
    });

    await describe('adw-drop-down notify-on-change', async () => {
        await it('fires notify::selected + change on a real change only', async () => {
            const dd = makeDropDown();
            dd.options = ['a', 'b', 'c'];
            let notifyCount = 0;
            let lastChange: unknown = null;
            dd.addEventListener('notify::selected', () => notifyCount++);
            dd.addEventListener('change', (e) => {
                lastChange = (e as CustomEvent).detail;
            });
            dd.selected = 2;
            expect(notifyCount).toBe(1);
            expect(lastChange).toStrictEqual({ index: 2, value: 'c', label: 'c' });
            // Re-selecting the same index must NOT fire again.
            dd.selected = 2;
            expect(notifyCount).toBe(1);
            dd.remove();
        });

        await it('a popover item click selects, fires change + closes', async () => {
            const dd = makeDropDown();
            dd.options = ['a', 'b', 'c'];
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

    await describe('adw-drop-down popover behaviour', async () => {
        await it('opens on button click and closes on outside pointerdown', async () => {
            const dd = makeDropDown();
            dd.options = ['a', 'b'];
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
            dd.options = ['a', 'b'];
            dd.setAttribute('disabled', '');
            (dd.querySelector('.adw-drop-down-button') as HTMLButtonElement).click();
            expect(dd.active).toBe(false);
            dd.remove();
        });
    });

    await describe('adw-drop-down search', async () => {
        await it('renders a search entry and filters the list', async () => {
            const dd = makeDropDown();
            dd.options = ['Apple', 'Banana', 'Cherry'];
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

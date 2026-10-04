// DOM-level tests for <gtk-spin-button>. It is an entry with two arrows, so what matters
// here is `Gtk.SpinButton`'s own half: the child ORDER C parents them in, `real_spin`'s
// wrap branches, `update`'s two policies, `snap-to-ticks` and the arrows' sensitivity.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkSpinButton } from './elements/gtk-spin-button.js';

function mount(attrs: Record<string, string> = {}): { el: GtkSpinButton; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-spin-button') as GtkSpinButton;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

function arrows(el: GtkSpinButton): { up: HTMLButtonElement; down: HTMLButtonElement } {
    return {
        up: el.querySelector('.image-button.up') as HTMLButtonElement,
        down: el.querySelector('.image-button.down') as HTMLButtonElement,
    };
}

export const GtkSpinButtonTest = async () => {
    await describe('<gtk-spin-button> structure', async () => {
        await it('parents text, down, up horizontally — the order C builds them in', () => {
            const { el, host } = mount();
            const parts = [...el.children];
            expect(parts.map((n) => n.className.split(' ')[0])).toStrictEqual([
                'adw-spin-button-text',
                'adw-button',
                'adw-button',
            ]);
            expect((parts[2] as HTMLElement).classList.contains('up')).toBe(true);
            expect(el.getAttribute('role')).toBe('spinbutton');
            host.remove();
        });

        await it('a vertical spin button moves the up arrow to the front', () => {
            const { el, host } = mount({ orientation: 'vertical' });
            expect((el.children[0] as HTMLElement).classList.contains('up')).toBe(true);
            expect((el.children[2] as HTMLElement).classList.contains('down')).toBe(true);
            host.remove();
        });

        await it('the field shows the formatted value and one digit is the default', () => {
            const { el, host } = mount({ adjustment: '{"lower":0,"upper":10,"stepIncrement":0.5}', value: '2.5' });
            // `digits` is 0, so the field shows the value rounded to a whole number — which
            // is exactly what `gtk_spin_button_format_for_value`'s `%0.*f` does.
            expect(el.digits).toBe(0);
            expect(el.text.value).toBe('3');
            el.setAttribute('digits', '1');
            expect(el.text.value).toBe('2.5');
            host.remove();
        });
    });

    await describe('<gtk-spin-button> stepping', async () => {
        await it('an arrow press steps by the adjustment step and notifies once', () => {
            const { el, host } = mount({ adjustment: '{"lower":0,"upper":10,"stepIncrement":2}' });
            const changed = record(el, 'value-changed');
            arrows(el).up.click();
            expect(el.value).toBe(2);
            arrows(el).down.click();
            expect(el.value).toBe(0);
            expect(changed).toStrictEqual([{ value: 2 }, { value: 0 }]);
            host.remove();
        });

        await it('without wrap an arrow goes insensitive at the bound, as C computes it', () => {
            const { el, host } = mount({ adjustment: '{"lower":0,"upper":10,"stepIncrement":1}' });
            const { up, down } = arrows(el);
            // At the lower bound the DOWN arrow has nowhere to go and the UP arrow does.
            expect(down.disabled).toBe(true);
            expect(up.disabled).toBe(false);
            el.value = 10;
            expect(up.disabled).toBe(true);
            expect(down.disabled).toBe(false);
            host.remove();
        });

        await it('with wrap an arrow at the bound jumps to the other end and emits wrapped', () => {
            const { el, host } = mount({ adjustment: '{"lower":0,"upper":10,"stepIncrement":1}', wrap: '' });
            const wrapped = record(el, 'wrapped');
            const { up, down } = arrows(el);
            expect(up.disabled).toBe(false);
            expect(down.disabled).toBe(false);
            up.click();
            expect(el.value).toBe(1);
            expect(wrapped.length).toBe(0);
            el.value = 10;
            up.click();
            // `gtk_spin_button_real_spin`'s wrap branch sets the OTHER BOUND, not "one step
            // away from it": an arrow pressed at 10 in a range of 0…10 lands on 0.
            expect(el.value).toBe(0);
            down.click();
            expect(el.value).toBe(10);
            expect(wrapped.length).toBe(2);
            host.remove();
        });

        await it('an arrow key steps and Page Up pages', () => {
            const { el, host } = mount({ adjustment: '{"lower":0,"upper":100,"stepIncrement":1,"pageIncrement":10}' });
            const press = (key: string) =>
                el.text.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            press('ArrowUp');
            expect(el.value).toBe(1);
            press('PageUp');
            expect(el.value).toBe(11);
            press('ArrowDown');
            expect(el.value).toBe(10);
            host.remove();
        });
    });

    await describe('<gtk-spin-button> committing', async () => {
        await it('always clamps a typed value that is out of range', () => {
            const { el, host } = mount({ adjustment: '{"lower":0,"upper":10,"stepIncrement":1}' });
            el.text.value = '99';
            el.text.dispatchEvent(new Event('change'));
            expect(el.value).toBe(10);
            host.remove();
        });

        await it('if-valid leaves the committed value alone and re-formats the field', () => {
            const { el, host } = mount({
                adjustment: '{"lower":0,"upper":10,"stepIncrement":1,"value":5}',
                'update-policy': 'if-valid',
            });
            el.text.value = '99';
            el.text.dispatchEvent(new Event('change'));
            expect(el.value).toBe(5);
            expect(el.text.value).toBe('5');
            host.remove();
        });

        await it('snap-to-ticks lands a typed value on the step grid', () => {
            const { el, host } = mount({
                adjustment: '{"lower":0,"upper":10,"stepIncrement":4}',
                'snap-to-ticks': '',
            });
            el.text.value = '7';
            el.text.dispatchEvent(new Event('change'));
            expect(el.value).toBe(8);
            host.remove();
        });

        await it('numeric refuses letters, a second point and a trailing sign', () => {
            const { el, host } = mount({ numeric: '', digits: '2' });
            // A refused character restores the FORMATTED value, so the field reads `0.00`
            // at the two digits this story sets — not a bare `0`.
            el.text.value = '1a';
            el.text.dispatchEvent(new Event('input'));
            expect(el.text.value).toBe('0.00');
            el.text.value = '1.5';
            el.text.dispatchEvent(new Event('input'));
            expect(el.text.value).toBe('1.5');
            el.text.value = '1.5.';
            el.text.dispatchEvent(new Event('input'));
            expect(el.text.value).toBe('0.00');
            el.text.value = '-3';
            el.text.dispatchEvent(new Event('input'));
            expect(el.text.value).toBe('-3');
            host.remove();
        });

        await it('Enter activates only when the text was not edited', () => {
            const { el, host } = mount({ adjustment: '{"lower":0,"upper":10,"stepIncrement":1}' });
            const activated = record(el, 'activate');
            el.text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            expect(activated.length).toBe(1);
            el.text.value = '3';
            el.text.dispatchEvent(new Event('input'));
            el.text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            expect(el.value).toBe(3);
            expect(activated.length).toBe(1);
            host.remove();
        });
    });
};

// DOM-level tests for <adw-tab-button>: the page counter (`update_icon`,
// adw-tab-button.c:102-133) and the attention dot (`update_needs_attention`,
// adw-tab-button.c:135-161). The counter is DERIVED from a view, so every test drives the
// view and reads the button.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwTabButton } from './elements/adw-tab-button.js';
import type { AdwTabView } from './elements/adw-tab-view.js';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let serial = 0;

function mount(pages: number): { button: AdwTabButton; view: AdwTabView; host: HTMLElement } {
    const id = `tb-view-${(serial += 1)}`;
    const host = document.createElement('div');
    const rows = Array.from({ length: pages }, (_, i) => `<adw-tab-page title="Page ${i}"></adw-tab-page>`);
    host.innerHTML = `<adw-tab-view id="${id}">${rows.join('')}</adw-tab-view><adw-tab-button view="${id}"></adw-tab-button>`;
    document.body.appendChild(host);
    return {
        button: host.querySelector('adw-tab-button') as AdwTabButton,
        view: host.querySelector('adw-tab-view') as AdwTabView,
        host,
    };
}

const label = (button: AdwTabButton) => button.querySelector('.adw-tab-button-label') as HTMLElement;
const dot = (button: AdwTabButton) => button.querySelector('.adw-tab-button-indicator') as HTMLElement;

export const AdwTabButtonTest = async () => {
    await describe('<adw-tab-button> counter', async () => {
        await it('shows the page count of the view it is bound to', async () => {
            const { button, view, host } = mount(3);
            expect(button.view).toBe(view);
            expect(label(button).textContent).toBe('3');
            expect(label(button).classList.contains('small')).toBe(false);
            host.remove();
        });

        await it('follows pages added and removed', async () => {
            const { button, view, host } = mount(2);
            // A page added after the view connected goes through its API: declared
            // `<adw-tab-page>` children are adopted on connect only.
            view.appendPage({ id: 'late', title: 'Late' });
            expect(label(button).textContent).toBe('3');
            view.closePage('late');
            expect(label(button).textContent).toBe('2');
            host.remove();
        });

        await it('is `small` from ten pages and a glyph instead of a number from a hundred', async () => {
            const ten = mount(10);
            expect(label(ten.button).textContent).toBe('10');
            expect(label(ten.button).classList.contains('small')).toBe(true);
            ten.host.remove();

            const hundred = mount(100);
            expect(label(hundred.button).hidden).toBe(true);
            expect(hundred.button.querySelector('.adw-tab-button-indicatorbin')?.classList.contains('overflow')).toBe(
                true,
            );
            hundred.host.remove();
        });

        await it('without a view the plate stays, with a zero on it', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<adw-tab-button></adw-tab-button>';
            document.body.appendChild(host);
            const button = host.firstElementChild as AdwTabButton;
            expect(button.view).toBeNull();
            expect(label(button).textContent).toBe('0');
            host.remove();
        });
    });

    await describe('<adw-tab-button> needs-attention', async () => {
        await it('lights up for a page that is NOT the selected one', async () => {
            const { button, view, host } = mount(3);
            expect(dot(button).hidden).toBe(true);
            view.querySelectorAll('adw-tab-page')[2].setAttribute('needs-attention', '');
            await settle();
            expect(dot(button).hidden).toBe(false);
            host.remove();
        });

        await it('ignores the selected page, which is already in front of the user', async () => {
            const { button, view, host } = mount(3);
            view.querySelectorAll('adw-tab-page')[0].setAttribute('needs-attention', '');
            await settle();
            expect(dot(button).hidden).toBe(true);
            host.remove();
        });

        await it('is a real button the platform activates', async () => {
            const { button, host } = mount(1);
            expect(button.getAttribute('role')).toBe('button');
            expect(button.querySelector('button')).not.toBeNull();
            host.remove();
        });
    });
};

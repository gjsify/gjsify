// <adw-alert-dialog> against `Adw.AlertDialog`'s own property list.
//
// This element shipped with FOUR of its eight GIR properties reachable from markup —
// `heading`, `body`, `open` (a web convention with no GIR counterpart) and
// `prefer-wide-layout`. `close-response` and `default-response` existed as JS
// properties but no attribute fed them, and `heading-use-markup`/`body-use-markup`
// were absent entirely. The website's generated widget table read
// `observedAttributes` and truthfully reported "takes 4 attributes", which is how the
// gap became visible: the DOC was right and the ELEMENT was short.
//
// The markup pair defaults to FALSE here and in libadwaita alike — unlike
// `Adw.Banner:use-markup`, whose C default is TRUE and which `adw-banner.ts` therefore
// departs from on purpose. So these vectors pin a MATCH, not a departure, and the
// negative case is the one that matters: tags must show literally until asked for.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwAlertDialog } from './elements/adw-alert-dialog.js';

/** Mount via `setAttribute` so an attribute value's exact text survives. */
function mount(attributes: Record<string, string> = {}): { el: AdwAlertDialog; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('adw-alert-dialog') as AdwAlertDialog;
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

const headingEl = (el: AdwAlertDialog): HTMLElement => el.querySelector('.adw-alert-dialog-heading') as HTMLElement;
const bodyEl = (el: AdwAlertDialog): HTMLElement => el.querySelector('.adw-alert-dialog-body') as HTMLElement;

export const AdwAlertDialogTest = async () => {
    await describe('adw-alert-dialog observes every Adw.AlertDialog property it can render', async () => {
        // Named rather than counted: a count passes again the moment someone swaps one
        // attribute for another, which is the drift this file exists to catch.
        for (const name of [
            'heading',
            'body',
            'heading-use-markup',
            'body-use-markup',
            'close-response',
            'default-response',
            'prefer-wide-layout',
        ]) {
            await it(`observes \`${name}\``, () => {
                expect(
                    (
                        customElements.get('adw-alert-dialog') as typeof HTMLElement & {
                            observedAttributes: string[];
                        }
                    ).observedAttributes,
                ).toContain(name);
            });
        }
    });

    await describe('adw-alert-dialog markup is opt-in, matching the libadwaita default', async () => {
        await it('a heading with tags shows them literally by default', () => {
            const { el, host } = mount({ heading: '<b>Delete</b> file?' });
            expect(headingEl(el).textContent).toBe('<b>Delete</b> file?');
            expect(headingEl(el).querySelector('b')).toBe(null);
            host.remove();
        });

        await it('heading-use-markup renders it, which is the author asserting it is trusted', () => {
            const { el, host } = mount({ heading: '<b>Delete</b> file?', 'heading-use-markup': '' });
            expect(headingEl(el).querySelector('b')?.textContent).toBe('Delete');
            host.remove();
        });

        await it('a body with tags shows them literally by default', () => {
            const { el, host } = mount({ body: 'Really delete <i>notes.txt</i>?' });
            expect(bodyEl(el).textContent).toBe('Really delete <i>notes.txt</i>?');
            expect(bodyEl(el).querySelector('i')).toBe(null);
            host.remove();
        });

        await it('body-use-markup renders it', () => {
            const { el, host } = mount({ body: 'Really delete <i>notes.txt</i>?', 'body-use-markup': '' });
            expect(bodyEl(el).querySelector('i')?.textContent).toBe('notes.txt');
            host.remove();
        });

        await it('toggling the attribute off returns to text', () => {
            const { el, host } = mount({ heading: '<b>Delete</b>', 'heading-use-markup': '' });
            el.headingUseMarkup = false;
            expect(headingEl(el).textContent).toBe('<b>Delete</b>');
            expect(headingEl(el).querySelector('b')).toBe(null);
            host.remove();
        });
    });

    await describe('adw-alert-dialog response IDs are reachable from markup', async () => {
        await it('close-response defaults to `close`, as in Adw.AlertDialog', () => {
            const { el, host } = mount();
            expect(el.closeResponse).toBe('close');
            host.remove();
        });

        await it('the attribute feeds the headless model', () => {
            const { el, host } = mount({ 'close-response': 'cancel' });
            expect(el.closeResponse).toBe('cancel');
            host.remove();
        });

        await it('default-response defaults to null and the attribute sets it', () => {
            const { el, host } = mount();
            expect(el.defaultResponse).toBe(null);
            el.setAttribute('default-response', 'delete');
            expect(el.defaultResponse).toBe('delete');
            host.remove();
        });

        await it('removing default-response clears it', () => {
            const { el, host } = mount({ 'default-response': 'delete' });
            el.removeAttribute('default-response');
            expect(el.defaultResponse).toBe(null);
            host.remove();
        });

        await it('a dismissal emits the close response the attribute named', () => {
            const { el, host } = mount({ 'close-response': 'cancel', open: '' });
            let seen: string | null = null;
            el.addEventListener('response', (event) => {
                seen = (event as CustomEvent<{ response: string }>).detail.response;
            });
            el.open = false;
            expect(seen).toBe('cancel');
            host.remove();
        });
    });
};

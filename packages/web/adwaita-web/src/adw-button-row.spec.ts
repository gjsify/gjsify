// DOM-level behaviour tests for <adw-button-row>. Runs in a real browser via the
// @gjsify/adwaita-web browser test axis. The regression this guards: a
// declaratively-parsed row (attributes already present when connectedCallback
// runs) must not crash. Setting the default `activatable` attribute inside
// connectedCallback re-enters attributeChangedCallback → _render(); if that runs
// before the title/icon elements are built, it threw
// "Cannot set properties of undefined (setting 'textContent')".
import { describe, expect, it } from '@gjsify/unit';

import type { AdwButtonRow } from './elements/adw-button-row.js';

/** Parse a row from HTML so its attributes are present at connectedCallback. */
function parseRow(html: string): { row: AdwButtonRow; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = html;
    return { row: host.querySelector('adw-button-row') as AdwButtonRow, host };
}

export const AdwButtonRowTest = async () => {
    await describe('adw-button-row', async () => {
        await it('parses a declarative row with a start icon without throwing', async () => {
            const errors: string[] = [];
            const onError = (event: ErrorEvent) => errors.push(event.message);
            window.addEventListener('error', onError);

            // No `activatable` attribute → connectedCallback sets the default,
            // which used to re-enter _render() before the elements existed.
            const { row, host } = parseRow(
                '<adw-button-row title="Add account" start-icon-name="list-add" class="suggested-action"></adw-button-row>',
            );

            // Let any reported reaction error surface on the window.
            await new Promise((resolve) => setTimeout(resolve, 0));
            window.removeEventListener('error', onError);

            expect(errors.length).toBe(0);
            expect(row.textContent).toContain('Add account');
            expect(row.querySelector('.adw-icon--list-add') !== null).toBe(true);
            expect(row.classList.contains('activatable')).toBe(true);
            host.remove();
        });

        // DELETED: `honours activatable="false"`. It was green, and what it
        // pinned was an INVENTION — `Adw.ButtonRow` is always activatable
        // (`<property name="activatable">True</property>`, adw-button-row.ui;
        // "AdwButtonRow is always activatable."), and the
        // class exposes no property, no setter and no getter for it. The opt-out
        // also gave one markup two opposite meanings inside one package, because
        // <adw-action-row> reads `activatable` by PRESENCE — so
        // `activatable="false"` deactivated a button row and ACTIVATED an action
        // row. Its replacement is BUTTON_ROW_ACTIVATABLE_VECTORS, driven from
        // adw-action-rows.spec.ts, which asserts that every spelling of the
        // attribute leaves the row activatable.

        await it('emits `activated` on click', async () => {
            const { row, host } = parseRow('<adw-button-row title="Add account"></adw-button-row>');
            let activated = false;
            row.addEventListener('activated', () => {
                activated = true;
            });
            row.click();
            expect(activated).toBe(true);
            host.remove();
        });
    });
};

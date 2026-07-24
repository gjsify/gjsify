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
            // The start icon span carries the adw-icon class derived from the name.
            expect(row.querySelector('.adw-icon--list-add') !== null).toBe(true);
            // Activatable by default.
            expect(row.classList.contains('activatable')).toBe(true);
            host.remove();
        });

        await it('honours activatable="false"', async () => {
            const { row, host } = parseRow('<adw-button-row title="Locked" activatable="false"></adw-button-row>');
            expect(row.classList.contains('activatable')).toBe(false);
            host.remove();
        });

        await it('emits `activated` on click when activatable', async () => {
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

// <adw-shortcut-label> against `SHORTCUT_LABEL_VECTORS` — the same table the
// core suite drives, so a divergence between the parse and what this element
// actually renders fails a test naming the accelerator.
//
// The serialiser below walks the REAL DOM and produces the table's compact form.
// That is the whole point of the shared format: if this file built its own
// expectation strings instead, the two suites could agree with each other while
// both disagreeing with libadwaita.
import { describe, expect, it } from '@gjsify/unit';
import { SHORTCUT_LABEL_VECTORS } from '@gjsify/adwaita-core/conformance';

import '@gjsify/adwaita-web';

/** The rendered element in the table's compact form (see conformance/shortcut-label.ts). */
const serialize = (host: HTMLElement): string =>
    [...host.children]
        .map((child) => {
            if (child.classList.contains('adw-shortcut-label-disabled'))
                return `(disabled: ${child.textContent ?? ''})`;
            if (child.classList.contains('dimmed')) return child.textContent ?? '';

            return [...child.children]
                .map((cap) => {
                    const side = cap.querySelector('.adw-shortcut-label-side');
                    // The marker rides INSIDE the keycap, so its text has to come
                    // back out of the label before the two are compared.
                    const label = (cap.textContent ?? '').slice(
                        0,
                        (cap.textContent ?? '').length - (side?.textContent?.length ?? 0),
                    );
                    return `[${side ? `${label} (${side.textContent})` : label}]`;
                })
                .join('');
        })
        .join(' ')
        .trim();

export const AdwShortcutLabelTest = async () => {
    await describe('<adw-shortcut-label> (conformance vectors)', async () => {
        for (const vector of SHORTCUT_LABEL_VECTORS) {
            // The Apple glyph set is a build constant in the C and an option in
            // core; the ELEMENT reads its platform from nothing, so the two
            // Apple rows have no element to drive. They stay core-only.
            if (vector.platform === 'apple') continue;

            await it(`${vector.accelerator || '(empty)'} — ${vector.rule}`, async () => {
                const host = document.createElement('adw-shortcut-label');
                host.setAttribute('accelerator', vector.accelerator);
                if (vector.disabledText !== undefined) host.setAttribute('disabled-text', vector.disabledText);
                // RTL comes from the rendered direction, so the vector's
                // direction has to be a real attribute on a CONNECTED element.
                if (vector.direction === 'rtl') host.setAttribute('dir', 'rtl');
                document.body.appendChild(host);

                expect(serialize(host)).toBe(vector.expected);
                if (vector.accessibleLabel !== undefined) {
                    expect(host.getAttribute('aria-label')).toBe(vector.accessibleLabel);
                }

                host.remove();
            });
        }

        await it('re-renders when the accelerator changes', async () => {
            const host = document.createElement('adw-shortcut-label');
            host.setAttribute('accelerator', '<Control>C');
            document.body.appendChild(host);

            let notified = 0;
            host.addEventListener('notify::accelerator', () => notified++);
            host.setAttribute('accelerator', '<Control>V');

            expect(serialize(host)).toBe('[Ctrl][V]');
            expect(notified).toBe(1);

            host.remove();
        });

        await it('draws the keycaps of one combination left-to-right inside an RTL context', async () => {
            // `gtk_widget_set_direction (box, GTK_TEXT_DIR_LTR)` (:380): the
            // modifier order belongs to the shortcut, not to the surrounding
            // text — only the SEQUENCE arrow flips.
            const host = document.createElement('adw-shortcut-label');
            host.setAttribute('dir', 'rtl');
            host.setAttribute('accelerator', '<Control>C+<Control>X');
            document.body.appendChild(host);

            const box = host.querySelector<HTMLElement>('.adw-shortcut-label-keys');
            expect(box?.getAttribute('dir')).toBe('ltr');
            expect(getComputedStyle(box as HTMLElement).direction).toBe('ltr');
            expect(host.querySelector('.dimmed')?.textContent).toBe('←');

            host.remove();
        });

        await it('gives its keycaps the styling libadwaita gives them', async () => {
            // The rule exists, and it reaches the node the element builds — the
            // half a class-name assertion cannot see (`_shortcuts-dialog.scss:42-53`).
            const host = document.createElement('adw-shortcut-label');
            host.setAttribute('accelerator', '<Control>C');
            document.body.appendChild(host);

            const cap = host.querySelector<HTMLElement>('.keycap');
            const style = getComputedStyle(cap as HTMLElement);
            expect(style.borderTopLeftRadius).toBe('6px');
            expect(style.paddingTop).toBe('6px');
            expect(Number.parseFloat(style.minWidth)).toBe(20);

            host.remove();
        });
    });
};

// DOM-level tests for <gtk-button>'s style classes.
//
// The element and its NativeScript twin each kept their own attribute→class table,
// and the two disagreed: `circular` was here and not there. The table now lives in
// `@gjsify/adwaita-core`, and these drive its vectors through the REAL element, so a
// renderer that goes back to a private copy fails on the row that names the class.

import { describe, expect, it } from '@gjsify/unit';
import { BUTTON_STYLE_CLASS_VECTORS } from '@gjsify/adwaita-core/conformance';

/** The boolean attributes this element exposes — the short spellings. */
const WEB_ATTRIBUTES = new Set(['flat', 'suggested', 'destructive', 'circular', 'pill']);

/** Mount a button carrying the given boolean attributes; return the inner classes. */
function mountWithStyles(names: readonly string[]): string[] {
    const el = document.createElement('gtk-button');
    el.setAttribute('label', 'Click me');
    for (const name of names) el.setAttribute(name, '');
    document.body.appendChild(el);
    const btn = el.querySelector('button') as HTMLButtonElement;
    return Array.from(btn.classList).filter((cls) => cls !== 'adw-button');
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-button'))) el.remove();
}

export const GtkButtonTest = async () => {
    // Rows naming a class the LONG way (`suggested-action`) are the NativeScript
    // variant spelling — this element has no such attribute. They are partitioned
    // out here rather than skipped inside the loop, and the partition is asserted,
    // so a row cannot fall out of coverage unnoticed.
    const reachable = BUTTON_STYLE_CLASS_VECTORS.filter((v) => v.names.every((n) => WEB_ATTRIBUTES.has(n)));
    const unreachable = BUTTON_STYLE_CLASS_VECTORS.filter((v) => !v.names.every((n) => WEB_ATTRIBUTES.has(n)));

    await describe('<gtk-button> style classes', async () => {
        for (const { names, classes, rule } of reachable) {
            await it(`[${names.join(', ')}] → [${classes.join(', ')}] — ${rule}`, () => {
                expect(mountWithStyles(names)).toStrictEqual([...classes]);
                unmountAll();
            });
        }

        await it('the rows this element cannot express are exactly the long spellings', () => {
            const names = unreachable.flatMap((v) => v.names).filter((n) => !WEB_ATTRIBUTES.has(n));
            expect(names).toStrictEqual(['suggested-action', 'suggessted', 'not-a-style']);
        });

        await it('a style attribute added later is picked up', () => {
            const el = document.createElement('gtk-button');
            el.setAttribute('label', 'Send');
            document.body.appendChild(el);
            el.setAttribute('suggested', '');
            const btn = el.querySelector('button') as HTMLButtonElement;
            expect(btn.classList.contains('suggested-action')).toBe(true);
            unmountAll();
        });

        // What `buildSharedTree` writes for `Gtk.Button { icon-name: …; styles ["flat"] }`:
        // the GObject property as an attribute and the style as a host class. Read as
        // `icon` and the boolean flags only, that button rendered empty and unstyled.
        await it('a host class and icon-name, as a built .blp writes them, style the button', () => {
            const el = document.createElement('gtk-button');
            el.setAttribute('icon-name', 'go-previous-symbolic');
            el.classList.add('flat', 'suggested-action');
            document.body.appendChild(el);
            const btn = el.querySelector('button') as HTMLButtonElement;
            expect(Array.from(btn.classList).filter((cls) => cls !== 'adw-button')).toStrictEqual([
                'flat',
                'suggested-action',
                'icon-only',
            ]);
            expect(btn.querySelector('gtk-image')?.getAttribute('icon-name')).toBe('go-previous-symbolic');
            el.classList.add('pill');
            expect(btn.classList.contains('pill')).toBe(true);
            unmountAll();
        });
    });

    // libadwaita's `%pill_button` is `padding: 10px 32px` over a `min-height: 24px` content
    // box, so a GTK pill is 44px tall. This one was 6px 20px and 34px, measured against a
    // GTK render of the gallery's wrap box: every chip 10px short and 24px narrow.
    await describe('<gtk-button pill> geometry', async () => {
        await it('carries the GTK pill padding and height', () => {
            const el = document.createElement('gtk-button');
            el.setAttribute('label', 'Design');
            el.setAttribute('pill', '');
            document.body.appendChild(el);
            const btn = el.querySelector('button') as HTMLButtonElement;
            const style = getComputedStyle(btn);
            expect([style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]).toStrictEqual([
                '10px',
                '32px',
                '10px',
                '32px',
            ]);
            expect(btn.getBoundingClientRect().height).toBe(44);
            unmountAll();
        });
    });
};

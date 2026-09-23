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
    // `adw-button` is the skin and `text-button` says what fills the button, not its style.
    return Array.from(btn.classList).filter((cls) => cls !== 'adw-button' && cls !== 'text-button');
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

    // `Gtk.Button:child`. A `.blp` writes `child: Adw.ButtonContent { … }`, which the shared
    // tree carries as a child with `slot: 'child'`. The element used to wipe its children on
    // connect and read their text as the label, so the button content vanished and
    // `mountSharedTree` refused the slot as unknown.
    await describe('<gtk-button> child', async () => {
        await it('an authored child: fills the inner button in place of icon and label', () => {
            const el = document.createElement('gtk-button');
            el.classList.add('suggested-action', 'pill');
            const content = document.createElement('adw-button-content');
            content.setAttribute('slot', 'child');
            content.setAttribute('label', 'Download');
            content.setAttribute('icon-name', 'folder-download-symbolic');
            el.appendChild(content);
            document.body.appendChild(el);
            const btn = el.querySelector('button') as HTMLButtonElement;
            expect(Array.from(btn.children)).toStrictEqual([content]);
            expect(Array.from(btn.childNodes).some((node) => node.nodeType === Node.TEXT_NODE)).toBe(false);
            expect(btn.classList.contains('suggested-action') && btn.classList.contains('pill')).toBe(true);
            // A style class added later rebuilds the button and keeps the child.
            el.classList.add('flat');
            expect(content.parentElement).toBe(btn);
            unmountAll();
        });

        await it('a bare element child is the child too; inline text stays the label', async () => {
            const late = document.createElement('gtk-button');
            document.body.appendChild(late);
            const content = document.createElement('adw-button-content');
            late.appendChild(content);
            const labelled = document.createElement('gtk-button');
            labelled.textContent = 'Go';
            document.body.appendChild(labelled);
            // The late child reaches the button through the slot observer, one microtask on.
            await Promise.resolve();
            expect(content.parentElement).toBe(late.querySelector('button'));
            expect(labelled.querySelector('button')?.textContent).toBe('Go');
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

        // Measured against a GTK render of the gallery's Gtk.Button and Adw.ButtonContent
        // `.blp` files: each text button 6-7px narrower, the content pill 47px narrower
        // with its label painted in the window colour, and "Delete" filled red.
        await it('a label-only button carries the GTK text-button padding', () => {
            const el = document.createElement('gtk-button');
            el.setAttribute('label', 'Suggested');
            document.body.appendChild(el);
            const style = getComputedStyle(el.querySelector('button') as HTMLButtonElement);
            expect([style.paddingLeft, style.paddingRight]).toStrictEqual(['17px', '17px']);
            unmountAll();
        });

        await it('a pill keeps its padding around button content, which takes the button colour', () => {
            const el = document.createElement('gtk-button');
            el.classList.add('suggested-action', 'pill');
            const content = document.createElement('adw-button-content');
            content.setAttribute('label', 'Download');
            el.appendChild(content);
            document.body.appendChild(el);
            const btn = el.querySelector('button') as HTMLButtonElement;
            const style = getComputedStyle(btn);
            expect([style.paddingLeft, style.paddingRight]).toStrictEqual(['32px', '32px']);
            expect(getComputedStyle(content).color).toBe(style.color);
            unmountAll();
        });

        await it('a destructive button is red text on a tint, not a filled button', () => {
            const el = document.createElement('gtk-button');
            el.setAttribute('label', 'Delete');
            el.classList.add('destructive-action');
            document.body.appendChild(el);
            const style = getComputedStyle(el.querySelector('button') as HTMLButtonElement);
            // The tint is the text colour at 15% alpha (`color-mix` computes to `color(srgb … / 0.15)`);
            // a filled button is opaque and paints white text.
            expect(style.color === 'rgb(255, 255, 255)').toBe(false);
            expect(/[/,] 0\.15\)$/.test(style.backgroundColor)).toBe(true);
            unmountAll();
        });
    });
};

// <adw-status-page> compact — the documented smaller status page for a narrow surface.
//
// libadwaita ships ONE style class on this widget, `.compact`
// (style-classes.md "Compact Status Page"), and `_misc.scss` gives it four differences from the
// full page: margin 24px 12px not 36px 12px, icon 96px not 128px, 12px not 24px under the icon,
// `.title-2` not `.title-1`. The child keeps libadwaita's 24px spacing, of which this renderer's
// flex `gap` supplies 12 — hence `margin-top: 12px`.
//
// Each is asserted as a COMPUTED size on the node the rule selects, not as the class alone: the
// class would pass against the pre-#1826 element whenever an author wrote `class="compact"` by
// hand, so a class-only suite would have left the variant unmeasured.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwStatusPage } from './elements/adw-status-page.js';

/** Mount a status page wide enough for the full variant to differ from the compact one. */
function mount(
    attributes: Record<string, string> = {},
    width = 400,
): {
    el: AdwStatusPage;
    host: HTMLElement;
} {
    const host = document.createElement('div');
    host.style.width = `${width}px`;
    document.body.appendChild(host);
    const el = document.createElement('adw-status-page') as AdwStatusPage;
    el.setAttribute('icon', 'dialog-error-symbolic');
    el.setAttribute('title', 'Could not connect');
    el.setAttribute('description', 'Check your network connection and try again.');
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

/** Tolerance for a computed ratio: Firefox rounds a percentage-derived px size. */
const near = (actual: number, expected: number, tolerance = 0.005): boolean => Math.abs(actual - expected) <= tolerance;

const iconOf = (el: AdwStatusPage): HTMLElement => el.querySelector('.adw-status-page-icon') as HTMLElement;
const titleOf = (el: AdwStatusPage): HTMLElement => el.querySelector('.adw-status-page-title') as HTMLElement;
const childOf = (el: AdwStatusPage): HTMLElement => el.querySelector('.adw-status-page-child') as HTMLElement;

export const AdwStatusPageTest = async () => {
    await describe('adw-status-page compact (style-classes.md "Compact Status Page")', async () => {
        await it('the compact attribute puts the documented style class on the host', async () => {
            const { el, host } = mount({ compact: '' });
            // The selector is `adw-status-page.compact` — the HOST, not an inner node, which
            // is why this element writes the class itself instead of leaving it to a wrapper.
            expect(el.classList.contains('compact')).toBe(true);
            host.remove();
        });

        await it('a full status page carries no compact class and keeps the 128px icon', async () => {
            const { el, host } = mount();
            expect(el.classList.contains('compact')).toBe(false);
            expect(getComputedStyle(iconOf(el)).width).toBe('128px');
            expect(getComputedStyle(el).paddingTop).toBe('36px');
            host.remove();
        });

        await it('compact shrinks the icon to 96px and the margin to 24px (_misc.scss, statuspage.compact)', async () => {
            const { el, host } = mount({ compact: '' });
            const icon = getComputedStyle(iconOf(el));
            expect(icon.width).toBe('96px');
            expect(icon.height).toBe('96px');
            expect(icon.marginBottom).toBe('12px');
            expect(getComputedStyle(el).paddingTop).toBe('24px');
            expect(getComputedStyle(el).paddingBottom).toBe('24px');
            host.remove();
        });

        await it('compact sets .title-2 (136%), the full page .title-1 (181%) (_labels.scss)', async () => {
            const compact = mount({ compact: '' });
            const full = mount();
            try {
                // The RATIO, not a pixel size: `_misc.scss` picks between `.title-1` and
                // `.title-2`, which are 181% and 136% of the SAME inherited size — the
                // boundary reset re-roots it (`_reset.scss`, ADR 0010), and a px assertion
                // would pin this suite to one font instead of to the ratio the class encodes.
                const compactTitle = parseFloat(getComputedStyle(titleOf(compact.el)).fontSize);
                const fullTitle = parseFloat(getComputedStyle(titleOf(full.el)).fontSize);
                expect(compactTitle < fullTitle).toBe(true);
                expect(near(compactTitle / fullTitle, 136 / 181)).toBe(true);
                // …and the weights both `.title-1`/`.title-2` carry, so this is the
                // heading scale rather than a body label that happens to be smaller.
                expect(getComputedStyle(titleOf(compact.el)).fontWeight).toBe('800');
            } finally {
                compact.host.remove();
                full.host.remove();
            }
        });

        await it('compact leaves 12px to the child beyond the 12px flex gap (_misc.scss, 24px spacing)', async () => {
            const { el, host } = mount({ compact: '' });
            const button = document.createElement('button');
            button.className = 'adw-button suggested-action';
            button.textContent = 'Try Again';
            el.appendChild(button);

            expect(getComputedStyle(childOf(el)).marginTop).toBe('12px');
            // The full page's own 24px, so the pair cannot both be the compact rule.
            const full = mount();
            try {
                expect(getComputedStyle(childOf(full.el)).marginTop).toBe('24px');
            } finally {
                host.remove();
                full.host.remove();
            }
        });

        await it('a .blp\'s styles ["compact"] survives a later attribute change', async () => {
            const { el, host } = mount({ compact: '' });
            el.classList.add('compact');
            el.removeAttribute('compact');
            // `title` is the attribute every real page sets, and setting it re-renders. A
            // `toggle` here would strip the class the shared-tree builder had put there —
            // `shared-tree-builder.ts:296` writes a `.blp`'s style classes onto this host.
            el.setAttribute('title', 'Still compact');
            expect(el.classList.contains('compact')).toBe(true);
            expect(getComputedStyle(iconOf(el)).width).toBe('96px');
            host.remove();
        });
    });
};

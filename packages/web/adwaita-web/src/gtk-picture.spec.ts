// DOM-level tests for <gtk-picture>. The four scalar properties all have a GIR default
// that is TRUE, so most of what matters here is the ABSENCE cases: an attribute that is not
// written has to read back as the C's default, not as `false`. The other half is
// `keep-aspect-ratio`, which is a deprecated MAPPING rather than a stored boolean, and whose
// getter is the inverse test over `content-fit` — so `cover` and `scale-down` both read it
// back `true` and only `fill` reads `false`.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkPicture } from './elements/gtk-picture.js';

function mount(attrs: Record<string, string> = {}): { el: GtkPicture; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-picture') as GtkPicture;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

export const GtkPictureTest = async () => {
    await describe('<gtk-picture> content-fit', async () => {
        await it('defaults to CONTAIN, which is what the C installs in init', () => {
            // gtkpicture.c:555 — `self->content_fit = GTK_CONTENT_FIT_CONTAIN`.
            const { el, host } = mount();
            expect(el.contentFit).toBe('contain');
            host.remove();
        });

        await it('an unrecognised nick stays CONTAIN rather than becoming FILL', () => {
            // FILL is the one value that would silently distort every picture a page writes,
            // so the default is the safe arm — not a coercion to the first enum member.
            const { el, host } = mount({ 'content-fit': 'squeeze' });
            expect(el.contentFit).toBe('contain');
            host.remove();
        });

        await it('holds all four GtkContentFit members, scale-down included', () => {
            // gtkpicture.c:162-167 — SCALE_DOWN is the member `GtkContentFit` added and CSS
            // already had, so this mapping is exact rather than approximate.
            for (const mode of ['fill', 'contain', 'cover', 'scale-down'] as const) {
                const { el, host } = mount({ 'content-fit': mode });
                expect(el.contentFit).toBe(mode);
                host.remove();
            }
        });

        await it('reaches the replaced child as object-fit, which is not inherited', () => {
            const { el, host } = mount({ 'content-fit': 'cover' });
            expect(el.style.getPropertyValue('--gtk-picture-content-fit')).toBe('cover');
            host.remove();
        });
    });

    await describe('<gtk-picture> keep-aspect-ratio', async () => {
        await it('the setter MAPS onto content-fit rather than storing a boolean', async () => {
            // gtkpicture.c:1017-1021 — TRUE sets CONTAIN, FALSE sets FILL.
            const { el, host } = mount();
            el.keepAspectRatio = true;
            expect(el.contentFit).toBe('contain');
            el.keepAspectRatio = false;
            expect(el.contentFit).toBe('fill');
            host.remove();
        });

        await it('the getter is the INVERSE test, so cover and scale-down read TRUE', () => {
            // gtkpicture.c:1040 — `return self->content_fit != GTK_CONTENT_FIT_FILL`. Both
            // preserve the ratio, so answering FALSE for either would be a lie.
            for (const mode of ['contain', 'cover', 'scale-down'] as const) {
                const { el, host } = mount({ 'content-fit': mode });
                expect(el.keepAspectRatio).toBe(true);
                host.remove();
            }
            const fill = mount({ 'content-fit': 'fill' });
            expect(fill.el.keepAspectRatio).toBe(false);
            fill.host.remove();
        });

        await it('notifies the deprecated property only when a FILL arm is involved', () => {
            // gtkpicture.c:1114-1115 — `notify_keep_aspect_ratio` is computed as "the new
            // mode or the old one is FILL", so a write between two non-FILL modes leaves the
            // deprecated property's VALUE unchanged and must stay silent.
            const { el, host } = mount({ 'content-fit': 'contain' });
            const events: unknown[] = [];
            el.addEventListener('notify::keep-aspect-ratio', (e) => events.push((e as CustomEvent).detail));
            el.contentFit = 'cover';
            expect(events.length).toBe(0);
            el.contentFit = 'fill';
            expect(events).toStrictEqual([{ 'keep-aspect-ratio': false }]);
            el.contentFit = 'contain';
            expect(events).toStrictEqual([{ 'keep-aspect-ratio': false }, { 'keep-aspect-ratio': true }]);
            host.remove();
        });
    });

    await describe('<gtk-picture> the two TRUE-defaulted booleans', async () => {
        await it('can-shrink and isolate-contents read TRUE when the attribute is ABSENT', () => {
            // gtkpicture.c:554-555 — both are installed TRUE in `init`, before any attribute
            // is read. An absent attribute therefore has to mean TRUE, or every picture on a
            // declarative page would be un-shrinkable and non-isolated.
            const { el, host } = mount();
            expect(el.canShrink).toBe(true);
            expect(el.isolateContents).toBe(true);
            host.remove();
        });

        await it('presence alone means TRUE; only the string "false" is FALSE', () => {
            const { el, host } = mount({ 'can-shrink': '', 'isolate-contents': '' });
            expect(el.canShrink).toBe(true);
            expect(el.isolateContents).toBe(true);
            host.remove();
        });

        await it('setting FALSE writes the attribute and TRUE REMOVES it', () => {
            // The property's own boolean needs three states, not two: absent is TRUE.
            const { el, host } = mount();
            el.canShrink = false;
            expect(el.getAttribute('can-shrink')).toBe('false');
            el.canShrink = true;
            expect(el.hasAttribute('can-shrink')).toBe(false);
            host.remove();
        });

        await it('a programmatic set notifies once per real change', () => {
            const { el, host } = mount();
            const events: unknown[] = [];
            el.addEventListener('notify::can-shrink', (e) => events.push((e as CustomEvent).detail));
            el.canShrink = false;
            el.canShrink = false;
            el.canShrink = true;
            expect(events).toStrictEqual([{ 'can-shrink': false }, { 'can-shrink': true }]);
            host.remove();
        });
    });

    await describe('<gtk-picture> accessibility and isolation', async () => {
        await it('carries the IMG role and the alternative text as its accessible name', () => {
            // gtkpicture.c:553 — `GTK_ACCESSIBLE_ROLE_IMG`, set for every picture whether or
            // not it has a name; :474-483 — `alternative-text` is that name.
            const { el, host } = mount({ 'alternative-text': 'A tangerine' });
            expect(el.getAttribute('role')).toBe('img');
            expect(el.getAttribute('aria-label')).toBe('A tangerine');
            host.remove();
        });

        await it('an empty alternative text REMOVES the name rather than emptying it', () => {
            const { el, host } = mount({ 'alternative-text': 'A tangerine' });
            el.alternativeText = '';
            expect(el.hasAttribute('aria-label')).toBe(false);
            host.remove();
        });

        await it('establishes a stacking context without becoming a containing block', () => {
            // `gtk_snapshot_push_isolation` (gtkpicture.c:148-149) stops the paintable's alpha
            // compositing against what is behind it. `contain: paint` would also isolate and
            // would ADDITIONALLY make the element a containing block for fixed and absolutely
            // positioned descendants, which the C's isolation does not do.
            const { el, host } = mount();
            const style = getComputedStyle(el);
            expect(style.isolation).toBe('isolate');
            expect(style.contain).not.toContain('paint');
            host.remove();
        });

        await it('clips its overflow, which is what makes cover clip rather than spill', () => {
            // gtkpicture.c:557 — `gtk_widget_set_overflow (widget, GTK_OVERFLOW_HIDDEN)` in
            // `init`, not a style class an application opts into.
            const { el, host } = mount();
            expect(getComputedStyle(el).overflow).toBe('hidden');
            host.remove();
        });
    });
};

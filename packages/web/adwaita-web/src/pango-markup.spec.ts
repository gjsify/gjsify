// `renderPangoMarkup` — markup becomes NODES, and a string the browser never parses.
//
// The rows that matter here are the ones that used to be `innerHTML`: a `<b>` has to come
// out as an ELEMENT (that is the whole feature — the reviewer who flagged the innerHTML
// was right about the sink and wrong that the only alternative is plain text), and an
// `<img src=x onerror=…>` or a `<script>` has to come out as NOTHING an element could
// carry. Both run through the real elements where they can, because a helper tested alone
// only proves the helper.

import { describe, expect, it } from '@gjsify/unit';

import { renderPangoMarkup } from './pango-markup.js';
import type { AdwAlertDialog } from './elements/adw-alert-dialog.js';
import type { AdwBanner } from './elements/adw-banner.js';

/** Render markup into a detached target and hand both back. */
function render(markup: string): { target: HTMLElement; text: string } {
    const target = document.createElement('span');
    document.body.appendChild(target);
    renderPangoMarkup(target, markup);
    return { target, text: target.textContent ?? '' };
}

/** Computed `font-weight`, which is `bold` or `700` depending on the engine. */
function isBold(el: Element): boolean {
    const weight = getComputedStyle(el).fontWeight;
    return weight === 'bold' || Number.parseInt(weight, 10) >= 600;
}

function mount<T extends HTMLElement>(tag: string, attributes: Record<string, string>): { el: T; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement(tag) as T;
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

const bannerTitle = (el: AdwBanner): HTMLElement => el.querySelector('.adw-banner-title') as HTMLElement;
const alertHeading = (el: AdwAlertDialog): HTMLElement => el.querySelector('.adw-alert-dialog-heading') as HTMLElement;
const alertBody = (el: AdwAlertDialog): HTMLElement => el.querySelector('.adw-alert-dialog-body') as HTMLElement;

export const PangoMarkupTest = async () => {
    await describe('renderPangoMarkup — <b> is drawn bold, because the tree says so', async () => {
        await it('<b>x</b> becomes a <b> ELEMENT, and it computes bold', () => {
            const { target } = render('<b>x</b>');
            const bold = target.querySelector('b');
            expect(bold).not.toBe(null);
            expect(bold?.textContent).toBe('x');
            expect(isBold(bold!)).toBe(true);
            target.remove();
        });

        // The four tags with no presentational UA rule, each spelled out as a style — the
        // rows a "map the tag name to the same HTML element" port silently gets wrong,
        // because <tt>, <big> and <small> exist in the HTML namespace and mean nothing.
        await it('tt, big and small draw through styles, not through obsolete elements', () => {
            const { target } = render('<tt>code</tt><big>big</big><small>small</small>');
            const tt = target.querySelector('span')!;
            expect(getComputedStyle(tt).fontFamily.toLowerCase()).toContain('monospace');
            const big = target.children[1] as HTMLElement;
            const small = target.children[2] as HTMLElement;
            expect(Number.parseFloat(getComputedStyle(big).fontSize)).toBeGreaterThan(
                Number.parseFloat(getComputedStyle(small).fontSize),
            );
            expect(big.tagName).toBe('SPAN');
            expect(small.tagName).toBe('SPAN');
        });

        await it('the remaining tags become their own elements, nested as written', () => {
            const { target } = render('<i>a<u>b</u></i><s>c</s><sub>d</sub><sup>e</sup>');
            expect([...target.children].map((el) => el.tagName)).toStrictEqual(['I', 'S', 'SUB', 'SUP']);
            expect(target.querySelector('i > u')?.textContent).toBe('b');
        });

        await it("<markup> draws its children — it is pango's implicit root, not a box", async () => {
            const { target } = render('<markup><b>x</b></markup>');
            expect(target.querySelector('b')?.textContent).toBe('x');
        });
    });

    await describe('renderPangoMarkup — the rows that were the injection sink', async () => {
        // Each of these was reachable as `banner.innerHTML = title` / `heading.innerHTML
        // = heading`. There is no branch in the renderer that creates an element for a
        // tag pango does not know, and no branch that sets an HTML attribute from a
        // `<span>` attribute — so none of them can produce an element at all.
        for (const markup of [
            '<img src=x onerror="alert(1)">',
            '<script>alert(1)</script>',
            '<div onclick="alert(1)">x</div>',
            '<iframe src="javascript:alert(1)"></iframe>',
            '<a href="javascript:alert(1)">x</a>',
            '<b onclick="alert(1)">x</b>',
        ]) {
            await it(`${JSON.stringify(markup)} → no element, the raw string as text`, () => {
                const { target, text } = render(markup);
                expect(text).toBe(markup);
                expect(target.children.length).toBe(0);
                expect(target.querySelector('img, script, div, iframe, a, b, span')).toBe(null);
                expect(target.getAttribute('onerror')).toBe(null);
                expect(target.getAttribute('onclick')).toBe(null);
            });
        }

        // The one shape that DOES parse and could still carry an `on*`: `<span>` takes
        // attributes, so an unknown one reaches the tree. It is dropped there and here —
        // the run renders as plain text with no attribute on it, which is what makes the
        // whitelist load-bearing rather than decoration.
        await it('an unknown <span> attribute is dropped, never set on the element', () => {
            const { target } = render('<span onmouseover="alert(1)">x</span>');
            const span = target.querySelector('span')!;
            expect(span.textContent).toBe('x');
            expect(span.attributes.length).toBe(0);
            expect((span as HTMLElement).style.cssText).toBe('');
        });

        await it('unparseable markup keeps the raw string, which is the C fallback', () => {
            for (const markup of ['a < b', 'Tom & Jerry', '<b>unclosed', '<b>wrong</i>']) {
                const { target, text } = render(markup);
                expect(text).toBe(markup);
                expect(target.children.length).toBe(0);
            }
        });

        await it('no element carries an attribute derived from a <span> attribute', () => {
            const { target } = render('<span weight="bold" font_family="Serif">x</span>');
            const span = target.querySelector('span')!;
            // `style` and nothing else: CSSOM reflects the declarations it holds, but a
            // MARKUP attribute must never reach the DOM as one.
            expect([...span.attributes].map((attribute) => attribute.name)).toStrictEqual(['style']);
            expect(span.style.fontWeight).toBe('bold');
        });
    });

    await describe('renderPangoMarkup — a <span> attribute reaches CSS, or nothing', async () => {
        await it("weight and style take pango's NAMED values", () => {
            const { target } = render('<span weight="bold" style="italic">x</span>');
            const span = target.querySelector('span')!;
            expect(span.style.fontWeight).toBe('bold');
            expect(span.style.fontStyle).toBe('italic');
        });

        await it('an unmapped weight is DROPPED, never passed through to CSS', () => {
            const { target } = render('<span weight="expression(alert(1))">x</span>');
            expect(target.querySelector('span')!.style.fontWeight).toBe('');
        });

        await it('underline and strikethrough ADD, so a span carrying both keeps both', () => {
            const { target } = render('<span underline="single" strikethrough="true">x</span>');
            const decoration = target.querySelector('span')!.style.textDecorationLine;
            expect(decoration).toContain('underline');
            expect(decoration).toContain('line-through');
        });

        await it('underline="none" and strikethrough="false" draw neither', () => {
            const { target } = render('<span underline="none" strikethrough="false">x</span>');
            expect(target.querySelector('span')!.style.textDecorationLine).toBe('');
        });

        await it('a font family list keeps its order; an unparseable one is refused whole', () => {
            const ok = render('<span font_family="Cantarell, sans-serif">x</span>');
            expect(ok.target.querySelector('span')!.style.fontFamily).toContain('Cantarell');
            const refused = render('<span font_family="a&quot;; color: red">x</span>');
            expect(refused.target.querySelector('span')!.style.fontFamily).toBe('');
            expect(refused.target.querySelector('span')!.style.color).toBe('');
        });

        await it('a size travels with its unit — a bare number is a CSS FONT-SIZE FACTOR', () => {
            const points = render('<span size="12">x</span>');
            expect(points.target.querySelector('span')!.style.fontSize).toBe('12pt');
            const percent = render('<span size="150%">x</span>');
            expect(percent.target.querySelector('span')!.style.fontSize).toBe('150%');
            const named = render('<span size="x-small">x</span>');
            expect(named.target.querySelector('span')!.style.fontSize).toBe('x-small');
        });

        await it('an attribute pango accepts but CSS cannot express is dropped', () => {
            // `rise` and `letter_spacing` are pango attributes with no equivalent here.
            const { target } = render('<span rise="4" letter_spacing="2">x</span>');
            expect(target.querySelector('span')!.getAttribute('style')).toBe(null);
        });
    });

    await describe('the elements render the same way', async () => {
        await it('<adw-banner> draws its <b> bold when use-markup is set', () => {
            const { el, host } = mount<AdwBanner>('adw-banner', {
                title: '<b>Metered</b> connection',
                revealed: '',
                'use-markup': '',
            });
            const bold = bannerTitle(el).querySelector('b');
            expect(bold?.textContent).toBe('Metered');
            expect(isBold(bold!)).toBe(true);
            host.remove();
        });

        await it('<adw-banner> shows an unknown tag as text, never as an element', () => {
            const { el, host } = mount<AdwBanner>('adw-banner', {
                title: '<img src=x onerror="alert(1)">',
                revealed: '',
                'use-markup': '',
            });
            expect(bannerTitle(el).querySelector('img')).toBe(null);
            expect(bannerTitle(el).textContent).toBe('<img src=x onerror="alert(1)">');
            host.remove();
        });

        await it('<adw-alert-dialog> draws heading AND body markup bold/italic', () => {
            const { el, host } = mount<AdwAlertDialog>('adw-alert-dialog', {
                heading: '<b>Delete</b> file?',
                'heading-use-markup': '',
                body: 'Really delete <i>notes.txt</i>?',
                'body-use-markup': '',
            });
            expect(isBold(alertHeading(el).querySelector('b')!)).toBe(true);
            expect(getComputedStyle(alertBody(el).querySelector('i')!).fontStyle).toBe('italic');
            host.remove();
        });

        await it('<adw-alert-dialog> shows an unknown tag in either slot as text', () => {
            const { el, host } = mount<AdwAlertDialog>('adw-alert-dialog', {
                heading: '<script>alert(1)</script>',
                'heading-use-markup': '',
                body: '<img src=x onerror="alert(1)">',
                'body-use-markup': '',
            });
            expect(alertHeading(el).querySelector('script')).toBe(null);
            expect(alertHeading(el).textContent).toBe('<script>alert(1)</script>');
            expect(alertBody(el).querySelector('img')).toBe(null);
            expect(alertBody(el).textContent).toBe('<img src=x onerror="alert(1)">');
            host.remove();
        });

        await it('without use-markup both slots stay literal text', () => {
            const { el, host } = mount<AdwAlertDialog>('adw-alert-dialog', {
                heading: '<b>Delete</b> file?',
                body: '<i>notes.txt</i>',
            });
            expect(alertHeading(el).textContent).toBe('<b>Delete</b> file?');
            expect(alertHeading(el).querySelector('b')).toBe(null);
            expect(alertBody(el).querySelector('i')).toBe(null);
            host.remove();
        });
    });
};

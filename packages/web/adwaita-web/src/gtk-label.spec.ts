// DOM-level tests for <gtk-label>.
//
// Four things matter more than the attribute round-trips. A label WITHOUT `use-markup`
// reaches the DOM as one text node, and one WITH it is drawn as the styled runs core
// derived — built node by node, so no string the label carries is ever parsed as markup
// (the `<img>` row: markup pango rejects stays text, it does not become an element).
// `<a href>` is a real anchor whose click is cancelled in favour of `activate-link`.
// `xalign` is read off where the text actually SITS in the label's box, not off a style the
// element wrote. And the typography classes from `_labels.scss` apply to the element,
// including inside another widget whose isolation floor would otherwise repaint it
// (`_reset.scss`).

import { describe, expect, it } from '@gjsify/unit';

import {
    LABEL_CHAR_COUNT_VECTORS,
    LABEL_DISPLAY_TEXT_VECTORS,
    LABEL_EFFECTIVE_LINES_VECTORS,
    LABEL_ELLIPSIZE_OVERFLOW_VECTORS,
    LABEL_ELLIPSIZE_VECTORS,
    LABEL_JUSTIFY_VECTORS,
    LABEL_MARKUP_LINK_VECTORS,
    LABEL_MARKUP_RUN_VECTORS,
    LABEL_WIDTH_CHARS_EXTENT_VECTORS,
    LABEL_WRAP_MODE_VECTORS,
    LABEL_XALIGN_VECTORS,
    LABEL_YALIGN_ALIGN_ITEMS_VECTORS,
    LABEL_YALIGN_VECTORS,
    type LabelMarkupLinkExpectation,
    type LabelMarkupRunExpectation,
} from '@gjsify/adwaita-core/conformance';

import type { GtkLabel } from './elements/gtk-label.js';
import { labelMarkupAnchorIndex, labelMarkupAnchors } from './label-markup.js';

function mount(label: string, parent?: HTMLElement): { el: GtkLabel; host: HTMLElement; opened: string[] } {
    const host = document.createElement('div');
    host.style.width = '400px';
    document.body.appendChild(host);
    const el = document.createElement('gtk-label') as GtkLabel;
    el.label = label;
    (parent ?? host).appendChild(el);
    if (parent) host.appendChild(parent);
    // `window.open` is the launcher call; a spec must not open a tab to prove a click.
    const opened: string[] = [];
    (el as unknown as { launch: (uri: string) => void }).launch = (uri: string) => opened.push(uri);
    return { el, host, opened };
}

/** One click a user could make, cancelable so the spec can read back whether it was. */
function click(target: Element): MouseEvent {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}

/** Collect the `detail` of every `event` dispatched on (or bubbling to) `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

/**
 * Every text node under `root`, in reading order — ONE PER DRAWN RUN, because a run is
 * built as a chain of elements around a single text node (`label-markup.ts`, `buildRun`).
 * So this list and the vector's `runs` line up position for position, and a renderer that
 * failed to merge two adjacent equal-styled runs produces one node too many.
 */
function textNodes(root: Node): Text[] {
    const found: Text[] = [];
    for (const child of root.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) found.push(child as Text);
        else found.push(...textNodes(child));
    }
    return found;
}

/** A run as the DOM holds it, in the shape {@link LabelMarkupRunExpectation} states it. */
interface DrawnRun {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikethrough: boolean;
    monospace: boolean;
    sizeSteps: number;
    script: 'sub' | 'sup' | null;
    link: number | null;
    /** How many `<span>` attribute sets the run sits in — the COUNT, see below. */
    spans: number;
}

/**
 * `node`'s run, read back off its ancestors up to `root`.
 *
 * THE `<span>`S ARE COUNTED, NOT COMPARED. `tt`, `big` and `small` are each drawn as a
 * `<span>` carrying the one CSS property `TAG_STYLES` gives them, so those three are
 * recognised by that property and everything else that is a `<span>` came from a pango
 * `<span>` element. Its ATTRIBUTES are not asserted here: `applySpanAttributes` drops
 * every attribute outside its whitelist (`foreground` among them), so the mapping is
 * `pango-markup.spec.ts`'s subject and what matters at this level is that each `<span>` in
 * the run's stack became one element in the chain, in order.
 */
function drawnRun(node: Text, root: Element): DrawnRun {
    const run: DrawnRun = {
        text: node.data,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        monospace: false,
        sizeSteps: 0,
        script: null,
        link: null,
        spans: 0,
    };
    for (let el = node.parentElement; el !== null && el !== root; el = el.parentElement) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'b') run.bold = true;
        else if (tag === 'i') run.italic = true;
        else if (tag === 'u') run.underline = true;
        else if (tag === 's') run.strikethrough = true;
        else if (tag === 'sub' || tag === 'sup') run.script = tag;
        else if (tag === 'a') run.link = labelMarkupAnchorIndex(el);
        // THE TWO BOXES ARE THE ELEMENT'S OWN, not a run's: `.adw-label-text` is the
        // wrap/ellipsize box (`_renderSpan`), `.adw-label-runs` the single-line one the
        // runs need because the label is a flex container (`_runSpan`). Neither carries
        // style a run asked for, so neither counts as a `<span>` from the markup.
        else if (el.classList.contains('adw-label-text') || el.classList.contains('adw-label-runs')) continue;
        else if (el.style.fontFamily === 'monospace') run.monospace = true;
        else if (el.style.fontSize === 'larger') run.sizeSteps += 1;
        else if (el.style.fontSize === 'smaller') run.sizeSteps -= 1;
        else run.spans += 1;
    }
    return run;
}

/** The same shape from the vector, where every omitted field means "not set". */
function expectedRun(run: LabelMarkupRunExpectation): DrawnRun {
    return {
        text: run.text,
        bold: run.bold ?? false,
        italic: run.italic ?? false,
        underline: run.underline ?? false,
        strikethrough: run.strikethrough ?? false,
        monospace: run.monospace ?? false,
        sizeSteps: run.sizeSteps ?? 0,
        script: run.script ?? null,
        link: run.link ?? null,
        spans: run.spans?.length ?? 0,
    };
}

/**
 * The text the DOM can give the anchor for `links[index]`: the link's range, minus the
 * range of any link nested INSIDE it.
 *
 * THE ONE PLACE THE ANCHORS ARE NOT THE RANGES. GTK's ranges may overlap —
 * `<a href="outer">out <a href="inner">in</a></a>` is two links and the outer's range
 * covers the inner's text — and one DOM element cannot hold text another also holds. The
 * inner anchor owns that text, as the inner link owns it in GTK too (`finish_text`
 * attributes to the open element), and the outer's node keeps the rest of its range.
 */
function anchorText(text: string, links: ReadonlyArray<LabelMarkupLinkExpectation>, index: number): string {
    const link = links[index]!;
    const inner = links.filter(
        (other, at) => at !== index && other.end > other.start && other.start >= link.start && other.end <= link.end,
    );
    let kept = '';
    for (let at = link.start; at < link.end; at += 1)
        if (!inner.some((nested) => nested.start <= at && at < nested.end)) kept += text[at];
    return kept;
}

/** Where the rendered TEXT sits, measured on the text node rather than the element. */
function textRect(el: HTMLElement): DOMRect {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
}

/** Where one drawn run's GLYPHS sit — the text node's own box, not its element's. */
function runRect(node: Text): DOMRect {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect();
}

export const GtkLabelTest = async () => {
    await describe('<gtk-label> against LABEL_DISPLAY_TEXT_VECTORS', async () => {
        for (const vector of LABEL_DISPLAY_TEXT_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount(vector.label);
                el.useMarkup = vector.useMarkup;
                el.useUnderline = vector.useUnderline;
                // What reached the SCREEN. `textContent` is the display text whichever
                // path drew it — a plain text node, or the run elements concatenated —
                // so this is the assertion that says the two agree.
                expect(el.textContent).toBe(vector.text);
                expect(el.getText()).toBe(vector.text);
                // NO ELEMENT WAS PARSED FROM THE STRING, which is the XSS answer and a
                // different claim from "no elements at all": a row whose markup PARSES is
                // now drawn as runs (`<b>` is a `<b>`), so the check is that nothing the
                // markup named as a foreign tag became a node. The `<img>` row is the one
                // that matters — it does not parse, so it stays text.
                expect(el.querySelectorAll('img, script, iframe').length).toBe(0);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_MARKUP_RUN_VECTORS — the runs as DRAWN nodes', async () => {
        for (const vector of LABEL_MARKUP_RUN_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount(vector.markup);
                el.useMarkup = true;

                // The row with NO runs is markup pango rejects, and GTK then shows the
                // raw string: one text node, the markup included, no element built.
                if (vector.runs.length === 0) {
                    expect(el.textContent).toBe(vector.text);
                    expect(el.childElementCount).toBe(0);
                    host.remove();
                    return;
                }

                const drawn = textNodes(el).map((node) => drawnRun(node, el));
                expect(drawn).toStrictEqual(vector.runs.map(expectedRun));
                // The runs' text concatenated IS the display text — `gtk_label_get_text`
                // and what the user sees cannot be two different strings.
                expect(el.textContent).toBe(vector.text);
                expect(el.getText()).toBe(vector.text);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> draws its runs as TEXT, not as flex items', async () => {
        await it('puts the runs in one box of their own, and takes it away again', () => {
            const { el, host } = mount('<b>Bold</b> and <i>italic</i>');
            el.useMarkup = true;
            // ONE element child, holding every run. The label itself is a flex container
            // (the `xalign` spacers, `_labels.scss`), so a run list directly under it is
            // one FLEX ITEM PER RUN — three boxes shrinking independently, not a line of
            // text. The box is the item; the runs inside it are inline.
            expect(el.childElementCount).toBe(1);
            expect(el.firstElementChild?.classList.contains('adw-label-runs')).toBe(true);
            expect(textNodes(el).length).toBe(3);

            // And it is GONE when there is no markup to draw: a plain label is back to the
            // single text node the XSS note pins, no leftover box.
            el.useMarkup = false;
            expect(el.childElementCount).toBe(0);
            expect(el.textContent).toBe('<b>Bold</b> and <i>italic</i>');
            host.remove();
        });

        await it('hands the box over to the wrap box, never nests the two', () => {
            const { el, host } = mount('<b>Bold</b> and <i>italic</i>');
            el.useMarkup = true;
            el.wrap = true;
            // `.adw-label-text` is `display: block`, so the runs in it are already inline
            // boxes — a second box inside it would be one box too many, and `_remeasure`
            // would then be pinning the wrong element's width.
            expect(el.childElementCount).toBe(1);
            expect(el.firstElementChild?.classList.contains('adw-label-text')).toBe(true);
            expect(el.querySelectorAll('.adw-label-runs').length).toBe(0);
            expect(el.textContent).toBe('Bold and italic');

            el.wrap = false;
            expect(el.childElementCount).toBe(1);
            expect(el.firstElementChild?.classList.contains('adw-label-runs')).toBe(true);
            expect(el.querySelectorAll('.adw-label-text').length).toBe(0);
            host.remove();
        });

        await it('raises sup above sub — the proof the runs are text and not items', () => {
            const { el, host } = mount('x<sub>2</sub> and y<sup>3</sup>');
            el.useMarkup = true;
            const [, sub, , sup] = textNodes(el);
            // THE ASSERTION THAT CATCHES THE FLEX ITEM. `vertical-align` does not apply to
            // a flex item: as items these two would each be laid out by the container's
            // `align-items: center`, landing at the SAME height, and a formula would read
            // `x2 and y3` flat. As inline text `<sup>` is raised and `<sub>` lowered, so
            // the one sits strictly above the other.
            expect(runRect(sup!).top).toBeLessThan(runRect(sub!).top);
            // Both still on the label's own one line: neither escaped the line box.
            const whole = textRect(el);
            expect(runRect(sub!).bottom).toBeLessThanOrEqual(Math.ceil(whole.bottom));
            expect(runRect(sup!).top).toBeGreaterThanOrEqual(Math.floor(whole.top));
            host.remove();
        });

        await it('still offsets the whole line by xalign', () => {
            const { el, host } = mount('<b>Hi</b> there');
            el.useMarkup = true;
            host.style.width = '400px';
            // The box sizes to its text (`flex-basis: auto` over `display: block`), which
            // is what leaves the two spacer pseudo-elements free space to split — the
            // whole of `xalign`. A box stretched to the container would have none, and the
            // text would sit at the left whatever `xalign` said.
            el.xalign = 0;
            const left = textRect(el);
            el.xalign = 1;
            const right = textRect(el);
            expect(Math.round(left.left)).toBeLessThan(Math.round(right.left));
            expect(Math.round(right.width)).toBe(Math.round(left.width));
            host.remove();
        });
    });

    await describe('<gtk-label> against LABEL_MARKUP_LINK_VECTORS — the anchors', async () => {
        for (const vector of LABEL_MARKUP_LINK_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount(vector.markup);
                el.useMarkup = true;

                // `null` is markup that does not parse: no links, and so neither of the
                // two things `gtk_label_set_markup` puts on the widget for having them.
                const links = vector.links ?? [];
                const anchors = labelMarkupAnchors(el);
                expect(anchors.length).toBe(links.length);
                expect(el.classList.contains('link')).toBe(vector.cssClass);
                expect(el.hasAttribute('has-tooltip')).toBe(vector.hasTooltip);

                for (const [index, link] of links.entries()) {
                    const anchor = anchors[index]!;
                    // The anchor is a REAL link: `href` is set, which is what makes it one
                    // to the keyboard, to the accessibility tree and to "copy link
                    // address". `getAttribute`, not `.href`, because the property
                    // resolves a relative URI against the document.
                    expect(anchor.getAttribute('href')).toBe(link.href);
                    expect(labelMarkupAnchorIndex(anchor)).toBe(index);
                    expect(anchor.classList.contains('link')).toBe(true);
                    // GTK's `link` class and `<a class>`'s value sit on the same node.
                    if (link.cssClass !== null) expect(anchor.classList.contains(link.cssClass)).toBe(true);
                    // An EMPTY `title` attribute is a tooltip in some browsers, so a link
                    // without one must not carry the attribute at all.
                    expect(anchor.hasAttribute('title')).toBe(link.title !== null);
                    if (link.title !== null) expect(anchor.title).toBe(link.title);
                    // THE OFFSETS REACHED THE DOM: the characters the row's range cuts out
                    // of the display text are the characters under this anchor.
                    expect(anchor.textContent).toBe(anchorText(el.textContent ?? '', links, index));
                }
                host.remove();
            });
        }
    });

    await describe('<gtk-label> activate-link', async () => {
        const markup = 'Read the <a href="https://gtk.org">docs</a> first';

        await it('cancels the browser navigation and launches the uri instead', () => {
            const { el, host, opened } = mount(markup);
            el.useMarkup = true;
            const details = record(el, 'activate-link');
            const anchor = labelMarkupAnchors(el)[0]!;

            // `preventDefault`ed EVERY time: the anchor has a real `href`, so a browser
            // would navigate this window, and GTK never does — `gtk_label_activate_link`
            // hands the URI to the desktop and leaves the window standing.
            expect(click(anchor).defaultPrevented).toBe(true);
            expect(opened).toStrictEqual(['https://gtk.org']);
            expect(details).toStrictEqual([{ uri: 'https://gtk.org' }]);
            expect(anchor.classList.contains('visited')).toBe(true);
            host.remove();
        });

        await it('a handler that handles it stops the launch — and still visits the link', () => {
            const { el, host, opened } = mount(markup);
            el.useMarkup = true;
            // `preventDefault` is a handler returning TRUE under the boolean accumulator,
            // so the class handler never runs and nothing is launched.
            el.addEventListener('activate-link', (event) => event.preventDefault());
            const anchor = labelMarkupAnchors(el)[0]!;
            click(anchor);
            expect(opened).toStrictEqual([]);
            // VISITED ALL THE SAME, and this is where the label and `<gtk-link-button>`
            // part ways. `emit_activate_link` (gtklabel.c:2053) reads the ACCUMULATED
            // result — `if (handled && !link->visited)` — so a handler that followed the
            // link its own way has followed it. `GtkLinkButton` instead sets `visited`
            // inside its own default handler (gtklinkbutton.c:521), which a cancelling
            // handler skips. Two widgets, two places, and only the C says which is which.
            expect(anchor.classList.contains('visited')).toBe(true);
            host.remove();
        });

        await it('visits every link to the same uri, and leaves the others alone', () => {
            const { el, host, opened } = mount('<a href="a">one</a> <a href="b">two</a> <a href="a">three</a>');
            el.useMarkup = true;
            const anchors = labelMarkupAnchors(el);
            click(anchors[0]!);
            // BY URI, not by index (gtklabel.c:3635-3647): two links to the same place are
            // one visited state, so following either marks both.
            expect(anchors[0]!.classList.contains('visited')).toBe(true);
            expect(anchors[2]!.classList.contains('visited')).toBe(true);
            expect(anchors[1]!.classList.contains('visited')).toBe(false);
            expect(opened).toStrictEqual(['a']);
            host.remove();
        });

        await it('carries visited across a re-render, by uri', () => {
            const { el, host } = mount(markup);
            el.useMarkup = true;
            click(labelMarkupAnchors(el)[0]!);
            // Rewriting the text AROUND a link has not un-followed it.
            el.label = 'Now read the <a href="https://gtk.org">manual</a>';
            expect(labelMarkupAnchors(el)[0]!.classList.contains('visited')).toBe(true);
            host.remove();
        });

        await it('ignores a click that is not on a link', () => {
            const { el, host, opened } = mount(markup);
            el.useMarkup = true;
            const details = record(el, 'activate-link');
            expect(click(el).defaultPrevented).toBe(false);
            expect(opened).toStrictEqual([]);
            expect(details).toStrictEqual([]);
            host.remove();
        });

        await it('keeps the run elements across a render that did not touch the text', () => {
            const { el, host } = mount(markup);
            el.useMarkup = true;
            const anchor = labelMarkupAnchors(el)[0]!;
            // `_render` runs on EVERY observed attribute, and rebuilding the runs for one
            // that never touched the text would drop a selection and the focus inside a
            // link — so the nodes have to be the SAME nodes.
            el.xalign = 1;
            expect(labelMarkupAnchors(el)[0]).toBe(anchor);
            host.remove();
        });

        await it('declares activate-link, so connect() takes it', () => {
            const { el, host } = mount(markup);
            el.useMarkup = true;
            const connectable = el as unknown as { connect(signal: string, handler: () => void): number };
            expect(() => connectable.connect('activate-link', () => {})).not.toThrow();
            host.remove();
        });
    });

    await describe('<gtk-label> gives its anchors the link treatment', async () => {
        const markup = 'Read the <a href="https://gtk.org">docs</a> first';

        await it('underlines the anchor and recolours it, where the text around it is plain', () => {
            const { el, host } = mount(markup);
            el.useMarkup = true;
            const anchor = labelMarkupAnchors(el)[0]!;
            // `_link.scss`'s `link`-node rule, upstream's `_links.scss:1-5`. The label is
            // NOT a link even though it carries the `.link` style class (gtklabel.c:3896),
            // so the treatment has to stop at the anchor.
            expect(getComputedStyle(anchor).textDecorationLine).toBe('underline');
            expect(getComputedStyle(el).textDecorationLine).toBe('none');
            expect(getComputedStyle(anchor).color === getComputedStyle(el).color).toBe(false);
            host.remove();
        });

        await it('keeps the label text weight inside the link', () => {
            const { el, host } = mount('<b>bold <a href="https://gtk.org">link</a></b>');
            el.useMarkup = true;
            const anchor = labelMarkupAnchors(el)[0]!;
            // `font-weight: inherit` (`_links.scss:4`): a link inside bold markup stays
            // bold, where a UA's own `<a>` styling would not care.
            expect(getComputedStyle(anchor).fontWeight).toBe(getComputedStyle(anchor.parentElement!).fontWeight);
            host.remove();
        });

        await it('draws a followed link in a different colour', () => {
            const { el, host } = mount(markup);
            el.useMarkup = true;
            const fresh = getComputedStyle(labelMarkupAnchors(el)[0]!).color;
            click(labelMarkupAnchors(el)[0]!);
            // `.visited`, the class `_paintVisited` writes — NOT the `:visited`
            // pseudo-class, which is the user's browsing history and would colour a link
            // in a label that was never clicked.
            expect(getComputedStyle(labelMarkupAnchors(el)[0]!).color === fresh).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-label> against LABEL_XALIGN_VECTORS and LABEL_JUSTIFY_VECTORS', async () => {
        for (const vector of LABEL_XALIGN_VECTORS) {
            await it(`xalign: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('xalign');
                else el.setAttribute('xalign', String(vector.value));
                expect(el.xalign).toBe(vector.xalign);
                host.remove();
            });
        }
        for (const vector of LABEL_JUSTIFY_VECTORS) {
            await it(`justify: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('justify');
                else el.setAttribute('justify', vector.value);
                expect(el.justify).toBe(vector.justify);
                host.remove();
            });
        }
        for (const vector of LABEL_YALIGN_VECTORS) {
            await it(`yalign: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('yalign');
                else el.setAttribute('yalign', String(vector.value));
                expect(el.yalign).toBe(vector.yalign);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_ELLIPSIZE_VECTORS and LABEL_WRAP_MODE_VECTORS', async () => {
        for (const vector of LABEL_ELLIPSIZE_VECTORS) {
            await it(`ellipsize: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('ellipsize');
                else el.setAttribute('ellipsize', vector.value);
                expect(el.ellipsize).toBe(vector.ellipsize);
                host.remove();
            });
        }
        for (const vector of LABEL_WRAP_MODE_VECTORS) {
            await it(`wrap-mode: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('wrap-mode');
                else el.setAttribute('wrap-mode', vector.value);
                expect(el.wrapMode).toBe(vector.wrapMode);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_CHAR_COUNT_VECTORS — lines / width-chars / max-width-chars', async () => {
        for (const vector of LABEL_CHAR_COUNT_VECTORS) {
            await it(`lines: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('lines');
                else el.setAttribute('lines', String(vector.value));
                expect(el.lines).toBe(vector.count);
                host.remove();
            });
            await it(`width-chars: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('width-chars');
                else el.setAttribute('width-chars', String(vector.value));
                expect(el.widthChars).toBe(vector.count);
                host.remove();
            });
            await it(`max-width-chars: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                if (vector.value === null) el.removeAttribute('max-width-chars');
                else el.setAttribute('max-width-chars', String(vector.value));
                expect(el.maxWidthChars).toBe(vector.count);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_ELLIPSIZE_OVERFLOW_VECTORS', async () => {
        for (const vector of LABEL_ELLIPSIZE_OVERFLOW_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount('word '.repeat(60).trim());
                el.style.width = '200px';
                el.ellipsize = vector.ellipsize;
                const cs = getComputedStyle(el.querySelector('.adw-label-text') ?? el);
                expect(cs.textOverflow).toBe(vector.overflow);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> against LABEL_EFFECTIVE_LINES_VECTORS', async () => {
        for (const vector of LABEL_EFFECTIVE_LINES_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount('word '.repeat(60).trim());
                el.ellipsize = vector.ellipsize;
                el.lines = vector.lines;
                const held = el.style.getPropertyValue('--gtk-label-lines');
                expect(held).toBe(vector.effective === null ? '' : String(vector.effective));
                host.remove();
            });
        }

        // The regression this table exists to pin: `wrap` must not change the answer,
        // in EITHER direction — measured against a real Gtk.Label, `label.ts`'s header.
        await it('wrap changes nothing while ellipsize is active', () => {
            const { el, host } = mount('word '.repeat(60).trim());
            el.ellipsize = 'end';
            el.lines = 2;
            const withoutWrap = el.style.getPropertyValue('--gtk-label-lines');
            el.wrap = true;
            expect(el.style.getPropertyValue('--gtk-label-lines')).toBe(withoutWrap);
            host.remove();
        });

        await it('wrap changes nothing while ellipsize is none — lines never applies', () => {
            const { el, host } = mount('word '.repeat(60).trim());
            el.lines = 2;
            const withoutWrap = el.style.getPropertyValue('--gtk-label-lines');
            el.wrap = true;
            expect(el.style.getPropertyValue('--gtk-label-lines')).toBe(withoutWrap);
            expect(withoutWrap).toBe('');
            host.remove();
        });
    });

    await describe('<gtk-label> against LABEL_WIDTH_CHARS_EXTENT_VECTORS', async () => {
        for (const vector of LABEL_WIDTH_CHARS_EXTENT_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount('Hi');
                el.widthChars = vector.widthChars;
                el.maxWidthChars = vector.maxWidthChars;
                expect(el.style.minWidth).toBe(vector.minCh === null ? '' : `${vector.minCh}ch`);
                expect(el.style.maxWidth).toBe(vector.maxCh === null ? '' : `${vector.maxCh}ch`);
                host.remove();
            });
        }
    });

    await describe('<gtk-label> text', async () => {
        await it('shows the label as text', () => {
            const { el, host } = mount('Hello');
            expect(el.textContent).toBe('Hello');
            expect(textRect(el).width).toBeGreaterThan(0);
            host.remove();
        });
    });

    await describe('<gtk-label> get_label / set_label', async () => {
        await it('are the GTK spelling of the `label` property', () => {
            const { el, host } = mount('Hello');
            const gtk = el as unknown as { get_label(): string; set_label(str: string): void };
            expect(gtk.get_label()).toBe('Hello');
            gtk.set_label('World');
            expect(el.label).toBe('World');
            expect(el.textContent).toBe('World');
            host.remove();
        });
    });

    await describe('<gtk-label> xalign and justify', async () => {
        await it('centres the text in its box by default (xalign 0.5)', () => {
            const { el, host } = mount('Hi');
            el.style.width = '400px';
            const box = el.getBoundingClientRect();
            const text = textRect(el);
            expect(Math.abs(text.left - box.left - (box.right - text.right)) <= 1).toBe(true);
            host.remove();
        });

        await it('puts the text at the start for 0 and the end for 1', () => {
            const { el, host } = mount('Hi');
            el.style.width = '400px';
            el.xalign = 0;
            expect(Math.round(textRect(el).left)).toBe(Math.round(el.getBoundingClientRect().left));
            el.xalign = 1;
            expect(Math.round(textRect(el).right)).toBe(Math.round(el.getBoundingClientRect().right));
            host.remove();
        });

        await it('splits the free space in the xalign ratio, as the C does', () => {
            const { el, host } = mount('Hi');
            el.style.width = '400px';
            el.xalign = 0.25;
            const box = el.getBoundingClientRect();
            const text = textRect(el);
            const free = box.width - text.width;
            expect(Math.abs(text.left - box.left - free * 0.25) <= 1).toBe(true);
            host.remove();
        });

        await it("aligns the lines through Pango's switch: left/right are start/end, fill justifies", () => {
            const { el, host } = mount('Hi');
            expect(el.justify).toBe('left');
            expect(getComputedStyle(el).textAlign).toBe('start');
            el.justify = 'center';
            expect(getComputedStyle(el).textAlign).toBe('center');
            el.justify = 'right';
            expect(getComputedStyle(el).textAlign).toBe('end');
            el.justify = 'fill';
            expect(getComputedStyle(el).textAlign).toBe('justify');
            host.remove();
        });
    });

    await describe('<gtk-label> wrap and selectable', async () => {
        await it('stays on one line unless wrap is set', () => {
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            const oneLine = textRect(el).height;
            el.wrap = true;
            expect(textRect(el).height).toBeGreaterThan(oneLine * 2);
            expect(el.getBoundingClientRect().width <= 400).toBe(true);
            host.remove();
        });

        await it('centres a WRAPPED label by xalign too, not just a one-line one', () => {
            // GTK centres the wrapped BLOCK (gtk_label_get_layout_location), not each line
            // independently — the defect this vector was written for: the block used to
            // fill the full width with no inset at all once it needed more than one line.
            //
            // Measured on the wrap SPAN's own box, not `textRect()`'s `Range` (every other
            // vector in this file uses it): `white-space: pre-wrap` lets a wrapped line's
            // trailing separator space HANG past its line box (CSS Text 3 § white-space-
            // phase-2, a real browser behaviour and not a bug here), which widens a
            // `Range`'s bounding rect on the side a line wrapped without moving anything a
            // viewer can see — the span's own layout box is what is actually centred.
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            el.wrap = true;
            const box = el.getBoundingClientRect();
            const span = el.querySelector('.adw-label-text')!.getBoundingClientRect();
            expect(span.width < box.width).toBe(true);
            expect(Math.abs(span.left - box.left - (box.right - span.right)) <= 1).toBe(true);
            host.remove();
        });

        await it('keeps a wrapped block flush with the edge at xalign 0, no inset', () => {
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            el.wrap = true;
            el.xalign = 0;
            const span = el.querySelector('.adw-label-text')!.getBoundingClientRect();
            expect(Math.round(span.left)).toBe(Math.round(el.getBoundingClientRect().left));
            host.remove();
        });

        // The block's width is measured, so it has to be measured again when the space
        // changes. Widening is the direction that proves it: narrowing is also caught by
        // the span's `max-width: 100%`, but a block pinned at 200px stays 200px wide in a
        // 400px container until something measures it again.
        await it('re-measures a wrapped block when its container widens', async () => {
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            host.style.width = '200px';
            el.wrap = true;
            // Settle the one-off font re-measure first, or it would widen the block on its own.
            await document.fonts.ready;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            host.style.width = '400px';
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const span = el.querySelector('.adw-label-text')!.getBoundingClientRect();
            expect(span.width > 300).toBe(true);
            host.remove();
        });

        // GtkLabel's wrapping MINIMUM is its longest word, not the width it first wrapped
        // at. A pinned `width` made the measured block the label's min-content, so a card
        // around it in a narrower pane (Learn6502's preferences: 343px) grew past the pane.
        await it('lets a wrapped label shrink below the width it first wrapped at', () => {
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            host.style.display = 'flex';
            const card = document.createElement('div');
            host.appendChild(card);
            card.appendChild(el);
            el.wrap = true;
            const first = el.querySelector('.adw-label-text')!.getBoundingClientRect().width;
            expect(first > 300).toBe(true);
            host.style.width = '200px';
            expect(card.getBoundingClientRect().width <= 200).toBe(true);
            expect(el.getBoundingClientRect().width <= 200).toBe(true);
            host.remove();
        });

        // gtk_label_measure: a wrapping label's minimum is its widest word, its natural
        // width the text on one line (capped only by `max-width-chars`).
        await it('gives a wrapped label its widest word as minimum, one line as natural', () => {
            const long = 'word '.repeat(60).trim();
            const { el, host } = mount(long);
            el.wrap = true;
            const word = mount('word');
            const wordWidth = textRect(word.el).width;
            word.host.remove();
            const line = mount(long);
            line.host.style.width = 'max-content';
            const lineWidth = textRect(line.el).width;
            line.host.remove();
            host.style.width = 'min-content';
            expect(el.getBoundingClientRect().width <= Math.ceil(wordWidth) + 1).toBe(true);
            host.style.width = 'max-content';
            expect(Math.abs(el.getBoundingClientRect().width - lineWidth) <= 1).toBe(true);
            host.remove();
        });

        await it('is not selectable unless asked, as GtkLabel', () => {
            const { el, host } = mount('Hi');
            expect(getComputedStyle(el).userSelect).toBe('none');
            el.selectable = true;
            expect(getComputedStyle(el).userSelect).toBe('text');
            host.remove();
        });
    });

    await describe('<gtk-label> ellipsize', async () => {
        const long = 'word '.repeat(60).trim();

        await it('stays as wide as its text when ellipsize is none, the default', () => {
            // `host`, not `el`, is constrained: `gtk-label` is a BLOCK-level flex
            // container and fills its own containing block by default (same as a plain
            // `<div>`), so pinning `el.style.width` would force the box regardless of
            // ellipsize — the text overflowing that box, measured on the text itself, is
            // what "not ellipsized" actually means.
            const { el, host } = mount(long);
            host.style.width = '200px';
            expect(textRect(el).width).toBeGreaterThan(200);
            expect(el.childElementCount).toBe(0);
            host.remove();
        });

        await it('trims to the box and keeps the full text in the property, for end', () => {
            const { el, host } = mount(long);
            el.style.width = '200px';
            el.ellipsize = 'end';
            const box = el.getBoundingClientRect();
            expect(box.width).toBeLessThanOrEqual(201);
            // Held faithfully: the PROPERTY still carries the whole string, as GTK's
            // `label` does — only what the box can show is trimmed.
            expect(el.label).toBe(long);
            expect(el.getText()).toBe(long);
            host.remove();
        });

        await it('draws the SAME end-ellipsis for start and middle — the declared divergence', () => {
            const endEl = mount(long);
            endEl.el.style.width = '200px';
            endEl.el.ellipsize = 'end';
            const startEl = mount(long);
            startEl.el.style.width = '200px';
            startEl.el.ellipsize = 'start';
            const middleEl = mount(long);
            middleEl.el.style.width = '200px';
            middleEl.el.ellipsize = 'middle';
            // `ellipsize` is held exactly as authored…
            expect(startEl.el.ellipsize).toBe('start');
            expect(middleEl.el.ellipsize).toBe('middle');
            // …while every non-`none` mode renders identically to `end`, the one
            // truncating value CSS actually has (`labelEllipsizeOverflowValue`).
            expect(Math.round(startEl.el.getBoundingClientRect().width)).toBe(
                Math.round(endEl.el.getBoundingClientRect().width),
            );
            expect(Math.round(middleEl.el.getBoundingClientRect().width)).toBe(
                Math.round(endEl.el.getBoundingClientRect().width),
            );
            endEl.host.remove();
            startEl.host.remove();
            middleEl.host.remove();
        });

        await it('centres a SHORT ellipsized label by xalign, exactly as the plain text node does', () => {
            // A label that FITS has free space regardless of `ellipsize` — the box only
            // shrinks to the container once the text no longer fits one line.
            const { el, host } = mount('Hi');
            el.style.width = '400px';
            el.ellipsize = 'end';
            const box = el.getBoundingClientRect();
            const span = el.querySelector('.adw-label-text')!.getBoundingClientRect();
            expect(Math.abs(span.left - box.left - (box.right - span.right)) <= 1).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-label> wrap-mode', async () => {
        // ONE unbreakable "word", no space for the default WORD mode to break at.
        const unbreakable = 'x'.repeat(80);

        await it('overflows its container under the default, word, with nothing to break at', () => {
            // `.adw-label-text { max-width: 100% }` caps the SPAN's own BOX at the
            // container, wrap-mode or not — the difference is whether the TEXT inside it
            // overflows that box, which is what `textRect` (on the span, not the host)
            // measures.
            const { el, host } = mount(unbreakable);
            host.style.width = '100px';
            el.wrap = true;
            const span = el.querySelector('.adw-label-text') as HTMLElement;
            expect(textRect(span).width).toBeGreaterThan(100);
            host.remove();
        });

        await it('breaks mid-word and fits its container under char', () => {
            const { el, host } = mount(unbreakable);
            host.style.width = '100px';
            el.wrap = true;
            el.wrapMode = 'char';
            const span = el.querySelector('.adw-label-text') as HTMLElement;
            expect(textRect(span).width).toBeLessThanOrEqual(100);
            host.remove();
        });

        await it("has no effect while wrap is off, as the pspec says ('only … if line wrapping is on')", () => {
            const { el, host } = mount(unbreakable);
            const withoutMode = textRect(el).width;
            el.wrapMode = 'char';
            expect(textRect(el).width).toBe(withoutMode);
            host.remove();
        });
    });

    await describe('<gtk-label> lines — gated by ellipsize alone, wrap plays no part', async () => {
        const paragraph = 'word '.repeat(60).trim();

        // THE FINDING THIS BLOCK EXISTS TO PIN: `wrap=false` does NOT keep an ellipsized,
        // `lines`-capped label to one line — a real `Gtk.Label` allocated with
        // `wrap=FALSE, ellipsize=END, lines=2` lays out exactly two lines, ellipsized
        // (`label.ts`'s header, `@gjsify/adwaita-core`). No `wrap` is set anywhere below.
        await it('wraps onto multiple lines from ellipsize + lines ALONE, wrap never set', () => {
            const { el, host } = mount(paragraph);
            host.style.width = '150px';
            el.ellipsize = 'end';
            el.lines = 2;
            const span = el.querySelector('.adw-label-text')!;
            // Two lines of wrapped text, not one: the span's rendered text spans more than
            // a single line's height.
            const oneLine = mount('word').el;
            oneLine.ellipsize = 'end';
            const oneLineHeight = oneLine.querySelector('.adw-label-text')!.getBoundingClientRect().height;
            expect(span.getBoundingClientRect().height).toBeGreaterThan(oneLineHeight * 1.5);
            oneLine.parentElement?.remove();
            host.remove();
        });

        await it('caps at 2 lines rather than the 1-line default a real allocation gives', () => {
            const { el: capped, host: cappedHost } = mount(paragraph);
            cappedHost.style.width = '150px';
            capped.ellipsize = 'end';
            capped.lines = 2;

            const { el: oneLine, host: oneLineHost } = mount(paragraph);
            oneLineHost.style.width = '150px';
            oneLine.ellipsize = 'end';
            // `lines` left unset: Pango's own default is ONE line, not unlimited.

            const cappedHeight = capped.querySelector('.adw-label-text')!.getBoundingClientRect().height;
            const oneLineHeight = oneLine.querySelector('.adw-label-text')!.getBoundingClientRect().height;
            expect(cappedHeight).toBeGreaterThan(oneLineHeight * 1.5);
            expect(cappedHeight).toBeLessThan(oneLineHeight * 2.5);
            cappedHost.remove();
            oneLineHost.remove();
        });

        await it('still caps below the TRUE unclamped height once ellipsize is none', () => {
            const { el: capped, host: cappedHost } = mount(paragraph);
            cappedHost.style.width = '150px';
            capped.ellipsize = 'end';
            capped.lines = 2;

            const { el: unclamped, host: unclampedHost } = mount(paragraph);
            unclampedHost.style.width = '150px';
            unclamped.wrap = true;
            // `ellipsize` stays `none`: wraps freely onto however many lines the text needs.

            const cappedHeight = capped.querySelector('.adw-label-text')!.getBoundingClientRect().height;
            const unclampedHeight = unclamped.querySelector('.adw-label-text')!.getBoundingClientRect().height;
            expect(cappedHeight).toBeLessThan(unclampedHeight);
            cappedHost.remove();
            unclampedHost.remove();
        });

        await it('has no effect at all while ellipsize is none, however lines is set', () => {
            const { el: capped, host: cappedHost } = mount(paragraph);
            capped.lines = 1;
            const { el: free, host: freeHost } = mount(paragraph);
            expect(Math.round(capped.getBoundingClientRect().width)).toBe(
                Math.round(free.getBoundingClientRect().width),
            );
            cappedHost.remove();
            freeHost.remove();
        });
    });

    await describe('<gtk-label> yalign', async () => {
        await it('sits the text at the top for 0 and the bottom for 1, in a taller box', () => {
            const { el, host } = mount('Hi');
            el.style.height = '100px';
            el.yalign = 0;
            const top = textRect(el);
            const box = el.getBoundingClientRect();
            expect(Math.round(top.top)).toBe(Math.round(box.top));
            el.yalign = 1;
            const bottom = textRect(el);
            expect(Math.round(bottom.bottom)).toBe(Math.round(box.bottom));
            host.remove();
        });

        await it('centres by default, 0.5, the same box the two edges measured against', () => {
            const { el, host } = mount('Hi');
            el.style.height = '100px';
            const box = el.getBoundingClientRect();
            const text = textRect(el);
            const topGap = text.top - box.top;
            const bottomGap = box.bottom - text.bottom;
            expect(Math.abs(topGap - bottomGap) <= 1).toBe(true);
            host.remove();
        });

        for (const vector of LABEL_YALIGN_ALIGN_ITEMS_VECTORS) {
            await it(`align-items: ${vector.rule}`, () => {
                const { el, host } = mount('Hi');
                el.yalign = vector.yalign;
                expect(getComputedStyle(el).alignItems).toBe(vector.alignItems);
                host.remove();
            });
        }

        await it('sits an intermediate yalign (0.3) at the SAME top gap as 0.5 — true nearest, not a half-split', () => {
            // The exact regression a strict `< 0.5`/`> 0.5` split gets wrong: 0.3 is
            // NEARER 0.5 than 0, so it must render identically to 0.5, not to 0.
            const { el, host } = mount('Hi');
            el.style.height = '100px';
            el.yalign = 0.5;
            const centredTop = textRect(el).top;
            el.yalign = 0.3;
            expect(Math.round(textRect(el).top)).toBe(Math.round(centredTop));
            host.remove();
        });
    });

    await describe('<gtk-label> width-chars and max-width-chars', async () => {
        await it('widens a short label to at least width-chars characters', () => {
            // `gtk-label` is a BLOCK-level flex container and fills the 400px `host` by
            // default (same as a plain `<div>` would) — `min-width` has nothing to widen
            // against there, so both sides shrink-to-fit with `display: inline-flex`
            // first, a test-only override that does not touch the component's own CSS.
            const { el: plain, host: plainHost } = mount('Hi');
            plain.style.display = 'inline-flex';
            const { el: widened, host: widenedHost } = mount('Hi');
            widened.style.display = 'inline-flex';
            widened.widthChars = 20;
            expect(widened.getBoundingClientRect().width).toBeGreaterThan(plain.getBoundingClientRect().width);
            plainHost.remove();
            widenedHost.remove();
        });
    });

    await describe('<gtk-label> and the typography classes', async () => {
        await it('takes .title-1 and .heading from _labels.scss', () => {
            const { el, host } = mount('Title');
            el.classList.add('title-1');
            expect(getComputedStyle(el).fontWeight).toBe('800');
            el.classList.replace('title-1', 'heading');
            expect(getComputedStyle(el).fontWeight).toBe('700');
            host.remove();
        });

        await it('dims under .dimmed', () => {
            // `.dim-label` is deliberately NOT here: `style-classes.spec.ts` ledgers it as
            // deprecated in favour of this one.
            const { el, host } = mount('Quiet');
            expect(getComputedStyle(el).opacity).toBe('1');
            el.classList.add('dimmed');
            expect(getComputedStyle(el).opacity === '1').toBe(false);
            host.remove();
        });

        await it('inherits colour and size inside another widget instead of the isolation floor', () => {
            const clamp = document.createElement('adw-clamp');
            clamp.style.color = 'rgb(255, 0, 0)';
            clamp.style.fontSize = '30px';
            const { el, host } = mount('Inside', clamp);
            expect(getComputedStyle(el).color).toBe('rgb(255, 0, 0)');
            expect(getComputedStyle(el).fontSize).toBe('30px');
            host.remove();
        });
    });
};

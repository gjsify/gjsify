// `Gtk.Label`'s markup DRAWN on the REAL NativeScript label — the conformance runs as
// `FormattedString` spans, the `<a href>` links as tappable spans, and `activate-link`'s
// default rule.
//
// DRIVEN FROM THE SAME TWO TABLES AS THE WEB HALF (`LABEL_MARKUP_RUN_VECTORS`,
// `LABEL_MARKUP_LINK_VECTORS`), because the question "which characters are bold" has one
// answer and two renderers; a table per port is how the two drift. What is asserted here is
// the PLATFORM mapping — `fontWeight`, `fontStyle`, `fontFamily`, `textDecoration`,
// `style.verticalAlignment` and `tappable` — and the expectations are derived from each
// row's own columns rather than from `widgets/label-markup.ts`, so the mapping and its test
// do not share a source.
//
// THE WRITE ORDER IS A TEST OF ITS OWN, and the reason is in `_render`: the device wipes
// `text` whenever `formattedText` changes (`[formattedTextProperty.setNative]` →
// `textProperty.nativeValueChange`), so a label going BACK to plain text must clear the
// spans first. The double models exactly that, which is why "plain after markup" is not a
// tautology here.
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget
// classes, which evaluate `@nativescript/core` at module scope.

import { describe, expect, it } from '@gjsify/unit';
import { FormattedString, Span } from '@nativescript/core';
import {
    LABEL_MARKUP_LINK_VECTORS,
    LABEL_MARKUP_RUN_VECTORS,
    type LabelMarkupLinkExpectation,
    type LabelMarkupRunExpectation,
    type LabelMarkupRunVector,
} from '@gjsify/adwaita-core/conformance';

import * as Gtk from './namespace/gtk.js';

/** The label's private link list — what `has-tooltip` and `visited` would be read off. */
interface LabelLinks {
    _links: ReadonlyArray<{
        href: string;
        title: string | null;
        cssClass: string | null;
        start: number;
        end: number;
        visited: boolean;
    }>;
}

const linksOf = (label: Gtk.Label) => (label as unknown as LabelLinks)._links;

/** Stands in for the platform attaching the view: `activate-link` launches nothing unrooted. */
function mount<T extends Gtk.Label>(label: T): T {
    (label as unknown as { callLoaded(): void }).callLoaded();
    return label;
}

/**
 * A label whose default launch is observable.
 *
 * Off a device `openPlatformUri` THROWS (`platform-source.ts`: there is no way to open a URI
 * on this host), so the launch the widget would reach is unobservable from outside —
 * `protected launch` exists for exactly this seam.
 */
class RecordingLabel extends Gtk.Label {
    readonly launched: string[] = [];

    protected override launch(uri: string): void {
        this.launched.push(uri);
    }
}

const markupLabel = (markup: string): Gtk.Label => {
    const label = new Gtk.Label();
    label.set_markup(markup);
    return label;
};

/**
 * The label's spans, READ THE WAY A DEVICE READS THEM.
 *
 * `FormattedString.spans` is an `ObservableArray<Span>` and not an array: `getItem(pos)` is
 * its read door and `spans[0]` is `undefined` on a device. So this walks `getItem` and the
 * rest of the file works on the snapshot — which keeps the assertions readable without any
 * of them resting on index access the platform does not have.
 */
const spansOf = (label: Gtk.Label): Span[] => {
    const formatted = label.formattedText;
    expect(formatted instanceof FormattedString).toBe(true);
    const spans = (formatted as FormattedString).spans;
    const list: Span[] = [];
    for (let index = 0; index < spans.length; index += 1) list.push(spans.getItem(index));
    return list;
};

/** Every tappable span, in reading order — the spans Android would give a `ClickableSpan`. */
const tappableSpans = (label: Gtk.Label): Span[] => spansOf(label).filter((span) => span.tappable);

const tap = (span: Span): void => span.notify({ eventName: Span.linkTapEvent, object: span });

/**
 * Whether a row's expectation needs the `FormattedString` path, read off the row's OWN
 * columns: any run that carries style or sits in a link. A markup string whose runs are all
 * plain draws identically from `text`, and `widgets/label-markup.ts`'s predicate says so
 * independently — the two agreeing is the assertion.
 */
function needsSpans(vector: LabelMarkupRunVector): boolean {
    return vector.runs.some(
        (run) =>
            run.bold === true ||
            run.italic === true ||
            run.underline === true ||
            run.strikethrough === true ||
            run.monospace === true ||
            (run.sizeSteps ?? 0) !== 0 ||
            run.script !== undefined ||
            run.link !== undefined ||
            (run.spans?.length ?? 0) > 0,
    );
}

/** `textDecoration` for a run: `<u>`, `<s>` and a LINK all reach the same property. */
function expectedDecoration(run: LabelMarkupRunExpectation): string | undefined {
    const underline = run.underline === true || run.link !== undefined;
    if (underline && run.strikethrough === true) return 'underline line-through';
    if (underline) return 'underline';
    if (run.strikethrough === true) return 'line-through';
    return undefined;
}

export const GtkLabelMarkupNsTest = async () => {
    await describe('Gtk.Label markup runs as NativeScript spans (LABEL_MARKUP_RUN_VECTORS)', async () => {
        for (const vector of LABEL_MARKUP_RUN_VECTORS) {
            await it(`${vector.markup} — ${vector.rule}`, () => {
                const label = markupLabel(vector.markup);
                expect(label.get_text()).toBe(vector.text);

                if (!needsSpans(vector)) {
                    // The plain path: nothing rich was ever written, so the property is
                    // untouched — `undefined`, not `null`.
                    expect(label.formattedText).toBe(undefined);
                    return;
                }

                const spans = spansOf(label);
                expect(spans.length).toBe(vector.runs.length);
                expect(spans.map((span) => span.text).join('')).toBe(vector.text);

                for (const [index, run] of vector.runs.entries()) {
                    const span = spans[index]!;
                    expect(span.text).toBe(run.text);
                    expect(span.tappable).toBe(run.link !== undefined);

                    // A `<span>`'s attributes reach the SAME `Span` properties the pango
                    // tags do, and a row's tag columns say nothing about what
                    // `weight="bold"` should map to — that question is the subject of the
                    // `<span>` block below, where the whitelist and the dropped values are
                    // named one by one. So a run carrying a `<span>` is asserted on its
                    // text and its link here, and on its style there.
                    if ((run.spans?.length ?? 0) > 0) continue;

                    expect(span.fontWeight).toBe(run.bold === true ? 'bold' : undefined);
                    expect(span.fontStyle).toBe(run.italic === true ? 'italic' : undefined);
                    expect(span.fontFamily).toBe(run.monospace === true ? 'monospace' : undefined);
                    expect(span.textDecoration).toBe(expectedDecoration(run));
                    expect(span.style.verticalAlignment).toBe(run.script);
                    // No base size is written here, so `<big>`/`<small>` are DROPPED — the
                    // declared remainder, measured rather than guessed against a default.
                    expect(span.fontSize).toBe(undefined);
                }
            });
        }
    });

    await describe('Gtk.Label markup only takes the rich path when the render needs it', async () => {
        for (const markup of ['plain', 'Tea &amp; cake', '<big><small>back</small></big>', '<markup>bare</markup>']) {
            await it(`${markup} draws from text, with no FormattedString at all`, () => {
                const label = markupLabel(markup);
                expect(label.formattedText).toBe(undefined);
                expect(label.text.length).toBeGreaterThan(0);
            });
        }

        await it('leaves className unset for a markup label without links', () => {
            // `check-nativescript-ns-defaults.mjs`'s incident in miniature: a render that
            // wrote the style classes unconditionally would leave a string here, and
            // `Adw.Clamp` splits what it finds.
            const label = markupLabel('<b>Bold</b>');
            expect(label.className).toBe(undefined);
            expect(label.has_css_class('link')).toBe(false);
        });

        await it('takes the rich path for an <a href> whose runs are otherwise plain', () => {
            const label = markupLabel('<a href="https://gtk.org">docs</a>');
            expect(spansOf(label).length).toBe(1);
        });

        await it('shows unparseable markup raw, from text and with no spans', () => {
            const label = markupLabel('<b>unclosed');
            expect(label.get_text()).toBe('<b>unclosed');
            expect(label.formattedText).toBe(undefined);
        });
    });

    await describe('Gtk.Label markup write order', async () => {
        await it('keeps get_text() answering while the spans are what shows', () => {
            const label = markupLabel('<b>Bold</b> and <i>italic</i>');
            expect(label.get_text()).toBe('Bold and italic');
        });

        await it('clears the spans BEFORE the text on the way back to plain', () => {
            const label = markupLabel('<b>Bold</b>');
            label.useMarkup = false;
            // The order is the whole assertion: clearing `formattedText` re-derives `text`
            // from the (now absent) spans, so a `text` written first would be wiped to ''.
            expect(label.formattedText).toBe(null);
            expect(label.get_text()).toBe('<b>Bold</b>');
        });

        await it('goes back and forth without losing either answer', () => {
            const label = markupLabel('<b>one</b>');
            label.label = 'two';
            expect(label.get_text()).toBe('two');
            label.label = '<i>three</i>';
            expect(label.get_text()).toBe('three');
            expect(spansOf(label)[0]!.fontStyle).toBe('italic');
        });

        await it('strips the mnemonic marker from each run, not from the markup', () => {
            const label = new Gtk.Label();
            label.useUnderline = true;
            label.set_markup('<b>_Bold</b> text');
            expect(spansOf(label)[0]!.text).toBe('Bold');
        });
    });

    await describe('Gtk.Label markup <big>/<small> against a written base size', async () => {
        await it('scales by pango\u2019s own factor when the label has a size', () => {
            const label = new Gtk.Label();
            label.style.fontSize = 16;
            label.set_markup('<big>up</big> and <small>down</small> and flat');
            // Four runs, not five: the text after the last element is ONE run — `' and '`,
            // `'down'`, `' and flat'` — because there is no element to split the tail.
            const spans = spansOf(label);
            expect(spans.map((span) => span.text)).toStrictEqual(['up', ' and ', 'down', ' and flat']);
            expect(spans[0]!.fontSize).toBe(16 * 1.2);
            expect(spans[2]!.fontSize).toBe(16 * 0.8333333333333);
            expect(spans[3]!.fontSize).toBe(undefined);
        });

        await it('multiplies one factor per element, as pango does', () => {
            const label = new Gtk.Label();
            label.style.fontSize = 10;
            label.set_markup('<big><big>huge</big></big>');
            expect(spansOf(label)[0]!.fontSize).toBe(10 * 1.2 * 1.2);
        });
    });

    await describe('Gtk.Label markup <sub>/<sup> scale by pango\u2019s font_scale fallback', async () => {
        await it('shrinks by 1 / 1.2 against a written base size, and keeps the baseline shift', () => {
            const label = new Gtk.Label();
            label.style.fontSize = 12;
            label.set_markup('x<sub>2</sub> y<sup>3</sup>');
            const spans = spansOf(label);
            expect(spans.map((span) => span.text)).toStrictEqual(['x', '2', ' y', '3']);
            expect(spans[1]!.fontSize).toBe(12 / 1.2);
            expect(spans[1]!.style.verticalAlignment).toBe('sub');
            expect(spans[3]!.fontSize).toBe(12 / 1.2);
            expect(spans[3]!.style.verticalAlignment).toBe('sup');
            expect(spans[0]!.fontSize).toBe(undefined);
        });

        await it('multiplies with <big>/<small>', () => {
            const label = new Gtk.Label();
            label.style.fontSize = 12;
            label.set_markup('<big><sub>n</sub></big>');
            expect(spansOf(label)[0]!.fontSize).toBe((12 * 1.2) / 1.2);
        });

        await it('skips the scale, not the shift, when the label has no base size', () => {
            const label = markupLabel('a<sup>b</sup>');
            const span = spansOf(label)[1]!;
            expect(span.fontSize).toBe(undefined);
            expect(span.style.verticalAlignment).toBe('sup');
        });
    });

    await describe('Gtk.Label markup <span> attributes NativeScript has a word for', async () => {
        await it('maps pango\u2019s named weights onto the eleven FontWeight values', () => {
            const label = markupLabel('<span weight="ultrabold">a</span><span weight="700">b</span>');
            const spans = spansOf(label);
            expect(spans[0]!.fontWeight).toBe('800');
            expect(spans[1]!.fontWeight).toBe('700');
        });

        await it('drops a weight FontWeight cannot state, rather than rounding it', () => {
            // `semilight` is 350 and has no value in `FontWeight.isValid`'s set.
            expect(spansOf(markupLabel('<span weight="semilight">a</span>'))[0]!.fontWeight).toBe(undefined);
        });

        await it('drops oblique, which FontStyle has no spelling for', () => {
            const spans = spansOf(markupLabel('<span style="italic">a</span><span style="oblique">b</span>'));
            expect(spans[0]!.fontStyle).toBe('italic');
            expect(spans[1]!.fontStyle).toBe(undefined);
        });

        await it('lets the pango tag win a collision with a span attribute', () => {
            // The attributes are written first and the tags after — the declared order, and
            // the same one the web port states: neither renderer can know which was inner.
            expect(spansOf(markupLabel('<span weight="300"><b>a</b></span>'))[0]!.fontWeight).toBe('bold');
        });

        await it('drops foreground, which would need the platform\u2019s colour parsing', () => {
            const span = spansOf(markupLabel('<span foreground="red">Hot</span>'))[0]!;
            expect(span.text).toBe('Hot');
            expect(span.fontWeight).toBe(undefined);
        });
    });

    await describe('Gtk.Label <a href> on NativeScript (LABEL_MARKUP_LINK_VECTORS)', async () => {
        for (const vector of LABEL_MARKUP_LINK_VECTORS) {
            await it(`${vector.markup} — ${vector.rule}`, () => {
                const label = mount(new RecordingLabel());
                label.set_markup(vector.markup);

                const expected: ReadonlyArray<LabelMarkupLinkExpectation> = vector.links ?? [];
                expect(
                    linksOf(label).map(({ href, title, cssClass, start, end }) => ({
                        href,
                        title,
                        cssClass,
                        start,
                        end,
                    })),
                ).toStrictEqual(expected.map((link) => ({ ...link })));
                expect(label.has_css_class('link')).toBe(vector.cssClass);

                if (vector.links === null) {
                    expect(label.get_text()).toBe(vector.markup);
                    return;
                }

                // A LINK WITH NO TEXT HAS NO SPAN and cannot:
                // `createSpannableStringBuilder` skips an empty-text span, so the link
                // survives only in the list above. Every other link is tappable over its
                // own runs, and a tap anywhere in it activates that URI.
                const tappable = vector.links.filter((link) => link.end > link.start);
                if (expected.length === 0) {
                    expect(label.formattedText).toBe(undefined);
                    return;
                }
                for (const span of tappableSpans(label)) tap(span);
                expect([...new Set(label.launched)]).toStrictEqual(tappable.map((link) => link.href));
            });
        }
    });

    await describe('Gtk.Label activate-link', async () => {
        await it('launches the URI through the default handler and marks the link visited', () => {
            const label = mount(new RecordingLabel());
            label.set_markup('Read the <a href="https://gtk.org">docs</a> first');
            tap(tappableSpans(label)[0]!);
            expect(label.launched).toStrictEqual(['https://gtk.org']);
            expect(linksOf(label)[0]!.visited).toBe(true);
        });

        await it('hands the URI to the handlers before the default launch', () => {
            const label = mount(new RecordingLabel());
            label.set_markup('<a href="https://gtk.org">docs</a>');
            const seen: string[] = [];
            label.connect('activate-link', (_self, data) => {
                seen.push((data as unknown as { uri: string }).uri);
                return false;
            });
            tap(tappableSpans(label)[0]!);
            expect(seen).toStrictEqual(['https://gtk.org']);
            expect(label.launched).toStrictEqual(['https://gtk.org']);
        });

        await it('still marks the link visited when a handler cancelled the launch', () => {
            // gtklabel.c:2053, `if (handled && !link->visited)` — a TRUE is "followed, my
            // way", and `Gtk.LinkButton` is NOT the same rule: it sets `visited` inside its
            // own default handler, which a cancelling handler never reaches.
            const label = mount(new RecordingLabel());
            label.set_markup('<a href="https://gtk.org">docs</a>');
            label.connect('activate-link', () => true);
            tap(tappableSpans(label)[0]!);
            expect(label.launched).toStrictEqual([]);
            expect(linksOf(label)[0]!.visited).toBe(true);
        });

        await it('launches nothing, and visits nothing, with no window above it', () => {
            // `GTK_IS_WINDOW (gtk_widget_get_root (widget))` — `isLoaded` is this surface's
            // version of the question, and an unmounted label answers no.
            const label = new RecordingLabel();
            label.set_markup('<a href="https://gtk.org">docs</a>');
            expect(label.isLoaded).toBe(false);
            tap(tappableSpans(label)[0]!);
            expect(label.launched).toStrictEqual([]);
            expect(linksOf(label)[0]!.visited).toBe(false);
        });

        await it('emits once per tap however many runs the link covers', () => {
            const label = mount(new RecordingLabel());
            label.set_markup('<a href="https://gtk.org"><b>bold</b> link</a>');
            const spans = tappableSpans(label);
            expect(spans.length).toBe(2);
            let count = 0;
            label.connect('activate-link', () => {
                count += 1;
                return true;
            });
            tap(spans[1]!);
            expect(count).toBe(1);
        });

        await it('activates the link the tapped run sits in, not the first one', () => {
            const label = mount(new RecordingLabel());
            label.set_markup('<a href="a">one</a> and <a href="b">two</a>');
            tap(tappableSpans(label)[1]!);
            expect(label.launched).toStrictEqual(['b']);
            expect(linksOf(label).map((link) => link.visited)).toStrictEqual([false, true]);
        });
    });

    await describe('Gtk.Label link visited state', async () => {
        await it('carries visited across a re-parse by URI', () => {
            const label = mount(new RecordingLabel());
            label.set_markup('<a href="https://gtk.org">docs</a>');
            tap(tappableSpans(label)[0]!);
            label.label = 'Read the <a href="https://gtk.org">docs</a> first';
            expect(linksOf(label)[0]!.visited).toBe(true);
        });

        await it('does not carry it to a different URI', () => {
            const label = mount(new RecordingLabel());
            label.set_markup('<a href="https://gtk.org">docs</a>');
            tap(tappableSpans(label)[0]!);
            label.label = '<a href="https://example.org">other</a>';
            expect(linksOf(label)[0]!.visited).toBe(false);
        });

        await it('shares one visited state between two links to the same place', () => {
            const label = mount(new RecordingLabel());
            label.set_markup('<a href="https://gtk.org">one</a> and <a href="https://gtk.org">two</a>');
            tap(tappableSpans(label)[0]!);
            expect(linksOf(label).map((link) => link.visited)).toStrictEqual([true, true]);
        });

        await it('drops the link class and the spans when the markup loses its links', () => {
            const label = mount(new RecordingLabel());
            label.set_markup('<a href="https://gtk.org">docs</a>');
            expect(label.has_css_class('link')).toBe(true);
            label.label = 'no links here';
            expect(label.has_css_class('link')).toBe(false);
            expect(label.formattedText).toBe(null);
            expect(label.get_text()).toBe('no links here');
            expect(linksOf(label)).toStrictEqual([]);
        });
    });
};

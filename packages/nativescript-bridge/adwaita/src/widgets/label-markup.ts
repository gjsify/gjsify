// A `Gtk.Label`'s markup DRAWN on NativeScript — the flat styled runs of
// `@gjsify/adwaita-core`'s `labelMarkupRender` as a `FormattedString` of `Span`s.
//
// WHY THE RUNS ARE ALREADY THE RIGHT SHAPE HERE. `FormattedString.spans` is a FLAT array
// and a `Span` has no children, so there is no tree to walk even if one wanted to: this is
// the surface core's `label-markup.ts` header names as the reason the runs are flat at all.
// One run is one `Span`, in reading order.
//
// WHAT A `Span` HAS WORDS FOR, MEASURED IN `@nativescript/core` 9.1 RATHER THAN ASSUMED.
// `fontFamily`, `fontSize`, `fontStyle`, `fontWeight` and `textDecoration` are `Span`'s OWN
// accessors forwarding to `style` (`ui/text-base/span.ts`), and Android's
// `setSpanModifiers` turns them into a `CustomTypefaceSpan`, an `AbsoluteSizeSpan` and an
// `UnderlineSpan`/`StrikethroughSpan` (`ui/text-base/index.android.ts`). `<sub>`/`<sup>`
// reach `style.verticalAlignment`, which is a REAL platform mechanism and not something
// invented here: Android shifts the baseline by ±0.4 of the font size
// (`BaselineAdjustedSpanImpl.updateState`) and iOS does the same in `getBaselineOffset`.
// That member has no `Span`-level shortcut because `verticalAlignment` lives on `View` and
// a `Span` is a `ViewBase`, so it is written through `style` — see `ns-core.d.ts` for the
// upstream `.d.ts` narrowing that hides those two values from the types.
//
// `<big>`/`<small>` NEED A BASE SIZE, AND SKIP WHEN THERE IS NONE — a DECLARED remainder.
// Pango's `<big>` is a FACTOR (`PANGO_SCALE_LARGE`, 1.2) applied to whatever size is in
// force; NativeScript's `fontSize` is an absolute number of DIPs and has no relative form.
// So the factor is resolved against the label's OWN `style.fontSize`, and when nothing has
// written one — the ordinary case, where the size comes from the platform theme and
// NativeScript leaves the property `undefined` — the scale is DROPPED rather than guessed
// against a made-up default, which would render a size GTK never asked for. The corpus this
// was measured against (155 labels, `adwaita-core`'s `label.ts` header) has no `<big>` or
// `<small>` at all.
//
// A LINK IS PER-RUN HERE, NOT ONE NODE — the other DECLARED divergence, and the flat array
// is the whole reason. GTK has one link node per `<a href>`, and the web port draws one
// `<a>` around however many runs the link covers. `FormattedString` has nothing to wrap
// runs IN, so a link whose text changes style part-way through is two tappable `Span`s that
// both activate the same URI. What that costs is the grouping, not the behaviour: a tap
// anywhere in the link emits once for that link.
//
// Reference: packages/web/adwaita-core/src/label-markup.ts (the runs, the links)
// Reference: packages/web/adwaita-web/src/label-markup.ts (the web half of the same render)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { FormattedString, Span } from '@nativescript/core';

import {
    stripMnemonic,
    type LabelMarkupRender,
    type LabelMarkupRun,
    type LabelMarkupStyle,
} from '@gjsify/adwaita-core';

/**
 * `PANGO_SCALE_LARGE` and `PANGO_SCALE_SMALL` (`pango/pango-font.h:263-265`) — pango's own
 * constants, so `<big>` here is the same step `<big>` is in GTK and not a rounded 1.2/0.8.
 */
const SCALE_LARGE = 1.2;
const SCALE_SMALL = 0.8333333333333;

/**
 * The `textDecoration` word for each combination `<u>`, `<s>` and a LINK can produce.
 *
 * A link underlines because that is the link treatment this theme already gives one:
 * `.adw-about-dialog-link` in `theme/adwaita.css` is `text-decoration: underline` and a
 * text colour, and the two link surfaces of this package must not disagree about what a
 * link looks like. The COLOUR is the declared remainder — libadwaita paints a link with the
 * accent, which the theme resolves per colour scheme in CSS, and this write path has no
 * accent value to write. `<a class>` goes the same way: a `Span` carries a `className`, but
 * whether NativeScript's CSS engine matches a selector against a span is unverified off a
 * device, so nothing here depends on it.
 */
function decoration(style: LabelMarkupStyle, link: boolean): string | undefined {
    const underline = style.underline || link;
    if (underline && style.strikethrough) return 'underline line-through';
    if (underline) return 'underline';
    if (style.strikethrough) return 'line-through';
    return undefined;
}

/**
 * The pango weights `fontWeight` states exactly.
 *
 * `FontWeight.isValid` (`ui/styling/font-common.ts`) accepts eleven values and no others,
 * and the words among them are only `normal` and `bold` — so pango's named ladder is mapped
 * onto the numbers beside them. `semilight` (350), `book` (380) and `ultraheavy` (1000) have
 * no value in that set and are DROPPED, which is the same answer the web port gives an
 * attribute value it cannot state.
 */
const SPAN_WEIGHTS: Readonly<Record<string, string>> = {
    thin: '100',
    ultralight: '200',
    light: '300',
    normal: 'normal',
    medium: '500',
    semibold: '600',
    bold: 'bold',
    ultrabold: '800',
    heavy: '900',
};

/** The values `FontWeight.isValid` takes, for a `<span weight="700">`. */
const NUMERIC_WEIGHTS: ReadonlySet<string> = new Set(['100', '200', '300', '400', '500', '600', '700', '800', '900']);

/**
 * One `<span>`'s attributes written onto `span`, for the attributes NativeScript has a word
 * for. Everything else is dropped — `foreground`/`background` would need NS's colour
 * parsing and no measured label uses one, and the remaining pango attributes (`rise`,
 * `letter_spacing`, `gravity`, …) have no `Span` member at all.
 */
function applySpanAttributes(span: Span, attributes: Readonly<Record<string, string>>): void {
    for (const [attribute, value] of Object.entries(attributes)) {
        switch (attribute) {
            case 'font_family':
            case 'family':
                span.fontFamily = value;
                break;
            case 'font_style':
            case 'style':
                // `FontStyle.isValid` takes `normal` and `italic` only; pango's `oblique`
                // has no NativeScript spelling, so it is dropped rather than italicised.
                if (value === 'normal' || value === 'italic') span.fontStyle = value;
                break;
            case 'font_weight':
            case 'weight': {
                const weight = SPAN_WEIGHTS[value] ?? (NUMERIC_WEIGHTS.has(value) ? value : undefined);
                if (weight !== undefined) span.fontWeight = weight;
                break;
            }
            case 'underline':
                // pango: any value but `none` underlines.
                if (value !== 'none') span.textDecoration = 'underline';
                break;
            case 'strikethrough':
                if (value !== 'false' && value !== 'none') span.textDecoration = 'line-through';
                break;
            default:
                break;
        }
    }
}

/**
 * One run as one `Span`.
 *
 * The `<span>` attributes are written FIRST and the pango tags after, so a tag wins a
 * collision — the same declared order the web port states, for the same reason: the runs
 * record the tags as booleans and the `<span>`s as a separate stack, so neither renderer can
 * know which element was inner.
 *
 * `mnemonics` is `use-underline`, applied to the run's TEXT and not to the markup string:
 * `gtk_label_set_markup_with_mnemonic` parses first and strips the marker out of the result,
 * so an `_` inside a tag's attributes is not a mnemonic.
 */
export function labelMarkupSpan(run: LabelMarkupRun, mnemonics: boolean, base?: number): Span {
    const span = new Span();
    span.text = mnemonics ? stripMnemonic(run.text) : run.text;

    for (const attributes of run.style.spans) applySpanAttributes(span, attributes);

    if (run.style.monospace) span.fontFamily = 'monospace';
    if (run.style.bold) span.fontWeight = 'bold';
    if (run.style.italic) span.fontStyle = 'italic';
    const line = decoration(run.style, run.link !== null);
    if (line !== undefined) span.textDecoration = line;
    if (run.style.script !== null) span.style.verticalAlignment = run.style.script;

    // The steps MULTIPLY, as pango's one factor per element does: `<big><big>` is 1.44.
    const steps = run.style.sizeSteps;
    if (steps !== 0 && base !== undefined)
        span.fontSize = base * (steps > 0 ? SCALE_LARGE : SCALE_SMALL) ** Math.abs(steps);

    return span;
}

/**
 * Whether `render` needs the `FormattedString` path at all.
 *
 * A label whose markup is only `<markup>` around plain prose draws IDENTICALLY from
 * `text`, and taking the rich path for it would move every such label onto a different
 * native mechanism (an Android `SpannableStringBuilder` rather than a plain `CharSequence`)
 * for no visible difference. So the predicate is "any run carries style, or there is a
 * link", and a markup label that needs neither keeps the path it has always had.
 *
 * LOCAL TO THIS MODULE on purpose: it is a NativeScript write-path question, and a core
 * helper for it would be a core function no renderer suite drives.
 */
export function labelMarkupNeedsSpans(render: LabelMarkupRender): boolean {
    if (render.links.length > 0) return true;
    return render.runs.some((run) => run.link !== null || styled(run.style));
}

/** Whether a run's style says anything a `Span` would carry. */
function styled(style: LabelMarkupStyle): boolean {
    return (
        style.bold ||
        style.italic ||
        style.underline ||
        style.strikethrough ||
        style.monospace ||
        style.script !== null ||
        style.sizeSteps !== 0 ||
        style.spans.length > 0
    );
}

/**
 * `render` as a `FormattedString`, with every run inside an `<a href>` subscribed to
 * `onLinkTap`.
 *
 * SUBSCRIBING IS WHAT MAKES A SPAN TAPPABLE: `tappable` is derived from
 * `hasListeners(Span.linkTapEvent)` (`Span._setTappable`) and `setSpanModifiers` attaches
 * the native `ClickableSpan` only for a tappable span, so the listener is not an extra on
 * top of the link — it IS the link.
 *
 * A LINK WITH NO TEXT HAS NO SPAN, and cannot: `createSpannableStringBuilder` skips any
 * span whose text is empty (`spanLength > 0`), so an empty `Span` would not reach the
 * native text at all. The web port keeps the empty `<a>`; here the link survives only in
 * the render's `links`, which is what answers `has-tooltip` and the `link` style class.
 */
export function labelMarkupFormattedString(
    render: LabelMarkupRender,
    mnemonics: boolean,
    base: number | undefined,
    onLinkTap: (index: number) => void,
): FormattedString {
    const formatted = new FormattedString();
    for (const run of render.runs) {
        const span = labelMarkupSpan(run, mnemonics, base);
        if (run.link !== null) {
            const index = run.link;
            span.addEventListener(Span.linkTapEvent, () => onLinkTap(index));
        }
        formatted.spans.push(span);
    }
    return formatted;
}

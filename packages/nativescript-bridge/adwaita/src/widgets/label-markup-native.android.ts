// The Android half of a `Gtk.Label`'s markup: the runs as ONE `SpannableStringBuilder` set
// on the native `TextView`, with no `FormattedString` and no `Span` anywhere. Rationale for
// the split and the measurement that made a second path worth having:
// `label-markup-native.ts`.
//
// EVERY DECISION IS `labelMarkupFace`'s, in `label-markup.ts` — which family, bold, italic,
// the two lines, the baseline and the font factor. This file turns one face into platform
// spans and decides nothing, so what the two markup paths draw can be asserted off a device
// against the same function.
//
// WHICH SPANS, read off the platform rather than assumed. `TypefaceSpan(String)` takes a
// family name (API 1), which is how `<tt>` reaches `monospace`; `StyleSpan` takes
// `Typeface.BOLD`/`ITALIC`/`BOLD_ITALIC`, the only weights below API 28 — see the face's own
// header for why the ladder collapses there and not here. `RelativeSizeSpan` is a FACTOR,
// which is what pango's `<big>`/`<small>`/script scale is, so unlike the `Span` path this
// one needs no base font size and drops nothing. `SubscriptSpan`/`SuperscriptSpan` shift the
// baseline only — the script's 1/1.2 is in the factor.
//
// `insert`, NOT `append`. `SpannableStringBuilder.append` is overloaded on `char` as well as
// `CharSequence`, and a one-character JS string marshals to either; `insert(int,
// CharSequence)` is unambiguous, and it is what `@nativescript/core`'s own
// `createSpannableStringBuilder` uses.
//
// SPAN_EXCLUSIVE_EXCLUSIVE so a span does not stretch over text inserted at its edge — the
// runs are written in reading order, and the next run inserts at the previous one's end.
//
// Reference: android.text.SpannableStringBuilder, android.text.style.{TypefaceSpan,
// StyleSpan, UnderlineSpan, StrikethroughSpan, RelativeSizeSpan, SubscriptSpan,
// SuperscriptSpan, ClickableSpan}, android.graphics.Typeface
// Copyright (c) The GTK Team. LGPLv2.1+.

import { stripMnemonic } from '@gjsify/adwaita-core';

import { labelMarkupFace, type LabelMarkupNativeText } from './label-markup.js';

/** The native text view a `Label` draws into, and the two framework doors this path uses. */
interface NativeLabel {
    readonly nativeTextViewProtected?: AndroidTextView | null;
    _setNativeText(reset?: boolean): void;
    /** `TextBase._setTappableState` — installs the `LinkMovementMethod` a `ClickableSpan` needs. */
    _setTappableState(tappable: boolean): void;
}

interface AndroidTextView {
    setText(text: unknown): void;
}

interface AndroidSpannableStringBuilder {
    insert(where: number, text: string): unknown;
    setSpan(what: unknown, start: number, end: number, flags: number): void;
}

/** `this` inside an `.extend()` implementation, plus the own property the tap is held in. */
type TappableSpan = { tap?: () => void };

/** The slice of the `android` global this file reaches, optional so a missing runtime is a refusal and not a crash. */
declare const android:
    | {
          text: {
              SpannableStringBuilder: new () => AndroidSpannableStringBuilder;
              Spanned: { SPAN_EXCLUSIVE_EXCLUSIVE: number };
              style: {
                  TypefaceSpan: new (family: string) => unknown;
                  StyleSpan: new (style: number) => unknown;
                  UnderlineSpan: new () => unknown;
                  StrikethroughSpan: new () => unknown;
                  RelativeSizeSpan: new (proportion: number) => unknown;
                  SubscriptSpan: new () => unknown;
                  SuperscriptSpan: new () => unknown;
                  ClickableSpan: unknown;
              };
          };
          graphics: { Typeface: { BOLD: number; ITALIC: number; BOLD_ITALIC: number } };
      }
    | undefined;

/**
 * What each label draws, by label. A `WeakMap` rather than a field on the widget: the two
 * doors are reached as free functions precisely so the base file can refuse without the
 * widget carrying a member only one platform ever fills.
 */
const held = new WeakMap<object, LabelMarkupNativeText>();

/** Built on first use: `.extend()` needs the runtime, which does not exist at import time. */
let clickableSpanClass: (new () => object) | undefined;

function tappableSpan(onTap: () => void): object {
    if (clickableSpanClass === undefined) {
        const base = android!.text.style.ClickableSpan as { extend(implementation: object): new () => object };
        clickableSpanClass = base.extend({
            onClick(this: TappableSpan) {
                this.tap?.();
            },
            // EMPTY, as `@nativescript/core`'s own `ClickableSpanImpl.updateDrawState` is:
            // the platform would otherwise paint its link colour and underline over the
            // markup's, and the markup's is GTK's (`labelMarkupFace`).
            updateDrawState() {},
        });
    }
    const span = new clickableSpanClass() as TappableSpan;
    span.tap = onTap;
    return span;
}

function nativeTextViewOf(label: object): AndroidTextView | undefined {
    const view = (label as NativeLabel).nativeTextViewProtected;
    return view === null || view === undefined ? undefined : view;
}

/** Rationale and contract: `label-markup-native.ts`. */
export function labelMarkupHoldNative(label: object, text: LabelMarkupNativeText | null): boolean {
    if (android === undefined) return false;

    const had = held.delete(label);
    if (text !== null) held.set(label, text);

    // A label with no native view yet is drawn by the `text` write that follows this hold,
    // which is what keeps the first render ONE native write. One that HAS a view may not
    // be: writing `text` with the string it already holds is a no-op, so markup that
    // changed only its styling (`<b>hi</b>` → `<i>hi</i>`) would never reach the view.
    if ((had || text !== null) && nativeTextViewOf(label) !== undefined) (label as NativeLabel)._setNativeText();
    return true;
}

/** Rationale and contract: `label-markup-native.ts`. */
export function labelMarkupDrawNative(label: object, reset: boolean): boolean {
    if (android === undefined || reset) return false;

    const text = held.get(label);
    if (text === undefined) return false;
    const view = nativeTextViewOf(label);
    if (view === undefined) return false;

    const { Typeface } = android.graphics;
    const style = android.text.style;
    const flags = android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE;
    const builder = new android.text.SpannableStringBuilder();
    let tappable = false;
    let start = 0;

    for (const run of text.render.runs) {
        const body = text.mnemonics ? stripMnemonic(run.text) : run.text;
        // An empty run is a range of nothing: every span over it would be a span the
        // platform keeps and never draws.
        if (body.length === 0) continue;

        builder.insert(start, body);
        const end = start + body.length;
        const link = run.link;
        const face = labelMarkupFace(run.style, link !== null);

        if (face.family !== undefined) builder.setSpan(new style.TypefaceSpan(face.family), start, end, flags);
        if (face.bold || face.italic) {
            const weight =
                face.bold && face.italic ? Typeface.BOLD_ITALIC : face.bold ? Typeface.BOLD : Typeface.ITALIC;
            builder.setSpan(new style.StyleSpan(weight), start, end, flags);
        }
        if (face.underline) builder.setSpan(new style.UnderlineSpan(), start, end, flags);
        if (face.strikethrough) builder.setSpan(new style.StrikethroughSpan(), start, end, flags);
        if (face.scale !== 1) builder.setSpan(new style.RelativeSizeSpan(face.scale), start, end, flags);
        if (face.script === 'sub') builder.setSpan(new style.SubscriptSpan(), start, end, flags);
        else if (face.script === 'sup') builder.setSpan(new style.SuperscriptSpan(), start, end, flags);
        if (link !== null) {
            tappable = true;
            builder.setSpan(
                tappableSpan(() => text.onLinkTap(link)),
                start,
                end,
                flags,
            );
        }

        start = end;
    }

    // BEFORE the text: the movement method is what makes a `ClickableSpan` reachable at
    // all, and `_setTappableState` also turns `singleLine` off, which conflicts with it.
    (label as NativeLabel)._setTappableState(tappable);
    view.setText(builder);
    return true;
}

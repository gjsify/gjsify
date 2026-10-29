// GtkLabel — a run of text, for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1). libadwaita ships no label type;
// it styles GTK's through `_labels.scss` (`.title-1`, `.dimmed`, …), which is what the style-class
// methods below carry. So this is `Gtk.Label`, and there is no `adw-` spelling of it.
//
// WHY IT EXISTS, when `@nativescript/core` already has a `Label`. The same measurement that bought
// `Gtk.Box`: three documented gallery panes reached into `@nativescript/core` for a `Label` because
// the port had none under the GIR name, and a pane that imports the platform's primitives is a
// different PROGRAM from the `gjs` pane beside it (ADR 0034 § Amendment 14). It extends the real
// `Label`, and adds the three things the platform has no word for — `label` with GTK's markup and
// mnemonic rules, `wrap` under GTK's name, and `add_css_class`.
//
// WHAT IT DOES WITH MARKUP, STATED HERE AND NOT LEFT IMPLICIT. `use-markup` is DRAWN: the markup
// is parsed into flat styled runs by `@gjsify/adwaita-core`'s `labelMarkupRender` and written as a
// `FormattedString` of `Span`s (`label-markup.ts`, which carries the per-attribute mapping and the
// two declared remainders). `Label.text` takes no markup string and never will — NativeScript has
// no parser to hand one to — so the parse is ours and only the resolved attributes reach the
// platform. Unparseable markup keeps the raw string, which is the C fallback. `get_text()` still
// answers the reduced plain text either way.
//
// A MARKUP LABEL WHOSE RUNS CARRY NOTHING STAYS ON `text`. `<markup>` around ordinary prose draws
// identically from the plain property, and taking the rich path for it would move such a label onto
// a different native mechanism (an Android `SpannableStringBuilder`) for no visible difference —
// `labelMarkupNeedsSpans` is the gate, and `formattedText` is cleared when it answers no.
//
// `use-markup` DEFAULTS TO FALSE, as in GTK, and that is what keeps this port clear of the failure
// the other direction has: a widget that parses markup by default blanks a label containing a `<` in
// ordinary prose. Nothing here parses unless asked, and when asked it strips.
//
// `xalign` REACHES `textAlignment` AT ITS THREE EXACT POINTS AND NOWHERE ELSE. GTK's `xalign` is a
// continuum in [0, 1] — `xalign * (width − text width)` — and NativeScript's `textAlignment` has
// three positions. So `0`, `0.5` and `1` map to the start, the centre and the end, mirrored in RTL
// as `gtk_label_get_layout_location` mirrors them, and every other value is REFUSED rather than
// snapped to the nearest: a label written at `0.25` that renders at `0` would report a snap as
// agreement. The reading is `@gjsify/adwaita-core`'s (`normalizeLabelXalign`), so an out-of-range
// `3` clamps to `1` on both before either renders it.
//
// `justify` AND `xalign` ARE TWO ALIGNMENTS IN GTK AND ONE ON THE PLATFORM. `xalign` places the
// text BLOCK in the allocation (`gtk_label_get_layout_location`); `justify` aligns the LINES
// inside that block (`gtk_label_ensure_layout`: LEFT is the start, RIGHT the end, CENTER the
// centre, FILL the start plus `pango_layout_set_justify`), so it does nothing to one line.
// `textAlignment` aligns every line within the view, so it states BOTH exactly when they name
// the same edge, and states `xalign` alone exactly when the label can only show one line (no
// `wrap`, no newline). FILL is Android's `JUSTIFICATION_MODE_INTER_WORD` (API 26): word gaps
// stretched, the last line left ragged — Pango's own rule. NativeScript's `'justify'` carries it
// in LTR; in RTL its gravity is LEFT, so there the port writes `'right'` and sets the mode on
// the `TextView` itself. A label that can show several lines, with a written `xalign` and a
// non-default `justify` on different edges, has no exact rendering and is REFUSED. Two edges
// stay, both older than `justify`: an UNWRITTEN `xalign` keeps the platform's start-aligned text
// where GTK centres it (the lines follow `justify` when it was written), and under the default
// `justify` a label of several lines aligns each line where GTK aligns the block.
//
// `ELLIPSIZE` AND `LINES` REACH REAL NATIVE MECHANISMS, MEASURED IN `@nativescript/core`'s OWN
// SOURCE rather than assumed from its `.d.ts`: `textOverflow` ('clip' | 'ellipsis') and `maxLines`
// (a plain number) are not declared gaps here, contrary to the continuum reasoning that keeps
// `yalign` off this widget. `ellipsize` sets `textOverflow` through `labelEllipsizeOverflowValue` —
// the SAME function `<gtk-label>` on the web surface uses, since Android's own `adjustLineBreak()`
// (`index.android.js`) only lets `textOverflow` act while `whiteSpace` is `'nowrap'` (i.e. {@link
// wrap} is off), exactly CSS's `text-overflow` needing `white-space: nowrap` — so `start`/`middle`
// collapse to the same end-ellipsis declared divergence the web element pins.
//
// `lines` SETS `maxLines`, GATED BY `labelEffectiveLines` TO "ELLIPSIZE IS ACTIVE" ALONE — NOT
// "wrapping or ellipsized", the pspec's own words for it. MEASURED (a real `Gtk.Label`, allocated,
// gjs 1.88.1 / gtk 4.22.5): `wrap` plays NO PART in whether GTK honours `lines` — `wrap=TRUE,
// ellipsize=NONE, lines=2` laid out 15 UNCAPPED lines (the pspec's own hint, ignored, since Pango
// only consults a layout's line-count while ellipsizing), and `wrap=FALSE, ellipsize=END, lines=2`
// laid out exactly 2, ellipsized. Android's own `maxLinesProperty.setNative` treats any `value <= 0`
// as UNLIMITED (`Number.MAX_SAFE_INTEGER`) and any `value > 0` as a real cap that ALSO force-sets a
// native end-ellipsize — a platform mechanism this port forwards the corrected value INTO, not one
// it built: whether Android's OWN `setSingleLine`/`setMaxLines` precedence then renders the same
// line count GTK does is unverified off a device.
//
// WHAT IT DOES NOT DO: `attributes`, `natural-wrap-mode`, `wrap-mode`, `width-chars`,
// `max-width-chars`, `tabs`, `yalign` and the mnemonic-widget link are declared gaps
// in `check-nativescript-widget-coverage.mjs` — that gate holds the list, so it is not restated
// here. `yalign` is a continuum on the view's OWN `verticalAlignment` (four positions), which
// `Gtk.Align` already answers to on every widget (`gtk-align.ts`): a second claim on it would
// report a snap as agreement twice over, the collision `xalign` does NOT have.
//
// Copyright (c) The GTK Team, GNOME contributors. LGPLv2.1+.

import { Label, type EventData } from '@nativescript/core';

import {
    DEFAULT_LABEL_LINES,
    DEFAULT_LABEL_XALIGN,
    HandledAccumulator,
    createAppInfo,
    labelActivateLink,
    labelDisplayText,
    labelEffectiveLines,
    labelEllipsizeOverflowValue,
    labelHasLinks,
    labelLinkVisited,
    labelMarkupRender,
    normalizeLabelEllipsize,
    normalizeLabelLines,
    normalizeLabelXalign,
    LABEL_JUSTIFICATIONS,
    type LabelEllipsizeMode,
    type LabelJustification,
    type LabelLink,
} from '@gjsify/adwaita-core';

import { classNameWith, normalizeStyleClasses, withCssClass, withoutCssClass } from './style-classes.js';
import { labelMarkupFormattedString, labelMarkupNeedsSpans } from './label-markup.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { androidApiLevel } from './native-tooltip.js';
import { nativePlatformHost } from '../platform-host.js';
import { withSignals } from './signals.js';

/** Event name emitted when a link in the markup is tapped, before it is opened. */
export const ACTIVATE_LINK = 'activate-link';

const appInfo = createAppInfo(nativePlatformHost);

type Edge = 'start' | 'center' | 'end';

/** The three `xalign` values `textAlignment` can state exactly, and the edge each one is. */
const XALIGN_EDGES: ReadonlyMap<number, Edge> = new Map([
    [0, 'start'],
    [0.5, 'center'],
    [1, 'end'],
]);

/** The edge `gtk_label_ensure_layout` aligns the lines to, per `Gtk.Justification`. */
const JUSTIFY_EDGES: Readonly<Record<LabelJustification, Edge>> = {
    left: 'start',
    right: 'end',
    center: 'center',
    fill: 'start',
};

/** `Build.VERSION_CODES.O`: the first level with `TextView.setJustificationMode`. */
const JUSTIFICATION_API = 26;

/** `Layout.JUSTIFICATION_MODE_NONE` / `JUSTIFICATION_MODE_INTER_WORD`. */
const JUSTIFICATION_MODE_NONE = 0;
const JUSTIFICATION_MODE_INTER_WORD = 1;

/** An edge as the physical `textAlignment` word, mirrored in RTL. */
function physical(edge: Edge, rtl: boolean): 'left' | 'center' | 'right' {
    if (edge === 'center') return 'center';
    return (edge === 'start') !== rtl ? 'left' : 'right';
}

export class GtkLabel extends withSignals(Label) {
    static readonly GTypeName: string = 'GtkLabel';

    private _label = '';
    private _useMarkup = false;
    private _useUnderline = false;
    private _ellipsize: LabelEllipsizeMode = 'none';
    private _lines = -1;
    private _styleClasses: string[] = [];
    private _xalign = DEFAULT_LABEL_XALIGN;
    private _xalignWritten = false;
    private _justify: LabelJustification = 'left';
    private _selectable = false;
    /** The `<a href>` of the last render — kept so a re-parse inherits `visited` by URI. */
    private _links: readonly LabelLink[] = [];

    constructor(props?: ConstructProps<GtkLabel>) {
        super();

        // NO BASE CLASS OF ITS OWN, and no `className` write — the same answer `GtkBox`
        // gives: GTK's `label` is a CSS NAME and never a member of `css-classes`, and
        // libadwaita's label looks are all opt-in style classes. So the list starts empty
        // and holds exactly what a caller puts in it.
        // The native view does not exist when `selectable` is first written from XML, so the
        // held value is applied again once the view is loaded.
        this.addEventListener('loaded', () => {
            this._applySelectable();
            this._applyJustificationMode();
        });
        applyConstructProps(this, props);
    }

    // --- properties ---

    /**
     * `Gtk.Label:label` — the text, as written, before markup and the mnemonic marker are
     * taken out of it. `get_text()` is the string actually shown.
     */
    get label(): string {
        return this._label;
    }

    set label(value: string) {
        this._label = value ?? '';
        this._render();
    }

    /**
     * `Gtk.Label:use-markup` — whether {@link label} is Pango markup.
     *
     * TRUE means the markup is DRAWN, as styled `Span`s: see the header. FALSE, the
     * default, shows the string literally, so a `<` in a sentence stays a `<`.
     */
    get useMarkup(): boolean {
        return this._useMarkup;
    }

    set useMarkup(raw: boolean | string) {
        this._useMarkup = xmlBoolean(raw, this._useMarkup);
        this._render();
    }

    /**
     * `Gtk.Label:use-underline` — whether an `_` in {@link label} marks a mnemonic.
     *
     * The marker is REMOVED and the key is not bound: NativeScript has no accelerator
     * layer and no way to underline one character of a `Label`. Same reduction
     * `Adw.ButtonContent` makes.
     */
    get useUnderline(): boolean {
        return this._useUnderline;
    }

    set useUnderline(raw: boolean | string) {
        this._useUnderline = xmlBoolean(raw, this._useUnderline);
        this._render();
    }

    /**
     * `Gtk.Label:wrap` — whether the text wraps rather than running past its allocation.
     *
     * NativeScript's own name for it is `textWrap`, which stays reachable; this is the GIR
     * spelling over the same platform property, so a snippet ported off GJS runs verbatim.
     * `wrap-mode` and `natural-wrap-mode` are the declared gaps beside it — the platform
     * wraps at word boundaries and offers no choice. Does NOT reapply {@link lines}:
     * MEASURED (`@gjsify/adwaita-core`'s `label.ts` header), `wrap` plays no part in
     * whether `lines` has an effect, only {@link ellipsize} does.
     */
    get wrap(): boolean {
        return this.textWrap;
    }

    set wrap(raw: boolean | string) {
        const wrap = xmlBoolean(raw, this.textWrap);
        this._applyAlignment({ wrap });
        this.textWrap = wrap;
    }

    /**
     * `Gtk.Label:ellipsize` — where the string is trimmed when it does not fit. Defaults
     * to `none`. Sets the platform's `textOverflow`, which only acts while {@link wrap} is
     * off (Android's `adjustLineBreak()` — see the header). `start` and `middle` are HELD
     * faithfully but DRAWN as an end-ellipsis: `labelEllipsizeOverflowValue`
     * (`@gjsify/adwaita-core`) says why, the same declared divergence the web element pins.
     */
    get ellipsize(): LabelEllipsizeMode {
        return this._ellipsize;
    }

    set ellipsize(raw: LabelEllipsizeMode | string) {
        this._ellipsize = normalizeLabelEllipsize(raw);
        this.textOverflow = labelEllipsizeOverflowValue(this._ellipsize);
        this._applyLines();
    }

    /**
     * `Gtk.Label:lines` — the line count an ellipsized label is held to. Defaults to -1
     * ("unset"), which still caps at Pango's own default of ONE line the moment
     * {@link ellipsize} is active — never "unlimited". Has no effect at all while
     * ellipsize is `none`, `wrap` or not — {@link labelEffectiveLines}
     * (`@gjsify/adwaita-core`) is that MEASURED guard, applied to the platform's
     * `maxLines`, where any `value <= 0` already means unlimited (measured in
     * `@nativescript/core`'s `index.android.js`).
     */
    get lines(): number {
        return this._lines;
    }

    set lines(raw: number | string) {
        this._lines = normalizeLabelLines(xmlNumber(raw, DEFAULT_LABEL_LINES));
        this._applyLines();
    }

    /**
     * `Gtk.Label:selectable` — whether the user can select and copy the text. Held on every
     * platform; ENFORCED on Android, where a NativeScript `Label` is a `TextView` and
     * `setTextIsSelectable` is its own switch. On a platform view without that method (iOS
     * `UILabel`) the value is only read back.
     */
    get selectable(): boolean {
        return this._selectable;
    }

    set selectable(raw: boolean | string) {
        this._selectable = xmlBoolean(raw, this._selectable);
        this._applySelectable();
    }

    private _applySelectable(): void {
        const native = (this as unknown as { nativeViewProtected?: { setTextIsSelectable?: (value: boolean) => void } })
            .nativeViewProtected;
        native?.setTextIsSelectable?.(this._selectable);
    }

    private _applyLines(): void {
        this.maxLines = labelEffectiveLines(this._lines, this._ellipsize) ?? 0;
    }

    /**
     * `Gtk.Label:justify` — how the lines align with one another; no effect on a single line.
     * Takes a nick or the `Gtk.Justification` constant and reads back as the nick. How it shares
     * `textAlignment` with {@link xalign}, and the one combination that throws, is in the header.
     */
    get justify(): LabelJustification {
        return this._justify;
    }

    set justify(raw: LabelJustification | number | string) {
        // A nick, or the enum constant — which XML hands over as a string like "2".
        const justify: LabelJustification | undefined = (LABEL_JUSTIFICATIONS as readonly unknown[]).includes(raw)
            ? (raw as LabelJustification)
            : LABEL_JUSTIFICATIONS[xmlNumber(raw, -1)];
        if (justify === undefined) {
            throw new TypeError(
                `'${String(raw)}' is not a Gtk.Justification, so it cannot be 'justify'. The members are ` +
                    `${LABEL_JUSTIFICATIONS.join(', ')}, or their values 0 to 3.`,
            );
        }
        this._applyAlignment({ justify });
    }

    /**
     * `Gtk.Label:xalign` — where the text sits in the label's box, `0` the start and `1` the
     * end. Clamped to that range as `gtk_label_set_xalign` clamps it, and painted only at the
     * three points `textAlignment` can say exactly; any other value throws (see the header).
     */
    get xalign(): number {
        return this._xalign;
    }

    set xalign(raw: number | string) {
        const xalign = normalizeLabelXalign(xmlNumber(raw, DEFAULT_LABEL_XALIGN));
        if (!XALIGN_EDGES.has(xalign)) {
            throw new TypeError(
                `Gtk.Label xalign ${xalign} has no NativeScript counterpart: textAlignment places text at the ` +
                    'start, the centre or the end, so only 0, 0.5 and 1 render as written. Snapping it would ' +
                    'show a different label than GTK does with no sign of the difference.',
            );
        }
        this._applyAlignment({ xalign });
    }

    /**
     * Resolve `xalign` and `justify` onto `textAlignment` for the state `next` would leave, and
     * commit it — or throw BEFORE anything changes, so a refused write leaves the label as it was.
     */
    private _applyAlignment(next: {
        xalign?: number;
        justify?: LabelJustification;
        text?: string;
        wrap?: boolean;
    }): void {
        const xalign = next.xalign ?? (this._xalignWritten ? this._xalign : null);
        const justify = next.justify ?? this._justify;
        const text = next.text ?? this.text ?? '';
        const multiline = (next.wrap ?? this.textWrap) || text.includes('\n');
        const lines = JUSTIFY_EDGES[justify];
        const block = xalign === null ? null : XALIGN_EDGES.get(xalign);

        let edge: Edge | null;
        if (block === null) edge = justify === 'left' ? null : lines;
        else if (block === lines || !multiline || justify === 'left') edge = block;
        else {
            throw new TypeError(
                `Gtk.Label justify ${justify} beside xalign ${xalign} has no NativeScript counterpart on a label ` +
                    `that can show several lines: GTK places the text block at its ${block} and aligns the ` +
                    `lines inside it to their ${lines}, and textAlignment is one alignment for both. An xalign ` +
                    'on the justify edge, or a label without wrap and newline, renders exactly.',
            );
        }

        if (next.xalign !== undefined) {
            this._xalign = next.xalign;
            this._xalignWritten = true;
        }
        if (next.justify !== undefined) this._justify = next.justify;
        if (edge === null) {
            // Only a label whose alignment was never written keeps the platform's own.
            if (next.xalign !== undefined || next.justify !== undefined) this.textAlignment = 'initial';
            return;
        }
        const side = physical(edge, this.style?.direction === 'rtl');
        this.textAlignment = justify === 'fill' && side === 'left' ? 'justify' : side;
        this._applyJustificationMode();
    }

    /**
     * FILL off NativeScript's `'justify'` word: that word also forces LEFT gravity, so an RTL
     * FILL label sets the mode on the `TextView` itself, after the platform's `textAlignment`
     * setter has reset it.
     */
    private _applyJustificationMode(): void {
        if (this.textAlignment === 'justify') return;
        if (androidApiLevel() < JUSTIFICATION_API) return;
        const native = (this as unknown as { nativeViewProtected?: { setJustificationMode?: (mode: number) => void } })
            .nativeViewProtected;
        // An unchanged `textAlignment` does not reach the platform setter, so leaving FILL
        // has to clear the mode here too.
        native?.setJustificationMode?.(
            this._justify === 'fill' ? JUSTIFICATION_MODE_INTER_WORD : JUSTIFICATION_MODE_NONE,
        );
    }

    /**
     * `GtkWidget:css-classes`, spelled `styleClasses` for the reason `style-classes.ts`
     * records: the platform owns `cssClasses` as a live `Set` and taking that name kills
     * the widget. From XML it is a space-separated list —
     * `<gtk:Label styleClasses="title-2" />`.
     */
    get styleClasses(): string[] {
        return [...this._styleClasses];
    }

    set styleClasses(value: string | null | undefined) {
        this._setClasses(normalizeStyleClasses(value));
    }

    // --- methods, under GTK's own names ---

    /** `gtk_label_get_label`. */
    get_label(): string {
        return this.label;
    }

    /** `gtk_label_set_label`. */
    set_label(value: string): void {
        this.label = value;
    }

    /** `gtk_label_set_markup` — set the text AND turn markup interpretation on. */
    set_markup(markup: string): void {
        this._label = markup ?? '';
        this._useMarkup = true;
        this._render();
    }

    /**
     * `gtk_label_get_text` — the text as SHOWN, with markup reduced and the mnemonic
     * marker removed. `label` is the string as written.
     */
    get_text(): string {
        return this.text ?? '';
    }

    /** `gtk_widget_add_css_class`. A class the label already carries is a no-op. */
    add_css_class(name: string): void {
        this._setClasses(withCssClass(this._styleClasses, name));
    }

    /** `gtk_widget_remove_css_class`. A class it does not carry is a no-op. */
    remove_css_class(name: string): void {
        this._setClasses(withoutCssClass(this._styleClasses, name));
    }

    /** `gtk_widget_has_css_class`. */
    has_css_class(name: string): boolean {
        return this._styleClasses.includes((name ?? '').trim());
    }

    /** `gtk_widget_get_css_classes` — the list, without the widget's own CSS name. */
    get_css_classes(): string[] {
        return [...this._styleClasses];
    }

    /** `gtk_widget_set_css_classes` — REPLACES the list, as in C. */
    set_css_classes(names: readonly string[]): void {
        this._setClasses(normalizeStyleClasses([...names].join(' ')));
    }

    private _setClasses(classes: readonly string[]): void {
        this._styleClasses = [...classes];
        this.className = classNameWith('', this._styleClasses);
    }

    private _render(): void {
        // `null` is BOTH cases where there is no markup to draw: `use-markup` unset, and a
        // string pango itself rejects — for which GTK shows the raw text, and
        // `labelDisplayText` answers with that same C fallback.
        const render = this._useMarkup ? labelMarkupRender(this._label, this._links) : null;
        this._links = render?.links ?? [];
        const text = labelDisplayText(this._label, this._useMarkup, this._useUnderline);
        this._applyAlignment({ text });

        // `gtk_label_set_markup` puts the `link` class on the WIDGET when the markup
        // carried an `<a href>` (gtklabel.c:3896) — libadwaita's stylesheet selects on it,
        // so a port that paints a link without it is styling by its own rule.
        //
        // ONLY WHEN IT CHANGES: `_setClasses` writes `className`, and NativeScript leaves
        // that property `undefined` until something sets it — a plain label that touched it
        // on every render would hold a string where `check-nativescript-ns-defaults.mjs`
        // expects nothing.
        const hasLink = labelHasLinks(this._links);
        if (hasLink !== this._styleClasses.includes('link'))
            this._setClasses(
                hasLink ? withCssClass(this._styleClasses, 'link') : withoutCssClass(this._styleClasses, 'link'),
            );

        if (render !== null && labelMarkupNeedsSpans(render)) {
            // TEXT FIRST, THEN THE SPANS. While `formattedText` is set the platform's
            // `[textProperty.setNative]` returns early, so this write is a no-op natively
            // and exists for `get_text()`; the device then re-derives `text` from the
            // spans (`formattedTextProperty.setNative` → `textProperty.nativeValueChange`,
            // `FormattedString.toString()`), which is the same string the runs were built
            // from.
            this.text = text;
            this.formattedText = labelMarkupFormattedString(
                render,
                this._useUnderline,
                // `<big>`/`<small>` need an absolute base and skip without one — see
                // `label-markup.ts`. Only a size something has WRITTEN counts; the theme's
                // own is in the CSS engine, not on this property.
                this.style.fontSize,
                (index) => this._activateLink(index),
            );
            return;
        }

        // THE SPANS GO FIRST on the way back, and that order is not interchangeable:
        // clearing `formattedText` calls `textProperty.nativeValueChange(this, '')`, so a
        // `text` written before it would be wiped to the empty string.
        if (this.formattedText !== null && this.formattedText !== undefined) this.formattedText = null;
        this.text = text;
    }

    /**
     * `emit_activate_link` for the link at `index`: the user's handlers under GTK's handled
     * accumulator, then — only if none handled it — the default launch.
     *
     * The link becomes VISITED whenever the emission was handled, INCLUDING by a handler
     * that cancelled the launch (gtklabel.c:2053, `if (handled && !link->visited)`): GTK
     * reads a TRUE as "this link has been followed, my way". `Gtk.LinkButton` differs — it
     * sets `visited` inside its own default handler, which a cancelling handler skips — and
     * the two are not the same rule.
     */
    private _activateLink(index: number): void {
        const link = this._links[index];
        if (link === undefined) return;
        const visited = labelActivateLink(link.href, {
            // `GTK_IS_WINDOW (gtk_widget_get_root (widget))` — a label with no window above
            // it launches nothing. `isLoaded` is this surface's version of that question:
            // it is `ViewBase._isLoaded`, set when the view is attached to the visual tree
            // a platform window owns.
            rooted: this.isLoaded,
            emit: () => {
                const accumulator = new HandledAccumulator();
                this.notify({ eventName: ACTIVATE_LINK, object: this, uri: link.href, accumulator } as EventData);
                return accumulator.stopped;
            },
            launch: (uri) => this.launch(uri),
        });
        if (visited) this._links = labelLinkVisited(this._links, index);
    }

    /**
     * The launcher call, on its own method so a caller (or a spec) can stand in for the
     * app the host would have opened — the same door `Adw.AboutDialog` uses on this
     * surface, because the two must not disagree about what following a link does. A URI
     * the host cannot launch is dropped, as a failed launch is.
     */
    protected launch(uri: string): void {
        try {
            appInfo.launch_default_for_uri(uri, null);
        } catch {
            // no scheme, nothing to open
        }
    }
}

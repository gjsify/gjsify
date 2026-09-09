// GtkLabel — a run of text, for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1). libadwaita ships no label
// type; it styles GTK's through `_labels.scss` (`.title-1`, `.dimmed`, …), which is what
// the style-class methods below carry. So this is `Gtk.Label`, and there is no `adw-`
// spelling of it.
//
// WHY IT EXISTS, when `@nativescript/core` already has a `Label`. The same measurement that
// bought `Gtk.Box`: three documented gallery panes reached into `@nativescript/core` for a
// `Label` because the port had none under the GIR name, and a pane that imports the
// platform's primitives is a different PROGRAM from the `gjs` pane beside it (ADR 0034
// § Amendment 14). It extends the real `Label`, and adds the three things the platform has
// no word for — `label` with GTK's markup and mnemonic rules, `wrap` under GTK's name, and
// `add_css_class`.
//
// WHAT IT DOES WITH MARKUP, STATED HERE AND NOT LEFT IMPLICIT. `use-markup` is honoured by
// REDUCING the markup to its plain text, never by rendering it: NativeScript's `Label.text`
// is literal and its `formattedText` takes objects rather than a markup string, so there is
// no parser to hand Pango markup to. Unparseable markup keeps the raw string, which is the C
// fallback. The reasoning, and the reason this is the honest answer rather than a
// pass-through, is in `label-text.ts` — one file, because `Adw.Banner` already made this
// decision and the port should have ONE answer to markup rather than one per widget.
//
// `use-markup` DEFAULTS TO FALSE, as in GTK, and that is what keeps this port clear of the
// failure the other direction has: a widget that parses markup by default blanks a label
// containing a `<` in ordinary prose. Nothing here parses unless asked, and when asked it
// strips.
//
// WHAT IT DOES NOT DO: everything Pango. `attributes`, `ellipsize`, `justify`,
// `natural-wrap-mode`, `wrap-mode`, `lines`, `width-chars`, `max-width-chars`, `tabs`,
// `xalign`/`yalign`, `selectable` and the mnemonic-widget link are declared gaps in
// `check-nativescript-widget-coverage.mjs`. A NativeScript `Label` exposes `text`,
// `textWrap` and `textAlignment` and no text-layout engine behind them, so most of those
// have nothing to reach; `xalign` is a continuum where `textAlignment` has three positions,
// and `horizontalAlignment` is the property a caller actually has here.
//
// Reference: refs/gtk gtk/gtklabel.c (GtkLabel)
// Reference: refs/libadwaita/src/stylesheet/widgets/_labels.scss
// Copyright (c) The GTK Team, GNOME contributors. LGPLv2.1+.

import { Label } from '@nativescript/core';

import { labelDisplayText } from './label-text.js';
import { classNameWith, normalizeStyleClasses, withCssClass, withoutCssClass } from './style-classes.js';
import { xmlBoolean } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';

export class GtkLabel extends withSignals(Label) {
    private _label = '';
    private _useMarkup = false;
    private _useUnderline = false;
    private _styleClasses: string[] = [];

    constructor(props?: ConstructProps<GtkLabel>) {
        super();

        // NO BASE CLASS OF ITS OWN, and no `className` write — the same answer `GtkBox`
        // gives: GTK's `label` is a CSS NAME and never a member of `css-classes`, and
        // libadwaita's label looks are all opt-in style classes. So the list starts empty
        // and holds exactly what a caller puts in it.
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
     * TRUE means the markup is REDUCED to its plain text here, not rendered: see the
     * header. FALSE, the default, shows the string literally, so a `<` in a sentence stays
     * a `<`.
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
     * wraps at word boundaries and offers no choice.
     */
    get wrap(): boolean {
        return this.textWrap;
    }

    set wrap(raw: boolean | string) {
        this.textWrap = xmlBoolean(raw, this.textWrap);
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
        this.text = labelDisplayText(this._label, this._useMarkup, this._useUnderline);
    }
}

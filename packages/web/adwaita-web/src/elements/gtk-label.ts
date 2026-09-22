// <gtk-label> — a run of text, and the node libadwaita's typography classes are written
// for (`.title-1` … `.caption`, `.dimmed`, `_labels.scss`).
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1): libadwaita ships no label
// type, so there is no `adw-` spelling. `_labels.scss` used to argue there should be no
// element at all — a `<span>` with a class does everything a hand-written page needs. What
// it cannot do is be the target of an authored tree: a Blueprint `Gtk.Label { label: …; }`
// mounted through `mountSharedTree` arrives as a TAG with a `label` attribute, and without
// an element that reads it the text never reached the screen.
//
// THE TEXT IS WRITTEN AS TEXT. `use-markup` is honoured by REDUCING the markup to its
// plain text (`labelDisplayText` in `@gjsify/adwaita-core`, the reduction the NativeScript
// label shares), never by handing it to `innerHTML`, which would run whatever the string
// carries. GTK draws the bold; this port shows the word. `use-underline` strips the
// mnemonic marker and binds no key.
//
// `xalign` IS WHERE THE TEXT SITS IN THE LABEL'S BOX, `justify` how its LINES align with
// each other — two properties, as in GTK. `xalign` is a continuum and CSS alignment has
// three keywords, so the box splits its free space between two spacers in the ratio
// `xalign : 1 − xalign` (`_labels.scss`), which is the C's `xalign * (width − text width)`
// to the pixel, and mirrors in RTL as `gtk_label` does. `justify` maps through Pango's own
// switch: LEFT and RIGHT are START and END of the text direction, FILL is start-aligned
// lines with inter-word justification.
//
// NOT HERE, and declared in `check-adwaita-element-properties.mjs`: `ellipsize`,
// `wrap-mode`, `natural-wrap-mode`, `lines`, `width-chars`, `max-width-chars`,
// `single-line-mode`, `yalign` and the mnemonic machinery. `selectable` is only the
// ability to select; there is no caret or context menu.
//
// Reference: refs/gtk/gtk/gtklabel.c (properties, the `label` CSS name, the justify switch)
// Reference: refs/libadwaita/src/stylesheet/widgets/_labels.scss (`label {}`)
// Copyright (c) The GTK Team, GNOME contributors. LGPLv2.1+.

import {
    labelDisplayText,
    normalizeLabelJustify,
    normalizeLabelXalign,
    type LabelJustification,
} from '@gjsify/adwaita-core';

/** The attributes that carry a property — also the `notify::` roster. */
const PROPERTY_ATTRIBUTES = [
    'label',
    'use-markup',
    'use-underline',
    'justify',
    'xalign',
    'wrap',
    'selectable',
] as const;

/** `Gtk.Justification` as a CSS `text-align`, through Pango's switch in `gtklabel.c`. */
const JUSTIFY_TEXT_ALIGN: Record<LabelJustification, string> = {
    left: 'start',
    right: 'end',
    center: 'center',
    fill: 'justify',
};

export class GtkLabel extends HTMLElement {
    static get observedAttributes() {
        return [...PROPERTY_ATTRIBUTES];
    }

    /** `Gtk.Label:label` — the text as written, before markup and the mnemonic come out. */
    get label(): string {
        return this.getAttribute('label') ?? '';
    }

    set label(value: string) {
        this.setAttribute('label', value ?? '');
    }

    /** `Gtk.Label:use-markup` — whether {@link label} is Pango markup (shown as its text). */
    get useMarkup(): boolean {
        return this.hasAttribute('use-markup');
    }

    set useMarkup(value: boolean) {
        this.toggleAttribute('use-markup', !!value);
    }

    /** `Gtk.Label:use-underline` — whether an `_` marks a mnemonic (stripped, not bound). */
    get useUnderline(): boolean {
        return this.hasAttribute('use-underline');
    }

    set useUnderline(value: boolean) {
        this.toggleAttribute('use-underline', !!value);
    }

    /** `Gtk.Label:justify` — how the lines align with each other. Defaults to `left`. */
    get justify(): LabelJustification {
        return normalizeLabelJustify(this.getAttribute('justify'));
    }

    set justify(value: LabelJustification) {
        this.setAttribute('justify', value);
    }

    /** `Gtk.Label:xalign` — where the text sits in the label's box, 0…1. Defaults to 0.5. */
    get xalign(): number {
        return normalizeLabelXalign(this.getAttribute('xalign'));
    }

    set xalign(value: number) {
        this.setAttribute('xalign', String(value));
    }

    /** `Gtk.Label:wrap` — whether the text breaks into lines rather than overflowing. */
    get wrap(): boolean {
        return this.hasAttribute('wrap');
    }

    set wrap(value: boolean) {
        this.toggleAttribute('wrap', !!value);
    }

    /** `Gtk.Label:selectable` — whether the text can be selected. GTK's default is not. */
    get selectable(): boolean {
        return this.hasAttribute('selectable');
    }

    set selectable(value: boolean) {
        this.toggleAttribute('selectable', !!value);
    }

    /** `gtk_label_get_text` — the text as SHOWN, markup reduced and the marker removed. */
    getText(): string {
        return labelDisplayText(this.label, this.useMarkup, this.useUnderline);
    }

    connectedCallback() {
        this._render();
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null) {
        this._render();
        const next = this._normalized(name, value);
        if (next === this._normalized(name, old)) return;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: next } }));
    }

    private _normalized(name: string, raw: string | null): string | number | boolean {
        if (name === 'label') return raw ?? '';
        if (name === 'justify') return normalizeLabelJustify(raw);
        if (name === 'xalign') return normalizeLabelXalign(raw);
        return raw !== null;
    }

    private _render(): void {
        // `textContent`, the whole of the XSS answer: whatever the label holds, the DOM
        // gets one text node.
        const text = this.getText();
        if (this.textContent !== text) this.textContent = text;
        this.style.setProperty('--gtk-label-xalign', String(this.xalign));
        this.style.textAlign = JUSTIFY_TEXT_ALIGN[this.justify];
    }
}

customElements.define('gtk-label', GtkLabel);

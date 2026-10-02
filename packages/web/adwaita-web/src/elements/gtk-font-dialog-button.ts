// <gtk-font-dialog-button> — a button that shows a font and opens a chooser for it. GTK's
// is a `GtkWidget` holding a plain `GtkButton` whose CHILD is a box of the family label
// and a size box made of a separator and the size label (gtkfontdialogbutton.c:118-152),
// with the CSS node `fontbutton > button.font`.
//
// THE LABEL IS GTK'S, PORTED WHOLE. `update_font_info` (:649-687) is three rules and all
// three are visible:
//
//   · the family label is the family NAME at `level: family`, and `family face` above it
//     — with `C_("font", "None")` standing in for a family that was never set;
//   · the size label is `%2.4g` of the size, `px` appended when the size is absolute
//     (:669-673), and it is only computed at `level` FONT or above;
//   · the size BOX — the separator and that label — is visible at `level` FONT and above
//     and gone below it, so a family chooser shows one word where a font chooser shows
//     two.
//
// `use-font` and `use-size` are `apply_use_font` (:689-720): the family label is drawn in
// the selected font or not at all, and `use-size` decides whether the SIZE is drawn in it
// too — `PANGO_FONT_MASK_SIZE` is unset when it is not. `font-features` and `language`
// ride along with it, and CSS takes both in the syntax Pango writes them, so neither needs
// a translation.
//
// THE FACE IS THE PART A BROWSER CANNOT LOOK UP. `update_font_data` (:601-647) walks
// Pango's font map for the family and then its faces, comparing each face's description
// with `font_description_style_equal` to find the one that matches, and the label prints
// its face name. A page has no font map: `document.fonts` is the faces the DOCUMENT
// declares, and `FontFaceSet.check()` is the only question a browser will answer about a
// description — "can this combination render at all". So the face here is that answer, and
// a combination the page cannot render has no face name, exactly as a family Pango has no
// face for has none.
//
// THE CHOOSER, then. Presenting a `GtkFontDialog` is GTK's job and the browser has no
// font API to do it with, so this element's dialog is a popover over the combinations
// `document.fonts.check()` accepts for the families the document declares — the (weight,
// slant) grid a family really exposes — plus whatever the button already holds. What
// choosing one writes is GTK's, per level: a FAMILY pick builds a fresh description
// carrying the family alone (:449-458), a FACE pick carries the family and its style
// (:480-490), and a FONT or FEATURES pick carries the whole thing (:500-510).
//
// The sensitivity rule is the colour button's, from the same C shape
// (gtkfontdialogbutton.c:433-439): `dialog != NULL && cancellable == NULL`, so the button
// is dead until a dialog is set — from markup with the `dialog` attribute, from code with
// the `dialog` property.
//
// A11Y: GTK's role is GROUP (:426). The size label carries the size as text, because that
// is what the C puts there; `aria-haspopup` marks the button, matching the C's
// HAS_POPUP (:154-157).
//
// Reference: refs/gtk/gtk/gtkfontdialogbutton.c (font_desc, level, use_font, use_size,
//   update_font_info, apply_use_font, the sensitivity rule, the chosen handlers)
// Reference: refs/libadwaita/src/stylesheet/widgets/_linked.scss:7 (`fontbutton > button`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    PANGO_FONT_DESCRIPTION_DEFAULT,
    cssFontFeatureTags,
    cssFontParts,
    cssFontShorthand,
    fontDescriptionEqual,
    formatFontDescription,
    formatFontSize,
    parseFontDescription,
    type PangoFontDescription,
} from '../font-description.js';

// SIDE-EFFECT imports, for the reason `gtk-menu-button.ts` carries one: the popover
// binding is used in type position only, so a combined `import { GtkPopover }` would be
// elided by TypeScript and take the registration with it.
import './gtk-popover.js';
import type { GtkPopover } from './gtk-popover.js';

import './gtk-separator.js';

/** `GtkFontLevel`'s four values, under the nicks a string property carries. */
export type FontLevel = 'family' | 'face' | 'font' | 'features';

const LEVELS: readonly FontLevel[] = ['family', 'face', 'font', 'features'];

/** `GtkFontDialog`'s own parameters; `font-map` has no browser counterpart and is absent. */
export interface FontDialogParameters {
    /** Whether the chooser is modal. Default `TRUE`, as in the GIR. */
    modal?: boolean;
    /** The chooser's title. Default `null`. */
    title?: string | null;
    /** The language font features are resolved against. Default `null`. */
    language?: string | null;
    /** Whether only scalable fonts are offered. */
    filter?: number;
}

/**
 * The (weight, slant) grid a font family exposes — the four faces a family really
 * declares, and the four `FontFaceSet.check()` can answer for. Pango's ladder has twelve
 * weights; a browser page cannot ask which of them a family has beyond whether it renders
 * them, and a chooser listing nine unverified weights per family is worse than one listing
 * the four it can see.
 */
const FACE_GRID: readonly { weight: number; slant: PangoFontDescription['slant'] }[] = [
    { weight: 400, slant: 'normal' },
    { weight: 700, slant: 'normal' },
    { weight: 400, slant: 'italic' },
    { weight: 700, slant: 'italic' },
];

export class GtkFontDialogButton extends HTMLElement {
    private _buttonEl!: HTMLButtonElement;
    private _labelEl!: HTMLSpanElement;
    private _sizeBoxEl!: HTMLSpanElement;
    private _sizeLabelEl!: HTMLSpanElement;
    private _dockEl!: GtkPopover;
    private _selectEl!: HTMLSelectElement;
    private _desc: PangoFontDescription = { ...PANGO_FONT_DESCRIPTION_DEFAULT };
    private _dialog: FontDialogParameters | null = null;
    private _features = '';
    private _language: string | null = null;
    private _pending = false;
    private _initialized = false;

    static get observedAttributes() {
        return ['font-desc', 'font-features', 'language', 'level', 'use-font', 'use-size', 'dialog', 'disabled'];
    }

    /** `GtkFontDialogButton:font-desc` — the selected font, as a plain value. */
    get fontDesc(): PangoFontDescription {
        return { ...this._desc };
    }

    set fontDesc(value: PangoFontDescription | string) {
        const next = typeof value === 'string' ? parseFontDescription(value) : value;
        // `set_font_desc` returns early when `pango_font_description_equal` holds
        // (:869-871), and `font-desc` is `G_PARAM_EXPLICIT_NOTIFY`.
        if (fontDescriptionEqual(next, this._desc)) return;
        this._desc = { ...next };
        this._render();
        this.dispatchEvent(
            new CustomEvent('notify::font-desc', { bubbles: true, detail: { fontDesc: this.fontDesc } }),
        );
    }

    /** `GtkFontDialogButton:font-features` — Pango's comma-separated feature list. */
    get fontFeatures(): string {
        return this._features;
    }

    set fontFeatures(value: string) {
        if (this._features === value) return; // `g_strcmp0` guard (:922-923)
        this._features = value;
        this._render();
        this.dispatchEvent(new CustomEvent('notify::font-features', { bubbles: true, detail: { value } }));
    }

    /** `GtkFontDialogButton:language` — the language font features resolve against. */
    get language(): string | null {
        return this._language;
    }

    set language(value: string | null) {
        if (this._language === value) return; // `self->language == language` (:979-980)
        this._language = value;
        this._render();
        this.dispatchEvent(new CustomEvent('notify::language', { bubbles: true, detail: { value } }));
    }

    /** `GtkFontDialogButton:level` — how much of the font the chooser offers. */
    get level(): FontLevel {
        const value = this.getAttribute('level');
        return LEVELS.find((level) => level === value) ?? 'font';
    }

    set level(value: FontLevel) {
        this.setAttribute('level', value);
    }

    /** `GtkFontDialogButton:use-font` — draw the family label in the selected font. */
    get useFont(): boolean {
        return this.hasAttribute('use-font');
    }

    set useFont(value: boolean) {
        this.toggleAttribute('use-font', !!value);
    }

    /** `GtkFontDialogButton:use-size` — draw the selected SIZE in the label too. */
    get useSize(): boolean {
        return this.hasAttribute('use-size');
    }

    set useSize(value: boolean) {
        this.toggleAttribute('use-size', !!value);
    }

    /** `GtkFontDialogButton:dialog` — the chooser this button opens, or `null` for none. */
    get dialog(): FontDialogParameters | null {
        return this._dialog;
    }

    set dialog(value: FontDialogParameters | null) {
        if (this._dialog === value) return;
        this._dialog = value;
        this._renderSensitivity();
        this.dispatchEvent(new CustomEvent('notify::dialog', { bubbles: true, detail: { dialog: value } }));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;
        this.setAttribute('role', 'group');

        this._labelEl = document.createElement('span');
        this._labelEl.className = 'font-button-label';
        this._sizeLabelEl = document.createElement('span');
        this._sizeLabelEl.className = 'font-button-size-label';
        const separator = document.createElement('gtk-separator');
        separator.setAttribute('orientation', 'vertical');
        this._sizeBoxEl = document.createElement('span');
        this._sizeBoxEl.className = 'font-button-size';
        this._sizeBoxEl.append(separator, this._sizeLabelEl);

        this._buttonEl = document.createElement('button');
        this._buttonEl.type = 'button';
        // `gtk_widget_add_css_class (self->button, "font")` (:152).
        this._buttonEl.className = 'adw-button font';
        this._buttonEl.setAttribute('aria-haspopup', 'dialog');
        this._buttonEl.append(this._labelEl, this._sizeBoxEl);

        this._selectEl = document.createElement('select');
        this._selectEl.className = 'font-button-chooser';
        this._selectEl.addEventListener('change', () => this._choose());

        this._dockEl = document.createElement('gtk-popover') as GtkPopover;
        this._dockEl.classList.add('font-button-popover');
        this._dockEl.replaceChildren(this._selectEl);
        this._dockEl.anchor = this._buttonEl;

        this.replaceChildren(this._buttonEl, this._dockEl);

        this._buttonEl.addEventListener('click', () => this.activate());
        this._dockEl.subscribe((open) => {
            if (!open) this._pending = false;
            this._renderSensitivity();
        });

        // The attribute doors, applied once the tree exists.
        if (this.hasAttribute('dialog')) this.dialog = {};
        for (const attribute of ['font-desc', 'font-features', 'language'] as const) {
            const authored = this.getAttribute(attribute);
            if (authored === null) continue;
            if (attribute === 'font-desc') this.fontDesc = authored;
            else if (attribute === 'font-features') this.fontFeatures = authored;
            else this.language = authored;
        }
        this._render();
    }

    attributeChangedCallback(name?: string) {
        if (!this._initialized) return;
        switch (name) {
            case 'font-desc': {
                const authored = this.getAttribute('font-desc');
                if (authored !== null) this.fontDesc = authored;
                return;
            }
            case 'font-features':
                this.fontFeatures = this.getAttribute('font-features') ?? '';
                return;
            case 'language':
                this.language = this.getAttribute('language');
                return;
            case 'dialog':
                this.dialog = this.hasAttribute('dialog') ? (this._dialog ?? {}) : null;
                return;
            case 'disabled':
                this._renderSensitivity();
                return;
            default:
                this._render();
        }
    }

    /**
     * The `::activate` action signal (:405-418), bound to `gtk_widget_activate (self->button)`
     * (:540-546): activating the widget and pressing the button are the same thing, and
     * both present the chooser.
     */
    activate(): void {
        this.dispatchEvent(new CustomEvent('activate', { bubbles: true }));
        this._openChooser();
    }

    /** `button_clicked` (:548-585), with the level deciding which C handler would answer. */
    private _openChooser(): void {
        if (this._dialog === null || this._pending) return;
        this._pending = true;
        this._renderSensitivity();
        this._selectEl.replaceChildren(...this._options());
        this._dockEl.popup();
    }

    /**
     * The combinations this page can actually render, plus the one already held.
     *
     * `FontFaceSet.check()` is the browser's font map in one call, and it is a QUESTION
     * ABOUT A DESCRIPTION, which is exactly the shape of Pango's face walk: the family is
     * the outer loop, the face the inner one, and a combination that does not render is
     * the face the family does not have.
     */
    private _options(): HTMLOptionElement[] {
        const families = new Set<string>();
        for (const face of document.fonts) if (face.family) families.add(face.family);
        if (this._desc.family !== '') families.add(this._desc.family);

        const options: HTMLOptionElement[] = [];
        const seen = new Set<string>();
        const add = (description: PangoFontDescription) => {
            const key = formatFontDescription(description);
            if (seen.has(key)) return;
            seen.add(key);
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            options.push(option);
        };
        add(this._desc);
        for (const family of [...families].sort()) {
            for (const { weight, slant } of FACE_GRID) {
                const candidate: PangoFontDescription = { ...this._desc, family, weight, slant };
                if (!document.fonts.check(cssFontShorthand(candidate, true))) continue;
                add(candidate);
            }
        }
        return options;
    }

    /** The four `*_chosen` handlers (:441-538), by level. */
    private _choose(): void {
        const chosen = parseFontDescription(this._selectEl.value);
        const level = this.level;
        if (level === 'family') {
            // `family_chosen`: a fresh description carrying the family and nothing else.
            this.fontDesc = { ...PANGO_FONT_DESCRIPTION_DEFAULT, family: chosen.family };
        } else if (level === 'face') {
            // `face_chosen`: `pango_font_face_describe`, which is family + this face.
            this.fontDesc = { ...chosen, size: this._desc.size, absolute: this._desc.absolute };
        } else {
            // `font_chosen` and `font_and_features_chosen`: the whole description.
            this.fontDesc = chosen;
        }
        this._pending = false;
        this._dockEl.popdown();
        this._renderSensitivity();
    }

    /** `update_button_sensitivity` (:433-439), as the colour button's is (:380-391). */
    private _renderSensitivity(): void {
        const sensitive = this._dialog !== null && !this.hasAttribute('disabled');
        this._buttonEl.disabled = !sensitive;
        this._buttonEl.classList.toggle('disabled', !sensitive);
    }

    /** `update_font_info` (:649-687) plus `apply_use_font` (:689-720). */
    private _render(): void {
        if (!this._initialized) return;
        const level = this.level;
        const face = this._faceName();
        // `fam_name` is `C_("font", "None")` when no family was ever set (:653-656), and the
        // label is the family alone at level FAMILY and `family face` above it (:658-665).
        // The C concatenates with a space whether or not the face is there, so the two are
        // joined as parts here and a regular face leaves no trailing space.
        const parts = [this._desc.family === '' ? 'None' : this._desc.family];
        if (level !== 'family' && face !== '') parts.push(face);
        this._labelEl.textContent = parts.join(' ');

        // The size box is visible from FONT up, and the size is only computed there.
        this._sizeBoxEl.hidden = level === 'family' || level === 'face';
        if (!this._sizeBoxEl.hidden) {
            this._sizeLabelEl.textContent = formatFontSize(this._desc.size, this._desc.absolute);
        }

        // `apply_use_font` sets or CLEARS the whole attribute list, and it is the four
        // longhands rather than the `font` shorthand: a shorthand is all-or-nothing, so one
        // value the browser rejects would discard the family with it.
        const style = this._labelEl.style;
        if (this.useFont) {
            const parts = cssFontParts(this._desc, this.useSize);
            style.fontFamily = parts.fontFamily;
            style.fontWeight = parts.fontWeight;
            style.fontStyle = parts.fontStyle;
            style.fontStretch = parts.fontStretch;
            // An unset size means "do not set it", which is what `PANGO_FONT_MASK_SIZE`
            // cleared means — so the longhand is emptied rather than given a default.
            style.fontSize = parts.fontSize;
            // Tag by tag: a `font-feature-settings` value is dropped whole when any tag in
            // it is unknown (measured in Firefox), so one rejection must not cost the rest.
            style.fontFeatureSettings = '';
            for (const tag of cssFontFeatureTags(this._features)) {
                style.fontFeatureSettings = tag;
                if (style.fontFeatureSettings === '') continue; // rejected: leave it unset
                break;
            }
            this._labelEl.lang = this._language ?? this._dialog?.language ?? '';
        } else {
            style.fontFamily = '';
            style.fontWeight = '';
            style.fontStyle = '';
            style.fontStretch = '';
            style.fontSize = '';
            style.fontFeatureSettings = '';
            this._labelEl.lang = '';
        }
        this._renderSensitivity();
    }

    /**
     * `font_description_style_equal` against the faces the page declares — the stand-in for
     * the font-map walk `update_font_data` performs, and the name it prints when there is
     * one.
     */
    private _faceName(): string {
        const style = cssFontShorthand(this._desc, true);
        if (this._desc.family === '' || !document.fonts.check(style)) return '';
        const words: string[] = [];
        if (this._desc.slant === 'italic') words.push('Italic');
        else if (this._desc.slant === 'oblique') words.push('Oblique');
        if (this._desc.weight !== 400) words.push(this._desc.weight >= 700 ? 'Bold' : 'Light');
        if (this._desc.width === 'condensed') words.push('Condensed');
        else if (this._desc.width === 'expanded') words.push('Expanded');
        return words.join(' ');
    }
}

customElements.define('gtk-font-dialog-button', GtkFontDialogButton);
